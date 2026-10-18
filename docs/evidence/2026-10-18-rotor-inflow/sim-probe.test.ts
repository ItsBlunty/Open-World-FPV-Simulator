import { test } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { compileParams, Sim, S, hoverSolve } from '../../../packages/sim-core/src/index';
import preset from '../../../packages/sim-core/presets/nazgulf5v3-6s.json';
const log = (t: string) => appendFileSync(new URL('sim-probe-output.txt', import.meta.url), t + String.fromCharCode(10));
function armed(classic: boolean): Sim {
    const sim = new Sim(compileParams(preset as never, { classicPhysics: classic }), null);
    sim.reset(0, 1000, 0, 0);
    const ch = [0, 0, -1, 0, -1, -1, -1, 0];
    sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
    return sim;
}
function setPitch(sim: Sim, deg: number) { const h = -deg * Math.PI / 360; sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0; }
function run(sim: Sim, thr: number, secs: number, pitch?: number, every = 500) {
    sim.setChannels([0, 0, thr, 0, 1, -1, -1, 0]); const out: string[] = [];
    for (let i = 1; i <= secs * 1000; i++) {
        if (pitch !== undefined) { setPitch(sim, pitch); sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0; }
        sim.step();
        if (i % every === 0) out.push((i / 1000).toFixed(1) + 's:' + Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]).toFixed(1));
    }
    return out.join(' ');
}
test('probe', () => {
    writeFileSync(new URL('sim-probe-output.txt', import.meta.url), '');
    for (const classic of [true, false]) {
        const p = compileParams(preset as never, { classicPhysics: classic });
        log(`=== ${classic ? 'CLASSIC' : 'INFLOW'}  hover motor ${hoverSolve(p, 1).motor.toFixed(4)} cdaV ${p.cda[1]}`);
        log('flat fall, throttle down   ' + run(armed(classic), -1, 6, 0, 1000));
        log('nose-down dive, thr down   ' + run(armed(classic), -1, 6, 90, 1000));
        log('full-throttle climb        ' + run(armed(classic), 1, 4, 0));
        log('full throttle, 60 deg      ' + run(armed(classic), 1, 4, 60));
        log('full throttle, 75 deg      ' + run(armed(classic), 1, 4, 75));
    }
});
