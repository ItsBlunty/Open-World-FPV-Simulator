// Paths in time for the airport's movers (air.ts): planes, the helicopter, tugs and people. A mover's day is a list of
// legs, each a straight or an arc on the ground plan with a height along it, run at a constant acceleration, with the
// mover's pitch, bank, engine power and gear eased across it. Where a mover is is a function of the time alone, so the
// tick puts it at the same bits on every machine (replays).
//
// Determinism: only + - * /, Math.sqrt, Math.floor and sim-core's dmath sine, cosine and arctangents.

import { datan2, dcos, dsin } from '@owfpv/sim-core';

/** One leg of a mover's path. Its place at time t in [t0, t1] is the point `s` m along it, s = v0 tau + a tau^2 / 2. */
export interface Leg {
    t0: number;
    t1: number;
    /** a straight from (ax, az) along unit (dx, dz), or an arc of radius r about (cx, cz) from angle a0 by `sweep` (x = cos, z = sin) */
    arc: boolean;
    ax: number;
    az: number;
    dx: number;
    dz: number;
    cx: number;
    cz: number;
    r: number;
    a0: number;
    sweep: number;
    /** horizontal length, m */
    len: number;
    v0: number;
    acc: number;
    /** height along it: y = y0 + m s + c s^2 */
    y0: number;
    m: number;
    c: number;
    /** moving backwards (pushed back): the mover faces against its way */
    rev: boolean;
    /** standing still and turning on the spot (a hovering helicopter): heading angle from h0 to h1, rad (x = cos, z = sin) */
    spin: boolean;
    h0: number;
    h1: number;
    /** pitch (nose up +) and bank (right wing down +), rad, eased from the first to the second */
    th0: number;
    th1: number;
    ph0: number;
    ph1: number;
    /** engine (or rotor) power, 0 stopped to 1 full, and the gear, 1 down to 0 up: eased across the leg (drawing; the gear's solidity) */
    e0: number;
    e1: number;
    g0: number;
    g1: number;
    /** out of sight and not solid (a plane away from the airport, a person inside) */
    hidden: boolean;
}

/** Where a mover is: its origin (a plane's main gear on the ground) and its frame: f ahead, u up, s to its right. */
export interface AirPlace {
    x: number;
    y: number;
    z: number;
    f: [number, number, number];
    u: [number, number, number];
    s: [number, number, number];
    /** power and gear (Leg e, g) and whether it is out of sight */
    e: number;
    g: number;
    hidden: boolean;
    /** how far along its leg's way it has gone since the leg began, m (wheels turning) and its speed, m/s */
    run: number;
    v: number;
}

export function newAirPlace(): AirPlace {
    return { x: 0, y: -1000, z: 0, f: [1, 0, 0], u: [0, 1, 0], s: [0, 0, 1], e: 0, g: 1, hidden: true, run: 0, v: 0 };
}

/** The state an itinerary is at: where, heading (unit), height, speed, attitude, power, gear, time. */
interface At {
    t: number;
    x: number;
    z: number;
    hx: number;
    hz: number;
    y: number;
    v: number;
    th: number;
    ph: number;
    e: number;
    g: number;
}

/** What a leg may change on the way (absent: kept). */
export interface LegOpts {
    /** height at the end (straight line in s) */
    y?: number;
    th?: number;
    ph?: number;
    e?: number;
    g?: number;
    rev?: boolean;
    hidden?: boolean;
}

/** Degrees to radians. */
export const DEG = Math.PI / 180;

/**
 * Builds a mover's legs one after another from where the last one left it. Times are seconds from the itinerary's own
 * start (air.ts places it in the day).
 */
export class Itin {
    readonly legs: Leg[] = [];
    private a: At;

    constructor(x: number, z: number, hx: number, hz: number, y: number, o: { th?: number; e?: number; g?: number; t?: number } = {}) {
        this.a = { t: o.t ?? 0, x, z, hx, hz, y, v: 0, th: o.th ?? 0, ph: 0, e: o.e ?? 0, g: o.g ?? 1 };
    }

    get t(): number { return this.a.t; }
    get x(): number { return this.a.x; }
    get z(): number { return this.a.z; }
    get y(): number { return this.a.y; }
    get v(): number { return this.a.v; }
    get hx(): number { return this.a.hx; }
    get hz(): number { return this.a.hz; }
    get th(): number { return this.a.th; }

