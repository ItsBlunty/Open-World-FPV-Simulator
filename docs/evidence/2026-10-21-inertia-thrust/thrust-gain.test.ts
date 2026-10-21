// The model's motor and prop held still in an axial airflow V (air entering from above the disc, as in climbing or
// fast forward flight along the thrust axis): steady rpm and thrust per motor at commands 0.1-1.0, and the local
// gain dT/dcmd (N per unit command, from +-0.02) at each, for V = 0, 10, 20, 30, 40 m/s.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = 'G:/openworldfpvsim';
test('gain', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const S = sc.S;
    const p = sc.compileParams(preset, {});
    const steady = (cmd: number, V: number) => {
        const sim: any = new sc.Sim(p, null); sim.reset(0, 100, 0, 0);
        const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
        const c = new Float64Array(4).fill(cmd);
        for (let i = 0; i < 600; i++) {
            sim.s[S.qw] = 1; sim.s[S.qx] = sim.s[S.qy] = sim.s[S.qz] = 0; sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0;
            sim.s[S.vx] = 0; sim.s[S.vy] = V; sim.s[S.vz] = 0; sim.s[S.py] = 100; sim.s[S.soc] = 1;
            sim.tick++; sim.physics(c);
        }
        const rpm = sim.s[S.m0] * p.omegaMaxPerVolt * sim.s[S.volt] * 9.5493;
        return { rpm, T: sim.thrust[0], volt: sim.s[S.volt] };
    };
    for (const V of [0, 10, 20, 30, 40]) {
        const row: string[] = [];
        for (const cmd of [0.1, 0.2, 0.3, 0.5, 0.7, 1.0]) {
            const a = steady(cmd, V), lo = steady(Math.max(0, cmd - 0.02), V), hi = steady(Math.min(1, cmd + 0.02), V);
            const g = (hi.T - lo.T) / (Math.min(1, cmd + 0.02) - Math.max(0, cmd - 0.02));
            row.push(`${cmd.toFixed(1)}: ${a.rpm.toFixed(0)} rpm ${a.T.toFixed(2)} N dT/dc ${g.toFixed(1)}`);
        }
        console.log(`V ${String(V).padStart(2)} m/s | ` + row.join(' | '));
    }
});
