// Damage off, the app's default for now (owner, 2026-10-17: shelve damage, bounce off things and keep
// flying): the self-test flight dives into the ground twice; with crashOn false it never crashes,
// stays armed and keeps its health, and with it on (the self-test's own setting) it crashes. The dive
// can leave it lying on its back with the throttle down: the director's stuck-flipped reset still
// picks it up (Liftoff's rule, nothing to do with damage).

import { describe, expect, it } from 'vitest';
import { S } from '@owfpv/sim-core';
import type { PresetJson } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from '../src/session';
import { DEFAULT_SETTINGS } from '../src/settings';
import { SELFTEST_TICKS, selftestSticks } from '../src/selftest';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();

function fly(crashOn: boolean) {
    const s = new FlightSession({ preset, level, overrides: { crashOn } });
    const r = s.runner;
    const ch = new Float32Array(8);
    let disarmed = 0;
    while (r.sim.tick < SELFTEST_TICKS) {
        const t = r.sim.tick;
        if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: selftestSticks(t, ch) });
        r.stepOnce();
        if (t > 1000 && r.sim.s[S.armed] === 0) disarmed++;
    }
    const n = (type: string) => r.events.filter((e) => e.type === type).length;
    return { crashes: n('crash'), contacts: n('contact'), reasons: r.lives().slice(1).map((l) => l.header.life.reason), disarmed, health: r.sim.s[S.health] };
}

describe('damage off (the default setting)', () => {
    it('the default setting is off', () => {
        expect(DEFAULT_SETTINGS.damage).toBe(false);
    });

    it('two dives into the ground: bounces, no crash, never disarmed, no crash respawn; damage on: crashes', () => {
        const off = fly(false);
        console.log('damage off', JSON.stringify(off));
        expect(off.crashes).toBe(0);
        expect(off.contacts).toBeGreaterThan(0);
        expect(off.disarmed).toBe(0);
        expect(off.reasons.every((x) => x === 'stuck-flipped')).toBe(true);
        expect(off.health).toBe(1);
        expect(fly(true).crashes).toBeGreaterThan(0);
    });
});
