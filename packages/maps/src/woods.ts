// Trees you can fly through and around, and the woods they make (map v10; owner, 2026-10-19: "larger multi branch trees
// so you can fly through and around them, a forest area where you could fly through dense and sparse areas", and the
// tree lines "spread out and more random").
//
// Three kinds, after common European trees [shapes and sizes are estimates, typical of mature trees]:
// - a broadleaf (oak, beech, lime): 13-19 m, a trunk that forks into 4-6 limbs, each ending in one or two clumps of
//   leaves, with open space inside the crown between the limbs. Grown in the open its crown starts low and spreads
//   wide; in a wood it starts at about 40 % of its height (the shaded lower branches die off), so you fly under it.
// - a spruce: 15-23 m, tiers of foliage down to 1.5-3 m in the open, higher in a thicket.
// - a pine: 16-22 m, a tall bare trunk with a small crown of flat clumps at the top.
// Plus dead standing trees (snags), fallen trees, stumps and log piles in the forest.
//
// Every surface is solid, leaves too (a quad that flies into a clump of leaves hits the twigs in it). The gaps between
// the clumps are real gaps. Angles come from sim-core's dsin and dcos, so every engine builds the same bytes.

import { dcos, dsin } from '@owfpv/sim-core';
import { LevelBuilder } from './builder';
import type { Material, Rng } from './builder';
import { onWayOut } from './links';
import { nearTrack, underHill } from './railway';

const DEG = Math.PI / 180;

export type TreeKind = 'broadleaf' | 'spruce' | 'pine';

/** How far a tree of this kind and scale can reach from its trunk on the ground plan, m (to keep it off things). */
export function crownReach(kind: TreeKind, s: number, open: boolean): number {
    if (kind === 'broadleaf') return (open ? 10 : 8.5) * s;
    if (kind === 'spruce') return 4.1 * s;
    return 5 * s;
}

/**
 * A broadleaf tree at (x, z), scale s (1: 13-19 m tall). `open`: grown in the open (a low, wide crown); else grown in
 * a wood (a high, narrower crown over a clear trunk).
 */
export function broadleaf(b: LevelBuilder, r: Rng, x: number, z: number, s = 1, open = true, leaves: Material = 'foliage'): Crown {
    const H = (13 + r.int(0, 60) / 10) * s;
    const fork = open ? (3 + r.int(0, 20) / 10) * s : H * (0.38 + r.int(0, 10) / 100);
    const lead = 0.74 * H;
    const lx = (r.int(-5, 5) / 10) * s, lz = (r.int(-5, 5) / 10) * s;
    b.prism('trunk', x, z, 0, fork + 0.4 * s, 0.38 * s, 6);
    b.bar('trunk', [x, fork, z], [x + lx, lead + 0.6 * s, z + lz], 0.32 * s);
    const n = r.int(4, 6);
    const a0 = r.int(0, 359);
    const limbs: [number, number][] = [];
    for (let k = 0; k < n; k++) {
        const t = k / n; // 0 for the lowest limb
        const th = (a0 + k * (360 / n) + r.int(-18, 18)) * DEG;
        const ys = fork + (lead - fork) * t * 0.8;
        const f = (ys - fork) / (lead - fork);
        const px = x + lx * f, pz = z + lz * f;
        const el = (28 + t * 30 + r.int(0, 14)) * DEG;
        const len = (open ? 5.4 : 4.2) * s * (1 - 0.3 * t) * (0.85 + r.int(0, 30) / 100);
        const c = dcos(el), sn = dsin(el), ct = dcos(th), st = dsin(th);
        const ex = px + len * c * ct, ey = ys + len * sn, ez = pz + len * c * st;
        b.bar('trunk', [px, ys, pz], [ex, ey, ez], 0.22 * s);
        limbs.push([th, ys]);
        const cr = (2.1 + r.int(0, 8) / 10) * s;
        if (r.chance(1, 2)) {
            // the limb forks into two branches, a clump on each
            for (const side of [-1, 1]) {
                const tt = th + side * 0.55;
                const tl = 1.8 * s;
                const tx = ex + tl * 0.75 * dcos(tt), ty = ey + tl * 0.65, tz = ez + tl * 0.75 * dsin(tt);
                b.bar('trunk', [ex, ey, ez], [tx, ty, tz], 0.13 * s);
                b.blob(leaves, tx, ty + 0.4 * s, tz, cr * 0.85, cr * 0.75, 6);
            }
        } else b.blob(leaves, ex, ey + 0.4 * s, ez, cr, cr * 0.8, 6);
    }
    // the leader's own clump at the top
    b.blob(leaves, x + lx, lead + 1.8 * s, z + lz, 3 * s, 2.4 * s, 8);
    return { fork, lead, lx, lz, limbs };
}

