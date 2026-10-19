// The railway (map v7, owner 2026-10-19: "a tunnel and a train that travels through a railyard, stops, then continues";
// map v8, the same day: "travel around the entire map ... pass through all the areas and even through the city, with
// another station inside the city"). One loop of standard-gauge track, 3.6 km round: the station and goods yard in the
// south-east fields, north through a tunnel under a hill south of the park, west past the park, the bando and the
// industrial yard, up a long gentle climb round the map's west edge, east across the whole city on a viaduct over a
// street (the city station halfway), and down round the east edge. The train that runs on it is packages/traffic
// train.ts; this file is the still part. Metres, north is -z, east +x, y up.
//
// The loop is a polygon of right-angle corners rounded to one radius (the same path as traffic route.ts pathThrough
// builds from Level.railway), drawn here with the same arithmetic: + - * /, Math.sqrt and sim-core's dmath sine and
// cosine, so every engine builds the same bytes.

import { dcos, dsin } from '@owfpv/sim-core';
import type { LevelBuilder, Material, Railway } from './builder';

/**
 * The loop's corners in the order the train runs them: north from the south-east fields (A to B), west past the park
 * and the bando (B to C), north outside the map's west edge (C to D), east across the city (D to E), south outside the
 * east edge (E to G), west through the station (G to A). Every corner is a 100 m curve: tight for a main line, usual
 * for a branch; a train takes it at no more than about 45 km/h [estimate].
 */
export const RAIL_CORNERS: [number, number][] = [[20, 475], [20, 100], [-610, 100], [-610, -250], [610, -250], [610, 475]];
export const RAIL_RADIUS = 100;

/** Standard gauge, m: 4 ft 8 1/2 in between the rails' inner faces. A rail head is about 7 cm wide [estimate]. */
const GAUGE = 1.435;
const RAIL_W = 0.07;
/** the rails' centre lines either side of the track's */
const RAIL_C = GAUGE / 2 + RAIL_W / 2;
/** the ballast's top above the ground, and how far the rails' top stands over the bed, m [estimates] */
export const BALLAST_TOP = 0.3;
export const RAIL_OVER_BED = 0.15;
/** sleepers: a British standard timber sleeper is 8 ft 6 in by 10 in (2.59 x 0.254 m), laid about 0.7 m apart [estimate] */
const SLEEPER_L = 2.59;
const SLEEPER_W = 0.254;
const SLEEPER_PITCH = 0.7;
/** the ballast's cross-section: its top 3 m wide, its shoulders sloping to the ground 4.8 m apart [estimates] */
const BALLAST: number[][] = [[-2.4, 0], [-1.5, BALLAST_TOP], [1.5, BALLAST_TOP], [2.4, 0]];

/**
 * The city viaduct: the deck's top 8.3 m up, 1.2 m deep and 5.2 m wide, so its underside (7.1 m) clears the traffic
 * lights' poles and mast arms (6 m, traffic network.ts) and the street lamps (7 m) [estimates: a steel girder deck]. It
 * stands over the street's centre line at z = -250, on piers mid-block only: the junctions under it stay open.
 */
const CITY_Z = -250;
const CITY_BED = 8.3;
const DECK = 1.2;
const DECK_HW = 2.6;
/** piers every 20 m along the viaduct; in the city only 18-62 m past a junction (junctions every 80 m from x = -480) */
const PIER_STEP = 20;
/** the climb up to the viaduct and down from it: 574 m each, 8 m: 1 in 72 [a gentle grade for a steam branch line] */
const RAMP = 574;
/** the height profile's eased bends, m */
const VCURVE = 80;

/** The tunnel: under the hill south of the park, on the line north from the fields (x 20), z 226 to 298 (72 m). */
const TUNNEL = { axis: 'z' as const, a0: 226, a1: 298, c: 20, halfWidth: 2.5, spring: 4, crown: 6.5 };
/** The hill: a round-topped mound 22 m high over an ellipse 120 m along the line and 80 m across [a made-up hill]. */
const HILL = { cu: 262, au: 60, av: 40, h: 22 };
/** The cutting each side of the tunnel: 7 m wide between stone retaining walls. */
const CUT = 3.5;

