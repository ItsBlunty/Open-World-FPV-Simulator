// Contact world for the flight model on a static triangle mesh: sim-core's ContactWorld
// (moving-sphere sweep and push-out), plus the ray and sphere queries the bot's planner and the
// game use. Coordinates are sim-core's world frame (Y up, metres).
//
// Like triangle.ts, everything here that feeds the simulation uses only exactly rounded
// arithmetic, so a flight gives the same bits in every engine.

import type { ContactOut, ContactWorld } from '@owfpv/sim-core';
import { Bvh } from './bvh';
import { TRI_STRIDE, closest, newClosest, rayTriangle, sweepTriangle } from './triangle';
import type { SweepHit } from './triangle';

/** Push-out passes per query, as in the voxel world this replaces (SuperSplat's resolveIterative). */
const PUSH_ITERATIONS = 4;

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export class MeshContactWorld implements ContactWorld {
    /** packed triangles, TRI_STRIDE numbers each (see triangle.ts) */
    readonly tris: Float64Array;
    readonly triangleCount: number;
    /** triangles dropped at build time because they have no area */
    readonly degenerate: number;
    readonly bvh: Bvh;
    private readonly stack: Int32Array;
    private readonly cl = newClosest();
    private readonly hit: SweepHit = { nx: 0, ny: 0, nz: 0 };
    private readonly pushNormals = new Float64Array(9);

    /**
     * positions: x, y, z per vertex. indices: three per triangle; omitted, every three vertices
     * make a triangle. Triangles with zero area are dropped (they cannot be touched first).
     */
    constructor(positions: ArrayLike<number>, indices?: ArrayLike<number>) {
        const nIn = indices ? indices.length / 3 : positions.length / 9;
        if (!Number.isInteger(nIn)) throw new Error('MeshContactWorld: triangle data is not a multiple of 3 vertices');
        const tris = new Float64Array(nIn * TRI_STRIDE);
        let n = 0;
        for (let i = 0; i < nIn; i++) {
            const ia = indices ? indices[i * 3] : i * 3;
            const ib = indices ? indices[i * 3 + 1] : i * 3 + 1;
            const ic = indices ? indices[i * 3 + 2] : i * 3 + 2;
            const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
            const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
            const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
            const ux = bx - ax, uy = by - ay, uz = bz - az;
            const vx = cx - ax, vy = cy - ay, vz = cz - az;
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (!(l > 0)) continue;
            const o = n * TRI_STRIDE;
            tris[o] = ax; tris[o + 1] = ay; tris[o + 2] = az;
            tris[o + 3] = bx; tris[o + 4] = by; tris[o + 5] = bz;
            tris[o + 6] = cx; tris[o + 7] = cy; tris[o + 8] = cz;
            tris[o + 9] = nx / l; tris[o + 10] = ny / l; tris[o + 11] = nz / l;
            tris[o + 12] = tris[o + 9] * ax + tris[o + 10] * ay + tris[o + 11] * az;
            n++;
        }
        this.tris = n === nIn ? tris : tris.slice(0, n * TRI_STRIDE);
        this.triangleCount = n;
        this.degenerate = nIn - n;
        this.bvh = new Bvh(this.tris, n);
        this.stack = new Int32Array(this.bvh.depth + 2);
    }

    /**
     * ContactWorld.sweep: n spheres move linearly from c0 to c1; radius r + pad each. Returns the
     * earliest fraction t in [0, 1] at which any sphere touches the mesh, or -1. A sphere that
     * overlaps the mesh at the start gives t = 0 with the normal of its deepest overlap. Ties go to
     * the lower sphere index, then to the first triangle in tree order.
     */
    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        let best = -1;
        let bestDepth = 0;
        const cl = this.cl;
        const hit = this.hit;
        const tris = this.tris;
        for (let i = 0; i < n; i++) {
            const R = r[i] + pad[i];
            const ax = c0[i * 3], ay = c0[i * 3 + 1], az = c0[i * 3 + 2];
            const bx = c1[i * 3], by = c1[i * 3 + 1], bz = c1[i * 3 + 2];
            const dx = bx - ax, dy = by - ay, dz = bz - az;
            const lo0 = (ax < bx ? ax : bx) - R, lo1 = (ay < by ? ay : by) - R, lo2 = (az < bz ? az : bz) - R;
            const hi0 = (ax > bx ? ax : bx) + R, hi1 = (ay > by ? ay : by) + R, hi2 = (az > bz ? az : bz) + R;
            const order = this.bvh.order;
            let sp = this.visitStart();
            while (sp > 0) {
                const node = this.stack[--sp];
                if (!this.overlapsBox(node, lo0, lo1, lo2, hi0, hi1, hi2)) continue;
                const l = this.bvh.left[node];
                if (l >= 0) {
                    this.stack[sp++] = l + 1;
                    this.stack[sp++] = l;
                    continue;
                }
                const f = this.bvh.first[node], e = f + this.bvh.count[node];
                for (let j = f; j < e; j++) {
                    const k = order[j];
                    closest(tris, k, ax, ay, az, cl);
                    if (cl.dist < R) {
                        // overlapping at the start: t = 0, the deepest overlap gives the normal
                        const depth = R - cl.dist;
                        if (best !== 0 || depth > bestDepth) {
                            best = 0;
                            bestDepth = depth;
                            out.sphere = i; out.nx = cl.nx; out.ny = cl.ny; out.nz = cl.nz;
                        }
                        continue;
                    }
                    if (best === 0) continue;
                    const t = sweepTriangle(tris, k, ax, ay, az, dx, dy, dz, R, hit);
                    if (t >= 0 && (best < 0 || t < best)) {
                        best = t;
                        bestDepth = 0;
                        out.sphere = i; out.nx = hit.nx; out.ny = hit.ny; out.nz = hit.nz;
                    }
                }
            }
            // a later sphere cannot start earlier than an overlap of this one (ties go to the lower index)
            if (best === 0) break;
        }
        return best;
    }

    /**
     * ContactWorld.pushOut: the vector that moves a sphere at (x, y, z) of radius r out of the
     * mesh; false (and a zero vector) when it touches nothing. Repeatedly pushes out of the deepest
     * overlap, never back against an earlier push direction, so a sphere in a corner leaves both
     * walls (the same scheme as SuperSplat's resolveIterative, which the voxel world used).
     */
    pushOut(x: number, y: number, z: number, r: number, out: Vec3): boolean {
        const cl = this.cl;
        const nrm = this.pushNormals;
        let cx = x, cy = y, cz = z;
        let tx = 0, ty = 0, tz = 0;
        let hadHit = false;
        let nN = 0;
        for (let it = 0; it < PUSH_ITERATIONS; it++) {
            if (!this.deepest(cx, cy, cz, r)) break;
            hadHit = true;
            const depth = r - cl.dist;
            let px = cl.nx * depth, py = cl.ny * depth, pz = cl.nz * depth;
            for (let k = 0; k < nN; k++) {
                const ux = nrm[k * 3], uy = nrm[k * 3 + 1], uz = nrm[k * 3 + 2];
                const dot = px * ux + py * uy + pz * uz;
                if (dot < 0) { px -= dot * ux; py -= dot * uy; pz -= dot * uz; }
            }
            if (nN < 3) {
                nrm[nN * 3] = cl.nx; nrm[nN * 3 + 1] = cl.ny; nrm[nN * 3 + 2] = cl.nz;
                nN++;
            }
            cx += px; cy += py; cz += pz;
            tx += px; ty += py; tz += pz;
        }
        out.x = tx; out.y = ty; out.z = tz;
        return hadHit;
    }

    /** Same as pushOut; the name the bot's planner (sim-core/bot PlanCollision) uses. */
    querySphere(x: number, y: number, z: number, r: number, out: Vec3): boolean {
        return this.pushOut(x, y, z, r, out);
    }

    /** First hit of a ray (direction need not be unit length) within `max` direction lengths, or null. */
    queryRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): Vec3 | null {
        const t = this.rayT(ox, oy, oz, dx, dy, dz, max);
        return t < 0 ? null : { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
    }

    /** Ray parameter of the first hit within [0, max], or -1. */
    rayT(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
        let best = -1;
        const ix = dx !== 0 ? 1 / dx : Infinity, iy = dy !== 0 ? 1 / dy : Infinity, iz = dz !== 0 ? 1 / dz : Infinity;
        const order = this.bvh.order;
        let sp = this.visitStart();
        while (sp > 0) {
            const node = this.stack[--sp];
            const lim = best >= 0 ? best : max;
            if (!this.rayHitsBox(node, ox, oy, oz, ix, iy, iz, lim)) continue;
            const l = this.bvh.left[node];
            if (l >= 0) {
                this.stack[sp++] = l + 1;
                this.stack[sp++] = l;
                continue;
            }
            const f = this.bvh.first[node], e = f + this.bvh.count[node];
            for (let j = f; j < e; j++) {
                const t = rayTriangle(this.tris, order[j], ox, oy, oz, dx, dy, dz);
                if (t >= 0 && t <= max && (best < 0 || t < best)) best = t;
            }
        }
        return best;
    }

    /** Distance from a point to the mesh (Infinity for an empty mesh), searching within `within`. */
    distance(x: number, y: number, z: number, within = Infinity): number {
        return this.deepest(x, y, z, within) ? this.cl.dist : Infinity;
    }

    /** The closest triangle within distance r (strictly) of p into this.cl; false if none. */
    private deepest(x: number, y: number, z: number, r: number): boolean {
        const cl = this.cl;
        let bestD = r;
        let found = false;
        let bqx = 0, bqy = 0, bqz = 0, bnx = 0, bny = 0, bnz = 0;
        const order = this.bvh.order;
        let sp = this.visitStart();
        while (sp > 0) {
            const node = this.stack[--sp];
            if (!this.overlapsBox(node, x - bestD, y - bestD, z - bestD, x + bestD, y + bestD, z + bestD)) continue;
            const l = this.bvh.left[node];
            if (l >= 0) {
                this.stack[sp++] = l + 1;
                this.stack[sp++] = l;
                continue;
            }
            const f = this.bvh.first[node], e = f + this.bvh.count[node];
            for (let j = f; j < e; j++) {
                closest(this.tris, order[j], x, y, z, cl);
                if (cl.dist < bestD) {
                    bestD = cl.dist;
                    found = true;
                    bqx = cl.qx; bqy = cl.qy; bqz = cl.qz; bnx = cl.nx; bny = cl.ny; bnz = cl.nz;
                }
            }
        }
        if (found) {
            cl.dist = bestD;
            cl.qx = bqx; cl.qy = bqy; cl.qz = bqz; cl.nx = bnx; cl.ny = bny; cl.nz = bnz;
        }
        return found;
    }

    private visitStart(): number {
        if (this.triangleCount === 0) return 0;
        this.stack[0] = 0;
        return 1;
    }

    private overlapsBox(node: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
        const b = this.bvh.box, o = node * 6;
        return !(x1 < b[o] || x0 > b[o + 3] || y1 < b[o + 1] || y0 > b[o + 4] || z1 < b[o + 2] || z0 > b[o + 5]);
    }

    /** Slab test: does the ray enter the node's box within [0, lim]? */
    private rayHitsBox(node: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, lim: number): boolean {
        const b = this.bvh.box, o = node * 6;
        let t0 = 0, t1 = lim;
        let a = (b[o] - ox) * ix, c = (b[o + 3] - ox) * ix;
        if (ix === Infinity) { if (ox < b[o] || ox > b[o + 3]) return false; } else {
            if (a > c) { const s = a; a = c; c = s; }
            if (a > t0) t0 = a; if (c < t1) t1 = c;
        }
        a = (b[o + 1] - oy) * iy; c = (b[o + 4] - oy) * iy;
        if (iy === Infinity) { if (oy < b[o + 1] || oy > b[o + 4]) return false; } else {
            if (a > c) { const s = a; a = c; c = s; }
            if (a > t0) t0 = a; if (c < t1) t1 = c;
        }
        a = (b[o + 2] - oz) * iz; c = (b[o + 5] - oz) * iz;
        if (iz === Infinity) { if (oz < b[o + 2] || oz > b[o + 5]) return false; } else {
            if (a > c) { const s = a; a = c; c = s; }
            if (a > t0) t0 = a; if (c < t1) t1 = c;
        }
        return t0 <= t1;
    }
}
