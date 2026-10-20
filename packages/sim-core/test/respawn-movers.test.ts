// Respawns avoid cars (owner, 2026-10-20): a rewind skips kept spots that a moving surface (car, person, train; the
// world's movingNear) is on at the respawn tick and goes further back; a start with one on it goes above it. Control:
// the history's pick without that test, on the same flight, is a spot the car is on.

import { describe, expect, it } from 'vitest';
import { S } from '../src/index';
import type { HistorySample } from '../src/index';
import { PlaneWorld, Pilot, attachDirector, newRunner, runFrames } from './log-kit';

/** A floor at y = 0 and a "car": from tick `from`, the points `inCar` says are within r of it count as near a mover. */
class CarWorld extends PlaneWorld {
    tick = 0;
    constructor(readonly from: number, readonly inCar: (x: number, y: number, z: number, r: number) => boolean) {
        super([[0, 1, 0, 0]]);
    }
    at(tick: number): void {
        this.tick = tick;
    }
    movingNear(x: number, y: number, z: number, r: number): boolean {
        return this.tick >= this.from && this.inCar(x, y, z, r);
    }
}

describe('respawns avoid cars', () => {
    it('a rewind onto the stretch a car now covers goes further back, to a spot clear of it', () => {
        // the car covers x > 4 from 6.5 s: the stretch the quad dashed along
        const world = new CarWorld(6500, (x, _y, _z, r) => x > 4 - r);
        const spawn: [number, number, number, number] = [0, 1, 0, 0];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn, { rewindTicks: 2000 });
        const p = new Pilot(r);
        let asked = false, control: HistorySample | null = null, at: number[] = [];
        r.onLife = () => { if (d.last) at = [r.sim.s[S.px], r.sim.s[S.py], r.sim.s[S.pz]]; };
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: pp.here(sim), yawDeg: -90 }, sim); pp.phase = 'hover'; }
            else if (pp.phase === 'hover' && pp.life === 0 && lt >= 3000 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: 3, yawDeg: -90 }, sim); pp.phase = 'dash'; }
            else if (pp.phase === 'dash' && lt >= 7000 && !asked) {
                asked = true;
                control = d.history.pickBefore(sim.tick, 2000);
                d.request('rewind');
            }
        };
        runFrames(r, 60, 8_000_000);
        console.log(`rewind: without the car test ${control ? `x ${control.x.toFixed(2)} m (${(r.sim.tick - control.tick)} ticks back)` : 'none'}; ` +
            `went to x ${at[0]?.toFixed(2)} m (${d.last?.kind}, ${d.last?.pathAgeTicks} ticks back)`);
        expect(control).not.toBeNull();
        expect(control!.x).toBeGreaterThan(4);
        expect(d.last?.kind).toBe('rewind');
        expect(at[0]).toBeLessThan(4 - r.sim.p.boundRadius - d.history.margin);
        expect(d.last!.pathAgeTicks!).toBeGreaterThan(2000);
    });

    it('a start with a car on it goes above the car, clear of it', () => {
        // a car 1.5 m tall over the spawn from 2.5 s
        const world = new CarWorld(2500, (x, y, z, r) => x * x + z * z < (2 + r) * (2 + r) && y < 1.5 + r);
        const spawn: [number, number, number, number] = [0, 0.5, 0, 0];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn);
        const p = new Pilot(r);
        let asked = false, at: number[] = [];
        r.onLife = () => { if (d.last) at = [r.sim.s[S.px], r.sim.s[S.py], r.sim.s[S.pz]]; };
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: [3, 1, 3], yawDeg: 0 }, sim); pp.phase = 'hover'; }
            else if (!asked && lt >= 3000) { asked = true; d.request('start'); }
        };
        runFrames(r, 60, 3_500_000);
        const clearAbove = 1.5 + r.sim.p.boundRadius + d.history.margin;
        console.log(`start: spawn y 0.5 m, went to y ${at[1]?.toFixed(2)} m (clear of the car from ${clearAbove.toFixed(2)} m)`);
        expect(d.last?.kind).toBe('start');
        expect(at[0]).toBe(0);
        expect(at[1]).toBeGreaterThanOrEqual(clearAbove);
        expect(at[1]).toBeLessThan(clearAbove + 0.25);
    });

    it('with nothing moving the start is the spawn as before', () => {
        const world = new CarWorld(Infinity, () => true);
        const spawn: [number, number, number, number] = [0, 0.5, 0, 0];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn);
        const p = new Pilot(r);
        let asked = false, at: number[] = [];
        r.onLife = () => { if (d.last) at = [r.sim.s[S.px], r.sim.s[S.py], r.sim.s[S.pz]]; };
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: [3, 1, 3], yawDeg: 0 }, sim); pp.phase = 'hover'; }
            else if (!asked && lt >= 1000) { asked = true; d.request('start'); }
        };
        runFrames(r, 60, 1_500_000);
        expect(at).toEqual([0, 0.5, 0]);
    });
});