/** The ground station and goods yard, on the south straight (z 475, westbound), as built in map v7 but 260 m east. */
const OX = 260;
const STATION_Z = 475;
const PLATFORM = { x0: -62 + OX, x1: 42 + OX, z0: STATION_Z + 1.5, z1: STATION_Z + 7.5, y: 0.9 };
/** the goods yard's sidings north of the main line, 4.5 m between track centres [estimate], and their buffer stops */
const SIDING_PITCH = 4.5;
const SIDING_END = -118 + OX;
/** the yard's ballast, a little lower than the main line's so the two never overlap in one plane */
const YARD_TOP = 0.29;
/** The city station: on the viaduct from x 2 to 102, a platform each side; the train runs east. */
const CITY_STATION = { x0: 2, x1: 102 };

interface Pose {
    x: number;
    z: number;
    /** unit heading */
    hx: number;
    hz: number;
    /** the track bed's height here */
    y: number;
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

/** The pose u m into piece g (its y left at 0). */
function poseIn(g: Piece, u: number, rc: number): Pose {
    if (!g.arc) return { x: g.ax + g.dx * u, z: g.az + g.dz * u, hx: g.dx, hz: g.dz, y: 0 };
    const th = g.a0 + g.sweep * (u / g.len);
    const c = dcos(th), sn = dsin(th);
    const sg = g.sweep > 0 ? 1 : -1;
    return { x: g.cx + rc * c, z: g.cz + rc * sn, hx: -sn * sg, hz: c * sg, y: 0 };
}

/**
 * The track bed's height at distance s round the loop: straight between the profile's breakpoints, each bend eased as a
 * parabola over `curve` m centred on it (a railway's vertical curve). Only + - * / and Math.floor.
 */
export function bedAt(rw: Pick<Railway, 'profile' | 'curve' | 'length'>, s: number): number {
    return heightAndGrade(rw, s)[0];
}

/** The bed's grade (rise per metre run) at distance s round the loop. */
export function gradeAt(rw: Pick<Railway, 'profile' | 'curve' | 'length'>, s: number): number {
    return heightAndGrade(rw, s)[1];
}

function heightAndGrade(rw: Pick<Railway, 'profile' | 'curve' | 'length'>, s: number): [number, number] {
    const L = rw.length, p = rw.profile, half = rw.curve / 2;
    s = s - Math.floor(s / L) * L;
    const slope = (i: number): number => (p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]);
    for (let j = 1; j + 1 < p.length; j++) {
        const sj = p[j][0];
        if (s > sj - half && s < sj + half) {
            const g1 = slope(j - 1), g2 = slope(j);
            const t = s - sj + half;
            return [p[j][1] + g1 * (s - sj) + ((g2 - g1) * t * t) / (2 * rw.curve), g1 + ((g2 - g1) * t) / rw.curve];
        }
    }
    let i = 0;
    while (i + 2 < p.length && s >= p[i + 1][0]) i++;
    const g = slope(i);
    return [p[i][1] + g * (s - p[i][0]), g];
}

