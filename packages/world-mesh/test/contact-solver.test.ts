// sim-core/0.3.0's contact solver on mesh geometry (sim.ts contactsAt; HANDOFF.md 0a item 1): a craft
// resting on a floor, against a wall or pressed under a ceiling stays still, and its gyro reads ~0
// (sim-core/0.2.0 rocked it from sphere to sphere at several rad/s: docs/physics-review.md F1, F2);
// sliding along a wall does not stick. Also MeshContactWorld.contacts, the query the solver uses.

import { describe, expect, it } from 'vitest';
import { S, Sim, compileParams, hoverSolve } from '@owfpv/sim-core';
import type { PresetJson, SimEvent } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { MeshBuilder, MeshContactWorld } from '../src/index';

const PRESET = nazgul as unknown as PresetJson;
/** a closed room: floor y = 0, ceiling y = 3, walls at x = +-5 and z = +-5 */
const mesh = (m: MeshBuilder) => new MeshContactWorld(m.positions, m.indices);
const ROOM = mesh(new MeshBuilder().box([-5, 0, -5], [5, 3, 5]));
/** the duct and body spheres' radius of the Nazgul (collider_duct_radius_mm, collider_body_radius_mm) */
const R = 0.045;

/** A Nazgul at `at`, heading 0 (nose to -z); armed (throttle low) or disarmed, free to move either way. */
function craft(at: [number, number, number], armed: boolean, crashOn = true): Sim {
    const sim = new Sim(compileParams(PRESET, { crashOn }), ROOM);
    sim.setChannels([0, 0, -1, 0, -1, -1, 0, 0]);
    sim.reset(at[0], at[1], at[2], 0);
    sim.step();
    if (armed) {
        sim.setChannels([0, 0, -1, 0, 1, -1, 0, 0]);
        sim.step();
        expect(sim.armed).toBe(true);
    } else sim.s[S.hold] = 0;
    return sim;
}

/** Fly `ticks` with the channels from ch(t); over the last `still` ticks: largest rotation rate, largest move, events. */
function run(sim: Sim, ticks: number, still: number, ch?: (t: number) => number[]) {
    let maxW = 0;
    let maxMove = 0;
    let from: number[] | null = null;
    const n = sim.events.length;
    for (let t = 0; t < ticks; t++) {
        if (ch) sim.setChannels(ch(t));
        sim.step();
        const s = sim.s;
        if (t === ticks - still) from = [s[S.px], s[S.py], s[S.pz]];
        if (from) {
            maxW = Math.max(maxW, Math.hypot(s[S.wx], s[S.wy], s[S.wz]));
            maxMove = Math.max(maxMove, Math.hypot(s[S.px] - from[0], s[S.py] - from[1], s[S.pz] - from[2]));
        }
    }
    const late = (sim.events.slice(n) as SimEvent[]).filter((e) => e.tick > sim.tick - still);
    return { maxW, maxMove, late };
}

describe('MeshContactWorld.contacts', () => {
    const out = new Float64Array(16);

    it('a floor of two triangles is one contact, also right over their shared edge', () => {
        const w = mesh(new MeshBuilder().quad([-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]));
        for (const [x, z] of [[0.3, -0.5], [0, 0], [0.001, -0.001], [-0.002, 0.0]]) {
            expect(w.contacts(x, 0.04, z, 0.05, out, 4), `${x}, ${z}`).toBe(1);
            expect([out[0], out[1], out[2], out[3]].map((v) => v + 0)).toEqual([0, 1, 0, 0.04]); // + 0: -0 is 0
        }
        expect(w.contacts(0, 0.06, 0, 0.05, out, 4)).toBe(0);
    });

    it('a corner of the room is three contacts (floor and two walls), closest first; max caps them', () => {
        expect(ROOM.contacts(-4.97, 0.02, -4.96, 0.05, out, 4)).toBe(3);
        expect([out[3], out[7], out[11]].map((d) => +d.toFixed(9))).toEqual([0.02, 0.03, 0.04]);
        expect([out[1], out[4], out[10]]).toEqual([1, 1, 1]); // floor normal +y, wall x = -5 normal +x, wall z = -5 normal +z
        expect(ROOM.contacts(-4.97, 0.02, -4.96, 0.05, out, 2)).toBe(2);
    });

    it('past the edge of a box, the edge is one contact whose normal points from the edge to the point', () => {
        const box = mesh(new MeshBuilder().box([0, 0, 0], [1, 1, 1]));
        expect(box.contacts(1.03, 1.04, 0.5, 0.06, out, 4)).toBe(1);
        expect(out[0]).toBeCloseTo(0.6, 12);
        expect(out[1]).toBeCloseTo(0.8, 12);
        expect(out[3]).toBeCloseTo(0.05, 12);
    });
});

