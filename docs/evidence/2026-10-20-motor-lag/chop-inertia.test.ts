// The owner's chop flight (sticks only, no world), with the motors slowed by the rotor-inertia multiplier, and the
// direct motor step for each multiplier: does matching the measured motor response change the bobble?
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('lag', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(__dirname + '/../2026-10-20-windmill/replay/sticks.json', 'utf8'));
    const S = sc.S;
    for (const pi of [1, 1.5, 2]) {
        const o = JSON.parse(readFileSync(__dirname + '/../2026-10-20-windmill/replay/overrides.json', 'utf8')); o.propInertia = pi;
        // direct step 0.055 -> 0.30 and 0.25 -> 0.40, held still
        const steps: string[] = [];
        for (const [c0, c1] of [[0.055, 0.3], [0.25, 0.4]]) {
            const sim = new sc.Sim(sc.compileParams(preset, { propInertia: pi }), null); sim.reset(0, 100, 0, 0);
            const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const hold = () => { sim.s[S.qw] = 1; sim.s[S.qx] = sim.s[S.qy] = sim.s[S.qz] = 0; sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0; sim.s[S.vx] = sim.s[S.vy] = sim.s[S.vz] = 0; sim.s[S.py] = 100; };
            const cmd = new Float64Array(4); const rpm = () => Math.abs(sim.s[S.m0]) * sim.p.omegaMaxPerVolt * sim.s[S.volt] * 9.5493;
            cmd.fill(c0); for (let i = 0; i < 1500; i++) { hold(); sim.tick++; sim.physics(cmd); }
            const r0 = rpm(); const tr: number[] = []; cmd.fill(c1); for (let i = 0; i < 400; i++) { hold(); sim.tick++; sim.physics(cmd); tr.push(rpm()); }
            const r1 = tr[tr.length - 1]; const f = (x: number) => tr.findIndex((r) => (r - r0) / (r1 - r0) >= x) + 1;
            steps.push(`${c0}->${c1}: 10 % ${f(0.1)} ms, 63 % ${f(0.632)} ms`);
        }
        // the owner's chop: 4.15-7 s
        const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
        let maxRoll = 0, maxPitch = 0, msHigh = 0, p0 = NaN, drift = 0, maxIP = 0;
        for (const row of sticks) {
            sim.setChannels(row.slice(1)); sim.step();
            const t = row[0];
            if (t >= 4150 && t < 7000) {
                const a = sc.attitude(sim.s); if (isNaN(p0)) p0 = a.pitch;
                drift = Math.max(drift, Math.abs(a.pitch - p0));
                maxRoll = Math.max(maxRoll, Math.abs(sim.s[S.wz]) * 57.3); maxPitch = Math.max(maxPitch, Math.abs(sim.s[S.wx]) * 57.3);
                if (Math.max(...sim.motorCmd) > 0.15) msHigh++;
                maxIP = Math.max(maxIP, Math.abs(sim.s[S.iP]), Math.abs(sim.s[S.iR]));
            }
        }
        console.log(`rotor inertia x${pi}: ${steps.join('; ')} | owner chop 4.15-7 s: max roll rate ${maxRoll.toFixed(0)}, max pitch rate ${maxPitch.toFixed(0)} deg/s, pitch drift ${drift.toFixed(1)} deg, motor > 15 % ${msHigh} ms, max |I| ${maxIP.toFixed(0)}`);
    }
});