/** The loop's railway metadata (corners, length, height profile, stations, tunnel), as Level.railway holds it. */
export function railwayLayout(): Railway {
    const { pieces, length } = loopPieces(RAIL_CORNERS, RAIL_RADIUS);
    // the city straight (D to E) is piece 6; up to it along the line from 574 m before, down after it as far
    const city = pieces[6];
    // level from VCURVE / 2 before the city straight to as far after it, so the deck is flat over every junction
    const lv0 = city.s0 - VCURVE / 2, lv1 = city.s0 + city.len + VCURVE / 2;
    const up0 = lv0 - RAMP, down1 = lv1 + RAMP;
    const cityStop = city.s0 + (CITY_STATION.x1 - 5 - city.ax);
    return {
        corners: RAIL_CORNERS.map(([x, z]) => [x, z]), radius: RAIL_RADIUS, length,
        profile: [[0, BALLAST_TOP], [up0, BALLAST_TOP], [lv0, CITY_BED], [lv1, CITY_BED], [down1, BALLAST_TOP], [length, BALLAST_TOP]],
        curve: VCURVE,
        stops: [
            { name: 'Fields station', x: PLATFORM.x0 + 5, z: STATION_Z },
            { name: 'City station', x: city.ax + (cityStop - city.s0), z: CITY_Z }
        ],
        tunnel: { axis: TUNNEL.axis, a0: TUNNEL.a0, a1: TUNNEL.a1, c: TUNNEL.c, halfWidth: TUNNEL.halfWidth, crown: TUNNEL.crown }
    };
}

/** Poses along the whole loop, closed (the last is the first again), with the bed's height: every piece's ends, and every `step` m or less round the curves and wherever the bed is not flat on the ground. */
function loopPoses(rw: Railway, step: number, straightStep = Infinity): Pose[] {
    const { pieces } = loopPieces(rw.corners, rw.radius);
    const out: Pose[] = [];
    for (const g of pieces) {
        let n = Math.max(1, Math.ceil(g.len / (g.arc ? step : straightStep)));
        // a straight whose bed is not all on the ground (a ramp, the viaduct): in steps, so the deck follows the profile
        if (!g.arc && (bedAt(rw, g.s0) > BALLAST_TOP || bedAt(rw, g.s0 + g.len) > BALLAST_TOP || bedAt(rw, g.s0 + g.len / 2) > BALLAST_TOP)) n = Math.max(n, Math.ceil(g.len / 10));
        for (let k = 0; k < n; k++) {
            const u = (g.len * k) / n;
            const p = poseIn(g, u, rw.radius);
            p.y = bedAt(rw, g.s0 + u);
            out.push(p);
        }
    }
    out.push(out[0]);
    return out;
}

/** Track centre-line points every 2 m or less, for nearTrack. */
let dense: Pose[] | null = null;

/** Is (x, z) within d m of the loop's centre line? (things placed earlier keep off the track) */
export function nearTrack(x: number, z: number, d: number): boolean {
    dense ??= loopPoses(railwayLayout(), 2, 2);
    for (const p of dense) if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < d * d) return true;
    return false;
}

/** Is (x, z) under the hill (inside its footprint, grown by d m)? */
export function underHill(x: number, z: number, d: number): boolean {
    const u = (z - HILL.cu) / (HILL.au + d), v = (x - TUNNEL.c) / (HILL.av + d);
    return u * u + v * v < 1;
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
 * A cross-section swept along `poses`: `profile(pose)` gives its [across, y] points there (across: to the right of the
 * heading; the same number of points at every pose). One quad per profile edge between each pair of poses, wound away
 * from the section's middle.
 */
function extrude(b: LevelBuilder, m: Material, poses: Pose[], profile: (p: Pose) => number[][]): void {
    const at = (p: Pose, o: number, y: number): number[] => [p.x - p.hz * o, y, p.z + p.hx * o];
    for (let i = 0; i + 1 < poses.length; i++) {
        const p = poses[i], q = poses[i + 1];
        const pp = profile(p), pq = profile(q);
        let mo = 0, my = 0;
        for (const pr of [pp, pq]) for (const [o, y] of pr) { mo += o / (2 * pr.length); my += y / (2 * pr.length); }
        const mid: Pose = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, hx: (p.hx + q.hx) / 2, hz: (p.hz + q.hz) / 2, y: 0 };
        const c = at(mid, mo, my);
        for (let k = 0; k + 1 < pp.length; k++) {
            b.quadOut(m, c, at(p, pp[k][0], pp[k][1]), at(p, pp[k + 1][0], pp[k + 1][1]), at(q, pq[k + 1][0], pq[k + 1][1]), at(q, pq[k][0], pq[k][1]));
        }
    }
}

