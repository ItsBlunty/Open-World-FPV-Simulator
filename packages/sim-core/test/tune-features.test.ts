// Betaflight's TPA, thrust linearization, I-term relax cutoff and anti-gravity gain (ParamOverrides.tpa, thrustLinear,
// itermRelaxCutoff, antiGravityGain; sim-core/0.8.0): absent or at Betaflight's defaults keeps every flight bit for bit;
// the formulas match Betaflight 4.5.1 pid.c / pid_init.c, worked out by hand; flights with them replay to the same hash.

import { describe, expect, it } from 'vitest';
import { LifePlayer, MODE_CHANNEL, S, S_DYN, S_TPA, Sim, compileParams, thrustLinearOutput, thrustLinearThrottle, tpaFactor } from '../src/index';
import type { Life, ParamOverrides } from '../src/index';
import { preset } from './model-helpers';
import { PlaneWorld, Pilot, crashCycles, deps, newRunner, runFrames } from './log-kit';

const NAZGUL = preset('nazgulf5v3-6s');
/** SupaflyFPV Freestyle 5 Inch (betaflight/firmware-presets 4.5) TPA */
const SUPAFLY_TPA = { mode: 'PD' as const, rate: 50, breakpoint: 1250, lowRate: 20, lowBreakpoint: 1100, lowAlways: true };
/** Betaflight 4.5's defaults (pid.c resetPidProfile) */
const BF_TPA = { mode: 'D' as const, rate: 65, breakpoint: 1350, lowRate: 20, lowBreakpoint: 1050, lowAlways: false };

