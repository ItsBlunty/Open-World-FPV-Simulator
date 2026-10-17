// The owner's first flight (2026-10-17): in the bando a rewind put the quad 25 cm under a slab; a short
// throttle blip pressed it against the ceiling, where it stayed pinned with the throttle at zero
// (contact chatter + airmode, docs/physics-review.md F2). Reproduced here from the same spot.

import { describe, expect, it } from 'vitest';
import { S } from '@owfpv/sim-core';
import type { PresetJson, RespawnPolicy, SimEvent } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession, QUICK_RESPAWN, REWIND_MARGIN_M } from '../src/session';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
/** where the owner's last rewind put the quad: bando storey 2, ceiling (slab underside) at 10.5 m */
const UNDER_SLAB: [number, number, number, number] = [-243.784, 10.245, -9.746, -89.53];

/** Arm at the park spawn, respawn at `at`, then fly script(t) for `ticks` (t = ticks since the respawn). */
function fly(script: (t: number, ch: Float32Array) => void, ticks: number, o: { at?: [number, number, number, number]; policy?: RespawnPolicy } = {}) {
    const s = new FlightSession({ preset, level, policy: o.policy });
    const r = s.runner;
    const ch = new Float32Array([0, 0, -1, 0, -1, -1, 0, 0]);
    r.enqueue({ tUs: 1000, ch });
    for (let i = 0; i < 100; i++) r.stepOnce();
    ch[4] = 1;
    r.enqueue({ tUs: r.tUs + 1000, ch });
    for (let i = 0; i < 100; i++) r.stepOnce();
    if (o.at) r.respawn(o.at[0], o.at[1], o.at[2], o.at[3], { platform: true, keepArmed: true }, 'crash');
    const n = r.events.length;
    for (let t = 0; t < ticks; t++) {
        const before = ch.join();
        script(t, ch);
        if (ch.join() !== before) r.enqueue({ tUs: r.tUs + 1000, ch });
        r.stepOnce();
    }
    return { s, events: r.events.slice(n) as SimEvent[] };
}

/** a 0.4 s blip near hover at 0.5 s, then the throttle all the way down */
const blip = (t: number, ch: Float32Array): void => {
    ch[2] = t >= 500 && t < 900 ? -0.25 : -1;
};

const pinned = (s: FlightSession): boolean => s.sim.s[S.armed] > 0 && s.sim.s[S.py] > 10.4;

describe('stuck under a ceiling', () => {
    it('negative control: with the stuck rules off the quad stays pinned, throttle down, motors working', () => {
        const { s, events } = fly(blip, 8000, { at: UNDER_SLAB, policy: { ...QUICK_RESPAWN, unstuck: false } });
        expect(events.some((e) => e.type === 'respawn')).toBe(false);
        expect(pinned(s)).toBe(true);
        expect(s.sim.ch[2]).toBe(-1);
    });

    it('the pinned rule rewinds it within 2 s, to a spot it then sits free at', () => {
        const { s, events } = fly(blip, 8000, { at: UNDER_SLAB });
        const re = events.filter((e) => e.type === 'respawn');
        expect(re.length).toBeGreaterThan(0);
        // pinned from about t = 600 (the blip reaches the slab in ~0.1 s); the rule needs 1.5 s still
        expect(re[0].tick - (s.sim.tick - 8000)).toBeLessThan(600 + 2000);
        expect(s.director.last?.reason).toBe('stuck-wedged');
        expect(pinned(s)).toBe(false);
        // after the rewind, nothing above it within its bounding radius
        const out = { x: 0, y: 0, z: 0 };
        const st = s.sim.s;
        expect(s.world.pushOut(st[S.px], st[S.py], st[S.pz], s.sim.p.boundRadius + 0.02, out) && out.y < 0).toBe(false);
    });

    it('never fires on a quad landed armed at idle (contact from below)', () => {
        const { events } = fly(() => undefined, 10000);
        expect(events.some((e) => e.type === 'respawn')).toBe(false);
    });

    it('does not count a spot 25 cm under a slab as a rewind spot any more', () => {
        const s = new FlightSession({ preset, level });
        const out = { x: 0, y: 0, z: 0 };
        const [x, y, z] = UNDER_SLAB;
        // sim-core's default margin (0.05 m) took it; ours does not
        expect(s.world.pushOut(x, y, z, s.sim.p.boundRadius + 0.05, out)).toBe(false);
        expect(s.world.pushOut(x, y, z, s.sim.p.boundRadius + REWIND_MARGIN_M, out)).toBe(true);
    });
});
