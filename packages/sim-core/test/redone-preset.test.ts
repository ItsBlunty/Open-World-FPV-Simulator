// The owner's quad ("red one", 2026-11-08): a squashed X whose numbers come from its blackbox log
// (docs/notes/physics.md §2v). Checks the squashed-X geometry, that the compiled model reproduces the log's
// measurements, and that it flips slower in pitch than in roll as the log shows (the true-X Nazgul as control).
import { describe, expect, it } from 'vitest';
import { compileParams } from '../src/index';
import { hovering, params, preset, rate } from './model-helpers';

const RPM = 60 / (2 * Math.PI);

describe('squashed X geometry (motor_spacing_front_rear_mm)', () => {
    it('places the motors 138 mm front to rear on a 225 mm diagonal', () => {
        const p = params('redone-6s');
        const hx = Math.sqrt(0.225 * 0.225 - 0.138 * 0.138) / 2;
        // Betaflight order M1 rear-right, M2 front-right, M3 rear-left, M4 front-left; x right, z back
        expect(Array.from(p.motorPos)).toEqual([hx, 0, 0.069, hx, 0, -0.069, -hx, 0, 0.069, -hx, 0, -0.069]);
        expect(hx * 2 * 1000).toBeCloseTo(177.7, 1);
        // collider spheres on each motor's diagonal, 132 mm out (93 mm x sqrt 2), reaching the prop tips
        for (let i = 0; i < 4; i++) {
            const sx = p.spheres[i * 4], sz = p.spheres[i * 4 + 2];
            expect(Math.sqrt(sx * sx + sz * sz)).toBeCloseTo(0.093 * Math.SQRT2, 9);
            expect(sz / sx).toBeCloseTo(p.motorPos[i * 3 + 2] / p.motorPos[i * 3], 9);
        }
    });

    it('leaves a true X exactly as before (the Nazgul has no spacing field)', () => {
        const p = params('nazgulf5v3-6s');
        const arm = 239 / 2000 / Math.SQRT2;
        expect(Array.from(p.motorPos)).toEqual([arm, 0, arm, arm, 0, -arm, -arm, 0, arm, -arm, 0, -arm]);
        expect(p.spheres[0]).toBe(0.1);
        expect(p.spheres[2]).toBe(0.1);
    });

    it('refuses a front-to-rear spacing that does not fit the diagonal', () => {
        const bad = preset('redone-6s');
        bad.fields.motor_spacing_front_rear_mm = { value: 230, source: 'estimate' };
        expect(() => compileParams(bad)).toThrow(/motor_spacing_front_rear_mm/);
    });
});

describe('red one: the compiled model against the blackbox log', () => {
    const p = params('redone-6s');

    it('top speed per volt and thrust per rpm^2 at the top as measured', () => {
        expect((p.omegaMaxPerVolt * RPM)).toBeCloseTo(1458, -1); // log: 1458 rpm per volt at full command
        const rpmTop = p.omegaMaxPerVolt * p.vNom * RPM;
        const kT = p.tmaxMotorNom / (rpmTop * rpmTop);
        // log: 1.45e-8 N per rpm^2 at 27 000 rpm (accelerometer x 700 g); the model's single value within 10 %
        expect(kT).toBeGreaterThan(1.45e-8 * 0.9);
        expect(kT).toBeLessThan(1.45e-8 * 1.1);
    });

    it('angular acceleration per newton of thrust difference as measured (roll 30, pitch 23 rad/s^2)', () => {
        expect(p.motorPos[0] / p.inertia[2]).toBeCloseTo(29.6, 0);
        expect(p.motorPos[2] / p.inertia[0]).toBeCloseTo(23.0, 0);
    });

    it('yaw torque and rotor spin-up against yaw inertia as measured (2.96 and 1.56e-3)', () => {
        expect(p.kappa / p.inertia[1]).toBeCloseTo(2.95, 1);
        expect(p.rotorInertia / p.inertia[1]).toBeCloseTo(1.55e-3, 4);
    });

    it('motor lag and pack sag as measured', () => {
        expect(p.tau).toBeCloseTo(0.018, 6);
        expect(p.rPack).toBeCloseTo(0.0264, 4);
    });
});

/** deg/s reached 20 ms after a full stick on `axis` from an acro hover */
function rateAfterFullStick(id: string, axis: 'roll' | 'pitch'): number {
    const { sim, ch } = hovering(params(id), 'acro');
    ch[axis === 'roll' ? 0 : 1] = 1;
    sim.setChannels(ch);
    for (let i = 0; i < 20; i++) sim.step();
    return Math.abs(rate(sim, axis));
}

describe('red one flies its geometry', () => {
    it('picks up pitch slower than roll (shorter front-to-rear arms); the true X does not', () => {
        const rRoll = rateAfterFullStick('redone-6s', 'roll');
        const rPitch = rateAfterFullStick('redone-6s', 'pitch');
        expect(rRoll).toBeGreaterThan(100);
        expect(rPitch).toBeLessThan(rRoll * 0.95);
        const nRoll = rateAfterFullStick('nazgulf5v3-6s', 'roll');
        const nPitch = rateAfterFullStick('nazgulf5v3-6s', 'pitch');
        expect(Math.abs(nPitch - nRoll) / nRoll).toBeLessThan(0.05);
    });
});
