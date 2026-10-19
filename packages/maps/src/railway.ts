// The railway (map v7, owner 2026-10-19: "a tunnel and a train that travels through a railyard, stops, then continues"):
// one loop of standard-gauge track in the open land south of the park, through a tunnel under a new hill on its north
// side and through a station and goods yard on its south side. The train that runs on it is packages/traffic train.ts;
// this file is the still part: ballast, rails, sleepers, the hill and its tunnel, the platform, sidings, wagons, the
// engine shed. Metres, north is -z, east +x, y up.
//
// The loop is a rectangle with its corners rounded (the same path as traffic route.ts pathThrough builds from
// Level.railway), drawn here with the same arithmetic: + - * /, Math.sqrt and sim-core's dmath sine and cosine, so
// every engine builds the same bytes.

import { dcos, dsin } from '@owfpv/sim-core';
import type { LevelBuilder, Material, Railway } from './builder';

/**
 * The loop: corners in the order the train runs them (clockwise seen from above: north up the west side, east through
 * the tunnel, south, then west through the station), every corner a 110 m curve. 110 m is tight for a main line and
 * usual for a branch line; a train there goes no faster than about 45 km/h [estimate], which is the train's top speed.
 */
export const RAIL_CORNERS: [number, number][] = [[-255, 475], [-255, 245], [235, 245], [235, 475]];
export const RAIL_RADIUS = 110;

/** Standard gauge, m: 4 ft 8 1/2 in between the rails' inner faces. A rail head is about 7 cm wide [estimate]. */
const GAUGE = 1.435;
const RAIL_W = 0.07;
/** the rails' centre lines either side of the track's */
const RAIL_C = GAUGE / 2 + RAIL_W / 2;
/** the ballast's top and the rails' top above the ground, m [estimates] */
export const BALLAST_TOP = 0.3;
export const RAIL_TOP = 0.45;
/** sleepers: a British standard timber sleeper is 8 ft 6 in by 10 in (2.59 x 0.254 m), laid about 0.7 m apart [estimate] */
const SLEEPER_L = 2.59;
const SLEEPER_W = 0.254;
const SLEEPER_PITCH = 0.7;
/** the ballast's cross-section: its top 3 m wide, its shoulders sloping to the ground 4.8 m apart [estimates] */
const BALLAST: number[][] = [[-2.4, 0], [-1.5, BALLAST_TOP], [1.5, BALLAST_TOP], [2.4, 0]];

/** The tunnel: under the hill on the north side, the straight from x -56 to 36 (92 m), a 5 m bore, walls to 4 m, a round arch to 6.5 m. */
const TUNNEL = { x0: -56, x1: 36, z: 245, halfWidth: 2.5, spring: 4, crown: 6.5 };
/** The hill: a round-topped mound 22 m high over an ellipse 160 m by 80 m, centred over the tunnel [a made-up hill]. */
const HILL = { cx: -10, cz: 245, ax: 80, az: 40, h: 22 };
/** The cutting each side of the tunnel: 7 m wide between stone retaining walls. */
const CUT = 3.5;

/** The station: the platform on the south side of the south straight, 0.9 m high, its edge 1.5 m from the track's centre. */
const STATION_Z = 475;
const PLATFORM = { x0: -62, x1: 42, z0: STATION_Z + 1.5, z1: STATION_Z + 7.5, y: 0.9 };
/** The front of the train stops here: its five vehicles (75 m) then stand along the platform. */
const STOP_X = -57;
/** the goods yard's sidings north of the main line, 4.5 m between track centres [estimate], and their buffer stops */
const SIDING_PITCH = 4.5;
const SIDING_END = -118;
/** the yard's ballast, a little lower than the main line's so the two never overlap in one plane */
const YARD_TOP = 0.29;

interface Pose {
    x: number;
    z: number;
    /** unit heading */
    hx: number;
    hz: number;
}

interface Piece {
    arc: boolean;
    s0: number;
    len: number;
    ax: number;
    az: number;
    dx: number;
    dz: number;
    cx: number;
    cz: number;
    a0: number;
    sweep: number;
}

const HALF_PI = Math.PI / 2;

