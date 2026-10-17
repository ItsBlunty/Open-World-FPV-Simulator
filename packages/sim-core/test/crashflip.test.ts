// Turtle mode's motor mix (crashflip.ts, ported from Betaflight 2026.6.2 applyCrashFlipModeToMotors) and its arming
// rules in sim.ts (from Betaflight's core.c). Motor order is Betaflight's quad X: M1 rear-right, M2 front-right,
// M3 rear-left, M4 front-left.

import { describe, expect, it } from 'vitest';
import { CRASHFLIP_MOTOR_DEADBAND, S, Sim, compileParams, crashFlipMix } from '../src/index';
import { PRESET } from './log-kit';

const MIX_R = [-1, -1, 1, 1];
const MIX_P = [1, -1, 1, -1];
const MIX_Y = [-1, 1, 1, -1];
const mix = (roll: number, pitch: number, yaw: number): number[] => {
    const out = new Float64Array(4);
    crashFlipMix(roll, pitch, yaw, MIX_R, MIX_P, MIX_Y, out);
    return Array.from(out);
};

describe('crash-flip mix (Betaflight 2026.6.2)', () => {
    it('roll or pitch spins the pair on that side, at the stick deflection', () => {
        expect(mix(1, 0, 0)).toEqual([1, 1, 0, 0]); // roll right: the right-hand motors
        expect(mix(-1, 0, 0)).toEqual([0, 0, 1, 1]);
        expect(mix(0, 1, 0)).toEqual([0, 1, 0, 1]); // pitch forward: the front motors
        expect(mix(0, -0.5, 0)).toEqual([0.5, 0, 0.5, 0]);
    });

    it('a diagonal stick spins one motor; off the diagonal by more than 30 deg, only the larger axis', () => {
        const d = Math.SQRT1_2;
        const m = mix(d, d, 0);
        expect(m[1]).toBeCloseTo(1, 12); // front-right: roll right and pitch forward both ask for it
        expect([m[0], m[2], m[3]]).toEqual([0, 0, 0]);
        // 20.6 deg from the roll axis, 24.4 deg from the diagonal: still the diagonal, both columns add, capped at 1
        expect(mix(0.8, 0.3, 0)).toEqual([0, 1, 0, 0]);
        // 7.1 deg from the roll axis: roll only, at the stick's length
        const len = Math.sqrt(0.8 * 0.8 + 0.1 * 0.1);
        expect(mix(0.8, 0.1, 0)).toEqual([len, len, 0, 0]);
    });

    it('yaw, when it is the largest deflection, spins a diagonal pair; throttle plays no part', () => {
        expect(mix(0.2, 0, 0.6)).toEqual([0, 0.6, 0.6, 0]);
        expect(mix(0, 0, -0.6)).toEqual([0.6, 0, 0, 0.6]);
    });

    it('nothing spins inside the 15 % stick deadband or under the 2 % motor deadband', () => {
        expect(mix(0.15, 0, 0)).toEqual([0, 0, 0, 0]);
        expect(mix(0.1, 0.1, 0)).toEqual([0, 0, 0, 0]); // length 0.141
        expect(mix(0.16, 0, 0)[0]).toBe(0.16);
        expect(CRASHFLIP_MOTOR_DEADBAND).toBe(0.02);
    });
});

/** A craft on its back in free space (no world), parked until armed. */
function onItsBack(): Sim {
    const sim = new Sim(compileParams(PRESET, {}), null);
    sim.setChannels([0, 0, -1, 0, -1, -1, 0, 0]);
    sim.reset(0, 10, 0, 0);
    sim.s[S.qw] = 0;
    sim.s[S.qz] = 1; // rolled 180 deg
    sim.step();
    return sim;
}
const chans = (o: { arm: boolean; turtle: boolean; roll?: number; thr?: number }): number[] => [o.roll ?? 0, 0, o.thr ?? -1, 0, o.arm ? 1 : -1, -1, o.turtle ? 1 : 0, 0];

describe('turtle-mode arming (Betaflight 2026.6.2 core.c, crashflip_auto_rearm off)', () => {
    it('on its back it will not arm (small_angle 25 deg) unless the turtle switch is on; then the motors run reversed on stick only', () => {
        const sim = onItsBack();
        sim.setChannels(chans({ arm: true, turtle: false }));
        sim.step();
        expect(sim.armed).toBe(false);
        sim.setChannels(chans({ arm: false, turtle: true }));
        sim.step();
        sim.setChannels(chans({ arm: true, turtle: true }));
        sim.step();
        expect(sim.armed).toBe(true);
        expect(sim.s[S.flip]).toBe(1);
        // sticks centred: nothing spins, whatever the throttle
        sim.setChannels(chans({ arm: true, turtle: true, thr: 1 }));
        sim.step();
        expect(Array.from(sim.motorCmd)).toEqual([0, 0, 0, 0]);
        sim.setChannels(chans({ arm: true, turtle: true, roll: 1 }));
        sim.step();
        expect(Array.from(sim.motorDir)).toEqual([-1, -1, -1, -1]);
        expect(Array.from(sim.motorCmd)).toEqual([1, 1, 0, 0]);
        sim.step();
        // the right-hand motors spin backwards: their state goes negative
        expect(sim.s[S.m0]).toBeLessThan(0);
        expect(sim.s[S.m0 + 1]).toBeLessThan(0);
        expect(sim.s[S.m0 + 2]).toBe(0);
    });

    it('turning the turtle switch off disarms; arming again needs the arm switch off and on, and the craft level', () => {
        const sim = onItsBack();
        sim.setChannels(chans({ arm: true, turtle: true }));
        sim.step();
        expect(sim.armed).toBe(true);
        const n = sim.events.length;
        sim.setChannels(chans({ arm: true, turtle: false }));
        sim.step();
        expect(sim.armed).toBe(false);
        expect(sim.s[S.flip]).toBe(0);
        expect(sim.events.slice(n)).toEqual([{ type: 'disarm', tick: sim.tick, reason: 'crashflip' }]);
        // the arm switch still on: no new edge, no arming, even once level
        sim.s[S.qw] = 1;
        sim.s[S.qz] = 0;
        sim.step();
        expect(sim.armed).toBe(false);
        sim.setChannels(chans({ arm: false, turtle: false }));
        sim.step();
        sim.setChannels(chans({ arm: true, turtle: false }));
        sim.step();
        expect(sim.armed).toBe(true);
        expect(sim.s[S.flip]).toBe(0);
        expect(Array.from(sim.motorDir)).toEqual([1, 1, 1, 1]);
    });

    it('level, the turtle switch on at arming still means turtle mode (the switch, not the attitude, decides)', () => {
        const sim = new Sim(compileParams(PRESET, {}), null);
        sim.setChannels(chans({ arm: false, turtle: true }));
        sim.reset(0, 10, 0, 0);
        sim.step();
        sim.setChannels(chans({ arm: true, turtle: true }));
        sim.step();
        expect(sim.s[S.flip]).toBe(1);
    });
});