    private base(len: number, vEnd: number, o: LegOpts): Leg {
        const a = this.a;
        const v0 = a.v;
        let acc = 0, dur: number;
        if (len <= 0) throw new RangeError('a leg must go somewhere');
        if (v0 === vEnd) dur = len / v0;
        else {
            acc = (vEnd * vEnd - v0 * v0) / (2 * len);
            dur = (vEnd - v0) / acc;
        }
        if (!(dur > 0) || !Number.isFinite(dur)) throw new RangeError(`no way to go ${len} m from ${v0} to ${vEnd} m/s`);
        const yEnd = o.y ?? a.y;
        return {
            t0: a.t, t1: a.t + dur, arc: false, ax: a.x, az: a.z, dx: a.hx, dz: a.hz, cx: 0, cz: 0, r: 0, a0: 0, sweep: 0,
            len, v0, acc, y0: a.y, m: (yEnd - a.y) / len, c: 0, rev: o.rev ?? false, spin: false, h0: 0, h1: 0,
            th0: a.th, th1: o.th ?? a.th, ph0: a.ph, ph1: o.ph ?? a.ph, e0: a.e, e1: o.e ?? a.e, g0: a.g, g1: o.g ?? a.g,
            hidden: o.hidden ?? false
        };
    }

    private done(l: Leg, x: number, z: number, hx: number, hz: number, vEnd: number): this {
        this.legs.push(l);
        const a = this.a;
        a.t = l.t1; a.x = x; a.z = z; a.hx = hx; a.hz = hz; a.v = vEnd;
        a.y = l.y0 + l.m * l.len + l.c * l.len * l.len;
        a.th = l.th1; a.ph = l.ph1; a.e = l.e1; a.g = l.g1;
        return this;
    }

    /** Straight ahead (or back, rev: the way is still the heading's) `len` m, ending at vEnd. */
    straight(len: number, vEnd: number, o: LegOpts = {}): this {
        const l = this.base(len, vEnd, o);
        const a = this.a;
        const dir = l.rev ? -1 : 1;
        l.dx = a.hx * dir; l.dz = a.hz * dir;
        return this.done(l, a.x + l.dx * len, a.z + l.dz * len, a.hx, a.hz, vEnd);
    }

    /** Straight to the point (x, z) (turning to face it first, with no leg: only for where the heading is already that way, or a mover that may jump). */
    to(x: number, z: number, vEnd: number, o: LegOpts = {}): this {
        const a = this.a;
        const dx = x - a.x, dz = z - a.z, l = Math.sqrt(dx * dx + dz * dz);
        a.hx = dx / l; a.hz = dz / l;
        return this.straight(l, vEnd, o);
    }

    /**
     * A flare: `len` m on, the height a parabola that leaves the present slope `m0` (m per m, + up) and arrives with
     * slope m1 at the height y1. The caller picks len so the two agree (air.ts).
     */
    flare(len: number, vEnd: number, m0: number, m1: number, o: LegOpts = {}): this {
        const l = this.base(len, vEnd, o);
        const a = this.a;
        l.m = m0;
        l.c = (m1 - m0) / (2 * len);
        return this.done(l, a.x + a.hx * len, a.z + a.hz * len, a.hx, a.hz, vEnd);
    }

    /** Turn `angle` rad (+ right, - left) on radius r, ending at vEnd; moving backwards when o.rev (the tail leads). */
    turn(r: number, angle: number, vEnd: number, o: LegOpts = {}): this {
        const a = this.a;
        const len = r * (angle < 0 ? -angle : angle);
        const l = this.base(len, vEnd, o);
        const dir = l.rev ? -1 : 1;
        // the way of travel, and its right: (-wz, wx); a right turn of the way curves about a centre on its right
        const wx = a.hx * dir, wz = a.hz * dir;
        const side = angle > 0 ? 1 : -1;
        l.arc = true;
        l.r = r;
        l.cx = a.x - wz * r * side;
        l.cz = a.z + wx * r * side;
        l.a0 = datan2(a.z - l.cz, a.x - l.cx);
        l.sweep = angle;
        const th = l.a0 + angle;
        const ex = l.cx + r * dcos(th), ez = l.cz + r * dsin(th);
        // the new way: the tangent (-sin, cos) times the sweep's sign; the heading is the way (back to front when rev)
        const nwx = -dsin(th) * side, nwz = dcos(th) * side;
        return this.done(l, ex, ez, nwx * dir, nwz * dir, vEnd);
    }

    /** Stand still for `dur` s (attitude, power and gear eased to o's). */
    wait(dur: number, o: LegOpts = {}): this {
        const a = this.a;
        if (!(dur > 0)) return this;
        const l: Leg = {
            t0: a.t, t1: a.t + dur, arc: false, ax: a.x, az: a.z, dx: a.hx, dz: a.hz, cx: 0, cz: 0, r: 0, a0: 0, sweep: 0,
            len: 0, v0: 0, acc: 0, y0: a.y, m: 0, c: 0, rev: false, spin: false, h0: 0, h1: 0,
            th0: a.th, th1: o.th ?? a.th, ph0: a.ph, ph1: o.ph ?? a.ph, e0: a.e, e1: o.e ?? a.e, g0: a.g, g1: o.g ?? a.g,
            hidden: o.hidden ?? false
        };
        if (o.y !== undefined) l.m = o.y - a.y; // len 0: m is the whole rise, eased in time (rise())
        this.legs.push(l);
        a.t = l.t1; a.y = o.y ?? a.y; a.v = 0;
        a.th = l.th1; a.ph = l.ph1; a.e = l.e1; a.g = l.g1;
        return this;
    }