function axisAngle(dx: number, dz: number): number {
    if (dx > 0.5) return 0;
    if (dz > 0.5) return HALF_PI;
    if (dx < -0.5) return Math.PI;
    return -HALF_PI;
}

/** The loop's straights and curves, as traffic route.ts pathThrough builds them for a closed path. */
export function loopPieces(corners: readonly (readonly [number, number])[], rc: number): { pieces: Piece[]; length: number } {
    const n = corners.length;
    const dir = (i: number): [number, number] => {
        const a = corners[i % n], b = corners[(i + 1) % n];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const l = Math.sqrt(ex * ex + ez * ez);
        return [ex / l, ez / l];
    };
    const pieces: Piece[] = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
        const a = corners[i], b = corners[(i + 1) % n];
        const [dx, dz] = dir(i);
        const side = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
        const len = side - 2 * rc;
        pieces.push({ arc: false, s0: s, len, ax: a[0] + dx * rc, az: a[1] + dz * rc, dx, dz, cx: 0, cz: 0, a0: 0, sweep: 0 });
        s += len;
        const [ex, ez] = dir(i + 1);
        const cross = dx * ez - dz * ex;
        const alen = rc * HALF_PI;
        pieces.push({
            arc: true, s0: s, len: alen, ax: 0, az: 0, dx: 0, dz: 0,
            cx: b[0] - dx * rc + ex * rc, cz: b[1] - dz * rc + ez * rc, a0: axisAngle(-ex, -ez), sweep: cross > 0 ? HALF_PI : -HALF_PI
        });
        s += alen;
    }
    return { pieces, length: s };
}

/** The pose u m into piece g. */
function poseIn(g: Piece, u: number, rc: number): Pose {
    if (!g.arc) return { x: g.ax + g.dx * u, z: g.az + g.dz * u, hx: g.dx, hz: g.dz };
    const th = g.a0 + g.sweep * (u / g.len);
    const c = dcos(th), sn = dsin(th);
    const sg = g.sweep > 0 ? 1 : -1;
    return { x: g.cx + rc * c, z: g.cz + rc * sn, hx: -sn * sg, hz: c * sg };
}

/** Poses along the whole loop, closed (the last is the first again): every piece's ends, and every `step` m or less round the curves. */
function loopPoses(step: number, straightStep = Infinity): Pose[] {
    const { pieces } = loopPieces(RAIL_CORNERS, RAIL_RADIUS);
    const out: Pose[] = [];
    for (const g of pieces) {
        const n = Math.max(1, Math.ceil(g.len / (g.arc ? step : straightStep)));
        for (let k = 0; k < n; k++) out.push(poseIn(g, (g.len * k) / n, RAIL_RADIUS));
    }
    out.push(out[0]);
    return out;
}

/** Track centre-line points every 2 m or less, for nearTrack. */
let dense: Pose[] | null = null;

/** Is (x, z) within d m of the loop's centre line? (things placed earlier keep off the track) */
export function nearTrack(x: number, z: number, d: number): boolean {
    dense ??= loopPoses(2, 2);
    for (const p of dense) if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < d * d) return true;
    return false;
}

/** Wind a triangle or a planar quad to face away from `centre`. */
function faceOut(b: LevelBuilder, m: Material, centre: number[], pts: number[][]): void {
    const [a, p, q] = pts;
    const ux = p[0] - a[0], uy = p[1] - a[1], uz = p[2] - a[2];
    const vx = q[0] - a[0], vy = q[1] - a[1], vz = q[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = nx * (a[0] - centre[0]) + ny * (a[1] - centre[1]) + nz * (a[2] - centre[2]);
    const v = out >= 0 ? pts : pts.slice().reverse();
    if (v.length === 3) b.tri(m, v[0], v[1], v[2]);
    else b.quad(m, v[0], v[1], v[2], v[3]);
}

/**
 * A cross-section `profile` ([across, y] points: across is to the right of the heading) swept along `poses`: one
 * quad per profile edge between each pair of poses, wound away from the profile's middle.
 */
function extrude(b: LevelBuilder, m: Material, poses: Pose[], profile: number[][]): void {
    let mo = 0, my = 0;
    for (const [o, y] of profile) { mo += o / profile.length; my += y / profile.length; }
    const at = (p: Pose, o: number, y: number): number[] => [p.x - p.hz * o, y, p.z + p.hx * o];
    for (let i = 0; i + 1 < poses.length; i++) {
        const p = poses[i], q = poses[i + 1];
        const mid: Pose = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, hx: (p.hx + q.hx) / 2, hz: (p.hz + q.hz) / 2 };
        const c = at(mid, mo, my);
        for (let k = 0; k + 1 < profile.length; k++) {
            const [o0, y0] = profile[k], [o1, y1] = profile[k + 1];
            b.quadOut(m, c, at(p, o0, y0), at(p, o1, y1), at(q, o1, y1), at(q, o0, y0));
        }
    }
}

