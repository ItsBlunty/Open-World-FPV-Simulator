// The model's prop in pure axial flow (Sim.propLoads called directly): thrust and torque against J = V / (n D) at a
// fixed airspeed, to compare the reversed band with measured data.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('band', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sim = new sc.Sim(sc.compileParams(preset, {}), null);
    const f = sim.p.inflow; const D = 2 * f.radius;
    const rows: string[] = [];
    for (const V of [10, 20, 40]) {
        for (let J = 0.3; J <= 8.0001; J += 0.02) {
            const n = V / (J * D); const om = 2 * Math.PI * n;
            const T = sim.propLoads(f, 0, om, 0, V, 0, 0, 0, 0); const Q = sim.propQ;
            rows.push([V, J, n, T, Q].map((x) => +x.toFixed(6)).join(','));
        }
    }
    writeFileSync(process.env.OUT!, 'V,J,n,T,Q\n' + rows.join('\n'));
    console.log('D', D, 'theta', f.theta);
});
