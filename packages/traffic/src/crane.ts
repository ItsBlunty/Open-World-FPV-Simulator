// The tower crane at work (owner, 2026-10-24: "crane should turn and pickup and drop boxes around the worksite, Put a
// little guy in the crane tower working as well"). The map keeps its tower (maps first-map.ts towerCrane); from the
// slewing ring up it turns: the slewing platform, the cab with its operator, the 50 m jib and the counter-jib with its
// ballast (one mover), the trolley with its two falls of hoist rope (one), the hook (one) and the crates it moves between
// the ground inside the frame and the frame's top deck (one each). Where everything is comes from the tick alone, from a
// day of jobs planned once (replays); the collision is AirWorld's (air-world.ts MoverSet), so a crate on the hook or the
// jib turning shoves the quad as a taxiing plane does.
//
// Speeds are the Liebherr 172 EC-B 8 Litronic's (its FEM technical data sheet, read 2026-10-18 and 2026-10-24 (copy at
// ueg.qa), "Antriebe / Driving units"): slewing 0 to 0.8 rpm, trolley 0 to 100 m/min, the 24 kW hoist 0 to 86 m/min with
// 0.5 t on the hook (0 to 16 m/min with 8 t). Each move eases in and out (smoothstep), so its fastest is 1.5 times its
// mean, and that fastest is the data sheet's. The crates and the times the hook waits are estimates.
//
// Determinism: only + - * / and Math.sqrt here, with sim-core's dmath for the angles (the shapes and places are solid).

import type { CraneSite } from '@owfpv/maps';
import { datan2, dcos, dsin } from '@owfpv/sim-core';
import type { AirPlace } from './air-path';
import type { AirShape, APart, Role } from './air-shapes';

/** Bumped with any change that moves the crane or changes its shapes: part of the world hash (replays). */
export const CRANE_VERSION = 1;

const TAU = 2 * Math.PI;
/** the data sheet's top speeds: slewing rad/s, trolley m/s, hoist m/s (with 0.5 t: a crate [estimate]) */
const SLEW = (0.8 * TAU) / 60;
const TROLLEY = 100 / 60;
const HOIST = 86 / 60;
/** the shortest a move takes, s; the hook waits while a crate is slung on, and while one is unhooked, s [estimates] */
const MIN_MOVE = 2;
const WAIT_SLING = 10;
const WAIT_UNHOOK = 8;
/** the jib's bottom chords over the slewing ring, the trolley's depth under them, and the jib's length, m */
const JIB_Y = 1.0;
const TROLLEY_D = 0.5;
const JIB_L = 50;
/** a crate (1.6 x 1.0 x 1.2 m) and the slings from its top to the hook's tip, m [estimates] */
const CRATE = { hx: 0.8, h: 1.0, hz: 0.6 };
const SLING = 1.0;
/** the hook block: its top over the hook's tip, m (the rope ends there) */
const HOOK_TOP = 1.52;

const I3: APart['R'] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function box(role: Role, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, gear = false): APart {
    return { kind: 'box', role, a: [0, 0, 0], b: [0, 0, 0], r: 0, c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], e: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], R: I3, gear };
}

/** A square bar w thick from a to b (as maps builder.ts bar): an oriented box. */
function bar(role: Role, a: number[], b: number[], w: number, gear = false): APart {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const d = [dx / l, dy / l, dz / l];
    // a side at right angles to it: across it level, or along x for an upright bar
    let sx = -d[2], sz = d[0];
    const sl = Math.sqrt(sx * sx + sz * sz);
    let s: number[];
    if (sl < 1e-6) s = [1, 0, 0];
    else { sx /= sl; sz /= sl; s = [sx, 0, sz]; }
    const u = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]];
    return {
        kind: 'box', role, a: [0, 0, 0], b: [0, 0, 0], r: 0,
        c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], e: [l / 2, w / 2, w / 2],
        R: [d[0], d[1], d[2], u[0], u[1], u[2], s[0], s[1], s[2]], gear
    };
}

function shapeOf(parts: APart[]): AirShape {
    let reach = 0;
    for (const p of parts) {
        const pts = p.kind === 'cap' ? [p.a, p.b] : [p.c];
        const pad = p.kind === 'cap' ? p.r : Math.sqrt(p.e[0] * p.e[0] + p.e[1] * p.e[1] + p.e[2] * p.e[2]);
        for (const q of pts) reach = Math.max(reach, Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]) + pad);
    }
    return { parts, props: [], reach, nose: 0, tail: 0, half: 0 };
}

/**
 * The turning part in its own frame (x along the jib, y up from the slewing ring, z to the cab's side), as the map had it
 * before map v23 (sizes there: the data sheet's jib, counter-jib and ballast; members, the jib's section and the cab
 * estimates), with the cab now hollow, glazed and its operator in it.
 */