/** A flight with throttle punches, rolls and a chop: sticks from the tick only (no Math functions) */
function fly(o: ParamOverrides, ms = 3000): Sim {
    const sim = new Sim(compileParams(NAZGUL, o), null);
    sim.reset(0, 500, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
    sim.setChannels(ch);
    for (let i = 0; i < 200; i++) sim.step();
    ch[4] = 1;
    sim.setChannels(ch);
    sim.step();
    expect(sim.armed).toBe(true);
    for (let t = 0; t < ms; t++) {
        const p = t % 1000;
        ch[2] = p < 400 ? 0.6 : p < 450 ? -1 : -0.6; // punch, chop, low
        ch[0] = p > 600 && p < 700 ? 0.5 : 0;
        ch[1] = p > 800 && p < 850 ? -0.3 : 0;
        sim.setChannels(ch);
        sim.step();
    }
    return sim;
}

describe('Betaflight tune features (TPA, thrust linear, relax cutoff, anti-gravity gain)', () => {
    it('absent, or at Betaflight\'s defaults (relax 15 Hz, anti-gravity 80, thrust linear 0): the same flight bit for bit', () => {
        const p = compileParams(NAZGUL, {});
        expect(p.tpa).toBeNull();
        expect(p.thrustLinear).toBe(0);
        const a = fly({});
        const b = fly({ itermRelaxCutoff: 15, antiGravityGain: 80, thrustLinear: 0 });
        expect(a.s.length).toBe(S.size);
        expect(Array.from(b.s)).toEqual(Array.from(a.s));
    });

    it('each one, set away from its default, changes the flight (it is wired in)', () => {
        const base = Array.from(fly({}).s);
        for (const o of [{ tpa: BF_TPA }, { thrustLinear: 30 }, { itermRelaxCutoff: 5 }, { antiGravityGain: 160 }] as ParamOverrides[]) {
            expect(Array.from(fly(o).s), JSON.stringify(o)).not.toEqual(base);
        }
    });

    it('TPA compiles as pid_init.c and attenuates as pid.c pidUpdateTpaFactor (hand-worked values)', () => {
        const sf = compileParams(NAZGUL, { tpa: SUPAFLY_TPA }).tpa!;
        expect(sf.pd).toBe(true);
        expect(sf.breakpoint).toBeCloseTo(0.25, 12);
        expect(sf.multiplier).toBeCloseTo(0.5 / 0.75, 12);
        expect(sf.lowBreakpoint).toBeCloseTo(0.1, 12);
        expect(sf.lowMultiplier).toBeCloseTo(20 / (100 * 0.1), 12);
        // below the low breakpoint: 1 - 2 x (0.1 - t)
        expect(tpaFactor(sf, 0, false)).toBeCloseTo(0.8, 12);
        expect(tpaFactor(sf, 0.05, false)).toBeCloseTo(0.9, 12);
        // between the breakpoints nothing; above 0.25 down to 1 - 0.5 at full throttle
        expect(tpaFactor(sf, 0.2, false)).toBe(1);
        expect(tpaFactor(sf, 0.625, false)).toBeCloseTo(0.75, 12);
        expect(tpaFactor(sf, 1, false)).toBeCloseTo(0.5, 12);
        const bf = compileParams(NAZGUL, { tpa: BF_TPA }).tpa!;
        expect(bf.pd).toBe(false);
        expect(tpaFactor(bf, 1, true)).toBeCloseTo(0.35, 12);
        // once faded (lowAlways off), the low-throttle part no longer applies
        expect(tpaFactor(bf, 0, true)).toBe(1);
        expect(tpaFactor(bf, 0, false)).toBeCloseTo(0.8, 12);
        // CLI ranges: rate 0-100, breakpoints 1000-2000; the low breakpoint is held at most the breakpoint
        const c = compileParams(NAZGUL, { tpa: { mode: 'D', rate: 500, breakpoint: 900, lowRate: -5, lowBreakpoint: 3000, lowAlways: true } }).tpa!;
        expect(c.multiplier).toBeCloseTo(1, 12);
        expect(c.breakpoint).toBe(0);
        expect(c.lowBreakpoint).toBe(0);
        expect(c.lowMultiplier).toBe(0);
        expect(() => compileParams(NAZGUL, { tpa: { ...BF_TPA, rate: NaN } })).toThrow(RangeError);
    });

    it('TPA without tpa_low_always keeps Betaflight\'s fade latch in a state slot; with it, no extra slot', () => {
        expect(fly({ tpa: SUPAFLY_TPA }, 10).s.length).toBe(S.size);
        const s = fly({ tpa: BF_TPA }, 600);
        expect(s.s.length).toBe(S_TPA.size);
        expect(s.s[S_TPA.lowFaded]).toBe(1); // the punch passed the 1050 breakpoint
        expect(fly({ tpa: BF_TPA, dynIdle: { minRpm: 30 } }, 10).s.length).toBe(S_TPA.size);
        expect(fly({ tpa: SUPAFLY_TPA, dynIdle: { minRpm: 30 } }, 10).s.length).toBe(S_DYN.size);
    });

    it('thrust linearization as pid.c (hand-worked values for thrust_linear 30)', () => {
        expect(compileParams(NAZGUL, { thrustLinear: 30 }).thrustLinear).toBeCloseTo(0.3, 12);
        expect(compileParams(NAZGUL, { thrustLinear: 999 }).thrustLinear).toBeCloseTo(1.5, 12);
        // output: v (1 + 0.3 (1 - v)^2)
        expect(thrustLinearOutput(0.3, 0)).toBe(0);
        expect(thrustLinearOutput(0.3, 0.2)).toBeCloseTo(0.2384, 12);
        expect(thrustLinearOutput(0.3, 1)).toBe(1);
        // throttle: t / (1 + (0.3 - 0.045) (1 - t)^2)
        expect(thrustLinearThrottle(0.3, 0.5)).toBeCloseTo(0.5 / (1 + 0.255 * 0.25), 12);
        expect(thrustLinearThrottle(0.3, 1)).toBe(1);
    });

    it('relax cutoff and anti-gravity gain take Betaflight\'s CLI ranges', () => {
        const pt1 = (fc: number) => 0.001 / (1 / (2 * Math.PI * fc) + 0.001);
        expect(compileParams(NAZGUL, { itermRelaxCutoff: 10 }).relaxK).toBeCloseTo(pt1(10), 15);
        expect(compileParams(NAZGUL, { itermRelaxCutoff: 0 }).relaxK).toBeCloseTo(pt1(1), 15);
        expect(compileParams(NAZGUL, { itermRelaxCutoff: 99 }).relaxK).toBeCloseTo(pt1(50), 15);
        expect(compileParams(NAZGUL, { antiGravityGain: 999 }).antiGravityGain).toBe(250);
        expect(compileParams(NAZGUL, { antiGravityGain: 120 }).antiGravityGain).toBe(120);
    });

    it('a recorded flight with all of them replays to the same hash', () => {
        const world = PlaneWorld.room({ wallX: 4 });
        const overrides: ParamOverrides = { tpa: BF_TPA, thrustLinear: 30, itermRelaxCutoff: 10, antiGravityGain: 120, dynIdle: { minRpm: 30 } };
        const r = newRunner({ world, at: [0, 1, 0, 0], overrides });
        expect(r.sim.s.length).toBe(S_TPA.size);
        crashCycles(new Pilot(r), { hoverTicks: 3000, speed: 6, maxCrashes: 1 });
        runFrames(r, 60, 3_000_000);
        const live = r.liveLifeHash()!;
        const life: Life = r.current();
        const end = r.sim.tick;
        const p = new LifePlayer({ header: life.header, bytes: () => life.bytes().slice(), endTick: end, hashFrom: life.hashFrom, snapshot: life.snapshot }, deps(world), end);
        p.stepTo(end);
        expect(p.digest()).toBe(live.hash);
    });
});
