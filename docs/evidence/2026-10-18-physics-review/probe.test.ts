// Physics-review probe (M2, 2026-10-18): falls, dive and climbs of the default 5-inch quad, no world.
// Run from the repo root: pnpm exec vitest run --root docs/evidence/2026-10-18-physics-review (writes out.txt here).
import { test } from 'vitest';
import { appendFileSync } from 'node:fs';
const log = (t: string) => appendFileSync(new URL('out.txt', import.meta.url), t + String.fromCharCode(10));
import { compileParams, Sim, S } from '../../../packages/sim-core/src/index';
import preset from '../../../packages/sim-core/presets/nazgulf5v3-6s.json';

function armed(): Sim {
    const sim = new Sim(compileParams(preset as never), null);
    sim.reset(0, 1000, 0, 0);
    const ch = [0, 0, -1, 0, -1, -1, -1, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    return sim;
}
function setPitch(sim: Sim, deg: number) { // nose down + : rotate about body x by -deg
    const h = -deg * Math.PI / 360;
    sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
}
function run(sim: Sim, thr: number, secs: number, pitch?: number) {
    sim.setChannels([0, 0, thr, 0, 1, -1, -1, 0]);
    const out: string[] = [];
    for (let i = 1; i <= secs * 1000; i++) {
        if (pitch !== undefined) { setPitch(sim, pitch); sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0; }
        sim.step();
        if (i % 1000 === 0) {
            const s = sim.s;
            out.push(`t=${i / 1000}s vx=${s[S.vx].toFixed(1)} vy=${s[S.vy].toFixed(1)} vz=${s[S.vz].toFixed(1)} |v|=${Math.hypot(s[S.vx], s[S.vy], s[S.vz]).toFixed(1)} V=${s[S.volt].toFixed(1)}`);
        }
    }
    return out.join('\n');
}
test('probe', () => {
    log('FLAT FALL, throttle down (airmode idle)\n' + run(armed(), -1, 10, 0));
    log('NOSE-DOWN 90 deg DIVE, throttle down\n' + run(armed(), -1, 10, 90));
    log('FULL THROTTLE CLIMB, level\n' + run(armed(), 1, 10, 0));
    log('FULL THROTTLE, 60 deg nose down held\n' + run(armed(), 1, 12, 60));
});
