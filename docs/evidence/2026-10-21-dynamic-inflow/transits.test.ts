// sim-core's dynamic inflow against the unsteady blade-element study (../2026-10-21-unsteady-bem/transits-output.txt):
// the same rotor-speed ramps at a fixed axial airspeed (body held still, airflow along the thrust axis), prop 0's thrust
// with and without dynamic inflow, after 300 ms settling at the first speed (t 0 below); largest gap and thrust every 2 ms. And a hover rpm step: thrust against the steady
// thrust at the same rpm (the initial overshoot and how fast it settles). ROOT: the repo (or a copy).
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT ?? 'G:/openworldfpvsim';
test('transits', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const S = sc.S;
    const run = (din: boolean, V: number, r0: number, r1: number, rampMs: number, endMs: number) => {
        const p = sc.compileParams(preset, { loopHz: 4000, dynamicInflow: din, batteryDrain: false });
        const sim: any = new sc.Sim(p, null); sim.reset(0, 500, 0, 0);
        const kw = p.omegaMaxPerVolt;
        const out: number[] = []; const c = new Float64Array(4);
        const n = (endMs + 300) * 4;
        for (let k = 0; k < n; k++) {
            const t = k / 4;
            const rpm = r0 + (r1 - r0) * Math.min(Math.max((t - 305) / rampMs, 0), 1);
            const s = sim.s;
            s[S.qw] = 1; s[S.qx] = s[S.qy] = s[S.qz] = 0; s[S.wx] = s[S.wy] = s[S.wz] = 0;
            s[S.vx] = 0; s[S.vz] = 0; s[S.vy] = V; s[S.py] = 500; s[S.soc] = 0.85;
            for (let i = 0; i < 4; i++) s[S.m0 + i] = (rpm * Math.PI / 30) / (kw * s[S.volt]);
            sim.physics(c);
            if (k % 4 === 3 && k >= 1200) out.push(sim.thrust[0]);
        }
        return out;
    };
    const cases: [string, number, number, number, number][] = [
        ['climb chop 21 m/s, up over the hump in 20 ms', 21, 6400, 13600, 20],
        ['owner chop 37 m/s, up in 10 ms', 37, 14000, 21600, 10],
        ['owner chop 37 m/s, up in 5 ms', 37, 14000, 21600, 5],
        ['owner chop 37 m/s, down in 10 ms', 37, 21600, 14000, 10],
        ['hover (still air), 11 -> 15 k rpm in 1 ms', 0, 11000, 15000, 1],
        ['hover (still air), 15 -> 11 k rpm in 1 ms', 0, 15000, 11000, 1],
    ];
    for (const [name, V, r0, r1, ramp] of cases) {
        const end = ramp + 25;
        const qs = run(false, V, r0, r1, ramp, end), dy = run(true, V, r0, r1, ramp, end);
        let gap = 0; for (let j = 0; j < qs.length; j++) gap = Math.max(gap, Math.abs(dy[j] - qs[j]));
        console.log(`== ${name}: quasi-steady ${qs[0].toFixed(2)} -> ${qs[qs.length - 1].toFixed(2)} N; largest gap with dynamic inflow ${gap.toFixed(2)} N`);
        console.log('   t ms | quasi-steady | dynamic inflow');
        for (let j = 1; j < qs.length; j += 2) console.log(`   ${String(j + 1).padStart(4)} | ${qs[j].toFixed(2).padStart(6)} | ${dy[j].toFixed(2).padStart(6)}`);
    }
});