    /** Rise or sink straight up or down to height y over `dur` s, standing (a helicopter lifting off or settling). */
    rise(y: number, dur: number, o: LegOpts = {}): this {
        return this.wait(dur, { ...o, y });
    }

    /** Turn on the spot to heading (hx, hz) over `dur` s (a hovering helicopter). */
    spinTo(hx: number, hz: number, dur: number, o: LegOpts = {}): this {
        const a = this.a;
        const h0 = datan2(a.hz, a.hx);
        let h1 = datan2(hz, hx);
        // the short way round
        while (h1 - h0 > Math.PI) h1 -= 2 * Math.PI;
        while (h1 - h0 < -Math.PI) h1 += 2 * Math.PI;
        this.wait(dur, o);
        const l = this.legs[this.legs.length - 1];
        l.spin = true; l.h0 = h0; l.h1 = h1;
        a.hx = hx; a.hz = hz;
        return this;
    }

    /** Jump (unseen) to a new place: the next leg starts there. */
    jump(x: number, z: number, hx: number, hz: number, y: number, v: number): this {
        const a = this.a;
        a.x = x; a.z = z; a.hx = hx; a.hz = hz; a.y = y; a.v = v;
        return this;
    }

    /** Set attitude, power or gear at once (between legs). */
    set(o: { th?: number; ph?: number; e?: number; g?: number }): this {
        const a = this.a;
        if (o.th !== undefined) a.th = o.th;
        if (o.ph !== undefined) a.ph = o.ph;
        if (o.e !== undefined) a.e = o.e;
        if (o.g !== undefined) a.g = o.g;
        return this;
    }
}

/** Smoothstep on [0, 1]: eases attitude and power in and out. */
function ease(k: number): number {
    return k * k * (3 - 2 * k);
}

/** The index of the leg holding time t (legs in order, back to back), or -1 before the first / after the last. */
export function legAt(legs: readonly Leg[], t: number): number {
    if (!legs.length || t < legs[0].t0 || t > legs[legs.length - 1].t1) return -1;
    let lo = 0, hi = legs.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (legs[mid].t0 <= t) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/** Place a mover at time t on leg l (t within it). */
export function placeOnLeg(l: Leg, t: number, out: AirPlace): AirPlace {
    const dur = l.t1 - l.t0;
    let tau = t - l.t0;
    if (tau < 0) tau = 0;
    if (tau > dur) tau = dur;
    const k = dur > 0 ? tau / dur : 1;
    const q = ease(k);
    let s = l.v0 * tau + 0.5 * l.acc * tau * tau;
    if (s > l.len) s = l.len;
    if (s < 0) s = 0;
    let wx: number, wz: number;
    if (l.arc) {
        const th = l.a0 + l.sweep * (s / l.len);
        const c = dcos(th), sn = dsin(th);
        out.x = l.cx + l.r * c;
        out.z = l.cz + l.r * sn;
        const side = l.sweep > 0 ? 1 : -1;
        wx = -sn * side; wz = c * side;
    } else {
        out.x = l.ax + l.dx * s;
        out.z = l.az + l.dz * s;
        wx = l.dx; wz = l.dz;
    }
    // a leg standing still: its height eased in time (rise), else along its way
    out.y = l.len > 0 ? l.y0 + l.m * s + l.c * s * s : l.y0 + l.m * q;
    let hx = l.rev ? -wx : wx, hz = l.rev ? -wz : wz;
    if (l.spin) {
        const h = l.h0 + (l.h1 - l.h0) * q;
        hx = dcos(h); hz = dsin(h);
    }
    frame(hx, hz, l.th0 + (l.th1 - l.th0) * q, l.ph0 + (l.ph1 - l.ph0) * q, out);
    out.e = l.e0 + (l.e1 - l.e0) * q;
    out.g = l.g0 + (l.g1 - l.g0) * q;
    out.hidden = l.hidden;
    out.run = s;
    out.v = l.v0 + l.acc * tau;
    return out;
}

/** The frame of a mover heading (hx, hz) (unit, level), pitched th and banked ph (rad), into out.f, u, s. */
export function frame(hx: number, hz: number, th: number, ph: number, out: AirPlace): void {
    const ct = dcos(th), st = dsin(th), cp = dcos(ph), sp = dsin(ph);
    const f = out.f, u = out.u, s = out.s;
    f[0] = hx * ct; f[1] = st; f[2] = hz * ct;
    // up after the pitch, and the level right (-hz, 0, hx); the bank turns both about f
    const px = -hx * st, py = ct, pz = -hz * st;
    const rx = -hz, rz = hx;
    s[0] = rx * cp - px * sp; s[1] = -py * sp; s[2] = rz * cp - pz * sp;
    u[0] = px * cp + rx * sp; u[1] = py * cp; u[2] = pz * cp + rz * sp;
}
