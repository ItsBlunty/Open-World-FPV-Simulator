// The self-test flight in Node: it must crash and respawn on the mesh map, give the same hash twice,
// and match the pinned hash the page's ?selftest is compared with.

import { describe, expect, it } from 'vitest';
import type { PresetJson } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { SELFTEST_HASH, runSelftest } from '../src/selftest';

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
});