/** Both rails and the sleepers along `poses`, on the bed each pose's y gives (a straight run when it is two poses). */
function track(b: LevelBuilder, poses: Pose[]): void {
    const w = RAIL_W / 2;
    for (const o of [-RAIL_C, RAIL_C]) {
        extrude(b, 'rail', poses, (p) => [[o - w, p.y + 0.02], [o - w, p.y + RAIL_OVER_BED], [o + w, p.y + RAIL_OVER_BED], [o + w, p.y + 0.02]]);
    }
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
            const y = p.y + (q.y - p.y) * t + 0.02;
            const f = SLEEPER_W / 2, s = SLEEPER_L / 2;
            // corners (along, across), anticlockwise seen from above (as LevelBuilder.floor)
            const c = (a: number, o: number): number[] => [x + a * hx - o * hz, y, z + a * hz + o * hx];
            b.paintQuad('sleeper', c(-f, -s), c(-f, s), c(f, s), c(f, -s));
        }
        start += len;
    }
}

/** A straight piece of track on the ground from (x0, z0) to (x1, z1), its bed at y. */
function straight(x0: number, z0: number, x1: number, z1: number, y: number): Pose[] {
    const l = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
    const hx = (x1 - x0) / l, hz = (z1 - z0) / l;
    return [{ x: x0, z: z0, hx, hz, y }, { x: x1, z: z1, hx, hz, y }];
}

/** A box turned to the heading (hx, hz): `along` and `across` are half sizes, from y0 to y1. */
function turnedBox(b: LevelBuilder, m: Material, x: number, z: number, hx: number, hz: number, along: number, across: number, y0: number, y1: number): void {
    const c = (f: number, o: number, y: number): number[] => [x + f * hx - o * hz, y, z + f * hz + o * hx];
    const centre = [x, (y0 + y1) / 2, z];
    const face = (pts: number[][]): void => faceOut(b, m, centre, pts);
    face([c(-along, -across, y1), c(-along, across, y1), c(along, across, y1), c(along, -across, y1)]);
    face([c(-along, -across, y0), c(-along, across, y0), c(along, across, y0), c(along, -across, y0)]);
    for (const [f0, o0, f1, o1] of [[-along, -across, along, -across], [along, -across, along, across], [along, across, -along, across], [-along, across, -along, -across]]) {
        face([c(f0, o0, y0), c(f1, o1, y0), c(f1, o1, y1), c(f0, o0, y1)]);
    }
}

// ---------------------------------------------------------------- the line itself: ballast, viaduct, piers

/** The ballast where the bed is on the ground, the viaduct deck where it is up, the rails and sleepers all round. */
function line(b: LevelBuilder, rw: Railway): void {
    const poses = loopPoses(rw, 3);
    // runs of segments on the ground and in the air (a segment is in the air when either end is up); a run shares its
    // end pose with the next
    const up = (p: Pose): boolean => p.y > BALLAST_TOP + 1e-9;
    const air = (i: number): boolean => up(poses[i]) || up(poses[i + 1]);
    let start = 0;
    for (let i = 1; i <= poses.length - 1; i++) {
        if (i < poses.length - 1 && air(i) === air(start)) continue;
        const run = poses.slice(start, i + 1);
        if (air(start)) {
            extrude(b, 'concrete', run, (p) => {
                const bot = Math.max(0, p.y - DECK);
                return [[-DECK_HW, bot], [-DECK_HW, p.y], [DECK_HW, p.y], [DECK_HW, bot], [-DECK_HW, bot]];
            });
        } else extrude(b, 'ballast', run, () => BALLAST);
        start = i;
    }
    track(b, poses);
    piers(b, rw);
}