/** A rail's cross-section, its centre `o` m right of the track's, from `foot` to the rail top. */
function railProfile(o: number, foot: number): number[][] {
    const w = RAIL_W / 2;
    return [[o - w, foot], [o - w, RAIL_TOP], [o + w, RAIL_TOP], [o + w, foot]];
}

/** Both rails and the sleepers along `poses` (a straight run when it is two poses), the sleepers painted at `bed`. */
function track(b: LevelBuilder, poses: Pose[], bed: number): void {
    for (const o of [-RAIL_C, RAIL_C]) extrude(b, 'rail', poses, railProfile(o, bed + 0.02));
    // a sleeper every SLEEPER_PITCH m along the whole run, wherever the poses' joints fall
    let start = 0;
    let next = SLEEPER_PITCH / 2;
    for (let i = 0; i + 1 < poses.length; i++) {
        const p = poses[i], q = poses[i + 1];
        const len = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z));
        for (; next < start + len; next += SLEEPER_PITCH) {
            const t = (next - start) / len;
            const hx0 = p.hx + (q.hx - p.hx) * t, hz0 = p.hz + (q.hz - p.hz) * t;
            const hl = Math.sqrt(hx0 * hx0 + hz0 * hz0);
            const hx = hx0 / hl, hz = hz0 / hl;
            const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
            const y = bed + 0.02;
            const f = SLEEPER_W / 2, s = SLEEPER_L / 2;
            // corners (along, across), anticlockwise seen from above (as LevelBuilder.floor)
            const c = (a: number, o: number): number[] => [x + a * hx - o * hz, y, z + a * hz + o * hx];
            b.paintQuad('sleeper', c(-f, -s), c(-f, s), c(f, s), c(f, -s));
        }
        start += len;
    }
}

/** A straight piece of track from (x0, z0) to (x1, z1). */
function straight(x0: number, z0: number, x1: number, z1: number): Pose[] {
    const l = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
    const hx = (x1 - x0) / l, hz = (z1 - z0) / l;
    return [{ x: x0, z: z0, hx, hz }, { x: x1, z: z1, hx, hz }];
}

// ---------------------------------------------------------------- the hill and its tunnel

function hillH(x: number, z: number): number {
    const u = (x - HILL.cx) / HILL.ax, v = (z - HILL.cz) / HILL.az;
    const d = Math.sqrt(u * u + v * v);
    return d >= 1 ? 0 : HILL.h * (0.5 + 0.5 * dcos(Math.PI * d));
}

/** Is the cell from x0 to x1 inside the cutting (the corridor beyond the portals, cut down to the ground)? */
const inCut = (x0: number, x1: number, z0: number, z1: number): boolean =>
    z0 >= TUNNEL.z - CUT && z1 <= TUNNEL.z + CUT && (x1 <= TUNNEL.x0 + 1 || x0 >= TUNNEL.x1 - 1);

/**
 * The hill: a grass height field on a 5 m grid (with lines at the cutting's walls), its surface only, as every solid in
 * this map is a shell. The track's corridor is cut down to the ground beyond the portals between stone retaining walls;
 * the tunnel is a stone-lined bore with a headwall at each end.
 */