/** A broadleaf's crown, for finding a gap inside it: the fork's and the leader's heights, the leader's lean, each limb's heading and height. */
export interface Crown {
    fork: number;
    lead: number;
    lx: number;
    lz: number;
    limbs: [number, number][];
}

/**
 * A point inside a broadleaf's crown, `out` m off its leader, at height y: on the heading furthest from every limb that
 * leaves the leader within 3 m of y (in whole degrees, so every engine picks the same one).
 */
function inCrown(c: Crown, x: number, z: number, y: number, out: number): [number, number, number] {
    let best = 0, bestGap = -1;
    for (let a = 0; a < 360; a++) {
        let gap = 360;
        for (const [th, ys] of c.limbs) {
            if (Math.abs(ys - y) > 3) continue;
            let d = Math.abs(a - th / DEG) % 360;
            if (d > 180) d = 360 - d;
            gap = Math.min(gap, d);
        }
        if (gap > bestGap) { bestGap = gap; best = a; }
    }
    const f = (y - c.fork) / (c.lead - c.fork);
    return [x + c.lx * f + out * dcos(best * DEG), y, z + c.lz * f + out * dsin(best * DEG)];
}

/** A spruce at (x, z), scale s (1: 15-23 m), its lowest tier `low` m (times s) up. */
export function spruce(b: LevelBuilder, r: Rng, x: number, z: number, s = 1, low = 1.5): void {
    const H = (15 + r.int(0, 80) / 10) * s;
    const base = (low + r.int(0, 15) / 10) * s;
    const R = (3 + r.int(0, 10) / 10) * s;
    b.prism('trunk', x, z, 0, H * 0.85, 0.28 * s, 6);
    const span = H - base;
    for (let k = 0; k < 4; k++) {
        const y0 = base + span * k * 0.22;
        const y1 = k === 3 ? H : y0 + span * 0.36;
        b.cone('foliage-dark', x, z, y0, y1, R * (1 - k * 0.2), 6);
    }
}

/** A pine at (x, z), scale s (1: 16-22 m): a bare trunk to about 60 % of its height, a crown of flat clumps on top. */
export function pine(b: LevelBuilder, r: Rng, x: number, z: number, s = 1): void {
    const H = (16 + r.int(0, 60) / 10) * s;
    const clear = H * (0.58 + r.int(0, 8) / 100);
    const lx = (r.int(-10, 10) / 10) * s, lz = (r.int(-10, 10) / 10) * s;
    b.prism('trunk', x, z, 0, clear * 0.5, 0.3 * s, 6);
    b.bar('trunk', [x, clear * 0.5 - 0.2, z], [x + lx, H - 1.5 * s, z + lz], 0.26 * s);
    const n = r.int(3, 4);
    const a0 = r.int(0, 359);
    for (let k = 0; k < n; k++) {
        const th = (a0 + k * (360 / n) + r.int(-25, 25)) * DEG;
        const y = clear + (H - clear) * (0.15 + 0.6 * k / n);
        const f = y / H;
        const cx = x + lx * f, cz = z + lz * f;
        const d = (1.6 + r.int(0, 12) / 10) * s;
        const ex = cx + d * dcos(th), ez = cz + d * dsin(th);
        b.bar('trunk', [cx, y - 0.6 * s, cz], [ex, y, ez], 0.14 * s);
        const cr = (1.8 + r.int(0, 8) / 10) * s;
        b.blob('foliage-dark', ex, y + 0.2 * s, ez, cr, cr * 0.45, 6);
    }
    b.blob('foliage-dark', x + lx, H - 0.8 * s, z + lz, 1.8 * s, 1.1 * s, 6);
}

/** A dead tree still standing: a broken-off trunk 7-12 m tall and two or three bare limbs. */
export function snag(b: LevelBuilder, r: Rng, x: number, z: number): void {
    const H = 7 + r.int(0, 50) / 10;
    b.prism('trunk', x, z, 0, H, 0.32, 6);
    const n = r.int(2, 3);
    const a0 = r.int(0, 359);
    for (let k = 0; k < n; k++) {
        const th = (a0 + k * (360 / n) + r.int(-30, 30)) * DEG;
        const ys = H * (0.45 + 0.4 * k / n);
        const len = 2.5 + r.int(0, 20) / 10;
        b.bar('trunk', [x, ys, z], [x + len * 0.8 * dcos(th), ys + len * 0.6, z + len * 0.8 * dsin(th)], 0.16);
    }
}

