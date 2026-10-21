// The UZH Kingfisher preset (owner 2026-10-21; docs/evidence/2026-10-21-neurobem-replay): a stretched X with per-axis
// inertia (the optional preset fields motor_forward_mm, motor_lateral_mm, inertia_roll_kgm2, inertia_pitch_kgm2), its
// logged Betaflight tune, and a hover at its logs' rotor speed.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sim, compileParams } from '../src/index';
import { preset } from './model-helpers';

const KF = preset('uzh-kingfisher-4s');
const MACH = preset('machr5sport-6s').fields;
const IPR = MACH.inertia_roll_pitch_kgm2.value as number, IYAW = MACH.inertia_yaw_kgm2.value as number;

describe('UZH Kingfisher preset', () => {
    it('motors at +-77.5 mm forward, +-100 mm sideways; inertia roll 0.0025, pitch 0.0021, yaw 0.0043 (UZH kingfisher.yaml)', () => {
        const p = compileParams(KF, {});
        // Betaflight quad X: rear right, front right, rear left, front left; body x right, z back
        expect(Array.from(p.motorPos)).toEqual([0.1, 0, 0.0775, 0.1, 0, -0.0775, -0.1, 0, 0.0775, -0.1, 0, -0.0775]);
        expect(p.inertia).toEqual([0.0021, 0.0043, 0.0025]);
        expect(p.mass).toBeCloseTo(0.752, 9);
    });

    it('flies its logged Betaflight 4.2 tune: P40 I80 D20 F0, rc_rate 2.2 / 2.04 linear', () => {
        const p = compileParams(KF, {});
        expect(p.pid.roll).toEqual([40, 80, 20, 0]);
        expect(p.pid.yaw).toEqual([30, 60, 0, 0]);
        expect(p.rates.type).toBe('BETAFLIGHT');
        expect(p.rates.roll).toEqual({ rcRate: 220, rate: 0, expo: 0 });
    });

    it('hovers near its logs\' 11 100-11 500 rpm, with about 31.6 N static thrust (paper: about 33 N)', () => {
        const p = compileParams(KF, { loopHz: 4000 });
        const at = (cmd: number) => {
            const sim = new Sim(p, null);
            sim.reset(0, 100, 0, 0);
            const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
            sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const c = new Float64Array(4).fill(cmd);
            const s = sim.s;
            for (let i = 0; i < 6000; i++) {
                s[S.qw] = 1; s[S.qx] = s[S.qy] = s[S.qz] = 0; s[S.wx] = s[S.wy] = s[S.wz] = 0;
                s[S.vx] = s[S.vy] = s[S.vz] = 0; s[S.py] = 100; s[S.soc] = 0.8;
                (sim as unknown as { physics(c: Float64Array): void }).physics(c);
            }
            const thrust = (sim as unknown as { thrust: Float64Array }).thrust[0] * 4;
            return { rpm: s[S.m0] * p.omegaMaxPerVolt * s[S.volt] * 60 / (2 * Math.PI), thrust };
        };
        let lo = 0.1, hi = 0.8;
        for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (at(m).thrust < p.mass * 9.81) lo = m; else hi = m; }
        expect(at(lo).rpm).toBeGreaterThan(11000);
        expect(at(lo).rpm).toBeLessThan(11800);
        expect(at(1).thrust).toBeGreaterThan(30);
        expect(at(1).thrust).toBeLessThan(34);
    });

    it('presets without the new fields keep the square X and one roll / pitch inertia', () => {
        const p = compileParams(preset('machr5sport-6s'), {});
        const a = 210 / 2000 / Math.SQRT2;
        expect(Array.from(p.motorPos)).toEqual([a, 0, a, a, 0, -a, -a, 0, a, -a, 0, -a]);
        expect(p.inertia).toEqual([IPR, IYAW, IPR]);
    });
});