function hill(b: LevelBuilder): void {
    const xs: number[] = [];
    for (let x = HILL.cx - HILL.ax; x <= HILL.cx + HILL.ax; x += 5) xs.push(x);
    const zs: number[] = [];
    for (let z = HILL.cz - HILL.az; z <= HILL.cz + HILL.az; z += 5) zs.push(z);
    zs.push(TUNNEL.z - CUT, TUNNEL.z + CUT);
    zs.sort((a, c) => a - c);
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
        const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
        if (inCut(x0, x1, z0, z1)) continue;
        const a = [x0, hillH(x0, z0), z0], p = [x0, hillH(x0, z1), z1], c = [x1, hillH(x1, z1), z1], d = [x1, hillH(x1, z0), z0];
        // anticlockwise from above; triangles lying flat on the ground are left to the ground
        if (a[1] > 0 || p[1] > 0 || c[1] > 0) b.tri('grass', a, p, c);
        if (a[1] > 0 || c[1] > 0 || d[1] > 0) b.tri('grass', a, c, d);
    }
    // the cutting's retaining walls, from the ground up to the hill's surface at the corridor's edge, facing the track
    for (let i = 0; i + 1 < xs.length; i++) {
        const x0 = xs[i], x1 = xs[i + 1];
        if (!inCut(x0, x1, TUNNEL.z - CUT, TUNNEL.z + CUT)) continue;
        for (const side of [-1, 1]) {
            const z = TUNNEL.z + side * CUT;
            const ha = hillH(x0, z), hb = hillH(x1, z);
            if (ha <= 0 && hb <= 0) continue;
            const pts: number[][] = [[x0, 0, z], [x1, 0, z]];
            if (hb > 0) pts.push([x1, hb, z]);
            if (ha > 0) pts.push([x0, ha, z]);
            faceOut(b, 'stone', [(x0 + x1) / 2, 1, z + side], pts);
        }
    }
    tunnelBore(b);
    for (const [x, out] of [[TUNNEL.x0, -1], [TUNNEL.x1, 1]]) headwall(b, x, out);
}

/** The bore's arch: points (z, y) from the south springing over the crown to the north one. */
function archPoints(): number[][] {
    const N = 12;
    const r = TUNNEL.halfWidth;
    const pts: number[][] = [];
    for (let k = 0; k <= N; k++) {
        const th = Math.PI - (k * Math.PI) / N;
        pts.push([TUNNEL.z + r * dcos(th), TUNNEL.spring + r * dsin(th)]);
    }
    return pts;
}

/** The stone lining from portal to portal: two walls to the springing and the arch, all facing in; a ballast floor. */
function tunnelBore(b: LevelBuilder): void {
    const { x0, x1, z, halfWidth: w, spring } = TUNNEL;
    const xm = (x0 + x1) / 2;
    for (const side of [-1, 1]) {
        const zw = z + side * w;
        faceOut(b, 'stone', [xm, spring / 2, zw + side], [[x0, 0, zw], [x1, 0, zw], [x1, spring, zw], [x0, spring, zw]]);
    }
    const arch = archPoints();
    for (let k = 0; k + 1 < arch.length; k++) {
        const [za, ya] = arch[k], [zb, yb] = arch[k + 1];
        const zc = (za + zb) / 2, yc = (ya + yb) / 2;
        // the outward side: away from the arch's centre
        const nz = zc - z, ny = yc - spring;
        faceOut(b, 'stone', [xm, yc + ny, zc + nz], [[x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za]]);
    }
    b.box('ballast', x0, 0, z - w, x1, 0.05, z + w);
}

