// The train in the collision: sim-core's ContactWorld with moving surfaces, as TrafficWorld does for the cars. The sim
// calls at(tick) at the start of every step; each vehicle's boxes are where the train is at that tick, and contacts()
// reports a touched point's velocity from where that point of the vehicle is one tick later. A quad hit by the train is
// shoved, one sat on a coach roof rides along.
//
// Determinism: only + - * / and Math.sqrt here (train.ts places the vehicles).

import type { ContactOut, ContactWorld } from '@owfpv/sim-core';
import { DT } from './model';
import { TRAIN_VMAX, newTrainPlace } from './train';
import type { Train, TrainPlace } from './train';
import { boxNear } from './world';
import type { Near } from './world';

/** Conservative-advancement steps per sphere and box in sweep(); a hit is closer than SWEEP_EPS, m (as world.ts) */
const SWEEP_STEPS = 32;
const SWEEP_EPS = 1e-4;
/** Highest point of any vehicle over its base, m (with room for its tilt on a grade) */
const TOP = 4.5;

export class TrainWorld implements ContactWorld {
    readonly inner: ContactWorld;
    readonly train: Train;
    private tick = 0;
    private placed = -1;
    private placed1 = -1;
    private readonly p0: TrainPlace[];
    private readonly p1: TrainPlace[];
    /** per vehicle: how far its boxes reach from its middle, m */
    private readonly reach: number[];
    private readonly near: Near = { d: 0, nx: 0, ny: 0, nz: 0 };
    private readonly hits: number[] = [];
    /** nearest()'s last point and vehicle, and the point in that vehicle's frame */
    private ci = -1;
    private cx = 0;
    private cy = 0;
    private cz = 0;
    private ct = -1;
    private clf = 0;
    private clu = 0;
    private cls = 0;

    constructor(inner: ContactWorld, train: Train) {
        this.inner = inner;
        this.train = train;
        const n = train.vehicles.length;
        this.p0 = Array.from({ length: n }, newTrainPlace);
        this.p1 = Array.from({ length: n }, newTrainPlace);
        this.reach = train.vehicles.map((v) => {
            let r = 0;
            for (const b of v.boxes) {
                const f = Math.max(-b.f0, b.f1), w = Math.max(-b.s0, b.s1);
                r = Math.max(r, Math.sqrt(f * f + w * w));
            }
            return r;
        });
    }

    at(tick: number): void {
        this.tick = tick;
        if (this.inner.at) this.inner.at(tick);
    }

    /** Vehicle i's place at the current tick. */
    placeOf(i: number): TrainPlace {
        this.placeAll();
        return this.p0[i];
    }

    private placeAll(): void {
        if (this.placed === this.tick) return;
        for (let i = 0; i < this.p0.length; i++) this.train.place(i, this.tick, this.p0[i]);
        this.placed = this.tick;
    }

