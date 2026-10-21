// The airflow each prop meets in the owner's chop (sticks replayed, no world): axial (uy, + = from in front), in-plane
// speed, tip speed, and which load path propLoads takes. Wraps Sim.propLoads to read its arguments.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = ROOT + '/docs/evidence/2026-10-20-windmill/replay/';
test('flow', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const o = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
    const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
    const orig = sim.propLoads.bind(sim);
    const rec: number[][] = [];
    sim.propLoads = (f: any, i: number, om: number, bvx: number, bvy: number, bvz: number, wx: number, wy: number, wz: number) => {
        const mp = sim.p.motorPos; const mx = mp[i * 3], mz = mp[i * 3 + 2];
        const ux = bvx + wy * mz, uy = bvy + wz * mx - wx * mz, uz = bvz - wy * mx;
        const T = orig(f, i, om, bvx, bvy, bvz, wx, wy, wz);
        rec.push([sim.tick, i, uy, ux, uz, om * f.radius, T, sim.propQ]);
        return T;
    };
    for (const row of sticks) { sim.setChannels(row.slice(1)); sim.step(); }
    writeFileSync(process.env.OUT!, 'tick,i,uy,ux,uz,tip,T,Q\n' + rec.map((r) => r.map((x) => +x.toFixed(4)).join(',')).join('\n'));
    console.log('radius', sim.p.inflow.radius, 'theta', sim.p.inflow.theta, 'motorPos', Array.from(sim.p.motorPos).map((x: number) => +x.toFixed(4)).join(' '));
});