function slewingShape(): AirShape {
    const p: APart[] = [];
    const CH = 0.14, BR = 0.07;
    // the slewing platform
    p.push(box('crane', -1.2, 0, -1.2, 1.2, 1.0, 1.2));
    // the cab on the jib's right: floor, roof, back and inner walls, a wall to the sill, glass in front and on the outer side
    p.push(box('crane', 0.3, 0.2, 1.2, 2.1, 0.35, 2.9));
    p.push(box('crane', 0.25, 2.6, 1.15, 2.3, 2.75, 2.95));
    p.push(box('crane', 0.3, 0.35, 1.2, 0.4, 2.6, 2.9));
    p.push(box('crane', 0.4, 0.35, 1.2, 2.1, 2.6, 1.3));
    p.push(box('crane', 0.4, 0.35, 2.8, 2.1, 1.2, 2.9));
    p.push(box('glass', 0.4, 1.2, 2.84, 2.1, 2.6, 2.86));
    p.push(box('crane', 2.0, 0.35, 1.3, 2.1, 0.6, 2.8));
    p.push(box('glass', 2.04, 0.6, 1.3, 2.06, 2.6, 2.8));
    // the operator in his seat, looking along the jib (as the tower's controllers sit: air.ts SITTER) [estimate]
    p.push(box('crane', 1.0, 0.35, 1.8, 1.5, 0.75, 2.3));
    p.push({ kind: 'cap', role: 'person', a: [1.25, 1.05, 2.05], b: [1.25, 1.5, 2.05], r: 0.3, c: [0, 0, 0], e: [0, 0, 0], R: I3, gear: false });
    // the jib along +x: a triangular lattice 1.6 m wide and 1.8 m deep, Warren panels of 2.5 m
    const sy = JIB_Y, P = 2.5, JW = 0.8, JD = 1.8, j0 = 1.2, tip = JIB_L;
    const lo = (x: number, side: number): number[] => [x, sy, side * JW];
    const hi = (x: number): number[] => [x, sy + JD, 0];
    p.push(bar('crane', lo(j0, -1), lo(tip, -1), CH), bar('crane', lo(j0, 1), lo(tip, 1), CH), bar('crane', hi(j0), hi(tip - 1), CH));
    for (let x = j0; x < tip - 0.01; x += P) {
        const xn = Math.min(x + P, tip), xh = Math.min(x + P / 2, tip - 1);
        p.push(bar('crane', lo(x, -1), lo(x, 1), BR), bar('crane', lo(x, -1), lo(xn, 1), BR));
        for (const side of [-1, 1]) p.push(bar('crane', lo(x, side), hi(xh), BR), bar('crane', hi(xh), lo(xn, side), BR));
    }
    p.push(bar('crane', lo(tip, -1), lo(tip, 1), BR), bar('crane', lo(tip, -1), hi(tip - 1), BR), bar('crane', lo(tip, 1), hi(tip - 1), BR));
    // the counter-jib along -x: two box beams 2 m apart, cross members, a walkway, hand rails, the hoist winch, the switch
    // cabinet and the seven ballast blocks hanging at its end
    const C = 13.4, c1 = -1.2, c0 = -C;
    for (const side of [-1, 1]) p.push(box('crane', c0, sy, side * 1.0 - 0.12, c1, sy + 0.45, side * 1.0 + 0.12));
    for (let x = c0; x <= c1; x += 2.4) p.push(box('crane', x, sy, -0.88, x + 0.12, sy + 0.2, 0.88));
    p.push(box('trim', c0 + 1, sy + 0.2, -0.4, c1 - 0.5, sy + 0.24, 0.4));
    for (const side of [-1, 1]) p.push(box('crane', c0 + 1, sy + 1.1, side * 1.0 - 0.03, c1, sy + 1.16, side * 1.0 + 0.03));
    for (let x = c0 + 1; x <= c1; x += 3) for (const side of [-1, 1]) p.push(box('crane', x, sy + 0.45, side * 1.0 - 0.03, x + 0.06, sy + 1.1, side * 1.0 + 0.03));
    p.push(box('trim', -6.5, sy + 0.24, -0.7, -4.5, sy + 1.4, 0.7));
    p.push(box('trim', -3.8, sy + 0.24, -0.7, -2.6, sy + 2.0, -0.1));
    for (let k = 0; k < 7; k++) {
        const x = c0 + 0.1 + k * 0.29;
        p.push(box('ballast', x, sy + 0.45 - 3.15, -0.59, x + 0.28, sy + 0.45, 0.59));
    }
    return shapeOf(p);
}

