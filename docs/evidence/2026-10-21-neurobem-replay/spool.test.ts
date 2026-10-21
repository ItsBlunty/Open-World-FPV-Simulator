// The NeuroBEM preset's motor: 63 % rise and fall time for a command step 0.25 -> 0.40 -> 0.25 at hover, per propInertia.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
test('spool', async () => {
    const sc: any = await import('G:/openworldfpvsim/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(__dirname + '/neurobem.json', 'utf8'));
    for (const pi of [1, 1.3, 1.5, 1.8]) {
        const p = sc.compileParams(preset, { loopHz: 4000, propInertia: pi });
        const sim: any = new sc.Sim(p, null); sim.reset(0, 100, 0, 0);
        const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
        const hold = () => { sim.s[sc.S.qw] = 1; sim.s[sc.S.qx] = sim.s[sc.S.qy] = sim.s[sc.S.qz] = 0; sim.s[sc.S.wx] = sim.s[sc.S.wy] = sim.s[sc.S.wz] = 0; sim.s[sc.S.vx] = sim.s[sc.S.vy] = sim.s[sc.S.vz] = 0; sim.s[sc.S.py] = 100; sim.s[sc.S.soc] = 0.8; };
        const rpm = () => sim.s[sc.S.m0] * p.omegaMaxPerVolt * sim.s[sc.S.volt] * 9.5493;
        const c = new Float64Array(4);
        const stepT = (c0: number, c1: number) => { c.fill(c0); for (let i = 0; i < 4000; i++) { hold(); sim.physics(c); } const r0 = rpm(); const tr: number[] = []; c.fill(c1); for (let i = 0; i < 1000; i++) { hold(); sim.physics(c); tr.push(rpm()); } const r1 = tr[tr.length - 1]; return (tr.findIndex((r) => (r - r0) / (r1 - r0) >= 0.632) + 1) / 4; };
        console.log(`propInertia ${pi}: rise 63 % ${stepT(0.25, 0.4)} ms, fall ${stepT(0.4, 0.25)} ms (real NeuroBEM: rise 24-32, fall 20-26 after 4 ms dead time)`);
    }
});
