// What the sim's accelerometer would read in the owner's chop (specific force in g, body axes; thrust axis = body y),
// measured like chop_acc.py measures the real logs: mean |f| 0.3 s before the chop, mean and peak 0.1-0.4 s after.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = 'G:/openworldfpvsim';
const REPLAY = ROOT + '/docs/evidence/2026-10-20-windmill/replay/';
test('acc', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import(ROOT + '/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const t0 = 4187;
    for (const id of ['original', 'supafly5']) {
        const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
        tunes.tuneOverrides(id, o);
        if (id === 'supafly5') o.dynIdle = { ...o.dynIdle, minRpm: 30 };
        const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
        let pv = [0, 0, 0]; const bef: number[] = [], aft: number[] = [], body: number[][] = []; let speed = 0;
        for (const row of sticks) {
            sim.setChannels(row.slice(1)); sim.step();
            const s = sim.s; const v = [s[S.vx], s[S.vy], s[S.vz]];
            const f = [(v[0] - pv[0]) / 0.001, (v[1] - pv[1]) / 0.001 + 9.81, (v[2] - pv[2]) / 0.001]; pv = v;
            const t = row[0] - t0;
            const w = s[S.qw], x = s[S.qx], y = s[S.qy], z = s[S.qz];
            const xb = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
            const yb = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
            const zb = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
            const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            const fb = [dot(f, xb), dot(f, yb), dot(f, zb)].map((q) => q / 9.81); const m = Math.hypot(fb[0], fb[1], fb[2]);
            if (t >= -300 && t < 0) bef.push(m);
            if (t >= 100 && t <= 400) { aft.push(m); body.push(fb); }
            if (t === 0) speed = Math.hypot(v[0], v[1], v[2]);
        }
        const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
        const bm = [0, 1, 2].map((k) => mean(body.map((r) => r[k])).toFixed(2));
        console.log(`${id}: speed at chop ${speed.toFixed(1)} m/s; |f| before ${mean(bef).toFixed(2)} g, after ${mean(aft).toFixed(2)} g (peak ${Math.max(...aft).toFixed(2)}), body x/y(thrust)/z after ${bm.join(' ')}`);
    }
});
