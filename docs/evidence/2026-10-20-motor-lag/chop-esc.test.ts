// The owner's chop with AM32's low-rpm duty cap and duty slew limit (scratch copy of sim-core), each on and off.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('esc', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(__dirname + '/../2026-10-20-windmill/replay/sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any;
    for (const [cap, slew, pi] of [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1], [1, 1, 1.5]]) {
        g.ESC_CAP = cap; g.ESC_SLEW = slew; g.escDuty = null;
        const o = JSON.parse(readFileSync(__dirname + '/../2026-10-20-windmill/replay/overrides.json', 'utf8')); o.propInertia = pi;
        const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
        let maxRoll = 0, maxPitch = 0, msHigh = 0, p0 = NaN, drift = 0, maxI = 0;
        for (const row of sticks) {
            sim.setChannels(row.slice(1)); sim.step();
            const t = row[0];
            if (t >= 4150 && t < 7000) {
                const a = sc.attitude(sim.s); if (isNaN(p0)) p0 = a.pitch;
                drift = Math.max(drift, Math.abs(a.pitch - p0));
                maxRoll = Math.max(maxRoll, Math.abs(sim.s[S.wz]) * 57.3); maxPitch = Math.max(maxPitch, Math.abs(sim.s[S.wx]) * 57.3);
                if (Math.max(...sim.motorCmd) > 0.15) msHigh++;
                maxI = Math.max(maxI, Math.abs(sim.s[S.iP]), Math.abs(sim.s[S.iR]));
            }
        }
        console.log(`cap ${cap ? 'on ' : 'off'} slew ${slew ? 'on ' : 'off'} inertia x${pi}: max roll rate ${maxRoll.toFixed(0)}, max pitch rate ${maxPitch.toFixed(0)} deg/s, pitch drift ${drift.toFixed(1)} deg, motor cmd > 15 % ${msHigh} ms, max |I| ${maxI.toFixed(0)}`);
    }
});