/**
 * A fallen tree lying from its root end at (x, z) along heading th (radians), len m long: its root plate (a lump of
 * earth torn up with it) holds that end 1 m up, the top end lies on the ground.
 */
export function fallenTree(b: LevelBuilder, x: number, z: number, th: number, len: number, rootUp = 1.0, topUp = 0.3): void {
    const ex = x + len * dcos(th), ez = z + len * dsin(th);
    b.bar('trunk', [x, rootUp, z], [ex, topUp, ez], 0.55);
    b.blob('rubble', x - 0.6 * dcos(th), rootUp, z - 0.6 * dsin(th), 1.5, 1.3, 6);
    // two dead limbs off the top half, sticking up
    for (const [f, side] of [[0.55, 1], [0.75, -1]]) {
        const px = x + (ex - x) * f, pz = z + (ez - z) * f, py = rootUp + (topUp - rootUp) * f;
        b.bar('trunk', [px, py, pz], [px + 1.6 * dcos(th + side * 1.1), py + 1.8, pz + 1.6 * dsin(th + side * 1.1)], 0.14);
    }
}

/** A bush or a young tree in the undergrowth: one rounded clump 1-1.8 m across its radius, on the ground. */
export function bush(b: LevelBuilder, r: Rng, x: number, z: number): void {
    const rad = 1 + r.int(0, 8) / 10;
    const ry = rad * (0.7 + r.int(0, 3) / 10);
    b.blob(r.chance(1, 3) ? 'foliage-light' : 'foliage', x, ry * 0.85, z, rad, ry, 6);
}

/** A stump: a tree felled 0.3-0.7 m up. */
export function stump(b: LevelBuilder, r: Rng, x: number, z: number): void {
    b.prism('trunk', x, z, 0, 0.3 + r.int(0, 4) / 10, 0.32 + r.int(0, 20) / 100, 8);
}

/** A pile of cut logs lying along x: 4, 3, 2 and 1 logs of 0.4 m stacked up, 6 m long, from (x, z). */
export function logPile(b: LevelBuilder, x: number, z: number): void {
    for (let row = 0; row < 4; row++) for (let k = 0; k < 4 - row; k++) {
        const zz = z + (row * 0.5 + k) * 0.42;
        b.box('trunk', x, row * 0.36, zz, x + 6, row * 0.36 + 0.4, zz + 0.4);
    }
}

// ---------------------------------------------------------------- placing them

/** A grid of what has been planted, for "is anything within d m?" without looking at every tree. */
class Planted {
    private readonly cells = new Map<string, number[]>();
    private static readonly C = 8;
    add(x: number, z: number): void {
        const k = `${Math.floor(x / Planted.C)},${Math.floor(z / Planted.C)}`;
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(x, z);
    }
    near(x: number, z: number, d: number): boolean {
        const C = Planted.C;
        const n = Math.ceil(d / C);
        const ci = Math.floor(x / C), cj = Math.floor(z / C);
        for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
            const a = this.cells.get(`${i},${j}`);
            if (!a) continue;
            for (let q = 0; q < a.length; q += 2) {
                const dx = a[q] - x, dz = a[q + 1] - z;
                if (dx * dx + dz * dz < d * d) return true;
            }
        }
        return false;
    }
}

/** Distance from (x, z) to the polyline `pts`, m. */
function toLine(pts: readonly (readonly [number, number])[], x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const ux = bx - ax, uz = bz - az;
        const l2 = ux * ux + uz * uz;
        let t = ((x - ax) * ux + (z - az) * uz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = ax + ux * t - x, dz = az + uz * t - z;
        best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
    }
    return best;
}

/** Keep trees off the railway and its hill: is a tree reaching `reach` m from (x, z) clear of them? */
function clearOfRailway(x: number, z: number, reach: number): boolean {
    return !nearTrack(x, z, reach + 3) && !underHill(x, z, reach);
}

/** A place for a golden prop, found while the woods were planted. */
export interface WoodSpot {
    x: number;
    y: number;
    z: number;
    spot: string;
}