/** Piers under the viaduct every PIER_STEP m where it is high enough, kept out of the city's junctions. */
function piers(b: LevelBuilder, rw: Railway): void {
    const { pieces } = loopPieces(rw.corners, rw.radius);
    for (const g of pieces) for (let u = PIER_STEP / 2; u < g.len; u += PIER_STEP) {
        const s = g.s0 + u;
        const bot = bedAt(rw, s) - DECK;
        if (bot < 2) continue;
        const p = poseIn(g, u, rw.radius);
        if (p.x > -500 && p.x < 500 && p.z > -500 && p.z < -70) {
            // in the city: mid-block only, on the street's centre line (cars run 1.55 m and more from it)
            const k = p.x + 480 - Math.floor((p.x + 480) / 80) * 80;
            if (k < 18 || k > 62) continue;
        }
        turnedBox(b, 'concrete', p.x, p.z, p.hx, p.hz, 0.8, 0.5, 0, bot - 0.6);
        turnedBox(b, 'concrete', p.x, p.z, p.hx, p.hz, 0.8, 2.4, bot - 0.6, bot);
    }
}

// ---------------------------------------------------------------- the hill and its tunnel

/** The hill's height at u along the tunnel's axis and v across it (from the tunnel's line). */
function hillH(u: number, v: number): number {
    const a = (u - HILL.cu) / HILL.au, c = v / HILL.av;
    const d = Math.sqrt(a * a + c * c);
    return d >= 1 ? 0 : HILL.h * (0.5 + 0.5 * dcos(Math.PI * d));
}

/** A point given along the tunnel (u), up (y) and across it (v), in the world (the tunnel runs along z at x = c). */
const W = (u: number, y: number, v: number): number[] => [TUNNEL.c + v, y, u];

/** Is the cell from u0 to u1 inside the cutting (the corridor beyond the portals, cut down to the ground)? */
const inCut = (u0: number, u1: number, v0: number, v1: number): boolean =>
    v0 >= -CUT && v1 <= CUT && (u1 <= TUNNEL.a0 + 1 || u0 >= TUNNEL.a1 - 1);

/**
 * The hill: a grass height field on a 5 m grid (with lines at the cutting's walls), its surface only, as every solid in
 * this map is a shell. The track's corridor is cut down to the ground beyond the portals between stone retaining walls;
 * the tunnel is a stone-lined bore with a headwall at each end.
 */
function hill(b: LevelBuilder): void {
    const us: number[] = [];
    for (let u = HILL.cu - HILL.au; u <= HILL.cu + HILL.au; u += 5) us.push(u);
    const vs: number[] = [];
    for (let v = -HILL.av; v <= HILL.av; v += 5) vs.push(v);
    vs.push(-CUT, CUT);
    vs.sort((a, c) => a - c);
    for (let i = 0; i + 1 < us.length; i++) for (let j = 0; j + 1 < vs.length; j++) {
        const u0 = us[i], u1 = us[i + 1], v0 = vs[j], v1 = vs[j + 1];
        if (inCut(u0, u1, v0, v1)) continue;
        const a = W(u0, hillH(u0, v0), v0), p = W(u0, hillH(u0, v1), v1), c = W(u1, hillH(u1, v1), v1), d = W(u1, hillH(u1, v0), v0);
        // each triangle faces up (away from a point under it); triangles lying flat on the ground are left to the ground
        for (const t of [[a, p, c], [a, c, d]]) {
            if (t[0][1] <= 0 && t[1][1] <= 0 && t[2][1] <= 0) continue;
            faceOut(b, 'grass', [(t[0][0] + t[1][0] + t[2][0]) / 3, -10, (t[0][2] + t[1][2] + t[2][2]) / 3], t);
        }
    }
    // the cutting's retaining walls, from the ground up to the hill's surface at the corridor's edge, facing the track
    for (let i = 0; i + 1 < us.length; i++) {
        const u0 = us[i], u1 = us[i + 1];
        if (!inCut(u0, u1, -CUT, CUT)) continue;
        for (const side of [-1, 1]) {
            const v = side * CUT;
            const ha = hillH(u0, v), hb = hillH(u1, v);
            if (ha <= 0 && hb <= 0) continue;
            const pts: number[][] = [W(u0, 0, v), W(u1, 0, v)];
            if (hb > 0) pts.push(W(u1, hb, v));
            if (ha > 0) pts.push(W(u0, ha, v));
            faceOut(b, 'stone', W((u0 + u1) / 2, 1, v + side), pts);
        }
    }
    tunnelBore(b);
    for (const [u, out] of [[TUNNEL.a0, -1], [TUNNEL.a1, 1]]) headwall(b, u, out);
}

