// The flight model flown on MeshContactWorld: the same landing as on the analytic floor that
// sim-core's own tests use, and bit-identical traces when a flight is flown again.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, Runner, S, SIM_CORE_VERSION, compileParams, hoverStickOf, lifeSim, makeLifeHeader } from '@owfpv/sim-core';
import type { ContactWorld, SimEvent } from '@owfpv/sim-core';
// test-only import of sim-core's test kit (the preset, its analytic plane world, the frame loop)
import { PRESET, PlaneWorld, runFrames } from '../../sim-core/test/log-kit';
import { MeshBuilder, MeshContactWorld } from '../src/index';
import { SPAWN, room } from './room';

/** Armed 1 m over the floor at y = 0, hover, then throttle off: it falls, lands and settles. Disarmed at 2.5 s. */
function drop(world: ContactWorld): { events: SimEvent[]; y: number; hash: string } {
    const p = compileParams(PRESET, {});
    const sim = lifeSim(p, world);
    const at: [number, number, number, number] = [0.3, 1, -0.2, 30];
    const r = new Runner(sim, makeLifeHeader({ simCore: SIM_CORE_VERSION, preset: PRESET, at, overrides: {}, opts: {} }), { traceHash: true, runHash: true });
    const hover = hoverStickOf(p) * 2 - 1;
    r.enqueue({ tUs: 1000, ch: [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0] });
    r.enqueue({ tUs: 20_000, ch: [0, 0, -1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
    r.enqueue({ tUs: 40_000, ch: [0, 0, hover, 0, 1, MODE_CHANNEL.acro, 0, 0] });
    r.enqueue({ tUs: 500_000, ch: [0, 0, -1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
    r.enqueue({ tUs: 2_500_000, ch: [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0] });
    runFrames(r, 60, 4_000_000);
    return { events: r.events.slice(), y: sim.s[S.py], hash: r.traceHash() };
}

describe('a mesh floor flies like the analytic floor', () => {
    const meshFloor = () => {
        const b = new MeshBuilder();
        // 200 triangles, so the craft lands across shared edges
        for (let i = -5; i < 5; i++) for (let j = -5; j < 5; j++) b.quad([i, 0, j], [i, 0, j + 1], [i + 1, 0, j + 1], [i + 1, 0, j]);
        return new MeshContactWorld(b.positions, b.indices);
    };

    it('a drop: bit-identical to the analytic floor, every tick of the flight (equal trace hashes)', () => {
        const plane = drop(PlaneWorld.room());
        const mesh = drop(meshFloor());
        const firstPlane = plane.events.find((e) => e.type === 'contact')!;
        const firstMesh = mesh.events.find((e) => e.type === 'contact')!;
        console.log(`drop: plane ${plane.events.length} events, first contact ${firstPlane.tick}, rest y ${plane.y}; mesh ${mesh.events.length} events, first contact ${firstMesh.tick}, rest y ${mesh.y}`);
        expect(firstMesh.tick).toBe(firstPlane.tick);
        expect(firstMesh.type === 'contact' && firstPlane.type === 'contact' && Math.abs(firstMesh.speed - firstPlane.speed)).toBeLessThan(1e-9);
        expect(mesh.events.map((e) => `${e.type}@${e.tick}`)).toEqual(plane.events.map((e) => `${e.type}@${e.tick}`));
        expect(mesh.y).toBe(plane.y);
        expect(mesh.hash).toBe(plane.hash);
    });
});

describe('determinism', () => {
    it('the same flight in a freshly built room gives the same trace hash, tick for tick', () => {
        const fly = () => {
            const p = compileParams(PRESET, {});
            const sim = lifeSim(p, room());
            const at: [number, number, number, number] = [SPAWN[0], SPAWN[1], SPAWN[2], -90];
            const r = new Runner(sim, makeLifeHeader({ simCore: SIM_CORE_VERSION, preset: PRESET, at, overrides: {}, opts: {} }), { traceHash: true, runHash: true });
            const hover = hoverStickOf(p) * 2 - 1;
            r.enqueue({ tUs: 1000, ch: [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0] });
            r.enqueue({ tUs: 20_000, ch: [0, 0, -1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
            // pitch forward towards the -x wall: it flies into it and crashes, then lies on the floor
            r.enqueue({ tUs: 300_000, ch: [0, 0.35, hover + 0.1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
            r.enqueue({ tUs: 500_000, ch: [0, 0, hover + 0.15, 0, 1, MODE_CHANNEL.acro, 0, 0] });
            runFrames(r, 144, 6_000_000);
            return { hash: r.traceHash(), crashes: r.events.filter((e) => e.type === 'crash').length };
        };
        const a = fly(), b = fly();
        console.log(`wall flight: ${a.crashes} crash, hash ${a.hash.slice(0, 16)}...`);
        expect(a.crashes).toBe(1);
        expect(b.hash).toBe(a.hash);
    });
});
