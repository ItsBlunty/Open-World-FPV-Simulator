// The Nazgul (sim-core as on this branch) chopped at a set airspeed, sticks centred in acro, to compare with real
// chops at GPS-known speeds. Start: attitude set (level flight: nose tilted so the thrust axis leans forward; climb:
// thrust axis along the velocity, the post-punch case), velocity set, throttle held 0.3 s, then ramped to zero over
// 150 ms. Measured in 0.15-1.0 s after the ramp starts: max |gyro| roll/pitch (setpoint 0), motor command max/min,
// ms with a motor above 15 %, max |I|.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('simchop', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const S = sc.S;
    for (const classic of [false, true]) {
        for (const mode of ['level', 'climb'] as const) {
            for (const V of [10, 15, 20, 25, 30, 40]) {
                const sim = new sc.Sim(sc.compileParams(preset, { classicPhysics: classic }), null);
                sim.reset(0, 500, 0, 0);
                const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0];
                sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
                // tilt: level flight leans the thrust axis forward by th (about atan of drag/weight); climb: the thrust axis
                // points along the velocity, 60 deg above the horizon
                const th = mode === 'level' ? Math.min(75, 20 + V * 1.3) * Math.PI / 180 : 30 * Math.PI / 180;
                // rotation about body x (pitch axis): nose (-z) down by th
                const h = th / 2; sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = -Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
                const qw = sim.s[S.qw], qx = sim.s[S.qx];
                // body up (thrust) in world = (r01, r11, r21), body forward = -(r02, r12, r22)
                const upY = 1 - 2 * (qx * qx), upZ = 2 * (qw * qx);
                const fwdY = -(-2 * qw * qx), fwdZ = -(1 - 2 * qx * qx);
                if (mode === 'level') { sim.s[S.vx] = 0; sim.s[S.vy] = 0; sim.s[S.vz] = V * Math.sign(fwdZ); }
                else { sim.s[S.vx] = 0; sim.s[S.vy] = V * upY; sim.s[S.vz] = V * upZ; }
                const thrHold = mode === 'level' ? 0.25 + V / 40 * 0.5 : 0.7;
                ch[2] = thrHold * 2 - 1; sim.setChannels(ch);
                for (let i = 0; i < 300; i++) sim.step();
                const t0 = sim.tick;
                const sp0 = Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]);
                const ax0 = (sim.s[S.vx] * 0 + sim.s[S.vy] * upY + sim.s[S.vz] * upZ);
                let maxR = 0, maxP = 0, mx = 0, mn = 1, ms15 = 0, maxI = 0;
                for (let i = 0; i < 1000; i++) {
                    const k = i < 150 ? 1 - i / 150 : 0;
                    ch[2] = thrHold * k * 2 - 1; sim.setChannels(ch); sim.step();
                    if (i >= 150) {
                        maxR = Math.max(maxR, Math.abs(sim.s[S.wz]) * 57.3); maxP = Math.max(maxP, Math.abs(sim.s[S.wx]) * 57.3);
                        mx = Math.max(mx, ...sim.motorCmd); mn = Math.min(mn, ...sim.motorCmd);
                        if (Math.max(...sim.motorCmd) > 0.15) ms15++;
                        maxI = Math.max(maxI, Math.abs(sim.s[S.iR]), Math.abs(sim.s[S.iP]));
                    }
                }
                console.log(`${classic ? 'classic' : 'airflow'} ${mode.padEnd(5)} V ${String(V).padStart(2)}: at chop ${sp0.toFixed(1)} m/s (${ax0.toFixed(1)} along the thrust axis) | max |gyro| r/p ${maxR.toFixed(0).padStart(4)}/${maxP.toFixed(0).padStart(4)} deg/s | motor cmd max ${mx.toFixed(2)} min ${mn.toFixed(2)} | >15 % ${String(ms15).padStart(3)} ms | |I| ${maxI.toFixed(0)}`);
            }
        }
    }
});
