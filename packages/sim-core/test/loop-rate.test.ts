// The gyro / PID loop rate (ParamOverrides.loopHz, sim-core/0.8.0; owner 2026-10-21: emulate the real 4-8 kHz gyro
// sampling): absent or 1000 keeps every flight bit for bit; at 2-8 kHz the controller reads a fresh gyro sample and the
// physics advances loopHz / 1000 times per tick, the filters follow the loop's dt, the physics converges as the loop
// shortens, and flights replay to the same hash.

import { describe, expect, it } from 'vitest';
import { LifePlayer, MODE_CHANNEL, S, Sim, compileParams } from '../src/index';
import type { Life, ParamOverrides } from '../src/index';
import { preset } from './model-helpers';
import { PlaneWorld, Pilot, crashCycles, deps, newRunner, runFrames } from './log-kit';

const NAZGUL = preset('nazgulf5v3-6s');

/** A flight with punches, rolls and a chop: sticks from the tick only */
function fly(o: ParamOverrides, ms = 3000): Sim {
    const sim = new Sim(compileParams(NAZGUL, o), null);
    sim.reset(0, 500, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
    sim.setChannels(ch);
    for (let i = 0; i < 200; i++) sim.step();
    ch[4] = 1;
    sim.setChannels(ch);
    sim.step();
    for (let t = 0; t < ms; t++) {
        const p = t % 1000;
        ch[2] = p < 400 ? 0.6 : p < 450 ? -1 : -0.6;
        ch[0] = p > 600 && p < 700 ? 0.5 : 0;
        ch[1] = p > 800 && p < 850 ? -0.3 : 0;
        sim.setChannels(ch);
        sim.step();
    }
    return sim;
}

describe('gyro / PID loop rate (loopHz)', () => {
    it('absent or 1000: one loop per tick, the same flight bit for bit', () => {
        expect(compileParams(NAZGUL, {}).loopHz).toBe(1000);
        expect(Array.from(fly({ loopHz: 1000 }).s)).toEqual(Array.from(fly({}).s));
    });

    it('takes 1000, 2000, 4000 or 8000 only', () => {
        for (const hz of [2000, 4000, 8000]) expect(compileParams(NAZGUL, { loopHz: hz }).loopHz).toBe(hz);
        for (const hz of [500, 3000, 16000, NaN]) expect(() => compileParams(NAZGUL, { loopHz: hz })).toThrow(RangeError);
    });

    it('the filters follow the loop: I-term relax at 15 Hz is pt1FilterGain(15, 1 / loopHz)', () => {
        const pt1 = (fc: number, dt: number) => dt / (1 / (2 * Math.PI * fc) + dt);
        expect(compileParams(NAZGUL, { loopHz: 4000 }).relaxK).toBeCloseTo(pt1(15, 0.00025), 15);
        expect(compileParams(NAZGUL, { loopHz: 8000 }).relaxK).toBeCloseTo(pt1(15, 0.000125), 15);
        const di = compileParams(NAZGUL, { loopHz: 4000, dynIdle: { minRpm: 30 } }).dynIdle!;
        expect(di.iGain).toBeCloseTo(50 * 0.01 * 0.00025, 15);
        expect(di.dGain).toBeCloseTo(50 * 0.0000003 * 4000, 15);
    });

    it('at 4 and 8 kHz the flight changes but stays close: the physics converges as the loop shortens', () => {
        const a = fly({}), b = fly({ loopHz: 4000 }), c = fly({ loopHz: 8000 });
        expect(Array.from(b.s)).not.toEqual(Array.from(a.s));
        // a controlled flight with punches and a chop: position after 3 s within centimetres between 4 and 8 kHz
        const d = (x: Sim, y: Sim) => Math.hypot(x.s[S.px] - y.s[S.px], x.s[S.py] - y.s[S.py], x.s[S.pz] - y.s[S.pz]);
        expect(d(b, c)).toBeLessThan(0.05);
        expect(d(b, c)).toBeLessThan(d(a, b) + 1e-9);
    });

    it('a free fall (disarmed) converges to the exact drop as the loop shortens', () => {
        const drop = (hz: number) => {
            const sim = new Sim(compileParams(NAZGUL, { loopHz: hz }), null);
            sim.reset(0, 500, 0, 0);
            sim.s[S.hold] = 0;
            for (let i = 0; i < 1000; i++) sim.step();
            return 500 - sim.s[S.py];
        };
        const d1 = drop(1000), d4 = drop(4000), d8 = drop(8000);
        expect(Math.abs(d8 - d4)).toBeLessThan(Math.abs(d4 - d1));
    });

    it('a recorded 4 kHz flight replays to the same hash', () => {
        const world = PlaneWorld.room({ wallX: 4 });
        const overrides: ParamOverrides = { loopHz: 4000, dynIdle: { minRpm: 30 } };
        const r = newRunner({ world, at: [0, 1, 0, 0], overrides });
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