/** The trolley under the jib's bottom chords (its frame at their level), and the rope's two falls down to the hook block. */
function trolleyShape(): AirShape {
    const rope = (x: number): APart => ({ kind: 'cap', role: 'rope', a: [x, -TROLLEY_D, 0], b: [x, -TROLLEY_D - JIB_L, 0], r: 0.025, c: [0, 0, 0], e: [0, 0, 0], R: I3, gear: false, rope: true });
    return shapeOf([box('crane', -0.9, -TROLLEY_D, -0.95, 0.9, 0, 0.95), rope(-0.3), rope(0.3)]);
}

/** The hook block, its shank and hook (its frame at the hook's tip), and the slings, solid only while a crate hangs on them. */
function hookShape(): AirShape {
    const t = HOOK_TOP;
    const p = [
        box('crane', -0.5, t - 0.8, -0.2, 0.5, t, 0.2),
        box('trim', -0.06, 0.12, -0.06, 0.06, t - 0.8, 0.06),
        box('trim', -0.06, 0, -0.06, 0.3, 0.12, 0.06),
        box('trim', 0.24, 0, -0.06, 0.3, 0.27, 0.06)
    ];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(bar('rope', [0.1 * sx, 0.02, 0.05 * sz], [(CRATE.hx - 0.1) * sx, -SLING, (CRATE.hz - 0.1) * sz], 0.04, true));
    return shapeOf(p);
}

/** A crate, its frame at the middle of its bottom [estimate: a slatted timber crate of building materials]. */
function crateShape(): AirShape {
    return shapeOf([box('crate', -CRATE.hx, 0, -CRATE.hz, CRATE.hx, CRATE.h, CRATE.hz)]);
}

/** One move of the day: from t0 for T s, the jib's angle, the trolley's radius and the hook's height eased from a to b. */
interface Move {
    t0: number;
    T: number;
    th0: number; th1: number;
    r0: number; r1: number;
    h0: number; h1: number;
    job: number;
    /** the crate on the hook through this move, or -1 */
    carry: number;
}

export interface CraneMover {
    kind: 'slewing' | 'trolley' | 'hook' | 'crate';
    shape: AirShape;
    vmax: number;
}

/** Smoothstep: eases a move in and out. */
const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** The tower crane's day of jobs and its movers' places at any tick. */
export class TowerCrane {
    readonly site: CraneSite;
    readonly movers: CraneMover[];
    readonly maxSpeed: number;
    /** the day's length, s: the jobs come round again after it */
    readonly day: number;
    private readonly moves: Move[] = [];
    /** before job j: each crate's place (index into site.spots) and the jib's angle it was set down at */
    private readonly at: { spot: number[]; yaw: number[] }[] = [];
    /** job j's crate and when it is set down at its new place (s into the day) */
    private readonly moved: { crate: number; down: number }[] = [];
    private readonly spotTh: number[];
    private readonly spotR: number[];
    private readonly nCrates: number;

    constructor(site: CraneSite) {
        this.site = site;
        const n = site.spots.length;
        this.nCrates = n - 1;
        this.spotTh = site.spots.map(([x, , z]) => datan2(-(z - site.z), x - site.x));
        this.spotR = site.spots.map(([x, , z]) => Math.sqrt((x - site.x) * (x - site.x) + (z - site.z) * (z - site.z)));
        const sweep = SLEW * JIB_L;
        this.movers = [
            { kind: 'slewing', shape: slewingShape(), vmax: sweep * 1.05 },
            { kind: 'trolley', shape: trolleyShape(), vmax: sweep + TROLLEY },
            { kind: 'hook', shape: hookShape(), vmax: sweep + TROLLEY + HOIST },
            ...Array.from({ length: this.nCrates }, () => ({ kind: 'crate' as const, shape: crateShape(), vmax: sweep + TROLLEY + HOIST }))
        ];
        this.maxSpeed = sweep + TROLLEY + HOIST;
        this.day = this.plan();
    }

    /** The hook's tip over a crate's bottom while it hangs, m */
    private static readonly HANG = CRATE.h + SLING;

