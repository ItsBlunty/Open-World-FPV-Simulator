// Dynamic idle (ParamOverrides.dynIdle, Betaflight's dyn_idle_*): off keeps every flight bit for bit; on, the slowest
// motor is held at dyn_idle_min_rpm once airmode is active, the floor stays under its caps, and replays match.

import { describe, expect, it } from 'vitest';
import { DYN_IDLE_DEFAULTS, LifePlayer, MODE_CHANNEL, S, S_DYN, Sim, autoDynIdleMinRpm, compileParams } from '../src/index';
import type { Life, ParamOverrides } from '../src/index';
import { plainPreset } from './model-helpers';
import { PlaneWorld, Pilot, crashCycles, deps, newRunner, runFrames } from './log-kit';

// the Nazgul without its own TPA and ESC dead time: these tests isolate one controller feature
const NAZGUL = plainPreset('nazgulf5v3-6s');

/** rpm of the slowest motor */
function minRpm(sim: Sim): number {
    let m = Infinity;
    for (let i = 0; i < 4; i++) m = Math.min(m, Math.abs(sim.s[S.m0 + i]));
    return (m * sim.p.omegaMaxPerVolt * sim.s[S.volt] * 60) / (2 * Math.PI);
}

/** Armed high in the air at zero throttle, acro; `pre` ms at mid stick first (activates airmode) */
function zeroThrottle(o: ParamOverrides, preMs: number, ms: number): Sim {
    const sim = new Sim(compileParams(NAZGUL, o), null);
    sim.reset(0, 500, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
    sim.setChannels(ch);
    for (let i = 0; i < 200; i++) sim.step();
    ch[4] = 1;
    sim.setChannels(ch);
    sim.step();
    expect(sim.armed).toBe(true);
    ch[2] = 0;
    sim.setChannels(ch);
    for (let i = 0; i < preMs; i++) sim.step();
    ch[2] = -1;
    sim.setChannels(ch);
    for (let i = 0; i < ms; i++) sim.step();
    return sim;
}

describe('dynamic idle (ParamOverrides.dynIdle)', () => {
    it('off (absent or minRpm 0): no extra state slots, the same flight bit for bit', () => {
        expect(compileParams(NAZGUL, {}).dynIdle).toBeNull();
        expect(compileParams(NAZGUL, { dynIdle: { minRpm: 0 } }).dynIdle).toBeNull();
        const a = zeroThrottle({}, 300, 500);
        const b = zeroThrottle({ dynIdle: { minRpm: 0, p: 200 } }, 300, 500);
        expect(a.s.length).toBe(S.size);
        expect(Array.from(b.s)).toEqual(Array.from(a.s));
    });

    it('compiles as Betaflight mixer_init.c does, with its defaults and CLI ranges', () => {
        const d = compileParams(NAZGUL, { dynIdle: { minRpm: 35 } }).dynIdle!;
        expect(d.minRps).toBeCloseTo(3500 / 60, 12);
        expect(d.pGain).toBeCloseTo(DYN_IDLE_DEFAULTS.p * 0.00015, 15);
        expect(d.iGain).toBeCloseTo(DYN_IDLE_DEFAULTS.i * 0.01 * 0.001, 15);
        expect(d.dGain).toBeCloseTo(DYN_IDLE_DEFAULTS.d * 0.0000003 * 1000, 15);
        expect(d.maxIncrease).toBeCloseTo(0.15, 15);
        expect(d.startIncrease).toBeCloseTo(0.05, 15);
        expect(d.delayK).toBeCloseTo(0.04, 15);
        const c = compileParams(NAZGUL, { dynIdle: { minRpm: 999, p: 0, d: -5, maxIncrease: 9999 } }).dynIdle!;
        expect(c.minRps).toBeCloseTo(20000 / 60, 12);
        expect(c.pGain).toBeCloseTo(0.00015, 15); // p 1-250
        expect(c.dGain).toBe(0); // d 0-250
        expect(c.maxIncrease).toBeCloseTo(0.255, 15);
        expect(() => compileParams(NAZGUL, { dynIdle: { minRpm: NaN } })).toThrow(RangeError);
    });

    it('once airmode is active, holds the slowest motor at the minimum rpm with the throttle down', () => {
        const target = 3400;
        const off = zeroThrottle({}, 500, 1500);
        const on = zeroThrottle({ dynIdle: { minRpm: target / 100 } }, 500, 1500);
        expect(on.s.length).toBe(S_DYN.size);
        expect(on.s[S_DYN.airAct]).toBe(1);
        // the static 5.5 % idle turns the Nazgul near its motor's free speed (0.055 x Kv x V, about 2400 rpm: the motor
        // model, sim-core/0.8.0); dynamic idle holds it at the target
        expect(minRpm(off)).toBeLessThan(2600);
        expect(Math.abs(minRpm(on) - target)).toBeLessThan(0.02 * target);
        expect(on.s[S_DYN.dynI]).toBeGreaterThan(0);
        expect(on.s[S_DYN.dynI]).toBeLessThanOrEqual(0.15);
    });

    it('before airmode is active (throttle never above 25 %), the rise stays under dyn_idle_start_increase', () => {
        const sim = zeroThrottle({ dynIdle: { minRpm: 200 } }, 0, 1000);
        expect(sim.s[S_DYN.airAct]).toBe(0);
        expect(sim.s[S_DYN.dynI]).toBeCloseTo(0.05, 12);
        // the floor (5 %) plus the 1 % throttle; the rate PID's small corrections ride on top
        for (let i = 0; i < 4; i++) expect(sim.motorCmd[i]).toBeLessThan(0.065);
        // 20000 rpm asked for: capped at the 15 % max increase once airmode is on
        const hi = zeroThrottle({ dynIdle: { minRpm: 200 } }, 500, 1000);
        expect(hi.s[S_DYN.airAct]).toBe(1);
        expect(hi.s[S_DYN.dynI]).toBeCloseTo(0.15, 12);
        for (let i = 0; i < 4; i++) expect(hi.motorCmd[i]).toBeLessThan(0.165);
    });

    it('disarming clears the airmode latch', () => {
        const sim = zeroThrottle({ dynIdle: { minRpm: 30 } }, 300, 100);
        expect(sim.s[S_DYN.airAct]).toBe(1);
        sim.setChannels([0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0]);
        sim.step();
        expect(sim.armed).toBe(false);
        expect(sim.s[S_DYN.airAct]).toBe(0);
    });

    it('a recorded flight with it replays to the same hash', () => {
        const world = PlaneWorld.room({ wallX: 4 });
        const r = newRunner({ world, at: [0, 1, 0, 0], overrides: { dynIdle: { minRpm: 60 } } });
        expect(r.sim.s.length).toBe(S_DYN.size);
        crashCycles(new Pilot(r), { hoverTicks: 3000, speed: 6, maxCrashes: 1 });
        runFrames(r, 60, 3_000_000);
        const live = r.liveLifeHash()!;
        const life: Life = r.current();
        const end = r.sim.tick;
        const p = new LifePlayer({ header: life.header, bytes: () => life.bytes().slice(), endTick: end, hashFrom: life.hashFrom, snapshot: life.snapshot }, deps(world), end);
        p.stepTo(end);
        expect(p.digest()).toBe(live.hash);
    });

    it('the game picks the minimum from the prop: 35 (3500 rpm) on a 5-inch, inside Betaflight\'s 30-40', () => {
        expect(autoDynIdleMinRpm(127)).toBe(35);
        expect(autoDynIdleMinRpm(129.5)).toBe(34); // the Nazgul's 5.1-inch
        expect(autoDynIdleMinRpm(177.8)).toBe(25); // 7-inch: Oscar Liang 14-28
        expect(autoDynIdleMinRpm(76.2)).toBe(58); // 3-inch: 33-66
    });
});
