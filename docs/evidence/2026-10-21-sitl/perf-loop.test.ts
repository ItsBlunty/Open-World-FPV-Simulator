// Cost of the loop rate: ms of CPU per second of flight (1000 ticks) in open air, near walls (contacts), at 1/4/8 kHz.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = 'G:/openworldfpvsim';
test('perf', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const kit: any = await import(ROOT + '/packages/sim-core/test/log-kit');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    for (const where of ['open air', 'room (walls 4 m, floor)']) for (const hz of [1000, 4000, 8000]) {
        const world = where === 'open air' ? null : kit.PlaneWorld.room({ wallX: 4 });
        const sim = new sc.Sim(sc.compileParams(preset, { loopHz: hz }), world);
        sim.reset(0, where === 'open air' ? 500 : 1, 0, 0);
        const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch);
        for (let i = 0; i < 100; i++) sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step();
        const run = (n: number) => { for (let t = 0; t < n; t++) { ch[2] = (t % 2000) < 1000 ? -0.2 : -0.35; ch[0] = (t % 700) < 100 ? 0.3 : 0; sim.setChannels(ch); sim.step(); } };
        run(3000);
        const t0 = performance.now(); run(10000); const ms = performance.now() - t0;
        console.log(`${where.padEnd(24)} ${hz} Hz: ${(ms / 10).toFixed(2)} ms CPU per second of flight`);
    }
});
