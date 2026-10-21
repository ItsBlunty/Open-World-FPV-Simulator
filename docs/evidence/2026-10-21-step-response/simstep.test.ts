// A 90 s acro flight in open air with pilot-like roll/pitch stick moves (ramps of 40-150 ms to random targets, held
// 0.15-0.8 s, fixed pseudo-random list) around hover throttle, logged as setpoint and filtered gyro (Betaflight's
// gyro LPF1 PT1 250 Hz + LPF2 PT1 500 Hz, as the sim's controller sees it) for step_response.py. ROOT: sim-core copy
// (the repo, or the experiment copy with switches); VARIANT JSON: tune, inertia multiplier, propInertia, dead (ms).
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('simstep', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const v = JSON.parse(process.env.VARIANT ?? '{}'); const fast = v.fast ?? 0; const sgn = v.sgn ?? 1;
    const g = globalThis as any; g.K_DEAD = v.dead ?? 0; g.K_ASYM = null; g.K_CMD = null; g.K_BAND = 1; g.K_SIMMONS = 0; g.K_LAG = 0; g.K_DAMP = 0;
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    if (v.inertia) { preset.fields.inertia_roll_pitch_kgm2.value *= v.inertia; preset.fields.inertia_yaw_kgm2.value *= v.inertia; }
    const o: any = {}; tunes.tuneOverrides(v.tune ?? 'original', o); if (v.pi) o.propInertia = v.pi;
    const sim = new sc.Sim(sc.compileParams(preset, o), null); const S = sc.S;
    sim.reset(0, 5000, 0, 0);
    const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch);
    for (let i = 0; i < 200; i++) sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    // stick targets per axis: ramp then hold
    const ax = [0, 1].map(() => ({ from: 0, to: 0, t0: 0, ramp: 1, hold: 0 }));
    const kf1 = 0.001 / (1 / (2 * Math.PI * 250) + 0.001), kf2 = 0.001 / (1 / (2 * Math.PI * 500) + 0.001);
    const f = [[0, 0], [0, 0]];
    const rows = ['time,setpoint[0],setpoint[1],gyroADC[0],gyroADC[1]'];
    const hover = 2 * Math.sqrt(1 / 4.5) - 1; // about hover for a 4.5:1 quad, corrected below by a slow height hold
    let thrTrim = 0;
    for (let ms = 0; ms < 90000; ms++) {
        for (let k = 0; k < 2; k++) {
            const a = ax[k];
            if (ms >= a.t0 + a.ramp + a.hold) { a.from = a.to; a.to = (rnd() * 2 - 1) * (rnd() < 0.3 ? 0.9 : 0.45); a.t0 = ms; a.ramp = 40 + Math.floor(rnd() * 110); a.hold = 150 + Math.floor(rnd() * 650); if (rnd() < 0.35) a.to = 0; }
            const u = Math.min(1, (ms - a.t0) / a.ramp); ch[k] = a.from + (a.to - a.from) * u;
        }
        if (fast) {
            // fast forward flight: a slow pilot loop holds the nose `fast` deg down and the wings level under the
            // random moves (half size), throttle from the vertical speed
            const at = sc.attitude(sim.s);
            ch[0] = ch[0] * 0.5 + Math.max(-0.5, Math.min(0.5, -at.roll * 0.01 * sgn));
            ch[1] = ch[1] * 0.5 + Math.max(-0.5, Math.min(0.5, (fast - at.pitch) * 0.01 * sgn));
        }
        // keep roughly level flight height: throttle from the vertical speed (pilot-like, slow)
        thrTrim += -sim.s[S.vy] * 0.00002; thrTrim = Math.max(-0.4, Math.min(1.2, thrTrim)); if (v.thr !== undefined) thrTrim = v.thr - hover;
        ch[2] = Math.max(-1, Math.min(1, hover + thrTrim));
        if (ms % 10000 === 0 && process.env.DBG) console.log('t', ms, 'speed', Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]).toFixed(1), 'pitch', sc.attitude(sim.s).pitch.toFixed(0), 'roll', sc.attitude(sim.s).roll.toFixed(0), 'y', sim.s[S.py].toFixed(0));
        sim.setChannels(ch); sim.step();
        const gr = -sim.s[S.wz] * 57.29578, gp = -sim.s[S.wx] * 57.29578;
        f[0][0] += (gr - f[0][0]) * kf1; f[0][1] += (f[0][0] - f[0][1]) * kf2;
        f[1][0] += (gp - f[1][0]) * kf1; f[1][1] += (f[1][0] - f[1][1]) * kf2;
        rows.push(`${ms * 1000},${sim.s[S.spR]},${sim.s[S.spP]},${f[0][1]},${f[1][1]}`);
    }
    writeFileSync(process.env.OUT!, rows.join('\n'));
});
