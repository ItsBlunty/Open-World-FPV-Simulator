// MeshContactWorld against exact answers: a floor against the analytic plane, hand-computed edge,
// vertex and corner cases, no tunnelling, and the BVH against a brute-force search.

import { describe, expect, it } from 'vitest';
import type { ContactOut } from '@owfpv/sim-core';
import { MeshBuilder, MeshContactWorld, closest, newClosest, sweepTriangle } from '../src/index';

/** Deterministic test numbers (mulberry32). */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function world(b: MeshBuilder): MeshContactWorld {
    return new MeshContactWorld(b.positions, b.indices);
}

/** One sphere's sweep through the ContactWorld interface. */
function sweep1(w: MeshContactWorld, a: number[], b: number[], r: number, pad = 0): { t: number; out: ContactOut } {
    const out: ContactOut = { sphere: -1, nx: 0, ny: 0, nz: 0 };
    const t = w.sweep(new Float64Array(a), new Float64Array(b), new Float64Array([r]), new Float64Array([pad]), 1, out);
    return { t, out };
}

const floor = () => world(new MeshBuilder().quad([-50, 0, -50], [-50, 0, 50], [50, 0, 50], [50, 0, -50]));

describe('a flat floor gives the analytic plane answer', () => {
    // Centres start above the floor: the plane is a solid half-space, a mesh is only a surface (see
    // 'a surface has no inside' below). The end point may be below: the sweep stops before it.
    it('sweep: 5000 random moves, t and normal as the plane y = 0 gives them', () => {
        const w = floor();
        const rand = rng(1);
        let hits = 0, overlaps = 0;
        for (let i = 0; i < 5000; i++) {
            const x = rand() * 20 - 10, z = rand() * 20 - 10;
            const a = [x, rand() * 0.5, z];
            const b = [x + rand() * 0.2 - 0.1, rand() * 0.55 - 0.05, z + rand() * 0.2 - 0.1];
            const r = 0.01 + rand() * 0.09, pad = 1e-9;
            // the plane world of sim-core's test kit (log-kit.ts PlaneWorld) for a floor at y = 0
            const R = r + pad, d0 = a[1] - R, d1 = b[1] - R;
            const want = d0 < 0 ? 0 : d1 < 0 ? d0 / (d0 - d1) : -1;
            const { t, out } = sweep1(w, a, b, r, pad);
            if (want < 0) { expect(t).toBe(-1); continue; }
            if (want === 0) overlaps++; else hits++;
            expect(Math.abs(t - want)).toBeLessThanOrEqual(1e-12);
            expect([out.nx, out.ny, out.nz]).toEqual([0, 1, 0]);
        }
        expect(hits).toBeGreaterThan(300);
        expect(overlaps).toBeGreaterThan(300);
    });

    it('pushOut: lifts an overlapping sphere by exactly its penetration, and leaves a free one alone', () => {
        const w = floor();
        const p = { x: 9, y: 9, z: 9 };
        expect(w.pushOut(1.3, 0.04, -2.2, 0.1, p)).toBe(true);
        expect(p.x).toBe(0);
        expect(p.z).toBe(0);
        expect(Math.abs(p.y - 0.06)).toBeLessThan(1e-15);
        expect(w.pushOut(1.3, 0.1, -2.2, 0.1, p)).toBe(false); // touching exactly is not overlapping
        expect([p.x, p.y, p.z]).toEqual([0, 0, 0]);
    });
});

describe('a surface has no inside', () => {
    // Known limit: a sphere whose centre is already below a floor is pushed out downwards. The
    // sweep stops every sphere a radius before a surface, so in flight a centre never crosses one.
    it('a centre below the floor is pushed out on its own side', () => {
        const p = { x: 0, y: 0, z: 0 };
        expect(floor().pushOut(0, -0.02, 0, 0.1, p)).toBe(true);
        expect(p.y).toBeCloseTo(-0.08, 15);
    });
});

