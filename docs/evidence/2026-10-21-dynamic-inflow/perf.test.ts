// CPU cost of dynamic inflow: 20 s of the step-test pilot's flying (hover, stick moves) at 4 kHz, physics and controller
// only, dynamic inflow off and on, best of 3.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT ?? 'G:/openworldfpvsim';
test('perf', { timeout: 300000 }, async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    for (const din of [false, true, false, true]) {
        let best = Infinity;
        for (let rep = 0; rep < 3; rep++) {
            const sim = new sc.Sim(sc.compileParams(preset, { loopHz: 4000, dynamicInflow: din }), null);
            sim.reset(0, 5000, 0, 0);
            const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const t0 = performance.now();
            for (let ms = 0; ms < 20000; ms++) { ch[0] = Math.sin(ms / 300) * 0.4; ch[1] = Math.cos(ms / 470) * 0.4; ch[2] = -0.1; sim.setChannels(ch); sim.step(); }
            best = Math.min(best, performance.now() - t0);
        }
        console.log(`dynamic inflow ${din ? 'on ' : 'off'}: ${(best / 20).toFixed(1)} ms CPU per second of flight`);
    }
});