/** A portal's headwall: 1 m of stone standing out of the hill into the cutting, the bore through it, a parapet on top. */
function headwall(b: LevelBuilder, x: number, out: number): void {
    const { z, halfWidth: w } = TUNNEL;
    const xo = x, xi = x - out; // its outer face (on the portal's line) and its back, 1 m into the hill
    const T = Math.max(hillH(xi, z - CUT), hillH(xi, z), hillH(xi, z + CUT)) + 0.8;
    const zs = z - CUT, zn = z + CUT;
    const inside = [x - out * 0.5, T / 2, z];
    const face = (pts: number[][]): void => faceOut(b, 'stone', inside, pts);
    // the outer face: a pier each side of the bore, and the stone over the arch in strips, one per arch segment
    face([[xo, 0, zs], [xo, 0, z - w], [xo, T, z - w], [xo, T, zs]]);
    face([[xo, 0, z + w], [xo, 0, zn], [xo, T, zn], [xo, T, z + w]]);
    const arch = archPoints();
    for (let k = 0; k + 1 < arch.length; k++) {
        const [za, ya] = arch[k], [zb, yb] = arch[k + 1];
        face([[xo, ya, za], [xo, yb, zb], [xo, T, zb], [xo, T, za]]);
    }
    // its top, its ends, and its back where the parapet stands above the hill
    face([[xo, T, zs], [xo, T, zn], [xi, T, zn], [xi, T, zs]]);
    for (const zz of [zs, zn]) face([[xo, 0, zz], [xi, 0, zz], [xi, T, zz], [xo, T, zz]]);
    const back = Math.min(hillH(xi, zs), hillH(xi, z), hillH(xi, zn)) - 1;
    face([[xi, back, zs], [xi, back, zn], [xi, T, zn], [xi, T, zs]]);
}

// ---------------------------------------------------------------- the station and the goods yard

/** A goods wagon standing on a siding at (x, z): a van, an open wagon with coal, or a tank wagon, 6 m over the body [estimates]. */
function wagon(b: LevelBuilder, kind: 'van' | 'open' | 'tank', x: number, z: number): void {
    const L = 3, W = 1.25;
    // underframe and wheels, as one dark block between the rails' tops and the floor
    b.box('rail', x - L + 0.3, RAIL_TOP, z - 1.0, x + L - 0.3, 1.05, z + 1.0);
    if (kind === 'van') {
        b.box('wagon', x - L, 1.05, z - W, x + L, 3.3, z + W);
        b.box('wagon', x - L + 0.1, 3.3, z - W + 0.25, x + L - 0.1, 3.5, z + W - 0.25); // the roof's crown
    } else if (kind === 'open') {
        b.box('wood', x - L, 1.05, z - W, x + L, 1.2, z + W); // floor
        for (const s of [-1, 1]) b.box('wood', x - L, 1.2, z + s * W - (s > 0 ? 0.1 : 0), x + L, 2.2, z + s * W + (s < 0 ? 0.1 : 0));
        for (const s of [-1, 1]) b.box('wood', x + s * L - (s > 0 ? 0.1 : 0), 1.2, z - W + 0.1, x + s * L + (s < 0 ? 0.1 : 0), 2.2, z + W - 0.1);
        b.box('rubble', x - L + 0.1, 1.2, z - W + 0.1, x + L - 0.1, 1.9, z + W - 0.1); // coal
    } else {
        b.box('metal', x - L, 1.05, z - 0.2, x + L, 1.25, z + 0.2);
        b.box('metal', x - L + 0.2, 1.25, z - 1.1, x + L - 0.2, 3.25, z + 1.1); // the tank
        b.box('metal', x - 0.4, 3.25, z - 0.4, x + 0.4, 3.55, z + 0.4); // its dome
    }
}

function station(b: LevelBuilder): void {
    const P = PLATFORM;
    b.box('concrete', P.x0, 0, P.z0, P.x1, P.y, P.z1);
    b.decal('marking', P.x0, P.z0 + 0.1, P.x1, P.z0 + 0.4, P.y); // the platform edge's line
    // the canopy over the platform, on two rows of columns, high enough to clear the coaches beside it
    const C = { x0: -45, x1: 20, z0: P.z0 + 0.4, z1: P.z1, y: 3.6 };
    b.box('concrete-dark', C.x0, C.y, C.z0, C.x1, C.y + 0.15, C.z1);
    for (let x = C.x0 + 1; x < C.x1; x += 6.5) for (const z of [P.z0 + 2.1, P.z1 - 0.3]) b.block('metal', x, z, 0.2, 0.2, P.y, C.y - P.y);
    // the station building under its back half
    b.box('brick', -30, P.y, P.z1 - 3, -5, C.y, P.z1);
    // the loco's water tower at the platform's west end: a tank on four legs
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) b.block('metal', -80 + dx, STATION_Z + 6 + dz, 0.3, 0.3, 0, 5);
    b.box('rust', -82.2, 5, STATION_Z + 3.8, -77.8, 7.5, STATION_Z + 8.2);
    // semaphore signals either side of the station, on the driver's left (British railways run on the left)
    for (const x of [70, -100]) {
        b.block('metal', x, STATION_Z + 2.8, 0.25, 0.25, 0, 7);
        b.box('container-a', x - 0.03, 6.2, STATION_Z + 1.6, x + 0.03, 6.5, STATION_Z + 2.7);
    }
}