describe('edges, vertices and the far side', () => {
    // one triangle in the plane y = 0 with corners (0,0,0), (1,0,0), (0,0,1)
    const tri = () => world(new MeshBuilder().triangle([0, 0, 0], [1, 0, 0], [0, 0, 1]));

    it('edge: a sphere sliding in the plane hits the edge z = 0 at z = -R', () => {
        const { t, out } = sweep1(tri(), [0.5, 0, -1], [0.5, 0, 1], 0.1);
        expect(t).toBeCloseTo(0.45, 14);
        expect(out.nx).toBeCloseTo(0, 14);
        expect(out.ny).toBeCloseTo(0, 14);
        expect(out.nz).toBeCloseTo(-1, 14);
    });

    it('vertex: a sphere coming at the corner (0,0,0) from outside touches it first', () => {
        const { t, out } = sweep1(tri(), [-1, 0, -1], [1, 0, 1], 0.1);
        expect(t).toBeCloseTo((Math.SQRT2 - 0.1) / (2 * Math.SQRT2), 14);
        expect(out.nx).toBeCloseTo(-Math.SQRT1_2, 14);
        expect(out.nz).toBeCloseTo(-Math.SQRT1_2, 14);
    });

    it('triangles are two-sided: from below, the face hit has the downward normal', () => {
        const { t, out } = sweep1(tri(), [0.2, -1, 0.2], [0.2, 1, 0.2], 0.1);
        expect(t).toBeCloseTo(0.45, 14);
        expect(Math.abs(out.nx) + Math.abs(out.nz)).toBe(0);
        expect(out.ny).toBe(-1);
    });

    it('a sphere that passes beside the triangle is free', () => {
        expect(sweep1(tri(), [1.2, 0, 0.5], [1.2, 0, 0.6], 0.1).t).toBe(-1);
        expect(sweep1(tri(), [0.2, 0.2, 0.2], [0.3, 0.2, 0.3], 0.1).t).toBe(-1);
    });
});

describe('no tunnelling, no snagging', () => {
    it('a sphere moving 100 m in one step through a thin wall stops at the wall', () => {
        const w = world(new MeshBuilder().quad([0, -1, -1], [0, 1, -1], [0, 1, 1], [0, -1, 1]));
        const { t, out } = sweep1(w, [-50, 0, 0], [50, 0, 0], 0.05);
        expect(t).toBeCloseTo(49.95 / 100, 14);
        expect(out.nx).toBe(-1);
    });

    it('sliding 1 mm over a floor of 400 small triangles crosses their shared edges without a contact', () => {
        const b = new MeshBuilder();
        for (let i = -5; i < 5; i++) for (let j = -5; j < 5; j++) b.quad([i, 0, j], [i, 0, j + 1], [i + 1, 0, j + 1], [i + 1, 0, j]);
        const w = world(b);
        expect(w.triangleCount).toBe(200);
        expect(sweep1(w, [-4.5, 0.101, -4.3], [4.5, 0.101, 4.1], 0.1).t).toBe(-1);
        // and the same move 1 mm lower is an overlap from the start
        expect(sweep1(w, [-4.5, 0.099, -4.3], [4.5, 0.099, 4.1], 0.1).t).toBe(0);
    });
});

describe('pushOut in a corner', () => {
    it('a sphere in the corner of a floor and a wall leaves both', () => {
        const b = new MeshBuilder()
            .quad([0, 0, -5], [0, 0, 5], [5, 0, 5], [5, 0, -5]) // floor y = 0, x >= 0
            .quad([0, 0, -5], [0, 5, -5], [0, 5, 5], [0, 0, 5]); // wall x = 0
        const w = world(b);
        const p = { x: 0, y: 0, z: 0 };
        expect(w.pushOut(0.05, 0.03, 0, 0.1, p)).toBe(true);
        const x = 0.05 + p.x, y = 0.03 + p.y, z = p.z;
        expect(w.distance(x, y, z)).toBeGreaterThanOrEqual(0.1 - 1e-12);
        expect(p.x).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(0);
    });

    it('a sphere overlapping at the start reports t = 0 with the normal of its deepest overlap', () => {
        const b = new MeshBuilder()
            .quad([0, 0, -5], [0, 0, 5], [5, 0, 5], [5, 0, -5])
            .quad([0, 0, -5], [0, 5, -5], [0, 5, 5], [0, 0, 5]);
        const { t, out } = sweep1(world(b), [0.08, 0.03, 0], [0.5, 0.5, 0], 0.1);
        expect(t).toBe(0);
        expect([out.nx, out.ny, out.nz]).toEqual([0, 1, 0]); // 0.07 into the floor, 0.02 into the wall
    });
});

