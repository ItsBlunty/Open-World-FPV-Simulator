// Paths for movers: straights joined by quarter circles, open (a lane, a turn through a junction) or
// closed (a loop round a block). A place on a path is a function of the distance along it alone.
//
// Determinism: only + - * /, Math.sqrt, Math.floor (exact in IEEE arithmetic) and sim-core's dmath
// sine and cosine, so every JavaScript engine puts every mover at the same bits.

import { dcos, dsin } from '@owfpv/sim-core';

/** One piece of a route: a straight from (ax, az) along unit (dx, dz), or an arc around (cx, cz). */
export interface Seg {
    arc: boolean;
    /** where the piece starts along the route, m */
    s0: number;
    len: number;
    ax: number;
    az: number;
    dx: number;
    dz: number;
    cx: number;
    cz: number;
    r: number;
    /** arc start angle (x = cos, z = sin) and its signed sweep, rad */
    a0: number;
    sweep: number;
}

export interface Route {
    segs: Seg[];
    length: number;
    /** height of the surface the route runs on, m */
    y: number;
    /** the path's bounding box in x and z */
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

/** A place on a route: position (y: the ground under the mover) and unit heading (direction of travel) in x and z. */
export interface Place {
    x: number;
    y: number;
    z: number;
    hx: number;
    hz: number;
}

const HALF_PI = Math.PI / 2;

/** The angle of an axis direction (x = cos, z = sin), exact multiples of pi / 2. */
function axisAngle(dx: number, dz: number): number {
    if (dx > 0.5) return 0;
    if (dz > 0.5) return HALF_PI;
    if (dx < -0.5) return Math.PI;
    return -HALF_PI;
}

/**
 * A route through four corners of an axis-aligned rectangle, in travel order, with each corner
 * rounded to radius rc. The sides must be longer than 2 rc.
 */
export function rectRoute(corners: readonly (readonly [number, number])[], rc: number, y: number): Route {
    return pathThrough(corners, rc, true, y);
}

/**
 * A path through points joined by straights, each inner point (every point of a closed path) rounded
 * to a quarter circle of radius rc. Turns must be right angles, and each straight long enough for
 * the corners at its ends.
 */
export function pathThrough(points: readonly (readonly [number, number])[], rc: number, closed: boolean, y: number): Route {
    const n = points.length;
    const dir = (i: number): [number, number] => {
        const a = points[i % n], b = points[(i + 1) % n];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const l = Math.sqrt(ex * ex + ez * ez);
        return [ex / l, ez / l];
    };
    const segs: Seg[] = [];
    let s = 0;
    const sides = closed ? n : n - 1;
    for (let i = 0; i < sides; i++) {
        const a = points[i], b = points[(i + 1) % n];
        const [dx, dz] = dir(i);
        const side = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
        const cutA = closed || i > 0 ? rc : 0;
        const cutB = closed || i < sides - 1 ? rc : 0;
        if (side <= cutA + cutB) throw new RangeError(`a side of ${side} m is too short for corners of radius ${rc} m`);
        const len = side - cutA - cutB;
        segs.push({ arc: false, s0: s, len, ax: a[0] + dx * cutA, az: a[1] + dz * cutA, dx, dz, cx: 0, cz: 0, r: 0, a0: 0, sweep: 0 });
        s += len;
        if (cutB === 0) break;
        // the corner at b, turning from (dx, dz) to the next side's direction
        const [ex, ez] = dir(i + 1);
        const cross = dx * ez - dz * ex;
        const alen = rc * HALF_PI;
        segs.push({
            arc: true, s0: s, len: alen, ax: 0, az: 0, dx: 0, dz: 0,
            cx: b[0] - dx * rc + ex * rc, cz: b[1] - dz * rc + ez * rc, r: rc,
            a0: axisAngle(-ex, -ez), sweep: cross > 0 ? HALF_PI : -HALF_PI
        });
        s += alen;
    }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const c of points) {
        minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
        minZ = Math.min(minZ, c[1]); maxZ = Math.max(maxZ, c[1]);
    }
    return { segs, length: s, y, minX, minZ, maxX, maxZ };
}

/** The place at distance s along the route (any s: it wraps round; on an open path, clamped to its ends). */
export function placeAt(route: Route, s: number, out: Place, open = false): Place {
    const L = route.length;
    if (open) s = s < 0 ? 0 : s > L ? L : s;
    else {
        s = s - Math.floor(s / L) * L;
        if (s >= L) s -= L;
    }
    const segs = route.segs;
    let k = segs.length - 1;
    for (let i = 1; i < segs.length; i++) {
        if (s < segs[i].s0) { k = i - 1; break; }
    }
    const g = segs[k];
    const u = s - g.s0;
    out.y = route.y;
    if (!g.arc) {
        out.x = g.ax + g.dx * u;
        out.z = g.az + g.dz * u;
        out.hx = g.dx;
        out.hz = g.dz;
        return out;
    }
    const th = g.a0 + g.sweep * (u / g.len);
    const c = dcos(th), sn = dsin(th);
    out.x = g.cx + g.r * c;
    out.z = g.cz + g.r * sn;
    // d/ds of the position, normalised: the sweep's sign times (-sin, cos)
    const sg = g.sweep > 0 ? 1 : -1;
    out.hx = -sn * sg;
    out.hz = c * sg;
    return out;
}
