// The level's collision plus the traffic: sim-core's ContactWorld with moving surfaces (sim-core/0.5.0).
// The sim calls at(tick) at the start of every step; every query of that step sees each mover where it
// is at that tick, and contacts() reports each surface's velocity, from where the touched point of the
// mover is one tick later. A car shoves the quad, and a quad on its roof rides along. The signal poles,
// arms and heads (network model) are solid and still.
//
// Shapes: a vehicle is its boxes (vehicles.ts) turned to its heading, a semi's trailer's turned to the trailer's own;
// a person is a vertical capsule. Determinism: only + - * / and Math.sqrt here.

import type { ContactOut, ContactWorld } from '@owfpv/sim-core';
import { DT, PERSON } from './model';
import type { StaticBox, TrafficModel } from './model';
import type { Place } from './route';

/** Conservative-advancement steps per sphere and shape in sweep(); a hit is closer than SWEEP_EPS, m [numerical choices] */
const SWEEP_STEPS = 32;
const SWEEP_EPS = 1e-4;
/** how much bigger than the first ask of a tick moversNear's box is, m: the craft's spheres and its sweep over one tick fit in it */
const NEAR_CACHE = 8;

/** A closest-surface answer: signed distance from the point (negative inside) and the outward unit normal. */
export interface Near {
    d: number;
    nx: number;
    ny: number;
    nz: number;
}

/** Signed distance from (lf, ly, ls), a point in a box's frame, to the box of half sizes (ef, ey, es) at the origin. */
export function boxNear(lf: number, ly: number, ls: number, ef: number, ey: number, es: number, out: Near): void {
    const qf = (lf < 0 ? -lf : lf) - ef, qs = (ls < 0 ? -ls : ls) - es, qy = (ly < 0 ? -ly : ly) - ey;
    if (qf > 0 || qs > 0 || qy > 0) {
        // outside: from the closest point of the box
        const vf = qf > 0 ? (lf < 0 ? -qf : qf) : 0;
        const vs = qs > 0 ? (ls < 0 ? -qs : qs) : 0;
        const vy = qy > 0 ? (ly < 0 ? -qy : qy) : 0;
        const l = Math.sqrt(vf * vf + vs * vs + vy * vy);
        out.nx = vf / l; out.nz = vs / l; out.ny = vy / l;
        out.d = l;
    } else if (qf >= qs && qf >= qy) {
        out.nx = lf < 0 ? -1 : 1; out.nz = 0; out.ny = 0;
        out.d = qf;
    } else if (qs >= qy) {
        out.nx = 0; out.nz = ls < 0 ? -1 : 1; out.ny = 0;
        out.d = qs;
    } else {
        out.nx = 0; out.nz = 0; out.ny = ly < 0 ? -1 : 1;
        out.d = qy;
    }
}

export class TrafficWorld implements ContactWorld {
    readonly inner: ContactWorld;
    readonly model: TrafficModel;
    private tick = 0;
    /** the tick every mover's place p0 is for (-1: none); per mover, the tick its p1 (one tick later) is for */
    private placed = -1;
    private readonly stamp1: Float64Array;
    private readonly p0: Place[];
    private readonly p1: Place[];
    /** semis' trailers: at the current tick and one tick later (the tick each is for) */
    private readonly t0: Place[];
    private readonly t1: Place[];
    private readonly stampT1: Float64Array;
    private readonly near: Near = { d: 0, nx: 0, ny: 0, nz: 0 };
    private readonly hits: number[] = [];
    /** moversNear's box this tick and the movers that may reach into it */
    private readonly cache = new Float64Array(6);
    private cacheTick = -1;
    private readonly cached: number[] = [];