/** The bore's arch: points (v, y) from one springing over the crown to the other. */
function archPoints(): number[][] {
    const N = 12;
    const r = TUNNEL.halfWidth;
    const pts: number[][] = [];
    for (let k = 0; k <= N; k++) {
        const th = Math.PI - (k * Math.PI) / N;
        pts.push([r * dcos(th), TUNNEL.spring + r * dsin(th)]);
    }
    return pts;
}

/** The stone lining from portal to portal: two walls to the springing and the arch, all facing in; a ballast floor. */
function tunnelBore(b: LevelBuilder): void {
    const { a0, a1, halfWidth: w, spring } = TUNNEL;
    const um = (a0 + a1) / 2;
    for (const side of [-1, 1]) {
        const v = side * w;
        faceOut(b, 'stone', W(um, spring / 2, v + side), [W(a0, 0, v), W(a1, 0, v), W(a1, spring, v), W(a0, spring, v)]);
    }
    const arch = archPoints();
    for (let k = 0; k + 1 < arch.length; k++) {
        const [va, ya] = arch[k], [vb, yb] = arch[k + 1];
        const vc = (va + vb) / 2, yc = (ya + yb) / 2;
        // the outward side: away from the arch's centre
        faceOut(b, 'stone', W(um, yc + (yc - spring), vc + vc), [W(a0, ya, va), W(a0, yb, vb), W(a1, yb, vb), W(a1, ya, va)]);
    }
    const p = W(a0, 0, -w), q = W(a1, 0.05, w);
    b.box('ballast', Math.min(p[0], q[0]), 0, Math.min(p[2], q[2]), Math.max(p[0], q[0]), 0.05, Math.max(p[2], q[2]));
}

/** A portal's headwall: 1 m of stone standing out of the hill into the cutting, the bore through it, a parapet on top. */
function headwall(b: LevelBuilder, uo: number, out: number): void {
    const w = TUNNEL.halfWidth;
    const ui = uo - out; // its back, 1 m into the hill
    const T = Math.max(hillH(ui, -CUT), hillH(ui, 0), hillH(ui, CUT)) + 0.8;
    const inside = W(uo - out * 0.5, T / 2, 0);
    const face = (pts: number[][]): void => faceOut(b, 'stone', inside, pts);
    // the outer face: a pier each side of the bore, and the stone over the arch in strips, one per arch segment
    face([W(uo, 0, -CUT), W(uo, 0, -w), W(uo, T, -w), W(uo, T, -CUT)]);
    face([W(uo, 0, w), W(uo, 0, CUT), W(uo, T, CUT), W(uo, T, w)]);
    const arch = archPoints();
    for (let k = 0; k + 1 < arch.length; k++) {
        const [va, ya] = arch[k], [vb, yb] = arch[k + 1];
        face([W(uo, ya, va), W(uo, yb, vb), W(uo, T, vb), W(uo, T, va)]);
    }
    // its top, its ends, and its back where the parapet stands above the hill
    face([W(uo, T, -CUT), W(uo, T, CUT), W(ui, T, CUT), W(ui, T, -CUT)]);
    for (const v of [-CUT, CUT]) face([W(uo, 0, v), W(ui, 0, v), W(ui, T, v), W(uo, T, v)]);
    const back = Math.min(hillH(ui, -CUT), hillH(ui, 0), hillH(ui, CUT)) - 1;
    face([W(ui, back, -CUT), W(ui, back, CUT), W(ui, T, CUT), W(ui, T, -CUT)]);
}

