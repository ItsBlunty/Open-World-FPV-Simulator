// Damage and landing (sim-core/0.3.0, this project; docs/notes/contacts.md §0a items 2 and 3): one health value, 1 at a
// spawn, down by each impact from its approach speed; a hit on the frame's underside (a landing) is harmless up
// to a much higher speed than a hit on the props, arms or top; 0 health is a crash. Nazgul preset (vBounce 1.5,
// vCrash 5 m/s, so harmless up to 1.5 m/s on the props and 4 m/s on the underside; all of the health at 5 and
// 10 m/s).

import { describe, expect, it } from 'vitest';
import { S, Sim, compileParams } from '../src/index';
import type { ParamOverrides, PresetJson, SimEvent } from '../src/index';
import nazgul from '../presets/nazgulf5v3-6s.json';
import { halfSpace } from './model-helpers';

const PRESET = nazgul as unknown as PresetJson;
const FLOOR = halfSpace(0, 1, 0, 0);
/** duct and body sphere radius, m */
const R = 0.045;

/**
 * A disarmed Nazgul (motors off) that meets the floor at `v` m/s going straight down, level or rolled `rollDeg`;
 * the pose starts 0.5 mm above the touch, so the fall adds nothing. Runs 1.5 s.
 */
function drop(v: number, rollDeg = 0, o: ParamOverrides = {}): { sim: Sim; events: SimEvent[] } {
    const sim = new Sim(compileParams(PRESET, o), FLOOR);
    sim.reset(0, 1, 0, 0);
    sim.s[S.hold] = 0;
    const h = (rollDeg * Math.PI) / 360;
    sim.s[S.qw] = Math.cos(h); sim.s[S.qz] = -Math.sin(h);
    // lowest point of the spheres at this roll: a duct 0.1 m out along x (and z) drops by 0.1 sin(roll)
    const s = Math.sin((rollDeg * Math.PI) / 180);
    sim.s[S.py] = R + 0.1 * Math.abs(s) + 0.0005;
    sim.s[S.vy] = -v;
    for (let i = 0; i < 1500; i++) sim.step();
    return { sim, events: sim.events };
}

describe('damage from impacts', () => {
    it('a fresh craft (spawn and every respawn) has all of its health', () => {
        const sim = new Sim(compileParams(PRESET, {}), FLOOR);
        expect(sim.s[S.health]).toBe(1);
        sim.s[S.health] = 0.3;
        sim.respawn(0, 1, 0, 0);
        expect(sim.s[S.health]).toBe(1);
    });

    it('landing level on the underside at 2 and 3 m/s does no damage; at 3.9 m/s neither (vLandSafe 4)', () => {
        for (const v of [2, 3, 3.9]) {
            const { sim, events } = drop(v);
            expect(sim.s[S.health], `${v} m/s`).toBe(1);
            expect(sim.crashed).toBe(false);
            const hit = events.find((e) => e.type === 'contact');
            expect(hit && hit.type === 'contact' && hit.speed).toBeCloseTo(v, 1);
        }
    });

    it('harder landings take more, growing with the impact energy; 10 m/s and over is a crash', () => {
        const left = [6, 8].map((v) => drop(v).sim.s[S.health]);
        // (v^2 - 4^2) / (10^2 - 4^2): 0.24 at 6 m/s, 0.57 at 8 m/s (the approach is a little over v: the fall)
        expect(left[0]).toBeCloseTo(1 - 20 / 84, 1);
        expect(left[1]).toBeCloseTo(1 - 48 / 84, 1);
        const { sim, events } = drop(10.5);
        expect(sim.s[S.health]).toBe(0);
        expect(sim.crashed).toBe(true);
        expect(events.filter((e) => e.type === 'crash')).toHaveLength(1);
    });

    it('on its side the same hit lands on a prop: harmless only up to 1.5 m/s, a crash at 5 m/s', () => {
        expect(drop(1.2, 90).sim.s[S.health]).toBe(1);
        const side = drop(3, 90).sim.s[S.health];
        // (3^2 - 1.5^2) / (5^2 - 1.5^2) = 0.30
        expect(side).toBeCloseTo(1 - 6.75 / 22.75, 1);
        expect(drop(3).sim.s[S.health]).toBe(1); // the same speed level, on the underside
        expect(drop(5.2, 90).sim.crashed).toBe(true);
    });

    it('a 30 deg tilt still lands on the underside, harmless at 2 m/s; 60 deg is a prop hit', () => {
        const tilted = drop(2, 30);
        expect(tilted.sim.s[S.health]).toBe(1);
        // a rigid body: the low arm stops, the body pivots on it and the high arm comes down faster (here 1.7 x)
        const speeds = tilted.events.flatMap((e) => (e.type === 'contact' ? [e.speed] : []));
        expect(speeds[1]).toBeGreaterThan(1.5 * speeds[0]);
        expect(drop(3, 30).sim.s[S.health]).toBeGreaterThan(0.9);
        // at 60 deg the first touch is on the props' side: (4^2 - 1.5^2) / 22.75 = 0.6 of the health, and more after
        expect(drop(4, 60).sim.s[S.health]).toBeLessThan(0.4);
        expect(drop(4, 30).sim.s[S.health]).toBeGreaterThan(0.7);
    });

    it('hits add up: a few prop hits crash a craft that one of them would not', () => {
        const sim = new Sim(compileParams(PRESET, {}), FLOOR);
        let crashedAt = -1;
        for (let k = 0; k < 4 && crashedAt < 0; k++) {
            sim.reset(0, 1, 0, 0);
            if (k > 0) sim.s[S.health] = prev;
            sim.s[S.hold] = 0;
            sim.s[S.qw] = Math.SQRT1_2; sim.s[S.qz] = -Math.SQRT1_2;
            sim.s[S.py] = R + 0.1 + 0.0005;
            sim.s[S.vy] = -3.5;
            for (let i = 0; i < 300; i++) sim.step();
            if (sim.crashed) crashedAt = k;
            prev = sim.s[S.health];
        }
        // (3.5^2 - 1.5^2) / 22.75 = 0.44 per hit: the third one
        expect(crashedAt).toBe(2);
    });
    let prev = 1;

    it("the contact event carries the hit's damage", () => {
        const { events } = drop(6);
        const hit = events.find((e) => e.type === 'contact');
        expect(hit?.type).toBe('contact');
        expect(hit && hit.type === 'contact' && hit.damage).toBeGreaterThan(0.2);
    });

    it('crashes off (C.7): no damage at any speed, every impact a bounce', () => {
        const { sim, events } = drop(12, 90, { crashOn: false });
        expect(sim.s[S.health]).toBe(1);
        expect(sim.crashed).toBe(false);
        const hit = events.find((e) => e.type === 'contact');
        expect(hit && hit.type === 'contact' && hit.regime).toBe('bounce');
    });

    it('the thresholds can be overridden', () => {
        expect(drop(3, 0, { vLandSafe: 2 }).sim.s[S.health]).toBeLessThan(1);
        expect(drop(3, 90, { vHarm: 3.2 }).sim.s[S.health]).toBe(1);
    });
});