    constructor(inner: ContactWorld, model: TrafficModel) {
        this.inner = inner;
        this.model = model;
        const n = model.movers.length;
        this.stamp1 = new Float64Array(n).fill(-1);
        this.p0 = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, hx: 1, hz: 0 }));
        this.p1 = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, hx: 1, hz: 0 }));
        this.t0 = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, hx: 1, hz: 0 }));
        this.t1 = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, hx: 1, hz: 0 }));
        this.stampT1 = new Float64Array(n).fill(-1);
        this.semis = model.movers.map((m, i) => (m.shape?.trailer ? i : -1)).filter((i) => i >= 0);
    }

    /** the movers with a trailer */
    private readonly semis: number[];

    at(tick: number): void {
        this.tick = tick;
        this.model.at(tick);
        if (this.inner.at) this.inner.at(tick);
    }

    /** Mover i's place at the current tick. */
    placeOf(i: number): Place {
        this.placeAll();
        return this.p0[i];
    }

    private placeAll(): void {
        if (this.placed === this.tick) return;
        for (let i = 0; i < this.p0.length; i++) this.model.place(i, this.tick, this.p0[i]);
        for (const i of this.semis) this.model.trailer!(i, this.tick, this.t0[i]);
        this.placed = this.tick;
    }

    /**
     * The movers whose shapes may reach into the box [x0, x1] x [y0, y1] x [z0, z1] grown by pad (into this.hits), in
     * index order. The craft asks about 20 times a tick, all near it: the first ask in a tick scans every mover against
     * a box NEAR_CACHE m bigger, and later asks inside that box test only those, so they find exactly the same movers.
     */
    private moversNear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pad: number): number[] {
        this.placeAll();
        const c = this.cache;
        const bx0 = x0 - pad, by0 = y0 - pad, bz0 = z0 - pad, bx1 = x1 + pad, by1 = y1 + pad, bz1 = z1 + pad;
        if (this.cacheTick !== this.tick || bx0 < c[0] || by0 < c[1] || bz0 < c[2] || bx1 > c[3] || by1 > c[4] || bz1 > c[5]) {
            c[0] = bx0 - NEAR_CACHE; c[1] = by0 - NEAR_CACHE; c[2] = bz0 - NEAR_CACHE;
            c[3] = bx1 + NEAR_CACHE; c[4] = by1 + NEAR_CACHE; c[5] = bz1 + NEAR_CACHE;
            this.cacheTick = this.tick;
            this.cached.length = 0;
            for (let i = 0; i < this.p0.length; i++) if (this.reaches(i, c[0], c[1], c[2], c[3], c[4], c[5])) this.cached.push(i);
        }
        const h = this.hits;
        h.length = 0;
        for (const i of this.cached) if (this.reaches(i, bx0, by0, bz0, bx1, by1, bz1)) h.push(i);
        return h;
    }

    /** May mover i's shape (or its trailer) reach into the box [x0, x1] x [y0, y1] x [z0, z1]? */
    private reaches(i: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
        const sh = this.model.movers[i].shape;
        const top = sh ? sh.top : PERSON.y1 + PERSON.r;
        const q = this.p0[i];
        if (y1 < q.y || y0 > q.y + top) return false;
        let p = sh ? sh.reach[0] : PERSON.r;
        if (!(x1 < q.x - p || x0 > q.x + p || z1 < q.z - p || z0 > q.z + p)) return true;
        if (!sh?.trailer) return false;
        const t = this.t0[i];
        p = sh.reach[1];
        return !(x1 < t.x - p || x0 > t.x + p || z1 < t.z - p || z0 > t.z + p);
    }

    /** Part `part` of mover i (a vehicle: its box `part`; a person: 0) nearest the point, into this.near; false: no such part. */
    private nearest(i: number, part: number, x: number, y: number, z: number): boolean {
        const m = this.model.movers[i];
        let pl = this.p0[i];
        const out = this.near;
        if (!m.shape) {
            // out of sight in a building or on a train: not there to hit
            if (part > 0 || this.model.hidden?.(i)) return false;
            const ax = x - pl.x, az = z - pl.z;
            let cy = y - pl.y;
            cy = cy < PERSON.y0 ? PERSON.y0 : cy > PERSON.y1 ? PERSON.y1 : cy;
            const ay = y - pl.y - cy;
            const l = Math.sqrt(ax * ax + ay * ay + az * az);
            if (l > 1e-12) { out.nx = ax / l; out.ny = ay / l; out.nz = az / l; } else { out.nx = 0; out.ny = 1; out.nz = 0; }
            out.d = l - PERSON.r;
            return true;
        }
        const boxes = m.shape.boxes;
        if (part >= boxes.length) return false;
        // the box in its frame: f along the heading, s across it (-hz, hx), y up from the road
        const b = boxes[part];
        if (b.frame === 1) pl = this.t0[i];
        const cf = (b.f0 + b.f1) / 2, cs = (b.s0 + b.s1) / 2;
        const dx = x - pl.x, dz = z - pl.z;
        boxNear(dx * pl.hx + dz * pl.hz - cf, y - pl.y - (b.y0 + b.y1) / 2, -dx * pl.hz + dz * pl.hx - cs, (b.f1 - b.f0) / 2, (b.y1 - b.y0) / 2, (b.s1 - b.s0) / 2, out);
        const nf = out.nx, ns = out.nz;
        out.nx = nf * pl.hx - ns * pl.hz;
        out.nz = nf * pl.hz + ns * pl.hx;
        return true;
    }

    private staticNear(b: StaticBox, x: number, y: number, z: number): void {
        boxNear(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2, z - (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2, this.near);
    }

    /** Velocity of mover i's point (x, z) (taken as fixed to its frame `frame`), m/s: where that point is one tick later. */
    private pointVelocity(i: number, frame: number, x: number, z: number, out: Float64Array, o: number): void {
        const a = frame === 1 ? this.t0[i] : this.p0[i];
        const b = frame === 1 ? this.t1[i] : this.p1[i];
        if (frame === 1) {
            if (this.stampT1[i] !== this.tick) {
                this.model.trailer!(i, this.tick + 1, b);
                this.stampT1[i] = this.tick;
            }
        } else if (this.stamp1[i] !== this.tick) {
            this.model.place(i, this.tick + 1, b);
            this.stamp1[i] = this.tick;
        }
        const dx = x - a.x, dz = z - a.z;
        const lf = dx * a.hx + dz * a.hz;
        const ls = -dx * a.hz + dz * a.hx;
        const nx = b.x + lf * b.hx - ls * b.hz;
        const nz = b.z + lf * b.hz + ls * b.hx;
        out[o] = (nx - x) / DT;
        out[o + 1] = (b.y - a.y) / DT;
        out[o + 2] = (nz - z) / DT;
    }

    /** Put contact (n, d) into out (slot k if free, else over the farthest if closer); the slot used, or -1. */
    private put(out: Float64Array, k: number, max: number): number {
        const n = this.near;
        let slot = k;
        if (k >= max) {
            slot = 0;
            for (let j = 1; j < max; j++) if (out[j * 4 + 3] > out[slot * 4 + 3]) slot = j;
            if (!(n.d < out[slot * 4 + 3])) return -1;
        }
        out[slot * 4] = n.nx; out[slot * 4 + 1] = n.ny; out[slot * 4 + 2] = n.nz; out[slot * 4 + 3] = n.d;
        return slot;
    }

    contacts(x: number, y: number, z: number, r: number, out: Float64Array, max: number, vel?: Float64Array): number {
        let k = this.inner.contacts(x, y, z, r, out, max, vel);
        for (const b of this.model.staticsNear(x, z, r)) {
            this.staticNear(b, x, y, z);
            if (!(this.near.d < r)) continue;
            const slot = this.put(out, k, max);
            if (slot < 0) continue;
            if (slot === k) k++;
            if (vel) { vel[slot * 3] = 0; vel[slot * 3 + 1] = 0; vel[slot * 3 + 2] = 0; }
        }
        const ids = this.moversNear(x, y, z, x, y, z, r + this.model.maxSpeed * DT + 1e-3);
        for (const i of ids) {
            // a moving surface counts up to its own travel this tick beyond r (sim.ts ContactWorld.contacts)
            const reach = r + this.model.movers[i].v * DT + 1e-3;
            for (let part = 0; this.nearest(i, part, x, y, z); part++) {
                const n = this.near;
                if (!(n.d < reach)) continue;
                const d = n.d, nx = n.nx, nz = n.nz;
                const slot = this.put(out, k, max);
                if (slot < 0) continue;
                if (slot === k) k++;
                if (vel) this.pointVelocity(i, this.model.movers[i].shape?.boxes[part].frame ?? 0, x - nx * d, z - nz * d, vel, slot * 3);
            }
        }
        return k;
    }

    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        if (this.inner.pushOut(x, y, z, r, out)) return true;
        let best = 0;
        const take = (): void => {
            const n = this.near;
            const pen = r - n.d;
            if (!(pen > best)) return;
            best = pen;
            out.x = n.nx * pen; out.y = n.ny * pen; out.z = n.nz * pen;
        };
        for (const b of this.model.staticsNear(x, z, r)) {
            this.staticNear(b, x, y, z);
            take();
        }
        for (const i of this.moversNear(x, y, z, x, y, z, r)) {
            for (let part = 0; this.nearest(i, part, x, y, z); part++) take();
        }
        return best > 0;
    }

    /**
     * The scene's sweep, then each sphere against the traffic where it is at this tick, by conservative
     * advancement (the distance to a convex shape never shrinks faster than the sphere moves). A mover's own
     * motion within the tick is left to contacts(), which sees it coming.
     */
    sweep(c0: Float64Array, c1: Float64Array, rr: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        let best = this.inner.sweep(c0, c1, rr, pad, n, out);
        for (let s = 0; s < n; s++) {
            const ax = c0[s * 3], ay = c0[s * 3 + 1], az = c0[s * 3 + 2];
            const ex = c1[s * 3] - ax, ey = c1[s * 3 + 1] - ay, ez = c1[s * 3 + 2] - az;
            const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
            const R = rr[s] + pad[s];
            // the distance to one shape at a fraction t of the move (into this.near)
            const advance = (dist: (x: number, y: number, z: number) => void): void => {
                dist(ax, ay, az);
                let t = 0;
                let d = this.near.d - R;
                let hit = d < SWEEP_EPS;
                for (let it = 0; !hit && it < SWEEP_STEPS && len > 0; it++) {
                    t += d / len;
                    if (t > 1 || (best >= 0 && t >= best)) return;
                    dist(ax + ex * t, ay + ey * t, az + ez * t);
                    d = this.near.d - R;
                    hit = d < SWEEP_EPS;
                }
                if (!hit || (best >= 0 && t >= best)) return;
                best = t;
                out.sphere = s;
                out.nx = this.near.nx; out.ny = this.near.ny; out.nz = this.near.nz;
            };
            for (const b of this.model.staticsNear(ax + ex / 2, az + ez / 2, R + len)) advance((x, y, z) => this.staticNear(b, x, y, z));
            const ids = this.moversNear(Math.min(ax, ax + ex), Math.min(ay, ay + ey), Math.min(az, az + ez),
                Math.max(ax, ax + ex), Math.max(ay, ay + ey), Math.max(az, az + ez), R).slice();
            for (const i of ids) {
                for (let part = 0; this.nearest(i, part, ax, ay, az); part++) {
                    advance((x, y, z) => { this.nearest(i, part, x, y, z); });
                }
            }
        }
        return best;
    }
}
