// With the measured 4 ms motor dead time (and x1.5 slower motors): is ordinary flight still stable? The owner's flight
// before the chop (0.5-4.1 s: hover, punch, fast forward flight), rms and peak of (gyro - setpoint) roll/pitch error,
// against the chop window (4.19-5.69 s, sticks centred), for each tune.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('deadflight', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks0: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; const t0 = 4187;
    const sticks = sticks0.map((r) => r[0] >= t0 ? [r[0], 0, 0, r[3], 0, ...r.slice(5)] : r);
    for (const tune of ['original', 'supafly5']) for (const v of JSON.parse(process.env.VARIANTS!)) {
        g.K_ASYM = null; g.K_BAND = 1; g.K_SIMMONS = 0; g.K_LAG = 0; g.K_DAMP = 0; g.K_DEAD = (v as any).dead ?? 0; g.K_CMD = null;
        const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
        tunes.tuneOverrides(tune, o); if (tune === 'supafly5') o.dynIdle = { ...o.dynIdle, minRpm: 30 };
        if ((v as any).pi) o.propInertia = (v as any).pi;
        const pr = JSON.parse(JSON.stringify(preset)); if ((v as any).inertia) { pr.fields.inertia_roll_pitch_kgm2.value *= (v as any).inertia; pr.fields.inertia_yaw_kgm2.value *= (v as any).inertia; }
        const sim = new sc.Sim(sc.compileParams(pr, o), null); sim.reset(0, 0.105, -585, 0);
        let e1 = 0, n1 = 0, p1 = 0, e2 = 0, n2 = 0, p2 = 0;
        for (const row of sticks) {
            sim.setChannels(row.slice(1)); sim.step();
            const t = row[0];
            const er = Math.hypot(sim.s[S.spR] !== undefined ? 0 : 0, 0);
            // body rates (deg/s) minus the setpoints the controller holds (S.spR/spP keep the last setpoint)
            const eR = -sim.s[S.wz] * 57.3 - sim.s[S.spR], eP = -sim.s[S.wx] * 57.3 - sim.s[S.spP];
            const e = Math.hypot(eR, eP);
            if (t >= 500 && t < 4100) { e1 += e * e; n1++; p1 = Math.max(p1, e); }
            if (t >= t0 && t < t0 + 1500) { e2 += e * e; n2++; p2 = Math.max(p2, e); }
        }
        console.log(`${tune.padEnd(9)} ${v.n.padEnd(24)} normal flight 0.5-4.1 s: error rms ${Math.sqrt(e1 / n1).toFixed(0)} peak ${p1.toFixed(0)} deg/s | chop 0-1.5 s: rms ${Math.sqrt(e2 / n2).toFixed(0)} peak ${p2.toFixed(0)} deg/s`);
    }
});
