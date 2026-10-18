// sim-core/0.5.0 moving surfaces (ContactWorld.at and the surface velocity out of contacts()): a craft
// resting on a box that drives off is dragged along by friction and then rides with it, still; a box
// driving into a craft on the floor shoves it ahead without going into it; the same flight twice is
// bit-identical. Controls: the same box reporting no velocity (sim-core/0.4.0's still-world solver)
// slides away under the craft. Real Sim, a synthetic world whose box is a function of the tick alone.
import { describe, expect, it } from 'vitest';
import { Sim, S } from '../src/index';
import type { ContactOut, ContactWorld } from '../src/index';
import { params, tracer } from './model-helpers';

const DT = 0.001;
/** sim.ts MU, the Coulomb friction coefficient of every contact */
const MU = 0.4;
const G = 9.81;

/**
 * An axis-aligned box that stands still until tick t0, then moves along +x at vx; optionally a floor at y = 0.
 * `reportVel` false: it moves but says its surfaces are still (the control).
 */
class MovingBox implements ContactWorld {
    ox = 0;
    v = 0;
    constructor(
        readonly b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number },
        readonly vx: number,
        readonly t0: number,
        readonly floor: boolean,
        readonly reportVel = true
    ) {}

    at(tick: number): void {
        const moving = tick > this.t0;
        this.ox = moving ? this.vx * (tick - this.t0) * DT : 0;
        this.v = moving ? this.vx : 0;
    }

    /** signed distance from a point to the box, and the outward normal at the closest point */
    dist(x: number, y: number, z: number, n: number[]): number {
        const x0 = this.b.x0 + this.ox, x1 = this.b.x1 + this.ox;
        const { y0, y1, z0, z1 } = this.b;
        const cx = Math.min(Math.max(x, x0), x1), cy = Math.min(Math.max(y, y0), y1), cz = Math.min(Math.max(z, z0), z1);
        const dx = x - cx, dy = y - cy, dz = z - cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > 0) { n[0] = dx / d; n[1] = dy / d; n[2] = dz / d; return d; }
        // inside: out through the nearest face
        const faces: [number, number, number, number][] = [
            [x - x0, -1, 0, 0], [x1 - x, 1, 0, 0], [y - y0, 0, -1, 0], [y1 - y, 0, 1, 0], [z - z0, 0, 0, -1], [z1 - z, 0, 0, 1]];
        let best = faces[0];
        for (const f of faces) if (f[0] < best[0]) best = f;
        n[0] = best[1]; n[1] = best[2]; n[2] = best[3];
        return -best[0];
    }

    sweep(_c0: Float64Array, _c1: Float64Array, _r: Float64Array, _pad: Float64Array, _n: number, _out: ContactOut): number {
        // these flights are slow: every touch is found by contacts() (a fast impact would need a real sweep)
        return -1;
    }

    contacts(x: number, y: number, z: number, r: number, out: Float64Array, max: number, vel?: Float64Array): number {
        let k = 0;
        if (this.floor && y < r && k < max) {
            out[0] = 0; out[1] = 1; out[2] = 0; out[3] = y;
            k++;
        }
        const n = [0, 0, 0];
        const d = this.dist(x, y, z, n);
        // a moving surface may be reported up to its own travel in one tick beyond r (ContactWorld.contacts)
        if (d < r + Math.abs(this.v) * DT && k < max) {
            out[k * 4] = n[0]; out[k * 4 + 1] = n[1]; out[k * 4 + 2] = n[2]; out[k * 4 + 3] = d;
            if (vel && this.reportVel) vel[k * 3] = this.v;
            k++;
        }
        return k;
    }

    pushOut(x: number, y: number, z: number, r: number, o: { x: number; y: number; z: number }): boolean {
        o.x = 0; o.y = 0; o.z = 0;
        let hit = false;
        if (this.floor && y < r) { o.y = r - y; hit = true; }
        const n = [0, 0, 0];
        const d = this.dist(x, y, z, n);
        if (d < r) { o.x += n[0] * (r - d); o.y += n[1] * (r - d); o.z += n[2] * (r - d); hit = true; }
        return hit;
    }
}

/** World centres of the craft's collision spheres. */
function sphereCentres(sim: Sim): number[][] {
    const s = sim.s, sp = sim.p.spheres;
    const w = s[S.qw], x = s[S.qx], y = s[S.qy], z = s[S.qz];
    const out: number[][] = [];
    for (let i = 0; i < sp.length; i += 4) {
        const vx = sp[i], vy = sp[i + 1], vz = sp[i + 2];
        // v + 2 q x (q x v + w v)
        const tx = y * vz - z * vy + w * vx, ty = z * vx - x * vz + w * vy, tz = x * vy - y * vx + w * vz;
        out.push([s[S.px] + vx + 2 * (y * tz - z * ty), s[S.py] + vy + 2 * (z * tx - x * tz), s[S.pz] + vz + 2 * (x * ty - y * tx), sp[i + 3]]);
    }
    return out;
}