    /** The vehicles whose boxes may reach into [x0, x1] x [y0, y1] x [z0, z1] grown by pad (into this.hits). */
    private near3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pad: number): number[] {
        this.placeAll();
        const h = this.hits;
        h.length = 0;
        for (let i = 0; i < this.p0.length; i++) {
            const q = this.p0[i];
            const p = this.reach[i] + pad;
            if (x1 < q.x - p || x0 > q.x + p || z1 < q.z - p || z0 > q.z + p) continue;
            if (y0 > q.y + TOP + pad || y1 < q.y - 0.5 - pad) continue;
            h.push(i);
        }
        return h;
    }

    /** Box k of vehicle i nearest the point, into this.near; false: no such box. */
    private nearest(i: number, k: number, x: number, y: number, z: number, reach = Infinity): boolean {
        const boxes = this.train.vehicles[i].boxes;
        if (k >= boxes.length) return false;
        const b = boxes[k];
        const pl = this.p0[i];
        const out = this.near;
        // the point in the vehicle's frame: along (f), up (u), across ((-hz, 0, hx)); worked out once per point and vehicle
        if (this.ci !== i || this.cx !== x || this.cy !== y || this.cz !== z || this.ct !== this.placed) {
            const dx = x - pl.x, dy = y - pl.y, dz = z - pl.z;
            this.clf = dx * pl.fx + dy * pl.fy + dz * pl.fz;
            this.clu = dx * pl.ux + dy * pl.uy + dz * pl.uz;
            this.cls = -dx * pl.hz + dz * pl.hx;
            this.ci = i; this.cx = x; this.cy = y; this.cz = z; this.ct = this.placed;
        }
        const lf = this.clf, lu = this.clu, ls = this.cls;
        // a box further than `reach` along any of its axes cannot count: skip the distance
        if (lf < b.f0 - reach || lf > b.f1 + reach || lu < b.y0 - reach || lu > b.y1 + reach || ls < b.s0 - reach || ls > b.s1 + reach) {
            out.d = Infinity;
            return true;
        }
        boxNear(lf - (b.f0 + b.f1) / 2, lu - (b.y0 + b.y1) / 2, ls - (b.s0 + b.s1) / 2, (b.f1 - b.f0) / 2, (b.y1 - b.y0) / 2, (b.s1 - b.s0) / 2, out);
        const nf = out.nx, nu = out.ny, ns = out.nz;
        out.nx = nf * pl.fx + nu * pl.ux - ns * pl.hz;
        out.ny = nf * pl.fy + nu * pl.uy;
        out.nz = nf * pl.fz + nu * pl.uz + ns * pl.hx;
        return true;
    }

    /** Velocity of vehicle i's point (x, y, z) (taken as fixed to it), m/s: where that point is one tick later. */
    private pointVelocity(i: number, x: number, y: number, z: number, out: Float64Array, o: number): void {
        if (this.placed1 !== this.tick) {
            for (let j = 0; j < this.p1.length; j++) this.train.place(j, this.tick + 1, this.p1[j]);
            this.placed1 = this.tick;
        }
        const a = this.p0[i], b = this.p1[i];
        const dx = x - a.x, dy = y - a.y, dz = z - a.z;
        const lf = dx * a.fx + dy * a.fy + dz * a.fz;
        const lu = dx * a.ux + dy * a.uy + dz * a.uz;
        const ls = -dx * a.hz + dz * a.hx;
        out[o] = (b.x + lf * b.fx + lu * b.ux - ls * b.hz - x) / DT;
        out[o + 1] = (b.y + lf * b.fy + lu * b.uy - y) / DT;
        out[o + 2] = (b.z + lf * b.fz + lu * b.uz + ls * b.hx - z) / DT;
    }

    /** Put contact this.near into out (slot k if free, else over the farthest if closer); the slot used, or -1. */
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
        // a moving surface counts up to its own travel this tick beyond r (sim.ts ContactWorld.contacts)
        const reach = r + TRAIN_VMAX * DT + 1e-3;
        for (const i of this.near3(x, y, z, x, y, z, reach)) {
            for (let b = 0; this.nearest(i, b, x, y, z, reach); b++) {
                const n = this.near;
                if (!(n.d < reach)) continue;
                const d = n.d, nx = n.nx, ny = n.ny, nz = n.nz;
                const slot = this.put(out, k, max);
                if (slot < 0) continue;
                if (slot === k) k++;
                if (vel) this.pointVelocity(i, x - nx * d, y - ny * d, z - nz * d, vel, slot * 3);
            }
        }
        return k;
    }

    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        if (this.inner.pushOut(x, y, z, r, out)) return true;
        let best = 0;
        for (const i of this.near3(x, y, z, x, y, z, r)) {
            for (let b = 0; this.nearest(i, b, x, y, z, r); b++) {
                const n = this.near;
                const pen = r - n.d;
                if (!(pen > best)) continue;
                best = pen;
                out.x = n.nx * pen; out.y = n.ny * pen; out.z = n.nz * pen;
            }
        }
        return best > 0;
    }

    /** Is a vehicle of the train (or something moving in the inner world) within r of the point at this tick? */
    movingNear(x: number, y: number, z: number, r: number): boolean {
        if (this.inner.movingNear?.(x, y, z, r)) return true;
        for (const i of this.near3(x, y, z, x, y, z, r)) {
            for (let b = 0; this.nearest(i, b, x, y, z, r); b++) if (this.near.d < r) return true;
        }
        return false;
    }

    /** The scene's sweep, then each sphere against the train where it is at this tick (conservative advancement, as world.ts). */
    sweep(c0: Float64Array, c1: Float64Array, rr: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        let best = this.inner.sweep(c0, c1, rr, pad, n, out);
        for (let s = 0; s < n; s++) {
            const ax = c0[s * 3], ay = c0[s * 3 + 1], az = c0[s * 3 + 2];
            const ex = c1[s * 3] - ax, ey = c1[s * 3 + 1] - ay, ez = c1[s * 3 + 2] - az;
            const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
            const R = rr[s] + pad[s];
            const ids = this.near3(Math.min(ax, ax + ex), Math.min(ay, ay + ey), Math.min(az, az + ez),
                Math.max(ax, ax + ex), Math.max(ay, ay + ey), Math.max(az, az + ez), R).slice();
            for (const i of ids) {
                for (let b = 0; this.nearest(i, b, ax, ay, az); b++) {
                    let t = 0;
                    let d = this.near.d - R;
                    let hit = d < SWEEP_EPS;
                    for (let it = 0; !hit && it < SWEEP_STEPS && len > 0; it++) {
                        t += d / len;
                        if (t > 1 || (best >= 0 && t >= best)) break;
                        this.nearest(i, b, ax + ex * t, ay + ey * t, az + ez * t);
                        d = this.near.d - R;
                        hit = d < SWEEP_EPS;
                    }
                    if (!hit || t > 1 || (best >= 0 && t >= best)) continue;
                    best = t;
                    out.sphere = s;
                    out.nx = this.near.nx; out.ny = this.near.ny; out.nz = this.near.nz;
                }
            }
        }
        return best;
    }
}
