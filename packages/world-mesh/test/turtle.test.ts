// Turtle mode on mesh geometry (sim-core/0.4.0; the owner chose it on 2026-10-17 after prop strikes left a quad on its
// back at the foot of a wall, docs/physics-review.md F4): reversed props flip a quad lying on its back on the floor,
// and get one standing on its edge against a wall back on its feet.

import { describe, expect, it } from 'vitest';
import { S, Sim, compileParams } from '@owfpv/sim-core';
import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { MeshBuilder, MeshContactWorld } from '../src/index';

const PRESET = nazgul as unknown as PresetJson;
/** a closed room: floor y = 0, ceiling y = 3, walls at x = +-5 and z = +-5 */
const BOX = new MeshBuilder().box([-5, 0, -5], [5, 3, 5]);
const ROOM = new MeshContactWorld(BOX.positions, BOX.indices);

const upY = (sim: Sim): number => 1 - 2 * (sim.s[S.qx] * sim.s[S.qx] + sim.s[S.qz] * sim.s[S.qz]);
/** sticks roll, pitch; arm and turtle switches; throttle low (turtle mode ignores it) */
const ch = (arm: boolean, turtle: boolean, roll = 0, pitch = 0): number[] => [roll, pitch, -1, 0, arm ? 1 : -1, -1, turtle ? 1 : 0, 0];

/** Turtle switch on, arm, hold the stick until upright (or 3 s): the ms it took, -1 if it never got there. */
function flip(sim: Sim, roll: number, pitch: number): number {
    sim.setChannels(ch(false, true));
    sim.step();
    sim.setChannels(ch(true, true));
    sim.step();
    expect(sim.armed).toBe(true);
    for (let t = 0; t < 3000; t++) {
        sim.setChannels(ch(true, true, roll, pitch));
        sim.step();
        if (upY(sim) > 0.9) return t;
    }
    return -1;
}

describe('turtle mode in a room (Nazgul)', () => {
    it('on its back on the floor: a roll or pitch stick flips it over; it will not arm normally until it has', () => {
        for (const [roll, pitch] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.5, 0]]) {
            const sim = new Sim(compileParams(PRESET, { crashOn: false }), ROOM);
            sim.setChannels(ch(false, false));
            sim.reset(0, 0.3, 0, 0);
            sim.s[S.qw] = 0;
            sim.s[S.qz] = 1;
            sim.s[S.hold] = 0;
            for (let t = 0; t < 1000; t++) sim.step(); // falls and settles on its back
            expect(upY(sim)).toBeLessThan(-0.99);
            sim.setChannels(ch(true, false));
            sim.step();
            expect(sim.armed).toBe(false);
            const t = flip(sim, roll, pitch);
            console.log(`on its back, stick ${roll}, ${pitch}: upright after ${t} ms`);
            expect(t).toBeGreaterThan(0);
            expect(t).toBeLessThan(500);
        }
    });

    it('after a forward hit on a wall it stands on its edge, top to the wall: pitch flips it, roll does not; then it flies again', () => {
        let flown = 0;
        for (const [roll, pitch] of [[1, 0], [0, 1], [0, -1], [0, 0.6], [0, -0.6]]) {
            const sim = new Sim(compileParams(PRESET, { crashOn: false }), ROOM);
            sim.setChannels(ch(false, false));
            sim.reset(0, 2.5, -2, 0);
            sim.step();
            sim.setChannels(ch(true, false));
            sim.step();
            // 30 deg nose down at 15 m/s into the wall at z = -5, hover throttle, as in contact-solver.test.ts
            const h = (-30 * Math.PI) / 360;
            sim.s[S.qw] = Math.cos(h);
            sim.s[S.qx] = Math.sin(h);
            sim.s[S.vz] = -15;
            for (let t = 0; t < 2500; t++) {
                sim.setChannels([0, 0, 0, 0, 1, -1, 0, 0]);
                sim.step();
            }
            expect(sim.s[S.py]).toBeLessThan(0.3);
            expect(Math.abs(upY(sim))).toBeLessThan(0.1);
            sim.setChannels(ch(false, false));
            sim.step();
            const t = flip(sim, roll, pitch);
            // let go, then turtle off (disarms), arm again and climb
            for (let k = 0; k < 300; k++) {
                sim.setChannels(ch(true, true));
                sim.step();
            }
            sim.setChannels(ch(true, false));
            sim.step();
            expect(sim.armed).toBe(false);
            sim.setChannels(ch(false, false));
            sim.step();
            sim.setChannels(ch(true, false));
            sim.step();
            const rearmed = sim.armed;
            for (let k = 0; k < 1000; k++) {
                sim.setChannels([0, -0.1, 0.3, 0, 1, -1, 0, 0]);
                sim.step();
            }
            console.log(`at the wall, stick ${roll}, ${pitch}: upright after ${t} ms, re-armed ${rearmed}, height 1 s later ${sim.s[S.py].toFixed(2)} m`);
            if (roll !== 0) expect(t).toBe(-1);
            else expect(t).toBeGreaterThan(0);
            // a flip that ends tilted past 25 deg does not arm (Betaflight's small_angle), as on a real quad
            if (rearmed) {
                expect(sim.s[S.py]).toBeGreaterThan(1);
                flown++;
            }
        }
        expect(flown).toBeGreaterThanOrEqual(2);
    });

    it('a reversed prop draws air from below: upright on the floor in turtle mode, the floor blocks it and nothing moves', () => {
        const sim = new Sim(compileParams(PRESET, { crashOn: false }), ROOM);
        sim.setChannels(ch(false, true));
        sim.reset(0, 0.045, 0, 0);
        sim.step();
        sim.setChannels(ch(true, true));
        sim.step();
        expect(sim.armed).toBe(true);
        for (let t = 0; t < 500; t++) {
            sim.setChannels(ch(true, true, 1, 0));
            sim.step();
        }
        expect(upY(sim)).toBeGreaterThan(0.999);
        expect(sim.s[S.py]).toBeCloseTo(0.045, 4);
    });
});