/** A disarmed craft dropped from 1 cm onto whatever is under (x, y, z), free to move. */
function dropped(world: ContactWorld, x: number, y: number, z: number): Sim {
    const sim = new Sim(params(), world);
    sim.setChannels([0, 0, -1, 0, -1, -1, 0, 0]);
    sim.reset(x, y, z, 0);
    sim.s[S.hold] = 0;
    return sim;
}

/** the lowest point of the craft below its centre at level attitude, m */
function lowest(sim: Sim): number {
    let lo = 0;
    for (let i = 0; i < sim.p.spheres.length; i += 4) lo = Math.max(lo, sim.p.spheres[i + 3] - sim.p.spheres[i + 1]);
    return lo;
}

describe('moving surfaces (sim-core/0.5.0)', () => {
    // long enough behind the craft for the 1.2 m the box gains on it while friction catches it up
    const TOP = { x0: -5, y0: 0, z0: -2, x1: 40, y1: 1, z1: 2 };
    const START = 300;

    function ride(reportVel: boolean) {
        const world = new MovingBox(TOP, 3, START, false, reportVel);
        const probe = new Sim(params(), null);
        const sim = dropped(world, 0, TOP.y1 + lowest(probe) + 0.01, 0);
        let tA = NaN, tB = NaN, maxW = 0, yLo = Infinity, yHi = -Infinity, vxMid = NaN;
        for (let t = 1; t <= 3000; t++) {
            sim.step();
            const vx = sim.s[S.vx];
            if (Number.isNaN(tA) && vx >= 0.5) tA = t;
            if (Number.isNaN(tB) && vx >= 2.5) tB = t;
            if (t === 1500) vxMid = vx;
            if (t > 2000) {
                maxW = Math.max(maxW, Math.hypot(sim.s[S.wx], sim.s[S.wy], sim.s[S.wz]));
                yLo = Math.min(yLo, sim.s[S.py]); yHi = Math.max(yHi, sim.s[S.py]);
            }
        }
        return { sim, world, accel: 2 / ((tB - tA) * DT), maxW, yLo, yHi, vxMid };
    }

    it('a craft resting on a box that drives off is dragged at about mu g, then rides along with it, still', () => {
        const r = ride(true);
        const s = r.sim.s;
        console.log(`ride: dragged at ${r.accel.toFixed(3)} m/s^2 (mu g ${(MU * G).toFixed(3)}), then vx ${s[S.vx].toFixed(6)} m/s, ` +
            `gyro ${r.maxW.toExponential(2)} rad/s, height range ${((r.yHi - r.yLo) * 1000).toFixed(3)} mm`);
        expect(r.accel).toBeGreaterThan(0.85 * MU * G);
        expect(r.accel).toBeLessThan(1.02 * MU * G);
        expect(s[S.vx]).toBeCloseTo(3, 4);
        expect(Math.abs(s[S.vy]) + Math.abs(s[S.vz])).toBeLessThan(1e-4);
        expect(r.maxW).toBeLessThan(1e-3);
        expect(r.yHi - r.yLo).toBeLessThan(1e-4);
        // on the box top, where it was dropped
        expect(r.yLo - TOP.y1).toBeGreaterThan(lowest(r.sim) - 0.002);
        expect(r.sim.events.filter((e) => e.type === 'crash')).toEqual([]);
    });

    it('control: the same box saying its surface is still slides away under the craft', () => {
        const r = ride(false);
        // at 1.5 s, while the box is still under it (its back edge passes at 1.97 s)
        expect(Math.abs(r.vxMid)).toBeLessThan(1e-6);
    });

    it('a box driving into a craft on the floor shoves it ahead without going into it', () => {
        const WALL = { x0: -2, y0: 0, z0: -1, x1: -0.5, y1: 0.5, z1: 1 };
        const world = new MovingBox(WALL, 2, START, true);
        const probe = new Sim(params(), null);
        const sim = dropped(world, 0, lowest(probe) + 0.01, 0);
        const n = [0, 0, 0];
        let worst = Infinity, vxSum = 0, vxN = 0;
        for (let t = 1; t <= 2500; t++) {
            sim.step();
            for (const [x, y, z, r] of sphereCentres(sim)) worst = Math.min(worst, world.dist(x, y, z, n) - r);
            if (t > 2000) { vxSum += sim.s[S.vx]; vxN++; }
        }
        const front = WALL.x1 + world.ox;
        console.log(`shove: closest a sphere came to the box ${(worst * 1000).toFixed(3)} mm (negative: inside); ` +
            `craft ${(sim.s[S.px] - front).toFixed(3)} m ahead of the box's face, vx over the last 0.5 s ${(vxSum / vxN).toFixed(3)} m/s`);
        expect(worst).toBeGreaterThan(-0.01);
        expect(sim.s[S.px]).toBeGreaterThan(front);
        expect(vxSum / vxN).toBeGreaterThan(1.9);
    });

    it('is bit-identical run twice (the box is a function of the tick)', () => {
        const hash = (): string => {
            const world = new MovingBox(TOP, 3, START, false);
            const probe = new Sim(params(), null);
            const sim = dropped(world, 0, TOP.y1 + lowest(probe) + 0.01, 0);
            const tr = tracer(sim);
            for (let t = 0; t < 1500; t++) tr.step();
            return tr.hex();
        };
        expect(hash()).toBe(hash());
    });
});