describe('the contact solver on mesh surfaces (Nazgul)', () => {
    it('at rest on the floor, disarmed and armed at idle: still, the gyro reads ~0, no contact events', () => {
        for (const armed of [false, true]) {
            const sim = craft([0, R + 0.01, 0], armed);
            const r = run(sim, 4000, 3000);
            expect(r.maxW, `armed ${armed}`).toBeLessThan(1e-4);
            expect(r.maxMove).toBeLessThan(1e-6);
            expect(r.late).toEqual([]);
            expect(sim.s[S.py]).toBeCloseTo(R, 6);
            expect(sim.s[S.health]).toBe(1);
            expect(sim.startOverlaps).toBe(0);
        }
    });

    it('leaning into a wall, armed in angle mode at hover throttle: still against it (sim-core/0.2.0 rocked here)', () => {
        const sim = craft([0, 1.5, -4.75], true);
        const hover = hoverSolve(sim.p, 1).stick * 2 - 1;
        // nose to -z, pitch forward: it drifts into the wall at z = -5 and leans on it
        const r = run(sim, 6000, 3000, () => [0, 0.4, hover + 0.02, 0, 1, 1, 0, 0]);
        expect(sim.s[S.pz]).toBeLessThan(-4.8); // at the wall
        expect(r.maxW).toBeLessThan(1e-3);
        expect(r.maxMove).toBeLessThan(1e-4);
        expect(r.late).toEqual([]);
        expect(sim.crashed).toBe(false);
    });

    it('climbing into the ceiling: it stops just under it, still, gyro ~0; with the throttle down it leaves at once (F2)', () => {
        const sim = craft([0, 2.9, 0], true);
        const hover = hoverSolve(sim.p, 1).stick * 2 - 1;
        const r = run(sim, 3000, 2000, () => [0, 0, hover + 0.1, 0, 1, -1, 0, 0]);
        // sim-core/0.3.1 (prop strikes, F4): a prop loses its thrust over the last 0.5 mm to a surface over it, so the
        // climb ends where the thrust left balances the weight instead of pressing into the slab; it bobs there by
        // a millimetre or two (the thrust share is a stiff spring with no damping of its own), never rocking
        console.log(`under the ceiling: ${((3 - R - sim.s[S.py]) * 1000).toFixed(2)} mm below touching, moved ${(r.maxMove * 1000).toFixed(2)} mm, max rate ${r.maxW.toExponential(2)} rad/s`);
        expect(sim.s[S.py]).toBeLessThanOrEqual(3 - R);
        expect(sim.s[S.py]).toBeGreaterThan(3 - R - 0.003);
        expect(r.maxW).toBeLessThan(1e-4);
        expect(r.maxMove).toBeLessThan(0.003);
        expect(r.late).toEqual([]);
        // acro, throttle stick down: the motors spin down and it falls away
        let left = -1;
        for (let t = 0; t < 1000 && left < 0; t++) {
            sim.setChannels([0, 0, -1, 0, 1, -1, 0, 0]);
            sim.step();
            if (sim.s[S.py] < 3 - R - 0.01) left = t;
        }
        expect(left).toBeGreaterThan(0);
        expect(left).toBeLessThan(200);
    });

    it('lying on its side on the floor against a wall, disarmed: it settles and then stays still', () => {
        const sim = craft([4.9, 0.2, 0], false);
        // rolled 80 deg towards the wall at x = 5
        const h = (80 * Math.PI) / 360;
        sim.s[S.qw] = Math.cos(h); sim.s[S.qz] = -Math.sin(h);
        const r = run(sim, 5000, 2000);
        expect(r.maxW).toBeLessThan(1e-3);
        expect(r.maxMove).toBeLessThan(1e-5);
        expect(r.late).toEqual([]);
    });

    it('sliding along a wall at 5 m/s with 0.5 m/s into it does not stick: friction takes only what the push allows', () => {
        const sim = craft([4.9, 1.5, 0], false);
        sim.s[S.vz] = -5; sim.s[S.vx] = 0.5;
        const z0 = sim.s[S.pz];
        run(sim, 300, 1);
        // Coulomb: the tangential loss is at most MU (0.4) x the normal change (0.5 m/s + its bounce), plus air drag
        expect(-sim.s[S.vz]).toBeGreaterThan(4.5);
        expect(z0 - sim.s[S.pz]).toBeGreaterThan(1.35);
        expect(sim.s[S.px]).toBeLessThanOrEqual(5 - R + 1e-9);
        expect(sim.s[S.health]).toBe(1);
    });

    it('sliding on the floor at 5 m/s: Coulomb friction slows it at about MU x g, and it keeps sliding, not stopping dead', () => {
        const sim = craft([0, R, 0], false);
        sim.s[S.vx] = 5;
        run(sim, 400, 1);
        // 0.4 x 9.81 = 3.9 m/s^2 for 0.4 s: 1.57 m/s lost, plus air drag
        expect(sim.s[S.vx]).toBeGreaterThan(3.0);
        expect(sim.s[S.vx]).toBeLessThan(3.5);
    });

    // The owner's report after sim-core/0.3.0 (2026-10-17): "When I hit a wall or floor or anything like that, my whole
    // quad gets stuck". A forward-flight hit swings the quad flat against the wall, props first (the thrust leans
    // towards the direction of flight). In 0.3.0 those props kept their full thrust, pushed it into the wall, and
    // friction (MU x that push) held it there at hover throttle, at full throttle, and in airmode with the throttle
    // down and a stick held. Since 0.3.1 a prop against a surface over its intake makes no thrust (prop strikes, F4).
    it('a forward-flight hit on a wall leaves the quad on its props against it, and it falls off whatever the sticks do (F4)', () => {
        const sticks: [string, number[]][] = [
            ['hover throttle, no stick', [0, 0, 0, 0, 1, -1, 0, 0]],
            ['full throttle, no stick', [0, 0, 1, 0, 1, -1, 0, 0]],
            ['throttle down, pitch back (airmode)', [0, -0.5, -1, 0, 1, -1, 0, 0]],
            ['half throttle, roll', [0.5, 0, 0, 0, 1, -1, 0, 0]]
        ];
        for (const [name, ch] of sticks) {
            // damage off, as the app flies by default: every hit is a bounce and the motors keep running
            const sim = craft([0, 2.5, -2], true, false);
            // 30 deg nose down, 15 m/s towards the wall at z = -5
            const h = (-30 * Math.PI) / 360;
            sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = Math.sin(h);
            sim.s[S.vz] = -15;
            const hover = hoverSolve(sim.p, 1).stick * 2 - 1;
            let hit = -1;
            let upAtHit = 1;
            for (let t = 0; t < 2500; t++) {
                sim.setChannels(hit < 0 || t - hit < 100 ? [0, 0, hover, 0, 1, -1, 0, 0] : ch);
                sim.step();
                if (hit < 0 && sim.s[S.pz] < -5 + 0.2) hit = t;
                // the body's up axis along +z, 150 ms after the hit: props facing the wall
                if (t === hit + 150) upAtHit = 2 * (sim.s[S.qy] * sim.s[S.qz] + sim.s[S.qw] * sim.s[S.qx]);
            }
            expect(hit, name).toBeGreaterThan(0);
            expect(upAtHit, name).toBeLessThan(-0.8);
            console.log(`${name}: up.z ${upAtHit.toFixed(2)} after the hit, at 2.5 s y ${sim.s[S.py].toFixed(2)} z ${sim.s[S.pz].toFixed(2)}`);
            // 0.3.0: still on the wall at 2.5 m (all but the first); now on the floor
            expect(sim.s[S.py], name).toBeLessThan(0.3);
        }
    });

    it('sitting upright on the floor, armed: full throttle takes off as before (the floor under the props is no strike)', () => {
        const sim = craft([0, R, 0], true);
        run(sim, 500, 1, () => [0, 0, 1, 0, 1, -1, 0, 0]);
        expect(sim.s[S.py]).toBeGreaterThan(1);
    });
});