/** The forest's ground plan (m): where it grows, its track, its clearing, and the thickets in it. */
export const FOREST = { x0: 112, x1: 492, z0: 288, z1: 450 };
/** The forest track, from the fields north of it, through the clearing, out at its east end (centre line points). */
export const FOREST_TRACK: [number, number][] = [[176, 280], [196, 318], [232, 346], [276, 362], [304, 370], [346, 392], [404, 404], [452, 398], [500, 404]];
const TRACK_HW = 2;
/** The clearing round the old felling site (where the hay bales stood on map v9), its lone oak in the middle. */
export const CLEARING = { x: 300, z: 372, r: 24 };
/**
 * Where a fallen tree lies across the track (its centre line at z 404 here): its root end 11 m north of it, 1.6 m up
 * on its root plate, its top hung up on a stump 8 m south, so there is a way under it about 1.1 m high.
 */
const ACROSS = { x: 404, z: 404 };
/** how far round the thickest spot no tree stands: the gap the tree that fell there left in the canopy */
const GAP_R = 7;

/**
 * The forest in the south-east fields, between the water tower and the fields station (map v10): thickets where the
 * trees stand 4.5 m apart (spruce, a few pines and broadleaves grown tall and thin, the canopy closed overhead) and open
 * woodland between them where they stand 14 m or more apart (big broadleaves and pines), thinning out at the edges.
 * A dirt track winds through it to a clearing with stumps, log piles and one big open-grown oak. Fallen and dead trees
 * here and there. Returns the spots for its golden props.
 */
