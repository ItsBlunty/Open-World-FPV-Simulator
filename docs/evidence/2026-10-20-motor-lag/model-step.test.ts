// The model's motor alone: a motor-command step straight into Sim.physics (no flight controller, no throttle boost),
// held still, from idle and from hover, to compare with NeuroBEM's measured steps and fit.
import { test } from 'vitest';
const ROOT = process.env.ROOT!;
test('direct', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const { readFileSync } = await import('node:fs');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const S = sc.S;
    for (const classic of [false, true]) {
        for (const [c0, c1] of [[0.055, 0.30], [0.055, 0.40], [0.25, 0.40], [0.40, 0.25]]) {
            const sim = new sc.Sim(sc.compileParams(preset, { classicPhysics: classic }), null);
            sim.reset(0, 100, 0, 0);
            const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0];
            sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const hold = () => { sim.s[S.qw] = 1; sim.s[S.qx] = sim.s[S.qy] = sim.s[S.qz] = 0; sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0; sim.s[S.vx] = sim.s[S.vy] = sim.s[S.vz] = 0; sim.s[S.px] = 0; sim.s[S.py] = 100; sim.s[S.pz] = 0; };
            const cmd = new Float64Array(4);
            const run = (c: number, n: number, tr?: number[]) => { cmd.fill(c); for (let i = 0; i < n; i++) { hold(); sim.tick++; sim.physics(cmd); tr?.push(rpm()); } };
            const rpm = () => Math.abs(sim.s[S.m0]) * sim.p.omegaMaxPerVolt * sim.s[S.volt] * 60 / (2 * Math.PI);
            run(c0, 1500);
            const r0 = rpm(); const tr: number[] = []; run(c1, 400, tr);
            const r1 = tr[tr.length - 1];
            const f = (x: number) => tr.findIndex((r) => (r - r0) / (r1 - r0) >= x) + 1;
            let acc = 0; for (let i = 1; i < 80; i++) acc = Math.max(acc, Math.abs(tr[i] - tr[i - 1]) * 2 * Math.PI / 60 / 0.001);
            console.log(`${classic ? 'classic' : 'airflow'} cmd ${c0} -> ${c1}: ${r0.toFixed(0)} -> ${r1.toFixed(0)} rpm, 10 % at ${f(0.1)} ms, 63 % at ${f(0.632)} ms, peak accel ${acc.toFixed(0)} rad/s^2`);
        }
    }
});