describe('rays', () => {
    it('down onto a floor, a miss, and the length limit', () => {
        const w = floor();
        expect(w.queryRay(0.3, 2, 0.4, 0, -1, 0, 10)).toEqual({ x: 0.3, y: 0, z: 0.4 });
        expect(w.queryRay(0.3, 2, 0.4, 0, 1, 0, 10)).toBeNull();
        expect(w.queryRay(0.3, 2, 0.4, 0, -1, 0, 1.5)).toBeNull();
    });
});

describe('the BVH finds what a search of every triangle finds', () => {
    // a random triangle soup in a 10 m cube
    const rand = rng(7);
    const pos: number[] = [];
    for (let i = 0; i < 600; i++) {
        const cx = rand() * 10, cy = rand() * 10, cz = rand() * 10;
        for (let v = 0; v < 3; v++) pos.push(cx + rand() - 0.5, cy + rand() - 0.5, cz + rand() - 0.5);
    }
    const w = new MeshContactWorld(pos);

    it('sweeps: 2000 random moves give the same t as testing every triangle', () => {
        const cl = newClosest();
        const hit = { nx: 0, ny: 0, nz: 0 };
        let hits = 0;
        for (let i = 0; i < 2000; i++) {
            const a = [rand() * 10, rand() * 10, rand() * 10];
            const b = [a[0] + rand() * 2 - 1, a[1] + rand() * 2 - 1, a[2] + rand() * 2 - 1];
            const r = 0.02 + rand() * 0.1;
            let want = -1;
            for (let k = 0; k < w.triangleCount; k++) {
                closest(w.tris, k, a[0], a[1], a[2], cl);
                if (cl.dist < r) { want = 0; break; }
                const t = sweepTriangle(w.tris, k, a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2], r, hit);
                if (t >= 0 && (want < 0 || t < want)) want = t;
            }
            const got = sweep1(w, a, b, r).t;
            expect(got).toBe(want);
            if (want > 0) hits++;
        }
        expect(hits).toBeGreaterThan(100);
    });

    it('distances and rays: the same as testing every triangle', () => {
        const cl = newClosest();
        for (let i = 0; i < 1000; i++) {
            const x = rand() * 10, y = rand() * 10, z = rand() * 10;
            let want = Infinity;
            for (let k = 0; k < w.triangleCount; k++) {
                closest(w.tris, k, x, y, z, cl);
                if (cl.dist < want) want = cl.dist;
            }
            expect(w.distance(x, y, z)).toBe(want);
        }
    });
});

describe('build', () => {
    it('drops triangles with no area and builds the same tree every time', () => {
        const b = new MeshBuilder().box([0, 0, 0], [1, 2, 3]).triangle([0, 0, 0], [1, 1, 1], [2, 2, 2]);
        const w1 = world(b), w2 = world(b);
        expect(w1.triangleCount).toBe(12);
        expect(w1.degenerate).toBe(1);
        expect(w1.tris).toEqual(w2.tris);
        expect(w1.bvh.order).toEqual(w2.bvh.order);
        expect(w1.bvh.box).toEqual(w2.bvh.box);
    });

    it('an empty mesh touches nothing', () => {
        const w = new MeshContactWorld([]);
        expect(sweep1(w, [0, 0, 0], [1, 1, 1], 0.1).t).toBe(-1);
        expect(w.pushOut(0, 0, 0, 1, { x: 0, y: 0, z: 0 })).toBe(false);
        expect(w.queryRay(0, 0, 0, 1, 0, 0, 10)).toBeNull();
    });
});