export function forest(b: LevelBuilder, r: Rng): WoodSpot[] {
    const F = FOREST;
    // the thickets: centre and radius, drawn first
    const thickets: [number, number, number][] = [];
    for (let k = 0; k < 7; k++) thickets.push([F.x0 + 40 + r.int(0, F.x1 - F.x0 - 80), F.z0 + 30 + r.int(0, F.z1 - F.z0 - 60), 34 + r.int(0, 28)]);
    /** 0 in the open woodland, up to 1 in the middle of a thicket */
    const density = (x: number, z: number): number => {
        let d = 0;
        for (const [cx, cz, R] of thickets) {
            const q = 1 - Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz)) / R;
            if (q > d) d = q;
        }
        return d;
    };
    // the deepest spot of the first thicket: its golden prop stands in a small gap kept there
    const [hx, hz] = [thickets[0][0], thickets[0][1]];
    const hollowFree = toLine(FOREST_TRACK, hx, hz) > GAP_R + 6 && Math.sqrt((hx - CLEARING.x) ** 2 + (hz - CLEARING.z) ** 2) > CLEARING.r + GAP_R + 6;
    const inGap = (x: number, z: number, d: number): boolean => hollowFree && (x - hx) * (x - hx) + (z - hz) * (z - hz) < (GAP_R + d) * (GAP_R + d);
    const planted = new Planted();
    // the track: a dirt path painted on the grass, segment by segment
    for (let i = 0; i + 1 < FOREST_TRACK.length; i++) {
        const [ax, az] = FOREST_TRACK[i], [bx, bz] = FOREST_TRACK[i + 1];
        const l = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);
        const nx = -(bz - az) / l * TRACK_HW, nz = (bx - ax) / l * TRACK_HW;
        // a little past each end, so the joints overlap
        const ex = (bx - ax) / l * 1.2, ez = (bz - az) / l * 1.2;
        b.paintQuad('path', [ax - ex + nx, 0.02, az - ez + nz], [bx + ex + nx, 0.02, bz + ez + nz], [bx + ex - nx, 0.02, bz + ez - nz], [ax - ex - nx, 0.02, az - ez - nz]);
    }
    // the clearing: the lone oak, stumps, two log piles
    const oak = broadleaf(b, r, CLEARING.x, CLEARING.z, 1.35, true);
    planted.add(CLEARING.x, CLEARING.z);
    for (let k = 0; k < 18; k++) {
        const x = CLEARING.x - CLEARING.r + r.int(0, 2 * CLEARING.r), z = CLEARING.z - CLEARING.r + r.int(0, 2 * CLEARING.r);
        const d = Math.sqrt((x - CLEARING.x) ** 2 + (z - CLEARING.z) ** 2);
        if (d > CLEARING.r - 1 || d < 12 || toLine(FOREST_TRACK, x, z) < TRACK_HW + 1) continue;
        stump(b, r, x, z);
    }
    logPile(b, CLEARING.x - 16, CLEARING.z + 9);
    logPile(b, CLEARING.x + 8, CLEARING.z - 20);
    // the tree across the track, its root end north of it
    fallenTree(b, ACROSS.x, ACROSS.z - 11, 90 * DEG, 19, 1.6, 1.3);
    b.prism('trunk', ACROSS.x, ACROSS.z + 7.6, 0, 1.0, 0.4, 8);
    // the tree that fell in the thickest spot, from its middle eastwards
    if (hollowFree) fallenTree(b, hx + 2, hz, 0, 13, 1.0);
    // the trees: darts thrown at the ground plan, each kept clear of the ones before by the spacing where it lands
    let n = 0;
    for (let k = 0; k < 9000; k++) {
        const x = F.x0 + r.int(0, (F.x1 - F.x0) * 2) / 2;
        const z = F.z0 + r.int(0, (F.z1 - F.z0) * 2) / 2;
        const u = r.int(0, 99);
        const v = r.int(0, 99);
        const d = density(x, z);
        const edge = Math.min(x - F.x0, F.x1 - x, z - F.z0, F.z1 - z);
        const gap = 11 - 7 * Math.min(1, d * 1.6) + (edge < 18 ? (18 - edge) * 0.5 : 0) + (v % 4);
        if (planted.near(x, z, gap)) continue;
        if (toLine(FOREST_TRACK, x, z) < TRACK_HW + 2.5) continue;
        if (Math.sqrt((x - CLEARING.x) ** 2 + (z - CLEARING.z) ** 2) < CLEARING.r) continue;
        if (inGap(x, z, 0)) continue;
        if (Math.abs(x - ACROSS.x) < 3 && z > ACROSS.z - 14 && z < ACROSS.z + 10) continue;
        const thick = d > 0.3;
        const kind: TreeKind | 'snag' = v < 4 ? 'snag'
            : thick ? (u < 55 ? 'spruce' : u < 72 ? 'pine' : 'broadleaf')
                : (u < 58 ? 'broadleaf' : u < 85 ? 'pine' : 'spruce');
        const s = thick ? 0.85 + r.int(0, 25) / 100 : 0.95 + r.int(0, 35) / 100;
        const open = !thick && d < 0.15;
        const reach = kind === 'snag' ? 4 : crownReach(kind, s, open);
        // the fields station and goods yard beyond the forest's south edge, the water tower beyond its north edge
        if (z + reach > 456 || Math.sqrt((x - 250) ** 2 + (z - 260) ** 2) < reach + 10) continue;
        if (!clearOfRailway(x, z, reach)) continue;
        if (kind === 'snag') snag(b, r, x, z);
        else if (kind === 'broadleaf') broadleaf(b, r, x, z, s, open, u % 3 === 0 ? 'foliage-light' : 'foliage');
        else if (kind === 'spruce') spruce(b, r, x, z, s, thick ? 4.5 : 1.5);
        else pine(b, r, x, z, s);
        planted.add(x, z);
        n++;
        // now and then a tree that fell, lying beside a standing one
        if (r.chance(1, 14)) {
            const th = r.int(0, 359) * DEG, len = 9 + r.int(0, 8);
            const fx = x + 3 * dcos(th + 1.6), fz = z + 3 * dsin(th + 1.6);
            const ex = fx + len * dcos(th), ez = fz + len * dsin(th);
            if (toLine(FOREST_TRACK, fx, fz) > 5 && toLine(FOREST_TRACK, ex, ez) > 5 && clearOfRailway(fx, fz, 1) && clearOfRailway(ex, ez, 1)
                && Math.min(fz, ez) > F.z0 && Math.max(fz, ez) < F.z1 - 6 && !inGap(fx, fz, 2) && !inGap(ex, ez, 2)) fallenTree(b, fx, fz, th, len);
        }
    }
    // the undergrowth: bushes, more of them under the thickets' edges and in the open woodland than in the dark middle
    // of a thicket, none on the track, in the clearing or in the gap
    let bushes = 0;
    for (let k = 0; k < 3000 && bushes < 260; k++) {
        const x = F.x0 + r.int(0, (F.x1 - F.x0) * 2) / 2;
        const z = F.z0 + r.int(0, (F.z1 - F.z0) * 2) / 2;
        const d = density(x, z);
        if (r.int(0, 99) > (d > 0.7 ? 15 : d > 0.1 ? 70 : 35)) continue;
        if (planted.near(x, z, 2.6) || toLine(FOREST_TRACK, x, z) < TRACK_HW + 2 || inGap(x, z, 0)) continue;
        if (Math.sqrt((x - CLEARING.x) ** 2 + (z - CLEARING.z) ** 2) < CLEARING.r - 2 || z > 452) continue;
        if (Math.abs(x - ACROSS.x) < 4 && z > ACROSS.z - 14 && z < ACROSS.z + 10) continue;
        if (!clearOfRailway(x, z, 2)) continue;
        bush(b, r, x, z);
        planted.add(x, z);
        bushes++;
    }
    const [ox, oy, oz] = inCrown(oak, CLEARING.x, CLEARING.z, (oak.fork + oak.lead) / 2, 1.6);
    const spots: WoodSpot[] = [
        { x: ACROSS.x, y: 0.55, z: ACROSS.z, spot: 'Under the fallen tree across the forest track' },
        { x: ox, y: oy, z: oz, spot: 'In the crown of the big oak in the forest clearing' }
    ];
    if (hollowFree) spots.push({ x: hx - 1.5, y: 1.6, z: hz, spot: 'In the gap a fallen tree left, deep in the forest' });
    void n;
    return spots;
}

