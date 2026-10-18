// The owner's first flight (2026-10-17): in the bando a rewind put the quad 25 cm under a slab; a short
// throttle blip pressed it against the ceiling, where it stayed pinned with the throttle at zero
// (contact chatter + airmode, docs/physics-review.md F2). sim-core/0.3.0 fixed the contacts themselves
// (every touching sphere solved together, sim.ts contactsAt), so the same flight from the same spot now
// touches the slab and drops away. The director's "stuck, pinned" rule that worked around it is gone.

import { describe, expect, it } from 'vitest';
import { S } from '@owfpv/sim-core';
import type { PresetJson, RespawnPolicy, SimEvent } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession, QUICK_RESPAWN, REWIND_MARGIN_M } from '../src/session';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
/**
 * where the owner's last rewind put the quad: bando storey 2, ceiling (slab underside) at 10.5 m. Map v4
 * added floor beams on the column lines; the owner's spot (x = -243.784) is 7 cm from the one on line 6
 * (x = -244, underside 10.35 m), so the spot is moved 0.78 m east into the same bay, under the flat slab.
 */
const UNDER_SLAB: [number, number, number, number] = [-243.0, 10.245, -9.746, -89.53];
const SLAB = 10.5;

interface Track {
    /** ticks (since the respawn) with the top of a prop sphere within 2 mm of the slab */
    touching: number[];
    /** largest body rotation rate while touching, rad/s */
    maxW: number;
}

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
    const top = s.sim.p.spheres[3]; // duct sphere radius, the centre is level with the body's
    const track: Track = { touching: [], maxW: 0 };
    for (let t = 0; t < ticks; t++) {
        const before = ch.join();
        script(t, ch);
        if (ch.join() !== before) r.enqueue({ tUs: r.tUs + 1000, ch });
        r.stepOnce();
        const st = s.sim.s;
        if (st[S.py] + top > SLAB - 0.002) {
            track.touching.push(t);
            track.maxW = Math.max(track.maxW, Math.hypot(st[S.wx], st[S.wy], st[S.wz]));
        }
    }
    return { s, events: r.events.slice(n) as SimEvent[], track };
}

/** a 0.4 s blip near hover at 0.5 s, then the throttle all the way down */
const blip = (t: number, ch: Float32Array): void => {
    ch[2] = t >= 500 && t < 900 ? -0.25 : -1;
};

describe('under a ceiling (the owner\'s bando flight, F2)', () => {
    it('the blip reaches the slab, rests against it without rocking, and the quad drops away once the throttle is down', () => {
        // the director's stuck rules off: nothing but the physics gets it down
        const { s, events, track } = fly(blip, 3000, { at: UNDER_SLAB, policy: { ...QUICK_RESPAWN, unstuck: false } });
        console.log(`under the slab: touching ticks ${track.touching[0]}..${track.touching[track.touching.length - 1]} (${track.touching.length}), max rotation then ${track.maxW.toExponential(2)} rad/s, y at 3 s ${s.sim.s[S.py].toFixed(3)}`);
        expect(track.touching.length).toBeGreaterThan(50);
        // sim-core/0.2.0: 2-3 rad/s of alternating roll or yaw for as long as it stayed there
        expect(track.maxW).toBeLessThan(0.05);
        // it lets go when the stick goes down at t = 900 (the motors spin down over a few tens of ms)
        expect(track.touching[track.touching.length - 1]).toBeLessThan(1000);
        // and falls back onto the invisible respawn platform it started from (still on: it never left by 1 m)
        expect(s.sim.s[S.platOn]).toBe(1);
        expect(s.sim.s[S.py]).toBeCloseTo(UNDER_SLAB[1], 2);
        expect(s.sim.s[S.armed]).toBe(1);
        expect(events.some((e) => e.type === 'respawn' || e.type === 'crash')).toBe(false);
    });

    it('never respawns a quad landed armed at idle (contact from below)', () => {
        const { events } = fly(() => undefined, 10000);
        expect(events.some((e) => e.type === 'respawn')).toBe(false);
    });

    it('does not count a spot 25 cm under a slab as a rewind spot', () => {
        const s = new FlightSession({ preset, level });
        const out = { x: 0, y: 0, z: 0 };
        const [x, y, z] = UNDER_SLAB;
        // sim-core's default margin (0.05 m) took it; ours does not, so a rewind leaves room to fly
        expect(s.world.pushOut(x, y, z, s.sim.p.boundRadius + 0.05, out)).toBe(false);
        expect(s.world.pushOut(x, y, z, s.sim.p.boundRadius + REWIND_MARGIN_M, out)).toBe(true);
    });
});