    /**
     * Plan the day: each job takes the crate in the place after the empty one into it, so the empty place moves on one;
     * with n places and n - 1 crates every crate is back where it began after n (n - 1) jobs, the day.
     */
    private plan(): number {
        const s = this.site, n = s.spots.length, jobs = n * (n - 1);
        const clear = s.clear + TowerCrane.HANG;
        const spot = Array.from({ length: this.nCrates }, (_, i) => i);
        const yaw = spot.map((k) => this.spotTh[k]);
        let empty = n - 1;
        // the day starts with the hook at the clearance height over the empty place
        let th = this.spotTh[empty], r = this.spotR[empty], h = clear, t = 0;
        const add = (job: number, carry: number, th1: number, r1: number, h1: number, wait = 0): void => {
            let d = th1 - th;
            // the short way round
            while (d > Math.PI) d -= TAU;
            while (d < -Math.PI) d += TAU;
            const T = wait > 0 ? wait : Math.max(MIN_MOVE, (1.5 * Math.abs(d)) / SLEW, (1.5 * Math.abs(r1 - r)) / TROLLEY, (1.5 * Math.abs(h1 - h)) / HOIST);
            this.moves.push({ t0: t, T, th0: th, th1: th + d, r0: r, r1, h0: h, h1, job, carry });
            t += T; th += d; r = r1; h = h1;
        };
        for (let j = 0; j < jobs; j++) {
            this.at.push({ spot: spot.slice(), yaw: yaw.slice() });
            const from = (empty + 1) % n, c = spot.indexOf(from);
            const hA = s.spots[from][1] + TowerCrane.HANG, hB = s.spots[empty][1] + TowerCrane.HANG;
            add(j, -1, this.spotTh[from], this.spotR[from], clear);
            add(j, -1, th, r, hA);
            add(j, -1, th, r, hA, WAIT_SLING);
            add(j, c, th, r, clear);
            add(j, c, this.spotTh[empty], this.spotR[empty], clear);
            add(j, c, th, r, hB);
            this.moved.push({ crate: c, down: t });
            spot[c] = empty;
            yaw[c] = th - Math.floor((th + Math.PI) / TAU) * TAU;
            add(j, -1, th, r, hB, WAIT_UNHOOK);
            add(j, -1, th, r, clear);
            empty = from;
        }
        // back to where the day began (the jib may have gone round: the angle the same mod 2 pi)
        add(jobs, -1, this.spotTh[n - 1], this.spotR[n - 1], clear);
        return t;
    }

    /** The move at time t of the day (s). */
    private moveAt(t: number): Move {
        const m = this.moves;
        let lo = 0, hi = m.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (m[mid].t0 <= t) lo = mid;
            else hi = mid - 1;
        }
        return m[lo];
    }

    /** The jib's angle, the trolley's radius, the hook's height and the crate on it at `tick` (ms). */
    state(tick: number): { th: number; r: number; h: number; carry: number; job: number } {
        let t = tick / 1000;
        t -= Math.floor(t / this.day) * this.day;
        const m = this.moveAt(t);
        const e = ease((t - m.t0) / m.T);
        return { th: m.th0 + (m.th1 - m.th0) * e, r: m.r0 + (m.r1 - m.r0) * e, h: m.h0 + (m.h1 - m.h0) * e, carry: m.carry, job: m.job };
    }

    /** Where crate i rests when not on the hook during job j: its place and the jib's angle it was set down at. */
    private restOf(i: number, j: number, t: number): { spot: number; yaw: number } {
        // the day's last move (back to its start) has every crate where the day began
        const a = this.at[j] ?? this.at[0];
        // set down at its new place by its job: the next job's record has it (the day's start after the last job)
        const m = this.moved[j];
        if (m && m.crate === i && t >= m.down) {
            const next = this.at[j + 1] ?? this.at[0];
            return { spot: next.spot[i], yaw: next.yaw[i] };
        }
        return { spot: a.spot[i], yaw: a.yaw[i] };
    }

    place(i: number, tick: number, out: AirPlace): void {
        const s = this.site, st = this.state(tick);
        const c = dcos(st.th), sn = dsin(st.th);
        out.hidden = false; out.e = 0; out.g = 1; out.len = 0; out.run = 0; out.v = 0;
        out.u[0] = 0; out.u[1] = 1; out.u[2] = 0;
        const frame = (ct: number, st2: number): void => {
            out.f[0] = ct; out.f[1] = 0; out.f[2] = -st2;
            out.s[0] = st2; out.s[1] = 0; out.s[2] = ct;
        };
        const kind = this.movers[i].kind;
        const jibY = s.ring + JIB_Y;
        if (kind === 'slewing') {
            frame(c, sn);
            out.x = s.x; out.y = s.ring; out.z = s.z;
            return;
        }
        if (kind !== 'crate' || st.carry === i - 3) {
            frame(c, sn);
            out.x = s.x + c * st.r; out.z = s.z - sn * st.r;
            if (kind === 'trolley') {
                out.y = jibY;
                out.len = jibY - TROLLEY_D - (st.h + HOOK_TOP);
            } else if (kind === 'hook') {
                out.y = st.h;
                out.g = st.carry >= 0 ? 1 : 0;
            } else {
                out.y = st.h - TowerCrane.HANG;
            }
            return;
        }
        let t = tick / 1000;
        t -= Math.floor(t / this.day) * this.day;
        const r = this.restOf(i - 3, st.job, t);
        const p = s.spots[r.spot];
        frame(dcos(r.yaw), dsin(r.yaw));
        out.x = p[0]; out.y = p[1]; out.z = p[2];
    }
}

/** The crane for a level: null when it has none. */
export function makeCrane(site: CraneSite | null): TowerCrane | null {
    return site && site.spots.length > 1 ? new TowerCrane(site) : null;
}

