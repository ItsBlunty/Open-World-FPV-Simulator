// The owner's chop in the real sim-core, measured exactly as chop_old_long.py measures the real logs: 0-1.5 s (and
// 0-3 s) from the chop start, rms and peak of each body rate, tilt change from integrated rates, until when a motor stays
// above 15 %, for each tune.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = 'G:/openworldfpvsim';
const REPLAY = ROOT + '/docs/evidence/2026-10-20-windmill/replay/';
test('cmp', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import(ROOT + '/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S;
    // chop start: throttle stick (ch index 2) last above 0 before it reaches -0.9, after 4 s
    let t0 = 0;
    for (let k = 1; k < sticks.length; k++) if (sticks[k][0] > 4000 && sticks[k][3] < -0.9) { let j = k; while (sticks[j][3] < 0) j--; t0 = sticks[j][0]; break; }
    console.log('chop start', t0, 'ms; sticks during 1.5 s: roll/pitch/yaw max |stick|',
        [1, 2, 4].map((c) => Math.max(...sticks.filter((r) => r[0] >= t0 && r[0] < t0 + 1500).map((r) => Math.abs(r[c])))).map((v) => v.toFixed(2)).join('/'));
    for (const id of ['original', 'betaflight', 'supafly5']) {
        const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
        tunes.tuneOverrides(id, o);
        if (id === 'supafly5') o.dynIdle = { ...o.dynIdle, minRpm: 30 };
        const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
        for (const win of [1500, 3000]) {
            const sim2 = new sc.Sim(sc.compileParams(preset, o), null); sim2.reset(0, 0.105, -585, 0);
            let sa = 0, sb = 0, pa = 0, pb = 0, n = 0, ia = 0, ib = 0, tilt = 0, last = 0;
            for (const row of sticks) {
                sim2.setChannels(row.slice(1)); sim2.step();
                const t = row[0] - t0;
                if (t >= 0 && t <= win) {
                    const a = sim2.s[S.wx] * 57.3, b = sim2.s[S.wz] * 57.3;
                    sa += a * a; sb += b * b; n++; pa = Math.max(pa, Math.abs(a)); pb = Math.max(pb, Math.abs(b));
                    ia += a * 0.001; ib += b * 0.001; tilt = Math.max(tilt, Math.hypot(ia, ib));
                    if (Math.max(...sim2.motorCmd) > 0.15) last = t;
                }
            }
            console.log(`${id} 0-${win} ms: rms x/z ${Math.sqrt(sa / n).toFixed(0)}/${Math.sqrt(sb / n).toFixed(0)}, peak x/z ${pa.toFixed(0)}/${pb.toFixed(0)} deg/s, tilt change ${tilt.toFixed(1)} deg, a motor > 15 % until ${last} ms`);
        }
    }
});
