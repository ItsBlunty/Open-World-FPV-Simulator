// NeuroBEM quad preset: static thrust and hover rpm in the model (held level, motors at a command), against the paper's
// 33 N static and the logs' hover median 11 100-11 500 rpm.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
test('hover', async () => {
    const sc: any = await import('G:/openworldfpvsim/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(__dirname + '/neurobem.json', 'utf8'));
    const p = sc.compileParams(preset, { loopHz: 4000 });
    console.log('compiled: mass', p.mass, 'inertia', Array.from(p.inertia), 'twr', p.twr, 'cells', p.cells);
    for (const cmd of [0.2, 0.25, 0.3, 1.0]) {
        const sim: any = new sc.Sim(p, null); sim.reset(0, 100, 0, 0);
        const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
        const c = new Float64Array(4).fill(cmd);
        for (let i = 0; i < 8000; i++) { sim.s[sc.S.qw] = 1; sim.s[sc.S.qx] = sim.s[sc.S.qy] = sim.s[sc.S.qz] = 0; sim.s[sc.S.wx] = sim.s[sc.S.wy] = sim.s[sc.S.wz] = 0; sim.s[sc.S.vx] = sim.s[sc.S.vy] = sim.s[sc.S.vz] = 0; sim.s[sc.S.py] = 100; sim.s[sc.S.soc] = 0.8; sim.physics(c); }
        const rpm = sim.s[sc.S.m0] * p.omegaMaxPerVolt * sim.s[sc.S.volt] * 9.5493;
        console.log(`cmd ${cmd}: ${rpm.toFixed(0)} rpm, thrust total ${(4 * sim.thrust[0]).toFixed(2)} N (weight ${(p.mass * 9.81).toFixed(2)}), volt ${sim.s[sc.S.volt].toFixed(2)}`);
    }
});