function goodsYard(b: LevelBuilder): void {
    // the yard's ballast, one bed for every siding
    b.box('ballast', SIDING_END - 6, 0, STATION_Z - 3 * SIDING_PITCH - 3.5, 120, YARD_TOP, STATION_Z - 2);
    // a ladder of points off the main line at x 118, 1 in 8, and three sidings off it westwards to their buffer stops
    const x0 = 118;
    const xk = (k: number): number => x0 - 8 * SIDING_PITCH * k;
    track(b, straight(x0, STATION_Z, xk(3), STATION_Z - 3 * SIDING_PITCH), YARD_TOP);
    for (let k = 1; k <= 3; k++) {
        const z = STATION_Z - k * SIDING_PITCH;
        track(b, straight(xk(k), z, SIDING_END, z), YARD_TOP);
        b.box('container-a', SIDING_END - 0.4, YARD_TOP, z - 1.2, SIDING_END, 1.4, z + 1.2); // buffer stop
    }
    const s1 = STATION_Z - SIDING_PITCH, s2 = STATION_Z - 2 * SIDING_PITCH, s3 = STATION_Z - 3 * SIDING_PITCH;
    // wagons stand where the ladder is at least 3 m away
    for (const [k, x] of [['van', 52], ['van', 45.5], ['open', 33], ['open', 26.5], ['open', 20]] as const) wagon(b, k, x, s1);
    for (const [k, x] of [['tank', 15], ['tank', 8.5], ['van', -40], ['open', -52.5], ['open', -59]] as const) wagon(b, k, x, s2);
    // the engine shed over the third siding: brick side walls with windows, open at both ends, a roof with a smoke vent
    const ex0 = -116, ex1 = -86, h = 6.5;
    for (const side of [-1, 1]) {
        const z = s3 + side * 3;
        b.box('brick', ex0, YARD_TOP, z - 0.2, ex1, 1.5, z + 0.2);
        b.box('brick', ex0, 4.2, z - 0.2, ex1, h, z + 0.2);
        for (let x = ex0; x <= ex1 - 0.8; x += 6) b.box('brick', x, 1.5, z - 0.2, x + 0.8, 4.2, z + 0.2);
        b.box('brick', ex1 - 0.8, 1.5, z - 0.2, ex1, 4.2, z + 0.2);
        // the roof's half on this side of the vent
        const za = side < 0 ? s3 - 3.4 : s3 + 0.6, zb = side < 0 ? s3 - 0.6 : s3 + 3.4;
        b.box('metal', ex0 - 0.3, h, za, ex1 + 0.3, h + 0.2, zb);
    }
    // the vent's cap over the gap in the ridge, on posts
    b.box('metal', ex0 + 2, h + 1.4, s3 - 1.2, ex1 - 2, h + 1.6, s3 + 1.2);
    for (const x of [ex0 + 2.5, ex1 - 2.5]) for (const s of [-1, 1]) b.block('metal', x, s3 + s * 0.85, 0.15, 0.15, h + 0.2, 1.2);
}

/** Lay the railway: the loop's ballast, rails and sleepers, the hill and tunnel, the station and the goods yard. */
export function railway(b: LevelBuilder): void {
    const poses = loopPoses(3);
    extrude(b, 'ballast', poses, BALLAST);
    track(b, poses, BALLAST_TOP);
    hill(b);
    station(b);
    goodsYard(b);
    const rw: Railway = {
        corners: RAIL_CORNERS.map(([x, z]) => [x, z]), radius: RAIL_RADIUS, railTop: RAIL_TOP, stopX: STOP_X, stopZ: STATION_Z,
        tunnel: { x0: TUNNEL.x0, x1: TUNNEL.x1, z: TUNNEL.z, halfWidth: TUNNEL.halfWidth, crown: TUNNEL.crown }
    };
    b.railway = rw;
}
