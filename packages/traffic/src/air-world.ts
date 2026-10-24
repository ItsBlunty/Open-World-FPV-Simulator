// The airport's movers in the collision: sim-core's ContactWorld with moving surfaces, as TrainWorld does for the trains.
// Each mover's parts (air-shapes.ts: capsules and boxes in its own frame) are where the mover is at the current tick;
// contacts() reports a touched point's velocity from where that point of the mover is one tick later, so a taxiing plane
// shoves the quad and one sat on a wing rides along. A hidden mover (a plane away, a medic inside) is not there, nor is a
// folded gear. After its parts come its props and rotors (air-shapes.ts Prop): while its engine turns (power above 0) each
// is a solid disc as thick as its blade's chord, moving with the mover (a hit bounces as off a wall: the blades' own speed
// is not in it); stopped, each blade is a box where it stops.
//
// Determinism: only + - * / and Math.sqrt here (air.ts places the movers).

import type { ContactOut, ContactWorld } from '@owfpv/sim-core';
import { DT } from './model';
import { newAirPlace } from './air-path';
import type { AirPlace } from './air-path';
import type { APart, Prop } from './air-shapes';
import type { AirTraffic } from './air';
import { boxNear } from './world';
import type { Near } from './world';

/** Conservative-advancement steps per sphere and part in sweep(); a hit is closer than SWEEP_EPS, m (as world.ts) */
const SWEEP_STEPS = 32;
const SWEEP_EPS = 1e-4;

export class AirWorld implements ContactWorld {
    readonly inner: ContactWorld;
    readonly air: AirTraffic;
    private tick = 0;
    private placed = -1;
    private placed1 = -1;
    private readonly p0: AirPlace[];
    private readonly p1: AirPlace[];
    private readonly near: Near = { d: 0, nx: 0, ny: 0, nz: 0 };
    private readonly hits: number[] = [];

    constructor(inner: ContactWorld, air: AirTraffic) {
        this.inner = inner;
        this.air = air;
        this.p0 = air.movers.map(newAirPlace);
        this.p1 = air.movers.map(newAirPlace);
    }

    at(tick: number): void {
        this.tick = tick;
        if (this.inner.at) this.inner.at(tick);
    }

    /** Mover i's place at the current tick. */
    placeOf(i: number): AirPlace {
        this.placeAll();
        return this.p0[i];
    }

    private placeAll(): void {
        if (this.placed === this.tick) return;
        for (let i = 0; i < this.p0.length; i++) this.air.place(i, this.tick, this.p0[i]);
        this.placed = this.tick;
    }