// ---------------------------------------------------------------- the stations and the goods yard

/** A goods wagon standing on a siding at (x, z): a van, an open wagon with coal, or a tank wagon, 6 m over the body [estimates]. */
function wagon(b: LevelBuilder, kind: 'van' | 'open' | 'tank', x: number, z: number): void {
    const L = 3, W2 = 1.25;
    const top = BALLAST_TOP + RAIL_OVER_BED;
    // underframe and wheels, as one dark block between the rails' tops and the floor
    b.box('rail', x - L + 0.3, top, z - 1.0, x + L - 0.3, 1.05, z + 1.0);
    if (kind === 'van') {
        b.box('wagon', x - L, 1.05, z - W2, x + L, 3.3, z + W2);
        b.box('wagon', x - L + 0.1, 3.3, z - W2 + 0.25, x + L - 0.1, 3.5, z + W2 - 0.25); // the roof's crown
    } else if (kind === 'open') {
        b.box('wood', x - L, 1.05, z - W2, x + L, 1.2, z + W2); // floor
        for (const s of [-1, 1]) b.box('wood', x - L, 1.2, z + s * W2 - (s > 0 ? 0.1 : 0), x + L, 2.2, z + s * W2 + (s < 0 ? 0.1 : 0));
        for (const s of [-1, 1]) b.box('wood', x + s * L - (s > 0 ? 0.1 : 0), 1.2, z - W2 + 0.1, x + s * L + (s < 0 ? 0.1 : 0), 2.2, z + W2 - 0.1);
        b.box('rubble', x - L + 0.1, 1.2, z - W2 + 0.1, x + L - 0.1, 1.9, z + W2 - 0.1); // coal
    } else {
        b.box('metal', x - L, 1.05, z - 0.2, x + L, 1.25, z + 0.2);
        b.box('metal', x - L + 0.2, 1.25, z - 1.1, x + L - 0.2, 3.25, z + 1.1); // the tank
        b.box('metal', x - 0.4, 3.25, z - 0.4, x + 0.4, 3.55, z + 0.4); // its dome
    }
}

/** The fields station: platform, canopy, building, the engines' water tower, semaphore signals. */
function fieldsStation(b: LevelBuilder): void {
    const P = PLATFORM;
    b.box('concrete', P.x0, 0, P.z0, P.x1, P.y, P.z1);
    b.decal('marking', P.x0, P.z0 + 0.1, P.x1, P.z0 + 0.4, P.y); // the platform edge's line
    // the canopy over the platform, on two rows of columns, high enough to clear the coaches beside it
    const C = { x0: -45 + OX, x1: 20 + OX, z0: P.z0 + 0.4, z1: P.z1, y: 4.3 };
    b.box('concrete-dark', C.x0, C.y, C.z0, C.x1, C.y + 0.15, C.z1);
    for (let x = C.x0 + 1; x < C.x1; x += 6.5) for (const z of [P.z0 + 2.1, P.z1 - 0.3]) b.block('metal', x, z, 0.2, 0.2, P.y, C.y - P.y);
    // the station building under its back half
    b.box('brick', -30 + OX, P.y, P.z1 - 3, -5 + OX, C.y, P.z1);
    // the engines' water tower at the platform's west end: a tank on four legs
    const wx = -80 + OX;
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) b.block('metal', wx + dx, STATION_Z + 6 + dz, 0.3, 0.3, 0, 5);
    b.box('rust', wx - 2.2, 5, STATION_Z + 3.8, wx + 2.2, 7.5, STATION_Z + 8.2);
    // semaphore signals either side of the station, on the driver's left (British railways run on the left)
    for (const x of [70 + OX, -100 + OX]) {
        b.block('metal', x, STATION_Z + 2.8, 0.25, 0.25, 0, 7);
        b.box('container-a', x - 0.03, 6.2, STATION_Z + 1.6, x + 0.03, 6.5, STATION_Z + 2.7);
    }
}

