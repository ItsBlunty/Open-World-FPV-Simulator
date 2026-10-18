// Golden props (owner, 2026-10-18): taken when the quad's centre comes within COLLECT_RADIUS, on the sim tick it
// happens (so a replay takes the same ones at the same ticks), and taking one changes nothing in the flight.

import { describe, expect, it } from 'vitest';
import { LevelBuilder } from '@owfpv/maps';
import type { Collectible, Level } from '@owfpv/maps';
import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { COLLECT_RADIUS, Collector } from '../src/collect';
import { FlightSession } from '../src/session';
import { selftestSticks } from '../src/selftest';

const preset = nazgul as unknown as PresetJson;
const prop = (n: number, x: number, y: number, z: number): Collectible => ({ n, x, y, z, area: 'Test', spot: `spot ${n}` });

describe('collector', () => {
    it('takes a prop within its radius, once, and not one just outside it', () => {
        const c = new Collector([prop(1, 0, 1, 0), prop(2, 10, 1, 0)]);
        c.check(0, 1 + COLLECT_RADIUS + 0.01, 0);
        expect(c.drain()).toEqual([]);
        c.check(0, 1 + COLLECT_RADIUS - 0.01, 0);
        c.check(0, 1, 0);
        expect(c.drain()).toEqual([1]);
        expect(c.count).toBe(1);
        expect(c.isTaken(1)).toBe(true);
        expect(c.isTaken(2)).toBe(false);
    });

    it('starts from a saved collection and ignores numbers it does not have', () => {
        const c = new Collector([prop(1, 0, 1, 0), prop(2, 10, 1, 0)]);
        c.setTaken([2, 7, 0]);
        expect(c.count).toBe(1);
        c.check(10, 1, 0);
        expect(c.drain()).toEqual([]);
        c.setTaken([]);
        c.check(10, 1, 0);
        expect(c.drain()).toEqual([2]);
    });
});

/** A flat test level with a spawn at the origin and these props. */
function level(props: Collectible[]): Level {
    const b = new LevelBuilder().floor('grass', -200, -200, 200, 200);
    b.spawn({ id: 's', name: 'S', x: 0, z: 0, yawDeg: 0 });
    b.collectibles.push(...props);
    return b.build('test', 1, 'test', 200);
}

/** The self-test's scripted sticks for `ticks`: when each prop was taken, the end state and the run's hash. */
function fly(l: Level, ticks: number): { taken: [number, number][]; end: number[]; hash: string } {
    const s = new FlightSession({ preset, level: l, runHash: true });
    const r = s.runner;
    const ch = new Float32Array(8);
    const taken: [number, number][] = [];
    while (r.sim.tick < ticks) {
        const t = r.sim.tick;
        if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: selftestSticks(t, ch) });
        r.stepOnce();
        for (const n of s.collector.drain()) taken.push([n, r.sim.tick]);
    }
    return { taken, end: Array.from(r.sim.s.subarray(0, 3)), hash: r.traceHash() };
}

describe('golden props in a flight', () => {
    it('are taken on the same ticks every run, and change nothing in the flight', () => {
        // where the scripted flight is at tick 2000, from a run with no props
        const bare = fly(level([]), 2000);
        const [x, y, z] = bare.end;
        // one under the quad at the spawn, one on its path, one off it
        const props = [prop(1, 0, 0.3, 0), prop(2, x, y, z), prop(3, x + 30, y, z)];
        const a = fly(level(props), 2500), b = fly(level(props), 2500);
        expect(a.taken).toEqual(b.taken);
        expect(a.taken.map(([n]) => n)).toEqual([1, 2]);
        expect(a.taken[0][1]).toBe(1);
        expect(a.taken[1][1]).toBeLessThanOrEqual(2000);
        // the same flight, prop for prop and bit for bit, as with no props at all
        expect(a.hash).toBe(fly(level([]), 2500).hash);
    });
});
