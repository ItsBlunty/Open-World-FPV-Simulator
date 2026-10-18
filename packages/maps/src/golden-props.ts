// Golden props to collect (owner, 2026-10-18: "kinda like Tony Hawk pickups, but FPV themed", numbered, hidden around
// the city, a bunch of them) and the street furniture some of them hide in: bus shelters with frosted panels (seen
// clearly only from the road side), billboards on low roofs, and dumpsters in the alleys between buildings.
//
// The furniture is solid (in the collision and its hash); the props are not (metadata, like the building names).
// Both come after the rest of the map, from their own Rng, so everything else is drawn exactly as before.
// Sizes are real-world ones; the ones marked [estimate] were not taken from a source.

import { LevelBuilder, Rng } from './builder';
import type { Block, Building, Material } from './builder';

/** A footprint on the ground plan, x0 < x1 and z0 < z1, m. */
export interface Rect {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

/** A place a prop goes, found while the furniture was built. */
interface Spot {
    x: number;
    y: number;
    z: number;
    spot: string;
}

export interface Hideouts {
    shelters: Spot[];
    billboards: Spot[];
    alleys: Spot[];
    tallest: Spot;
}

/** How many of each to build (as many as fit, up to these). */
const SHELTERS = 10;
const BILLBOARDS = 6;
const ALLEYS = 6;

/**
 * People walk the sidewalks 1.3 m in from the kerb, 0.3 m to either side, 0.3 m wide (packages/traffic network.ts
 * HUB_IN, WALK_OFF, PERSON.r): they fill the first 1.9 m. A shelter starts 2.1 m in, so they pass in front of it.
 */
const SHELTER_FRONT = 2.1;
/** a three-bay shelter: 3.9 m long, 1.4 m deep, 2.5 m to the roof [estimates, typical of city shelters] */
const SHELTER_LEN = 3.9;
const SHELTER_DEPTH = 1.4;
const SHELTER_H = 2.5;
/** room a shelter needs from a block's corner (crossing queues, lamps, signal poles) and from a door, m */
const CORNER_ROOM = 14;
const DOOR_ROOM = 5;

/** The four faces in windowedBlock's order (0 -z, 1 +z, 2 -x, 3 +x) and their outward normals. */
const NX = [0, 0, -1, 1], NZ = [-1, 1, 0, 0];

/**
 * A frame on one side of a city block: u runs along the kerb, d in from the kerb (into the block), y up.
 * `at(u, d)` is the ground-plan point; `box` draws a box given in this frame.
 */
class Side {
    constructor(readonly blk: Block, readonly k: number) {}
    at(u: number, d: number): [number, number] {
        const b = this.blk;
        if (this.k === 0) return [u, b.z0 + d];
        if (this.k === 1) return [u, b.z1 - d];
        if (this.k === 2) return [b.x0 + d, u];
        return [b.x1 - d, u];
    }
    box(lb: LevelBuilder, m: Material, u0: number, u1: number, d0: number, d1: number, y0: number, y1: number): void {
        const [ax, az] = this.at(u0, d0), [bx, bz] = this.at(u1, d1);
        lb.box(m, ax, y0, az, bx, y1, bz);
    }
    rect(u0: number, u1: number, d0: number, d1: number): Rect {
        const [ax, az] = this.at(u0, d0), [bx, bz] = this.at(u1, d1);
        return { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
    }
    /** the block's extent along u */
    get u0(): number {
        return this.k < 2 ? this.blk.x0 : this.blk.z0;
    }
    get u1(): number {
        return this.k < 2 ? this.blk.x1 : this.blk.z1;
    }
}

/** How far face k of a building stands back from its block's kerb, and its extent along the kerb. */
function face(bd: Building, blk: Block, k: number): { set: number; a: number; c: number } {
    const set = k === 0 ? bd.z0 - blk.z0 : k === 1 ? blk.z1 - bd.z1 : k === 2 ? bd.x0 - blk.x0 : blk.x1 - bd.x1;
    return { set, a: k < 2 ? bd.x0 : bd.z0, c: k < 2 ? bd.x1 : bd.z1 };
}

const FACE_BIT = [4, 8, 16, 32]; // FACE.nz, pz, nx, px

function overlaps(a: Rect, b: Rect): boolean {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
}

/** Fisher-Yates with the map's integer Rng: the same order on every engine. */
function shuffle<T>(r: Rng, a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
        const j = r.int(0, i);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Take candidates in order, skipping any nearer than `gap` m (on the ground plan) to one already taken. */
function spread<T extends { x: number; z: number }>(c: T[], n: number, gap: number): T[] {
    const out: T[] = [];
    for (const p of c) {
        if (out.length >= n) break;
        if (out.every((q) => (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z) >= gap * gap)) out.push(p);
    }
    return out;
}

/**
 * The bus shelters, rooftop billboards and alley dumpsters, and the spots in them a prop goes. `clutter` is what
 * already stands on the city roofs.
 */
export function streetFurniture(b: LevelBuilder, r: Rng, clutter: Rect[]): Hideouts {
    return { shelters: shelters(b, r), billboards: billboards(b, r, clutter), alleys: alleys(b, r), tallest: tallest(b) };
}

// ---------------------------------------------------------------- bus shelters

/**
 * A bus shelter on the sidewalk in front of a building, its open side to the road: four posts, a roof, a frosted
 * back panel and end panels (so from the sidewalk behind, a prop inside shows only as a blur), a bench along the
 * back, and the stop's flag on a pole at the kerb. Only where the building stands far enough back for people to
 * walk between the shelter and the kerb.
 */
function shelters(lb: LevelBuilder, r: Rng): Spot[] {
    const need = SHELTER_FRONT + SHELTER_DEPTH + 0.4;
    const cand: (Spot & { side: Side; u: number })[] = [];
    lb.buildings.forEach((bd) => {
        const door = lb.doors[bd.door];
        const blk = lb.blocks[door.block];
        for (let k = 0; k < 4; k++) {
            if (!(bd.street & FACE_BIT[k])) continue;
            const f = face(bd, blk, k);
            if (f.set < need) continue;
            const side = new Side(blk, k);
            const half = SHELTER_LEN / 2 + 0.2;
            const lo = Math.max(f.a + half, side.u0 + CORNER_ROOM), hi = Math.min(f.c - half - 1, side.u1 - CORNER_ROOM);
            if (hi < lo) continue;
            // the middle of the face, or the middle of the longer stretch beside its door
            let u = (lo + hi) / 2;
            if (door.nx === NX[k] && door.nz === NZ[k]) {
                const du = k < 2 ? door.x : door.z;
                if (Math.abs(u - du) < DOOR_ROOM + half) {
                    const left = [lo, Math.min(hi, du - DOOR_ROOM - half)], right = [Math.max(lo, du + DOOR_ROOM + half), hi];
                    const lw = left[1] - left[0], rw = right[1] - right[0];
                    if (lw < 0 && rw < 0) continue;
                    u = lw >= rw ? (left[0] + left[1]) / 2 : (right[0] + right[1]) / 2;
                }
            }
            const [x, z] = side.at(u, SHELTER_FRONT + 0.6);
            cand.push({ x, y: blk.y + 1.35, z, spot: `In the bus shelter outside ${bd.name}`, side, u });
        }
    });
    const picked = spread(shuffle(r, cand), SHELTERS, 90);
    for (const p of picked) shelter(lb, p.side, p.u);
    return picked.map(({ x, y, z, spot }) => ({ x, y, z, spot }));
}

function shelter(lb: LevelBuilder, s: Side, u: number): void {
    const y0 = s.blk.y;
    const h = SHELTER_LEN / 2;
    const d0 = SHELTER_FRONT, d1 = SHELTER_FRONT + SHELTER_DEPTH;
    const P = 0.04; // half a post, m
    for (const pu of [u - h + P, u + h - P]) for (const pd of [d0 + P, d1 - P]) s.box(lb, 'metal', pu - P, pu + P, pd - P, pd + P, y0, y0 + SHELTER_H);
    s.box(lb, 'metal', u - h - 0.1, u + h + 0.1, d0 - 0.1, d1 + 0.1, y0 + SHELTER_H, y0 + SHELTER_H + 0.1);
    // frosted panels, 10 cm off the ground, up to the roof: along the back, and at both ends
    s.box(lb, 'frosted', u - h + 2 * P, u + h - 2 * P, d1 - 0.07, d1 - 0.01, y0 + 0.1, y0 + SHELTER_H - 0.05);
    for (const e of [u - h + 0.01, u + h - 0.07]) s.box(lb, 'frosted', e, e + 0.06, d0 + 2 * P, d1 - 2 * P, y0 + 0.1, y0 + SHELTER_H - 0.05);
    // the bench: a 0.45 m high seat, 0.35 m deep, on two legs
    s.box(lb, 'wood', u - 1.2, u + 1.2, d1 - 0.45, d1 - 0.1, y0 + 0.4, y0 + 0.45);
    for (const lu of [u - 1, u + 1]) s.box(lb, 'metal', lu - 0.03, lu + 0.03, d1 - 0.3, d1 - 0.24, y0, y0 + 0.4);
    // the stop's flag: a pole by the kerb past the shelter's end, the sign on top
    const fu = u + h + 0.8;
    s.box(lb, 'metal', fu - 0.03, fu + 0.03, 0.42, 0.48, y0, y0 + 2.9);
    s.box(lb, 'billboard', fu - 0.25, fu + 0.25, 0.4, 0.5, y0 + 2.3, y0 + 2.9);
}

// ---------------------------------------------------------------- billboards

/**
 * A billboard on a low roof, facing the street: a 6 x 3 m panel on two posts with a kicker brace each, 1.3 m back
 * from the roof's edge [estimates]. A prop sits behind it, out of sight from the front.
 */
function billboards(lb: LevelBuilder, r: Rng, clutter: Rect[]): Spot[] {
    const cand: (Spot & { side: Side; u: number; set: number; top: number })[] = [];
    lb.buildings.forEach((bd) => {
        if (bd.storeys < 3 || bd.storeys > 8) return;
        if (bd.tx0 !== bd.x0 || bd.tz0 !== bd.z0 || bd.tx1 !== bd.x1 || bd.tz1 !== bd.z1) return; // a set-back tower
        const blk = lb.blocks[lb.doors[bd.door].block];
        for (let k = 0; k < 4; k++) {
            if (!(bd.street & FACE_BIT[k])) continue;
            const f = face(bd, blk, k);
            const deep = k < 2 ? bd.z1 - bd.z0 : bd.x1 - bd.x0;
            if (f.c - f.a < 10 || deep < 8) continue;
            const side = new Side(blk, k);
            const u = (f.a + f.c) / 2;
            const room = side.rect(u - 3.6, u + 3.6, f.set + 0.8, f.set + 4.2);
            if (clutter.some((c) => overlaps(c, room))) continue;
            const [x, z] = side.at(u, f.set + 3.0);
            cand.push({ x, y: bd.top + 1.4, z, spot: `Behind the billboard on the roof of ${bd.name}`, side, u, set: f.set, top: bd.top });
            break; // one per building
        }
    });
    const picked = spread(shuffle(r, cand), BILLBOARDS, 100);
    for (const p of picked) {
        const { side: s, u, set, top } = p;
        s.box(lb, 'billboard', u - 3, u + 3, set + 1.3, set + 1.5, top + 0.9, top + 3.9);
        for (const pu of [u - 2, u + 2]) {
            s.box(lb, 'metal', pu - 0.1, pu + 0.1, set + 1.5, set + 1.7, top, top + 3.9);
            const [ax, az] = s.at(pu, set + 1.6), [bx, bz] = s.at(pu, set + 3.6);
            lb.bar('metal', [ax, top + 2.6, az], [bx, top + 0.05, bz], 0.1);
        }
    }
    return picked.map(({ x, y, z, spot }) => ({ x, y, z, spot }));
}

// ---------------------------------------------------------------- alleys

/**
 * Two buildings of one block 4 m apart make an alley. A dumpster (a 1.8 m front-loader, 1.1 m deep, 1.2 m high
 * [estimate, typical of a 3 cubic yard bin]) stands against one wall half-way along; a prop sits low behind it, seen
 * only from the alley's far end.
 */
function alleys(lb: LevelBuilder, r: Rng): Spot[] {
    const cand: (Spot & { block: number; draw: () => void })[] = [];
    const bs = lb.buildings;
    for (let i = 0; i < bs.length; i++) for (let j = 0; j < bs.length; j++) {
        const A = bs[i], B = bs[j];
        const block = lb.doors[A.door].block;
        if (i === j || lb.doors[B.door].block !== block) continue;
        const y = lb.blocks[block].y;
        // B 4 m east of A (an alley running along z), or 4 m south (along x)
        if (Math.abs(B.x0 - A.x1 - 4) < 1e-9) {
            const lo = Math.max(A.z0, B.z0), hi = Math.min(A.z1, B.z1);
            if (hi - lo < 12) continue;
            const w = A.x1, m = (lo + hi) / 2;
            cand.push({
                x: w + 0.55, y: y + 0.7, z: m + 1.55, spot: `In the alley between ${A.name} and ${B.name}, behind the dumpster`, block,
                draw: () => dumpster(lb, w + 0.1, m - 0.9, w + 1.2, m + 0.9, y)
            });
        } else if (Math.abs(B.z0 - A.z1 - 4) < 1e-9) {
            const lo = Math.max(A.x0, B.x0), hi = Math.min(A.x1, B.x1);
            if (hi - lo < 12) continue;
            const w = A.z1, m = (lo + hi) / 2;
            cand.push({
                x: m + 1.55, y: y + 0.7, z: w + 0.55, spot: `In the alley between ${A.name} and ${B.name}, behind the dumpster`, block,
                draw: () => dumpster(lb, m - 0.9, w + 0.1, m + 0.9, w + 1.2, y)
            });
        }
    }
    // one alley per block
    const seen = new Set<number>();
    const one = shuffle(r, cand).filter((c) => !seen.has(c.block) && seen.add(c.block));
    const picked = spread(one, ALLEYS, 100);
    for (const p of picked) p.draw();
    return picked.map(({ x, y, z, spot }) => ({ x, y, z, spot }));
}

/** A front-load dumpster: the bin and a lid that overhangs it a little. */
function dumpster(lb: LevelBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
    lb.box('dumpster', x0, y + 0.1, z0, x1, y + 1.2, z1);
    lb.box('dumpster', x0 - 0.03, y + 1.2, z0 - 0.03, x1 + 0.03, y + 1.26, z1 + 0.03);
    // four short legs (casters) under it
    for (const [x, z] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.1, z0 + 0.1], [x0 + 0.1, z1 - 0.1], [x1 - 0.1, z1 - 0.1]]) lb.box('metal', x - 0.05, y, z - 0.05, x + 0.05, y + 0.1, z + 0.05);
}

/** Over the middle of the tallest building's roof. */
function tallest(lb: LevelBuilder): Spot {
    let t = lb.buildings[0];
    for (const bd of lb.buildings) if (bd.top > t.top) t = bd;
    return { x: (t.tx0 + t.tx1) / 2, y: t.top + 1.5, z: (t.tz0 + t.tz1) / 2, spot: `On the roof of ${t.name}, the tallest tower in the city` };
}

// ---------------------------------------------------------------- the props

/** Spots placed by hand, by area, with the reasoning for each in the coordinates' comments (first-map.ts layout). */
const PARK: [number, number, number, string][] = [
    [0, 4.4, 80, 'Over the fountain in the middle of the park'], // its column's top at 3.5 m
    [35.5, 3, 10.5, "Through the park's concrete gate"], // posts at x 30-31 and 40-41, the bar at 6-7 m
    [-28.5, 4.4, 20.5, 'On the tallest step of the low wall line'], // the last step: x -30 to -27, 3.5 m high
    [-66, 1.7, 114, 'Under the gazebo roof'], // posts at x -70 / -62, z 110 / 118, the roof at 3 m
    [72, 0.7, 120, 'Skimming the pond'],
    [200, 12.9, -40, 'On top of a power pole, east of the park'] // poles 12 m tall every 50 m along z = -40
];
const BANDO: [number, number, number, string][] = [
    [-229, 1.6, -3, "At the bottom of the bando's lift shaft"], // the shaft: x -232 to -226, z -6 to 0, open every floor
    [-253, 9, 3, 'In the collapse in the middle of the bando, two floors up'], // bay x -256 to -250, z 0 to 6: floors 3, 4 gone
    [-277, 1.5, -9, "On the bando's ground floor, north-west corner"],
    [-223, 16, 9, "On the bando's top floor, south-east corner"], // floor 4's top at 14.4 m, the roof's underside 17.7
    [-235, 20.2, 6, 'Under the water tank on the bando roof'], // between its legs, over the steel beams at 18.4 m
    [-265, 3.5, 17, 'Under the loading dock roof'] // the dock: x -274 to -256, z 12 to 22, its roof at 7 m
];
/** the construction site (block x0 -71, z0 -241) and its crane (tower at -40, -210; jib at 48.45 m) */
const CITY: [number, number, number, string][] = [
    [-30, 10.2, -200, 'Inside the steel frame on the building site, second level'], // bay x -35 to -25, z -205 to -195
    [-40, 26, -210, "Inside the crane's tower, half-way up"], // section 6: 24.05 to 27.95 m
    [-20, 28.8, -210, "Hanging under the crane's hook"], // the hook's bottom at 29.6 m
    [11.6, 49.2, -210, "Off the tip of the crane's jib"], // the jib ends at x 10
    [-50.9, 49.3, -210, "On the crane's counter-jib walkway, by the ballast"], // between the hand rails, over the grating
    [142.25, 8, -152.25, 'In the car park, second level, north-east corner'], // between column lines, level 2 at 6.55 m
    [140.25, 1.5, -124, 'Under the first ramp in the car park'] // ramp underside at z -124: 2.57 m
];
const YARD: [number, number, number, string][] = [
    [-404, 5, 158, 'Inside the big warehouse'], // x -440 to -368, z 140 to 176, 10 m high
    [-413, 10.15, 150, "In the big warehouse's skylight"], // the roof's gap at x -416 to -404
    [-346, 10, 144, 'High in the back corner of the small warehouse'], // x -350 to -290, z 140 to 170, 12 m high
    [-375, 1.2, 266, 'Down the alley between the container rows'], // rows at z 258-260.4 and 272-274.4
    [-260, 11, 256, 'Between the first two silos'], // silos at z 250 and 262, 4.5 m to their corners: a 3 m gap
    [-260, 25, 274, 'On top of the southern silo'], // its cone's tip at 24 m
    [-295, 7, 330.5, "Under the yard's gantry"] // posts at x -310 and -280, the beam at 13 m
];
const FIELDS: [number, number, number, string][] = [
    [250, 12, 260, "Inside the water tower's legs"], // legs 8 m apart, girder rings at 8 and 16 m
    [250, 36, 260, 'On top of the water tower'] // its roof's tip at 35 m
];

/** Number every prop, area by area: the park (by the first spawn) first. */
export function goldenProps(b: LevelBuilder, h: Hideouts): void {
    const add = (area: string, spots: Spot[]): void => {
        for (const s of spots) b.collectibles.push({ n: b.collectibles.length + 1, x: s.x, y: s.y, z: s.z, area, spot: s.spot });
    };
    const fixed = (a: [number, number, number, string][]): Spot[] => a.map(([x, y, z, spot]) => ({ x, y, z, spot }));
    add('Park', fixed(PARK));
    add('Bando', fixed(BANDO));
    add('City', [...fixed(CITY), h.tallest, ...h.shelters, ...h.billboards, ...h.alleys]);
    add('Industrial yard', fixed(YARD));
    add('Fields', fixed(FIELDS));
}

