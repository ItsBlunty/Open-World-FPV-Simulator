// The game's own flight session on the real map with traffic (as apps/fly/test/flights.test.ts), the self-test's sticks
// (climb, dive into the ground, respawn): CPU per second of flight at loop rates 1, 4 and 8 kHz.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
test('map', async () => {
    const maps: any = await import('G:/openworldfpvsim/packages/maps/src/index');
    const wm: any = await import('G:/openworldfpvsim/packages/world-mesh/src/index');
    const ses: any = await import('G:/openworldfpvsim/apps/fly/src/session');
    const st: any = await import('G:/openworldfpvsim/apps/fly/src/selftest');
    const preset = JSON.parse(readFileSync('G:/openworldfpvsim/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const level = maps.buildFirstMap(); const mesh = new wm.MeshContactWorld(level.collision);
    for (const hz of [1000, 4000, 8000]) {
        const s = new ses.FlightSession({ preset, level, world: mesh, overrides: { loopHz: hz }, traffic: { cars: true, people: true, signals: true } });
        const r = s.runner; const ch = new Float32Array(8);
        const t0 = performance.now();
        while (r.sim.tick < 12000) { const t = r.sim.tick; if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: st.selftestSticks(t, ch) }); r.stepOnce(); }
        console.log(`real map + traffic, ${hz} Hz: ${((performance.now() - t0) / 12).toFixed(2)} ms CPU per second of flight`);
    }
}, 600000);
