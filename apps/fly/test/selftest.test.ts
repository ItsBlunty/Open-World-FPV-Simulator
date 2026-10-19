// The self-test flight in Node: it must crash and respawn on the mesh map, give the same hash twice,
// and match the pinned hash the page's ?selftest is compared with.

import { describe, expect, it } from 'vitest';
import type { PresetJson } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { CLASSIC_SELFTEST_HASH, SELFTEST_HASH, TRAFFIC_HASH, runSelftest, runTrafficSelftest } from '../src/selftest';

const preset = nazgul as unknown as PresetJson;

describe('self-test flight on the first map', () => {
    it('crashes, respawns, and hashes the same every run', () => {
        const level = buildFirstMap();
        const a = runSelftest(preset, level);
        console.log('selftest', JSON.stringify(a));
        expect(a.crashes).toBeGreaterThan(0);
        expect(a.respawns).toBeGreaterThan(0);
        expect(runSelftest(preset, level).hash).toBe(a.hash);
        expect(a.hash).toBe(SELFTEST_HASH);
    });

    it('with classic physics flies the sim-core/0.5.0 flight model (contacts of 0.7.0)', () => {
        const c = runSelftest(preset, buildFirstMap(), { classicPhysics: true });
        expect(c.hash).toBe(CLASSIC_SELFTEST_HASH);
        // control: the default (rotor inflow) is another flight
        expect(c.hash).not.toBe(SELFTEST_HASH);
    });

    it('places the traffic and the train the same every run (both models, and after going back in time)', () => {
        const a = runTrafficSelftest(buildFirstMap());
        expect(runTrafficSelftest(buildFirstMap())).toBe(a);
        expect(a).toBe(TRAFFIC_HASH);
    });
});