    /** The movers whose parts may reach into [x0, x1] x [y0, y1] x [z0, z1] grown by pad (into this.hits). */
    private near3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pad: number): number[] {
        this.placeAll();
        const h = this.hits;
        h.length = 0;
        for (let i = 0; i < this.p0.length; i++) {
            const q = this.p0[i];
            if (q.hidden) continue;
            const p = this.air.movers[i].shape.reach + pad;
            if (x1 < q.x - p || x0 > q.x + p || z1 < q.z - p || z0 > q.z + p || y1 < q.y - p || y0 > q.y + p) continue;
            h.push(i);
        }
        return h;
    }

    /**
     * Part k of mover i nearest the point, into this.near; false: no such part (a folded gear answers d = Infinity). Past
     * the parts, k is a prop or rotor: its disc while the engine turns, else the nearest of its stopped blades.
     */
    private nearest(i: number, k: number, x: number, y: number, z: number): boolean {
        const sh = this.air.movers[i].shape, parts = sh.parts;
        const pl = this.p0[i];
        const out = this.near;
        if (k >= parts.length) {
            const pr = sh.props[k - parts.length];
            if (!pr) return false;
            if (pl.e > 0) {
                this.discNear(pl, pr, x, y, z);
                return true;
            }
            let d = Infinity, nx = 0, ny = 1, nz = 0;
            for (const b of pr.rest) {
                this.partNear(pl, b, x, y, z);
                if (out.d < d) { d = out.d; nx = out.nx; ny = out.ny; nz = out.nz; }
            }
            out.d = d; out.nx = nx; out.ny = ny; out.nz = nz;
            return true;
        }
        this.partNear(pl, parts[k], x, y, z);
        return true;
    }

    /** A turning prop's disc (radius r, as thick as its chord, about its axis n) nearest the point, into this.near. */
    private discNear(pl: AirPlace, pr: Prop, x: number, y: number, z: number): void {
        const out = this.near;
        const dx = x - pl.x, dy = y - pl.y, dz = z - pl.z;
        const f = pl.f, u = pl.u, s = pl.s;
        // the point from the hub, in the mover's frame
        const qf = dx * f[0] + dy * f[1] + dz * f[2] - pr.p[0];
        const qu = dx * u[0] + dy * u[1] + dz * u[2] - pr.p[1];
        const qs = dx * s[0] + dy * s[1] + dz * s[2] - pr.p[2];
        const n = pr.n, h = pr.chord / 2;
        // along the axis, and across it (rho from the hub in the disc's plane)
        const a = qf * n[0] + qu * n[1] + qs * n[2];
        const pf = qf - a * n[0], pu = qu - a * n[1], ps = qs - a * n[2];
        const rho = Math.sqrt(pf * pf + pu * pu + ps * ps);
        const sa = a < 0 ? -1 : 1;
        const da = (a < 0 ? -a : a) - h, dr = rho - pr.r;
        let nf: number, nu: number, ns: number;
        if (da > 0 || dr > 0) {
            // outside: from the nearest point of the rim or a face
            const va = da > 0 ? da : 0, vr = dr > 0 ? dr : 0;
            const l = Math.sqrt(va * va + vr * vr);
            const wa = (sa * va) / l, wr = rho > 1e-12 ? vr / l / rho : 0;
            nf = n[0] * wa + pf * wr; nu = n[1] * wa + pu * wr; ns = n[2] * wa + ps * wr;
            out.d = l;
        } else if (da >= dr || rho < 1e-12) {
            nf = n[0] * sa; nu = n[1] * sa; ns = n[2] * sa;
            out.d = da;
        } else {
            nf = pf / rho; nu = pu / rho; ns = ps / rho;
            out.d = dr;
        }
        out.nx = nf * f[0] + nu * u[0] + ns * s[0];
        out.ny = nf * f[1] + nu * u[1] + ns * s[1];
        out.nz = nf * f[2] + nu * u[2] + ns * s[2];
    }

    /** Part pt of a mover placed at pl nearest the point, into this.near. */
    private partNear(pl: AirPlace, pt: APart, x: number, y: number, z: number): void {
        const out = this.near;
        if (pt.gear && pl.g < 0.5) {
            out.d = Infinity; out.nx = 0; out.ny = 1; out.nz = 0;
            return;
        }
        // the point in the mover's frame
        const dx = x - pl.x, dy = y - pl.y, dz = z - pl.z;
        const f = pl.f, u = pl.u, s = pl.s;
        const lf = dx * f[0] + dy * f[1] + dz * f[2];
        const lu = dx * u[0] + dy * u[1] + dz * u[2];
        const ls = dx * s[0] + dy * s[1] + dz * s[2];
        let nf: number, nu: number, ns: number;
        if (pt.kind === 'cap') {
            const [af, au, as] = pt.a, [bf, bu, bs] = pt.b;
            const ef = bf - af, eu = bu - au, es = bs - as;
            const ee = ef * ef + eu * eu + es * es;
            let t = ee > 0 ? ((lf - af) * ef + (lu - au) * eu + (ls - as) * es) / ee : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qf = lf - (af + ef * t), qu = lu - (au + eu * t), qs = ls - (as + es * t);
            const l = Math.sqrt(qf * qf + qu * qu + qs * qs);
            if (l > 1e-12) { nf = qf / l; nu = qu / l; ns = qs / l; } else { nf = 0; nu = 1; ns = 0; }
            out.d = l - pt.r;
        } else {
            const R = pt.R, c = pt.c;
            const qf = lf - c[0], qu = lu - c[1], qs = ls - c[2];
            // into the box's own axes (R's rows)
            const bf = qf * R[0] + qu * R[1] + qs * R[2];
            const bu = qf * R[3] + qu * R[4] + qs * R[5];
            const bs = qf * R[6] + qu * R[7] + qs * R[8];
            boxNear(bf, bu, bs, pt.e[0], pt.e[1], pt.e[2], out);
            // boxNear answers in (nx: f, ny: u, nz: s); back to the mover's frame
            const af = out.nx, au = out.ny, as = out.nz;
            nf = af * R[0] + au * R[3] + as * R[6];
            nu = af * R[1] + au * R[4] + as * R[7];
            ns = af * R[2] + au * R[5] + as * R[8];
        }
        out.nx = nf * f[0] + nu * u[0] + ns * s[0];
        out.ny = nf * f[1] + nu * u[1] + ns * s[1];
        out.nz = nf * f[2] + nu * u[2] + ns * s[2];
    }

    /** Velocity of mover i's point (x, y, z) (taken as fixed to it), m/s: where that point is one tick later. */
    private pointVelocity(i: number, x: number, y: number, z: number, out: Float64Array, o: number): void {
        if (this.placed1 !== this.tick) {
            for (let j = 0; j < this.p1.length; j++) this.air.place(j, this.tick + 1, this.p1[j]);
            this.placed1 = this.tick;
        }
        const a = this.p0[i], b = this.p1[i];
        const dx = x - a.x, dy = y - a.y, dz = z - a.z;
        const lf = dx * a.f[0] + dy * a.f[1] + dz * a.f[2];
        const lu = dx * a.u[0] + dy * a.u[1] + dz * a.u[2];
        const ls = dx * a.s[0] + dy * a.s[1] + dz * a.s[2];
        out[o] = (b.x + lf * b.f[0] + lu * b.u[0] + ls * b.s[0] - x) / DT;
        out[o + 1] = (b.y + lf * b.f[1] + lu * b.u[1] + ls * b.s[1] - y) / DT;
        out[o + 2] = (b.z + lf * b.f[2] + lu * b.u[2] + ls * b.s[2] - z) / DT;
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
        const reach = r + this.air.maxSpeed * DT + 1e-3;
        for (const i of this.near3(x, y, z, x, y, z, reach)) {
            const ri = r + this.air.movers[i].vmax * DT + 1e-3;
            for (let b = 0; this.nearest(i, b, x, y, z); b++) {
                const n = this.near;
                if (!(n.d < ri)) continue;
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
            for (let b = 0; this.nearest(i, b, x, y, z); b++) {
                const n = this.near;
                const pen = r - n.d;
                if (!(pen > best)) continue;
                best = pen;
                out.x = n.nx * pen; out.y = n.ny * pen; out.z = n.nz * pen;
            }
        }
        return best > 0;
    }

    /** Is an airport mover (or something moving in the inner world) within r of the point at this tick? */
    movingNear(x: number, y: number, z: number, r: number): boolean {
        if (this.inner.movingNear?.(x, y, z, r)) return true;
        for (const i of this.near3(x, y, z, x, y, z, r)) {
            for (let b = 0; this.nearest(i, b, x, y, z); b++) if (this.near.d < r) return true;
        }
        return false;
    }

    /** The scene's sweep, then each sphere against the movers where they are at this tick (conservative advancement, as world.ts). */
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
                    if (d === Infinity) continue;
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

export type { APart };