function goodsYard(b: LevelBuilder): void {
    // the yard's ballast, one bed for every siding
    b.box('ballast', SIDING_END - 6, 0, STATION_Z - 3 * SIDING_PITCH - 3.5, 120 + OX, YARD_TOP, STATION_Z - 2);
    // a ladder of points off the main line, 1 in 8, and three sidings off it westwards to their buffer stops
    const x0 = 118 + OX;
    const xk = (k: number): number => x0 - 8 * SIDING_PITCH * k;
    track(b, straight(x0, STATION_Z, xk(3), STATION_Z - 3 * SIDING_PITCH, YARD_TOP));
    for (let k = 1; k <= 3; k++) {
        const z = STATION_Z - k * SIDING_PITCH;
        track(b, straight(xk(k), z, SIDING_END, z, YARD_TOP));
        b.box('container-a', SIDING_END - 0.4, YARD_TOP, z - 1.2, SIDING_END, 1.4, z + 1.2); // buffer stop
    }
    const s1 = STATION_Z - SIDING_PITCH, s2 = STATION_Z - 2 * SIDING_PITCH, s3 = STATION_Z - 3 * SIDING_PITCH;
    // wagons stand where the ladder is at least 3 m away
    for (const [k, x] of [['van', 52], ['van', 45.5], ['open', 33], ['open', 26.5], ['open', 20]] as const) wagon(b, k, x + OX, s1);
    for (const [k, x] of [['tank', 15], ['tank', 8.5], ['van', -40], ['open', -52.5], ['open', -59]] as const) wagon(b, k, x + OX, s2);
    // the engine shed over the third siding: brick side walls with windows, open at both ends, a roof with a smoke vent
    const ex0 = -116 + OX, ex1 = -86 + OX, h = 6.5;
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

/**
 * The city station, up on the viaduct over the street: a platform each side of the track (their edges 1.5 m from it, the
 * tops 0.45 m over the rails, as at the fields station), a canopy over each on a row of columns along its outer edge.
 */
function cityStation(b: LevelBuilder): void {
    const { x0, x1 } = CITY_STATION;
    const z = CITY_Z, top = CITY_BED + RAIL_OVER_BED + 0.45, bot = CITY_BED - DECK;
    for (const side of [-1, 1]) {
        const za = z + side * 1.5, zb = z + side * 5;
        b.box('concrete', x0, bot, Math.min(za, zb), x1, top, Math.max(za, zb));
        const edge = z + side * 1.6;
        b.decal('marking', x0, Math.min(edge, edge + side * 0.3), x1, Math.max(edge, edge + side * 0.3), top);
        // the canopy: 3.1 m over the platform, from 1.9 to 5 m out from the track
        const ca = z + side * 1.9, cb = z + side * 5;
        b.box('concrete-dark', 20, top + 3.1, Math.min(ca, cb), 85, top + 3.25, Math.max(ca, cb));
        for (let x = 21; x < 85; x += 6.5) b.block('metal', x, z + side * 4.7, 0.2, 0.2, top, 3.1);
        // a waiting shelter at the platform's back
        b.box('brick', 40, top, Math.min(z + side * 4.0, z + side * 5), 52, top + 2.6, Math.max(z + side * 4.0, z + side * 5));
    }
}

/** Lay the railway: the line (ballast, viaduct, rails, sleepers, piers), the hill and tunnel, both stations, the goods yard. */
export function railway(b: LevelBuilder): void {
    const rw = railwayLayout();
    line(b, rw);
    hill(b);
    fieldsStation(b);
    goodsYard(b);
    cityStation(b);
    b.railway = rw;
}