/**
 * A tree line along z = z0 from x0 to x1 (map v10): trees 5-16 m apart, wandering up to 8 m either side, with gaps
 * here and there, mostly broadleaves with some spruces and pines, of mixed sizes.
 */
export function treeLine(b: LevelBuilder, r: Rng, x0: number, x1: number, z0: number): void {
    let off = 0;
    for (let x = x0; x <= x1; x += r.int(5, 16)) {
        off += r.int(-3, 3);
        off = off < -8 ? -8 : off > 8 ? 8 : off;
        if (r.chance(1, 9)) { x += r.int(12, 30); continue; } // a gap
        const z = z0 + off;
        const u = r.int(0, 99);
        const s = 0.8 + r.int(0, 45) / 100;
        const kind: TreeKind = u < 70 ? 'broadleaf' : u < 85 ? 'spruce' : 'pine';
        if (!clearOfRailway(x, z, crownReach(kind, s, true))) continue;
        // (map v11) one on the farm track is grown where nobody sees it, so the trees after it stay as they were
        const g = onWayOut(x, z, crownReach(kind, s, true)) ? new LevelBuilder() : b;
        if (kind === 'broadleaf') broadleaf(g, r, x, z, s, true, u % 4 === 0 ? 'foliage-light' : 'foliage');
        else if (kind === 'spruce') spruce(g, r, x, z, s);
        else pine(g, r, x, z, s);
    }
}

/**
 * The belt of trees just outside the playable square (half size `e` m), so its edge reads as a place, not a line
 * (map v10): trees 8-20 m apart, 0-14 m out, a second tree behind one in three; mostly spruces (the cheapest to draw,
 * as it is outside the square), some pines and broadleaves.
 */
export function borderBelt(b: LevelBuilder, r: Rng, e: number): void {
    // each side as (along, out) -> (x, z)
    const sides: ((t: number, o: number) => [number, number])[] = [
        (t, o) => [t, -e - o], (t, o) => [t, e + o], (t, o) => [-e - o, t], (t, o) => [e + o, t]
    ];
    for (const at of sides) {
        for (let t = -e - 20; t <= e + 20; t += r.int(8, 20)) {
            const rows = r.chance(1, 3) ? 2 : 1;
            let o = r.int(0, 14);
            for (let k = 0; k < rows; k++, o += r.int(6, 12)) {
                const [x, z] = at(t + r.int(-3, 3), o);
                const u = r.int(0, 99);
                const s = 1 + r.int(0, 35) / 100;
                const kind: TreeKind = u < 65 ? 'spruce' : u < 80 ? 'broadleaf' : 'pine';
                if (!clearOfRailway(x, z, crownReach(kind, s, true))) continue;
                // (map v11) one on a road or track out of the map is grown where nobody sees it, the rest stay as they were
                const g = onWayOut(x, z, crownReach(kind, s, true)) ? new LevelBuilder() : b;
                if (kind === 'broadleaf') broadleaf(g, r, x, z, s, true);
                else if (kind === 'spruce') spruce(g, r, x, z, s);
                else pine(g, r, x, z, s);
            }
        }
    }
}
