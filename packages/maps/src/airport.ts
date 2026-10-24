// The airport and the hospital helipad (map v21; owner, 2026-10-20: "add an airport between the city and the forest/train
// station area. We need a landing strip, a tower with air traffic controllers working and open windows that you can fly
// through ... ten different planes ... that land and park in a hangar, and then pull out and take off again ... a helipad
// on a building in the city that you can mark as the hospital"). The planes and the helicopter that use it are packages
// /traffic air.ts; this file is the still part, and the Airport metadata they find their way by.
//
// A regional airport (owner's choice): one runway 1400 m by 30 m, its largest user an ATR 72 (27 m span, ICAO code 3C:
// a 30 m runway). The railway is still up on its viaduct east of the city, so the airport lies just east of it (owner,
// 2026-10-20): the runway from x 660 to 2060 along z 40, landings eastbound (runway 09) over the park, departures
// eastbound too (a fixed wind from the east). Its threshold is displaced 100 m to x 760 so arrivals cross the railway
// with room over a train. A parallel taxiway (A) 60 m south of the runway, exits to it, the apron south of it with three
// hangars along its south edge, the tower and terminal at its west end with the air ambulance's pad in front.
// Metres, north is -z, east +x, y up.
//
// Marking sizes: aiming points 45 m long and 6 m wide with 18 m between them (ICAO Annex 14 Table 5-1 for a 30 m
// runway, as quoted in ICAO APAC working paper WP22, 2025); eight threshold stripes on a 30 m (100 ft) runway (FAA AIM
// 2-3-3, as quoted in a search summary). Everything else marked [estimate].
//
// No random choices, so the rest of the map is drawn as before.

import { FACE } from './builder';
import type { LevelBuilder, Material } from './builder';

/** Top of the airport's pavement, m: slabs 5 cm thick on the grass, like the park's paths */
export const PAVE = 0.05;

/** Runway 09/27: from x0 to x1 along z, 30 m wide; landings touch down past the displaced threshold. */
export const RUNWAY = { x0: 660, x1: 2060, z: 40, hw: 15, threshold: 760 };
/** Taxiway A, parallel to the runway, 15 m wide [ICAO code C], 60 m from the runway's centre line [estimate] */
export const TAXIWAY = { z: 100, hw: 7.5 };
/** The landing exits from the runway to taxiway A (their centre lines, x), and the departure entry at the west end. */
export const EXITS = [960, 1250, 1550, 1850, 2045];
export const ENTRY_X = 675;
/** where a departure waits on taxiway A for its turn, heading west (its main gear), m */
export const HOLD_X = 730;
/** the radius every taxi turn is made on, m [estimate: an ATR 72 turns on less] */
export const TURN_R = 25;
/** The apron, from taxiway A's south edge to the hangars' doors (the door line, z1). */
export const APRON = { x0: 660, x1: 1180, z0: TAXIWAY.z + TAXIWAY.hw, z1: 190 };

/** The aircraft the airport has room for (packages/traffic aircraft.ts draws them). */
export type AircraftKind = 'cub' | 'c172' | 'sr22' | 'baron' | 'caravan' | 'pc12' | 'kingair' | 'twinotter' | 'phenom' | 'atr72';

/** A hangar: from x0 to x1 along the door line, `depth` m deep, its doors open `door` m high, its roof `roof` m up. */
interface Hangar {
    x0: number;
    depth: number;
    door: number;
    roof: number;
    /** its bays from west to east: the plane each is for and its width, m */
    bays: [AircraftKind, number][];
}

/**
 * Three hangars side by side along the apron's south edge, each bay a plane's span plus 3-6 m [estimates]: the small
 * planes (Caravan 15.87 m span, 4.53 m high is the largest), the mid-sized turboprops (Twin Otter 19.81 m span, 5.94 m
 * high), and the ATR 72 (27.05 m span, 27.17 m long, 7.65 m high) with the Phenom 300.
 */
const HANGARS: Hangar[] = [
    { x0: 820, depth: 16, door: 5.5, roof: 7, bays: [['caravan', 19], ['baron', 15], ['sr22', 15], ['c172', 14], ['cub', 14]] },
    { x0: 915, depth: 21, door: 7, roof: 8.8, bays: [['twinotter', 24], ['kingair', 22], ['pc12', 20]] },
    { x0: 1000, depth: 33, door: 9.5, roof: 12, bays: [['atr72', 33], ['phenom', 21]] }
];

/** The tower: a hollow shaft (a door at its foot, open into the cab) and a cab with open windows all round [estimates]. */
const TOWER = { x: 722, z: 222, shaft: 5, wall: 0.5, cab: 9, floor: 22, sill: 1.0, head: 3.5, roof: 4.0 };
/** The terminal, two storeys, landside to the south */
const TERMINAL = { x0: 745, z0: 196, x1: 805, z1: 214 };
/** The air ambulance's pad on the apron at the airport [estimate: 1.5 x its 12 m overall length] */
const HELI_PAD = { x: 705, z: 160, half: 9 };

/** The hospital: the city building that becomes it, its rooftop pad and the stair house the crew carry the patient into. */
export const HOSPITAL = {
    /** a point inside the building it is (the one map v20 called Cobalt Hotel) */
    x: 360, z: -210,
    name: 'City General Hospital',
    /** the pad's deck: 20 m square [estimate], 0.3 m over the roof, in its north-west part clear of the AC units */
    pad: { x: 350, z: -225, half: 10, deck: 0.3 },
    /** the stair house: its footprint and the door in its west face (z0-z1), 2.2 m high */
    stair: { x0: 372, z0: -233, x1: 378, z1: -227, h: 3, door: [-231, -229] as [number, number] }
};

/** One hangar bay, as the planes find it. */
export interface Bay {
    kind: AircraftKind;
    /** its middle along the door line, its width, and how deep the hangar is (inside), m */
    x: number;
    width: number;
    depth: number;
    /** which hangar (0-2) */
    hangar: number;
}

/**
 * A light of the airport (map v22, owner 2026-10-24: "airport lights"): drawn only, on a solid fixture (airportLights()).
 * `face`: the way it shines (seen only from that side), null all round; `papi`: a PAPI unit, white seen from above this
 * angle (deg) and red below; `beacon`: the tower's rotating beacon.
 */
export interface AirportLight {
    x: number;
    y: number;
    z: number;
    colour: 'white' | 'green' | 'red' | 'blue';
    face: [number, number] | null;
    papi?: number;
    beacon?: boolean;
}

/** Where the planes, tugs and the helicopter go (Level.airport). y of a pad is its surface. */
export interface Airport {
    pave: number;
    runway: { x0: number; x1: number; z: number; hw: number; threshold: number };
    taxiZ: number;
    exits: number[];
    entryX: number;
    holdX: number;
    turnR: number;
    /** the hangars' door line, z */
    doorZ: number;
    bays: Bay[];
    /** each hangar's tug: where it waits (heading north), m */
    tugs: { x: number; z: number }[];
    heliPad: { x: number; y: number; z: number };
    hospitalPad: { x: number; y: number; z: number };
    /** the stair house: a point outside its door and one inside it (the crew are out of sight from there), with the roof's height */
    hospitalDoor: { out: [number, number, number]; in: [number, number, number] };
    /** the controllers' seats in the tower cab: where each sits (the seat's top) and which way they face */
    seats: { x: number; y: number; z: number; hx: number; hz: number }[];
    /** the runway's and taxiway's lights, the PAPI and the beacon (map v22) */
    lights: AirportLight[];
}

/**
 * Is (x, z) within d m of the strip under the last of the approach to runway 09, where trees are cleared (map v21): from
 * 400 m before the runway's start, 45 m either side of its centre line [estimate: a cleared approach].
 */
export function underApproach(x: number, z: number, d: number): boolean {
    return x > RUNWAY.x0 - 400 - d && x < RUNWAY.x0 && z > RUNWAY.z - 45 - d && z < RUNWAY.z + 45 + d;
}

/** A windowed building (first-map.ts windowedBlock with its office rows), handed in so this file needs nothing of the city's. */
export type Windowed = (b: LevelBuilder, m: Material, x0: number, z0: number, x1: number, z1: number, storeys: number) => void;

/**
 * Lay the airport; `roof` is the hospital building's roof height (found by the caller from Level buildings), `windowed`
 * draws the terminal. Returns the Airport metadata.
 */
export function airport(b: LevelBuilder, hospitalRoof: number, windowed: Windowed): Airport {
    pavement(b);
    runwayMarkings(b);
    taxiMarkings(b);
    const tugs: { x: number; z: number }[] = [];
    const bays: Bay[] = [];
    HANGARS.forEach((h, k) => {
        const x1 = hangar(b, h, k + 1);
        let x = h.x0;
        for (const [kind, w] of h.bays) {
            bays.push({ kind, x: x + w / 2, width: w, depth: h.depth, hangar: k });
            x += w;
        }
        // its tug waits in the gap east of it (clear of the planes at their bays), in front of the door line
        tugs.push({ x: x1 + 9, z: APRON.z1 - 2 });
    });
    const seats = tower(b);
    const lights = airportLights(b);
    windowed(b, 'facade-glass', TERMINAL.x0, TERMINAL.z0, TERMINAL.x1, TERMINAL.z1, 2);
    landside(b);
    heliPad(b);
    windsock(b, 1000, -15);
    const H = HOSPITAL, top = hospitalRoof;
    hospitalPad(b, top);
    const S = H.stair, dz = (S.door[0] + S.door[1]) / 2;
    return {
        pave: PAVE,
        runway: { ...RUNWAY },
        taxiZ: TAXIWAY.z,
        exits: EXITS.slice(),
        entryX: ENTRY_X,
        holdX: HOLD_X,
        turnR: TURN_R,
        doorZ: APRON.z1,
        bays,
        tugs,
        heliPad: { x: HELI_PAD.x, y: PAVE, z: HELI_PAD.z },
        hospitalPad: { x: H.pad.x, y: top + H.pad.deck, z: H.pad.z },
        hospitalDoor: { out: [S.x0 - 1.5, top, dz], in: [S.x0 + 2, top, dz] },
        seats,
        lights
    };
}

// ---------------------------------------------------------------- pavement

/** A slab of pavement from the grass up to PAVE (its underside sits on the ground: left out). */
function slab(b: LevelBuilder, m: Material, x0: number, z0: number, x1: number, z1: number): void {
    b.box(m, x0, 0, z0, x1, PAVE, z1, FACE.bottom);
}

function pavement(b: LevelBuilder): void {
    const R = RUNWAY, T = TAXIWAY;
    slab(b, 'asphalt', R.x0, R.z - R.hw, R.x1, R.z + R.hw);
    slab(b, 'asphalt', R.x0, T.z - T.hw, R.x1, T.z + T.hw);
    // the exits: wide enough for the turns off the runway and onto the taxiway, both on TURN_R
    for (const x of EXITS) slab(b, 'asphalt', x - TURN_R - 7, R.z + R.hw, Math.min(R.x1, x + 7.5), T.z - T.hw);
    slab(b, 'asphalt', R.x0, R.z + R.hw, ENTRY_X + TURN_R + 15, T.z - T.hw);
    slab(b, 'concrete', APRON.x0, APRON.z0, APRON.x1, APRON.z1);
    // into each hangar
    for (const h of HANGARS) slab(b, 'concrete', h.x0 + 0.3, APRON.z1, hangarX1(h) - 0.3, APRON.z1 + h.depth - 0.3);
}

// ---------------------------------------------------------------- paint

/** Paint a rectangle on the pavement (u across, v along, in the frame of a point (cx, cz) heading (hx, hz)). */
function patch(b: LevelBuilder, m: Material, cx: number, cz: number, hx: number, hz: number, u0: number, v0: number, u1: number, v1: number, y = PAVE): void {
    // right of the heading is (-hz, hx)
    const P = (u: number, v: number): number[] => [cx + hx * v - hz * u, y + 0.02, cz + hz * v + hx * u];
    // counter-clockwise seen from above: (u0, v0), (u0, v1), (u1, v1), (u1, v0) when right is +u... wind by the frame's handedness
    const a = P(u0, v0), c = P(u1, v1);
    const p = P(u0, v1), q = P(u1, v0);
    // the quad must face up: check its normal's y and flip if needed
    const ux = p[0] - a[0], uz = p[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
    if (uz * vx - ux * vz > 0) b.paintQuad(m, a, p, c, q);
    else b.paintQuad(m, a, q, c, p);
}

/**
 * The seven segments of a runway numeral 9 m tall and 3 m wide with 0.9 m strokes [estimate, after the usual 9 m x 3 m
 * numerals], as [u0, v0, u1, v1] across and along the digit (v up the digit, the way the pilot reads it).
 */
const SEG: Record<string, number[]> = {
    a: [-1.5, 8.1, 1.5, 9], b: [0.6, 4.5, 1.5, 9], c: [0.6, 0, 1.5, 4.5], d: [-1.5, 0, 1.5, 0.9],
    e: [-1.5, 0, -0.6, 4.5], f: [-1.5, 4.5, -0.6, 9], g: [-1.5, 4.05, 1.5, 4.95]
};
const DIGITS: Record<string, string> = {
    0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'
};

/** Paint `text` (digits) centred across a frame at (cx, cz) heading (hx, hz), its foot at v = 0, scaled by s. */
function numerals(b: LevelBuilder, m: Material, text: string, cx: number, cz: number, hx: number, hz: number, s = 1, y = PAVE): void {
    const pitch = 4.5 * s;
    for (let i = 0; i < text.length; i++) {
        const u = (i - (text.length - 1) / 2) * pitch;
        for (const k of DIGITS[text[i]]) {
            const [u0, v0, u1, v1] = SEG[k];
            patch(b, m, cx, cz, hx, hz, u + u0 * s, v0 * s, u + u1 * s, v1 * s, y);
        }
    }
}

function runwayMarkings(b: LevelBuilder): void {
    const R = RUNWAY, z = R.z;
    // edge stripes, 0.9 m [estimate]
    b.decal('marking', R.x0, z - R.hw + 0.3, R.x1, z - R.hw + 1.2, PAVE);
    b.decal('marking', R.x0, z + R.hw - 1.2, R.x1, z + R.hw - 0.3, PAVE);
    // each end: from its threshold, heading into the runway: 09 at the (displaced) west threshold, 27 at the east end
    const ends: [number, number, string][] = [[R.threshold, 1, '09'], [R.x1, -1, '27']];
    for (const [tx, h, name] of ends) {
        // threshold bar and eight stripes 30 m long, 1.8 m wide [estimates], four each side of the centre line
        patch(b, 'marking', tx, z, h, 0, -R.hw + 1.2, 0, R.hw - 1.2, 1.8);
        for (let k = 0; k < 4; k++) {
            const u = 2.7 + k * 3.15;
            patch(b, 'marking', tx, z, h, 0, u, 6, u + 1.8, 36);
            patch(b, 'marking', tx, z, h, 0, -u - 1.8, 6, -u, 36);
        }
        numerals(b, 'marking', name, tx + h * 48, z, h, 0);
        // aiming points 300 m in [estimate: about 1000 ft], 45 m long, 6 m wide, 18 m apart
        patch(b, 'marking', tx, z, h, 0, 9, 300, 15, 345);
        patch(b, 'marking', tx, z, h, 0, -15, 300, -9, 345);
    }
    // centre line: 30 m stripes with 20 m gaps, 0.45 m wide [estimates], between the numerals
    for (let x = R.threshold + 70; x + 30 <= R.x1 - 70; x += 50) b.decal('marking', x, z - 0.225, x + 30, z + 0.225, PAVE);
    // the displaced part before the threshold: arrows down its centre line pointing to the threshold
    for (let x = R.x0 + 10; x + 20 <= R.threshold - 5; x += 30) {
        b.decal('marking', x, z - 0.45, x + 14, z + 0.45, PAVE);
        const y = PAVE + 0.02, tip = x + 20;
        b.paintTri('marking', [x + 14, y, z + 2.4], [tip, y, z], [x + 14, y, z - 2.4]);
    }
}

/** A yellow line along a straight from (x0, z0) to (x1, z1), 0.3 m wide [the 0.15 m of real paint would not show]. */
function yLine(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number): void {
    const dx = x1 - x0, dz = z1 - z0, l = Math.sqrt(dx * dx + dz * dz);
    // 1 cm over the white paint: where it crosses the runway's edge stripe the two never fight
    patch(b, 'marking-yellow', x0, z0, dx / l, dz / l, -0.15, 0, 0.15, l, PAVE + 0.01);
}

/** A yellow line round a quarter circle of radius r about (cx, cz) from angle a0 by `sweep` (x = cos, z = sin). */
function yArc(b: LevelBuilder, cx: number, cz: number, r: number, a0: number, sweep: number): void {
    const n = 8;
    for (let i = 0; i < n; i++) {
        const t0 = a0 + (sweep * i) / n, t1 = a0 + (sweep * (i + 1)) / n;
        yLine(b, cx + r * cosQ(t0), cz + r * sinQ(t0), cx + r * cosQ(t1), cz + r * sinQ(t1));
    }
}

/** cos and sin of a multiple of pi / 16 from a table (paint only, but the level's bytes must not depend on the engine). */
function cosQ(t: number): number {
    return sinQ(t + Math.PI / 2);
}
function sinQ(t: number): number {
    const k = Math.round(t / (Math.PI / 16));
    const m = ((k % 32) + 32) % 32;
    const T = [0, 0.19509032201612825, 0.3826834323650898, 0.5555702330196022, 0.7071067811865476, 0.8314696123025452, 0.9238795325112867, 0.9807852804032304, 1];
    if (m <= 8) return T[m];
    if (m <= 16) return T[16 - m];
    if (m <= 24) return -T[m - 16];
    return -T[32 - m];
}

function taxiMarkings(b: LevelBuilder): void {
    const R = RUNWAY, T = TAXIWAY, r = TURN_R;
    const H = Math.PI / 2;
    yLine(b, ENTRY_X + r, T.z, R.x1 - 15, T.z);
    // each exit: off the runway's centre line to the right, south, then right onto taxiway A (westbound)
    for (const x of EXITS) {
        yArc(b, x - r, R.z + r, r, -H, H);
        yLine(b, x, R.z + r, x, T.z - r);
        yArc(b, x - r, T.z - r, r, 0, H);
    }
    // the entry: from taxiway A north, then onto the runway heading east
    yArc(b, ENTRY_X + r, T.z - r, r, H, H);
    yLine(b, ENTRY_X, T.z - r, ENTRY_X, R.z + r);
    yArc(b, ENTRY_X + r, R.z + r, r, Math.PI, H);
    // the holding position across the entry, 40 m from the runway's centre line [code 3 non-instrument]: two solid
    // lines and two dashed ones, the solid on the taxiway's side
    const hz = R.z + 40, x0 = R.x0 + 2, x1 = ENTRY_X + r + 13;
    for (const [dz, dashed] of [[0.9, false], [0.3, false], [-0.3, true], [-0.9, true]] as [number, boolean][]) {
        if (!dashed) b.decal('marking-yellow', x0, hz + dz - 0.15, x1, hz + dz + 0.15, PAVE);
        else for (let x = x0; x + 1 <= x1; x += 2) b.decal('marking-yellow', x, hz + dz - 0.15, x + 1, hz + dz + 0.15, PAVE);
    }
    // a safety line along the hangar fronts, 2 m out
    b.decal('marking-yellow', HANGARS[0].x0, APRON.z1 - 2.15, hangarX1(HANGARS[2]), APRON.z1 - 1.85, PAVE);
}

// ---------------------------------------------------------------- hangars

function hangarX1(h: Hangar): number {
    return h.x0 + h.bays.reduce((s, [, w]) => s + w, 0);
}

/**
 * A steel-clad hangar open along its whole front (its doors slid away), a header beam over the opening carrying its
 * number, roof girders across inside every 6 m (room to fly over and under them). Returns its east end, x.
 */
function hangar(b: LevelBuilder, h: Hangar, n: number): number {
    const x0 = h.x0, x1 = hangarX1(h), z0 = APRON.z1, z1 = z0 + h.depth, t = 0.3;
    const top = h.roof, deck = top - 0.4;
    b.box('hangar', x0, 0, z0, x0 + t, deck, z1, FACE.bottom | FACE.top);
    b.box('hangar', x1 - t, 0, z0, x1, deck, z1, FACE.bottom | FACE.top);
    b.box('hangar', x0 + t, 0, z1 - t, x1 - t, deck, z1, FACE.bottom | FACE.top | FACE.nx | FACE.px);
    b.box('hangar', x0, deck, z0, x1, top, z1);
    b.box('hangar', x0 + t, h.door, z0, x1 - t, deck, z0 + t, FACE.top | FACE.nx | FACE.px);
    // girders across, 0.8 m deep, under the roof
    for (let z = z0 + 4; z < z1 - 2; z += 6) b.box('metal', x0 + t, deck - 0.8, z, x1 - t, deck, z + 0.3, FACE.top | FACE.nx | FACE.px);
    // its number on the header, facing the apron: digits 2.4 m tall [estimate]
    const s = Math.min(0.27, (deck - h.door - 0.4) / 9);
    paintFront(b, String(n), (x0 + x1) / 2, h.door + 0.2, z0 - 0.02, s);
    return x1;
}

/** Paint digits on a wall facing -z at z, their foot at y0, centred on x, scaled s (9 m x s tall). */
function paintFront(b: LevelBuilder, text: string, cx: number, y0: number, z: number, s: number): void {
    const pitch = 4.5 * s;
    for (let i = 0; i < text.length; i++) {
        const u0c = (i - (text.length - 1) / 2) * pitch;
        for (const k of DIGITS[text[i]]) {
            const [u0, v0, u1, v1] = SEG[k];
            // seen from the apron (looking +z), right is -x
            const xa = cx - (u0c + u0 * s), xb = cx - (u0c + u1 * s), ya = y0 + v0 * s, yb = y0 + v1 * s;
            b.paintQuad('marking', [xa, ya, z], [xb, ya, z], [xb, yb, z], [xa, yb, z]);
        }
    }
}

// ---------------------------------------------------------------- tower

/**
 * The control tower: a hollow concrete shaft 5 m square (a door at its foot on the east side, open up into the cab, so a
 * quad can fly in at the bottom and up into the cab) carrying a 9 m square cab 22 m up [estimates: a small regional
 * tower]. The cab's windows are open all round (owner: "open windows that you can fly through"): a 1 m wall to the sill,
 * three openings 2.5 m high on each side between slim posts, a deep roof with a mast. Inside, consoles along the north
 * windows (the runway's side) and the east ones; the controllers who sit at them are packages/traffic air.ts's.
 */
function tower(b: LevelBuilder): { x: number; y: number; z: number; hx: number; hz: number }[] {
    const T = TOWER, x = T.x, z = T.z, s = T.shaft / 2, w = T.wall;
    const fy = T.floor;
    // the shaft's four walls, a door 1.6 m wide and 2.6 m high in the east one [estimate]
    b.box('concrete', x - s, 0, z - s, x + s, fy, z - s + w, FACE.bottom | FACE.top);
    b.box('concrete', x - s, 0, z + s - w, x + s, fy, z + s, FACE.bottom | FACE.top);
    b.box('concrete', x - s, 0, z - s + w, x - s + w, fy, z + s - w, FACE.bottom | FACE.top | FACE.nz | FACE.pz);
    b.box('concrete', x + s - w, 0, z - s + w, x + s, fy, z - 0.8, FACE.bottom | FACE.top | FACE.nz);
    b.box('concrete', x + s - w, 0, z + 0.8, x + s, fy, z + s - w, FACE.bottom | FACE.top | FACE.pz);
    b.box('concrete', x + s - w, 2.6, z - 0.8, x + s, fy, z + 0.8, FACE.top | FACE.nz | FACE.pz);
    // the cab's floor, open over the shaft
    const c = T.cab / 2, x0 = x - c, x1 = x + c, z0 = z - c, z1 = z + c, f0 = fy - 0.4;
    const i0 = x - s + w, i1 = x + s - w, j0 = z - s + w, j1 = z + s - w;
    b.box('concrete', x0, f0, z0, x1, fy, j0);
    b.box('concrete', x0, f0, j1, x1, fy, z1);
    b.box('concrete', x0, f0, j0, i0, fy, j1, FACE.nz | FACE.pz);
    b.box('concrete', i1, f0, j0, x1, fy, j1, FACE.nz | FACE.pz);
    // the wall to the sill, the posts between the openings, the band over them, the roof slab and its overhang
    const sill = fy + T.sill, head = fy + T.head, roof = fy + T.roof, t = 0.25;
    b.box('concrete', x0, fy, z0, x1, sill, z0 + t, FACE.bottom);
    b.box('concrete', x0, fy, z1 - t, x1, sill, z1, FACE.bottom);
    b.box('concrete', x0, fy, z0 + t, x0 + t, sill, z1 - t, FACE.bottom | FACE.nz | FACE.pz);
    b.box('concrete', x1 - t, fy, z0 + t, x1, sill, z1 - t, FACE.bottom | FACE.nz | FACE.pz);
    for (const p of [-c, -c / 3, c / 3, c]) {
        const pa = p - t / 2 < -c ? -c : p + t / 2 > c ? c - t : p - t / 2;
        b.box('metal', x + pa, sill, z0, x + pa + t, head, z0 + t, FACE.bottom | FACE.top);
        b.box('metal', x + pa, sill, z1 - t, x + pa + t, head, z1, FACE.bottom | FACE.top);
        if (Math.abs(p) < c) {
            b.box('metal', x0, sill, z + p - t / 2, x0 + t, head, z + p + t / 2, FACE.bottom | FACE.top);
            b.box('metal', x1 - t, sill, z + p - t / 2, x1, head, z + p + t / 2, FACE.bottom | FACE.top);
        }
    }
    b.box('concrete', x0, head, z0, x1, roof - 0.3, z1, 0);
    b.box('concrete', x0 - 0.6, roof - 0.3, z0 - 0.6, x1 + 0.6, roof, z1 + 0.6);
    // the mast and its beacon
    b.prism('metal', x + 2.5, z + 2.5, roof, roof + 5, 0.1, 4);
    b.box('metal', x + 2.2, roof + 5, z + 2.2, x + 2.8, roof + 5.4, z + 2.8);
    // consoles 0.8 m deep and 0.75 m high along the north and east windows, screens on them [estimates]
    b.box('metal', x0 + 0.6, fy, z0 + t, x1 - 0.6, fy + 0.75, z0 + t + 0.8, FACE.bottom);
    b.box('metal', x1 - t - 0.8, fy, z0 + t + 0.8, x1 - t, fy + 0.75, z + 1.5, FACE.bottom | FACE.nz);
    const seats: { x: number; y: number; z: number; hx: number; hz: number }[] = [];
    for (const sx of [-2.6, 0, 2.6]) {
        b.box('window', x + sx - 0.5, fy + 0.75, z0 + t + 0.15, x + sx + 0.5, fy + 1.3, z0 + t + 0.25, FACE.bottom);
        seats.push({ x: x + sx, y: fy + 0.45, z: z0 + t + 1.5, hx: 0, hz: -1 });
        // the chair: a seat on a post (the controller sits on it)
        b.box('metal', x + sx - 0.25, fy, z0 + t + 1.3, x + sx + 0.25, fy + 0.45, z0 + t + 1.8, FACE.bottom);
    }
    b.box('window', x1 - t - 0.25, fy + 0.75, z - 1.5, x1 - t - 0.15, fy + 1.3, z - 0.5, FACE.bottom);
    seats.push({ x: x1 - t - 1.5, y: fy + 0.45, z: z - 1, hx: 1, hz: 0 });
    b.box('metal', x1 - t - 1.75, fy, z - 1.25, x1 - t - 1.25, fy + 0.45, z - 0.75, FACE.bottom);
    return seats;
}

// ---------------------------------------------------------------- lights (map v22)

/** An elevated light's fixture: a post and a glass head, its lamp's centre this high [estimate: about 40 cm] */
const LAMP_Y = 0.34;
/** A runway or taxiway edge light stands this far off the paved edge [estimate] */
const EDGE_OFF = 1.5;
/** Edge lights at most this far apart, m: at most 200 ft, 61 m, between lights in a line (Transport Canada, quoted in Wikipedia's "Runway") */
const EDGE_GAP = 60;
/**
 * The PAPI (Wikipedia, "Precision approach path indicator", read 2026-10-24): four units on the left of the runway at the
 * point the glide path meets it, 9 m apart, the inner one 15 m off the runway's edge; their red to white angles for a 3 deg
 * path from the inner unit 3.50, 3.17, 2.83, 2.50 deg (3 deg 30', 3 deg 10', 2 deg 50', 2 deg 30'). The planes' glide path
 * (packages/traffic air.ts) crosses the threshold 15 m up at 3 deg: it meets the runway 286 m past the threshold.
 */
const PAPI = { x: RUNWAY.threshold + 15 / Math.tan((3 * Math.PI) / 180), inner: 15, gap: 9, angles: [3.5, 3 + 10 / 60, 2 + 50 / 60, 2.5] };

/**
 * The airport's lights, after the FAA's Aeronautical Information Manual ch. 2 sec. 1 (read 2026-10-24): runway edge lights
 * white; the lights marking each end of the runway red toward the runway and green outward; taxiway edge lights blue; the
 * land airport's beacon white and green, 24 to 30 flashes a minute (render/airport-lights.ts). Runway 09's displaced
 * threshold gets four green lights a side shining toward the approach [estimate: as the end lights' "pair of four lights
 * on each side", Wikipedia's "Runway"]. The fixtures are solid; the glow is drawn. Gaps where an exit, the entry or the
 * apron joins the pavement.
 */
function airportLights(b: LevelBuilder): AirportLight[] {
    const R = RUNWAY, T = TAXIWAY, out: AirportLight[] = [];
    const fixture = (x: number, z: number): void => {
        b.prism('metal', x, z, 0, LAMP_Y - 0.05, 0.03, 4);
        b.prism('frosted', x, z, LAMP_Y - 0.06, LAMP_Y + 0.06, 0.06, 6);
    };
    const light = (x: number, z: number, colour: AirportLight['colour'], face: [number, number] | null = null): void => {
        out.push({ x, y: LAMP_Y, z, colour, face });
    };
    // where pavement joins the runway's south side and the taxiway's north side: the exits and the entry (pavement())
    const joined = (x: number): boolean => x < ENTRY_X + TURN_R + 15 + 2 || EXITS.some((e) => x > e - TURN_R - 9 && x < e + 9.5);
    const along = (x0: number, x1: number): number[] => {
        const n = Math.ceil((x1 - x0) / EDGE_GAP);
        return Array.from({ length: n + 1 }, (_, k) => x0 + ((x1 - x0) * k) / n);
    };
    for (const x of along(R.x0 + 2, R.x1 - 2)) {
        for (const z of [R.z - R.hw - EDGE_OFF, R.z + R.hw + EDGE_OFF]) {
            if (z > R.z && joined(x)) continue;
            fixture(x, z);
            light(x, z, 'white');
        }
    }
    // each end: a row across, red toward the runway, green outward; just off the pavement
    for (const [x, inward] of [[R.x0 - 1, 1], [R.x1 + 1, -1]] as const) {
        for (let z = R.z - R.hw + 1.5; z <= R.z + R.hw - 1.5 + 1e-9; z += 3) {
            fixture(x, z);
            light(x, z, 'red', [inward, 0]);
            light(x, z, 'green', [-inward, 0]);
        }
    }
    // runway 09's displaced threshold: four green a side, out from the edges, toward the approach
    for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
            const z = R.z + side * (R.hw + EDGE_OFF + 1.5 * (k + 1));
            fixture(R.threshold, z);
            light(R.threshold, z, 'green', [-1, 0]);
        }
    }
    // taxiway A: blue edges (the south side only east of the apron)
    for (const x of along(R.x0 + 2, R.x1 - 2)) {
        const n = T.z - T.hw - 1, s = T.z + T.hw + 1;
        if (!joined(x)) { fixture(x, n); light(x, n, 'blue'); }
        if (x > APRON.x1 + 5) { fixture(x, s); light(x, s, 'blue'); }
    }
    // the PAPI: housings on a plinth [estimate: 1 m wide, 0.6 m deep, the lamp 0.65 m up], the lamps facing the approach
    PAPI.angles.forEach((deg, k) => {
        const z = R.z - R.hw - PAPI.inner - 0.5 - k * PAPI.gap, x = PAPI.x;
        b.box('metal', x - 0.25, 0, z - 0.4, x + 0.25, 0.42, z + 0.4);
        b.box('metal', x - 0.3, 0.4, z - 0.5, x + 0.3, 0.9, z + 0.5);
        out.push({ x: x - 0.31, y: 0.65, z, colour: 'white', face: [-1, 0], papi: deg });
    });
    // the beacon on the tower's mast (tower(): the lamp box on its top)
    out.push({ x: TOWER.x + 2.5, y: TOWER.floor + TOWER.roof + 5.65, z: TOWER.z + 2.5, colour: 'white', face: null, beacon: true });
    return out;
}

// ---------------------------------------------------------------- terminal side, pads, windsock

/** The road from the terminal's landside down to the forest track out (links.ts, z 404), and a car park beside it. */
function landside(b: LevelBuilder): void {
    slab(b, 'asphalt', 771.5, TERMINAL.z1, 778.5, 402);
    slab(b, 'asphalt', 778.5, 222, 830, 262);
    for (let x = 781; x < 829; x += 2.6) {
        b.decal('marking', x, 223, x + 0.12, 228, PAVE);
        b.decal('marking', x, 256, x + 0.12, 261, PAVE);
    }
}

/** The air ambulance's pad on the apron: a white edge, a white H [usual heliport marking]. */
function heliPad(b: LevelBuilder): void {
    const P = HELI_PAD, y = PAVE;
    const e = P.half, w = 0.5;
    b.decal('marking', P.x - e, P.z - e, P.x + e, P.z - e + w, y);
    b.decal('marking', P.x - e, P.z + e - w, P.x + e, P.z + e, y);
    b.decal('marking', P.x - e, P.z - e + w, P.x - e + w, P.z + e - w, y);
    b.decal('marking', P.x + e - w, P.z - e + w, P.x + e, P.z + e - w, y);
    hLetter(b, 'marking', P.x, P.z, y, 1);
}

/** An H 6 m tall and 4 m wide with 1 m strokes [estimate], upright when read from the south. */
function hLetter(b: LevelBuilder, m: Material, x: number, z: number, y: number, s: number): void {
    b.decal(m, x - 2 * s, z - 3 * s, x - 1 * s, z + 3 * s, y);
    b.decal(m, x + 1 * s, z - 3 * s, x + 2 * s, z + 3 * s, y);
    b.decal(m, x - 1 * s, z - 0.5 * s, x + 1 * s, z + 0.5 * s, y);
}

/**
 * The hospital's rooftop pad: a deck 0.3 m up on the roof, a white edge, and the hospital heliport marking, a red H on a
 * white cross [FAA practice, from memory: not read]; the stair house the crew go in by, its door open on its west face.
 */
function hospitalPad(b: LevelBuilder, top: number): void {
    const P = HOSPITAL.pad, S = HOSPITAL.stair;
    const y = top + P.deck, e = P.half;
    b.box('concrete', P.x - e, top, P.z - e, P.x + e, y, P.z + e, FACE.bottom);
    const w = 0.5;
    b.decal('marking', P.x - e, P.z - e, P.x + e, P.z - e + w, y);
    b.decal('marking', P.x - e, P.z + e - w, P.x + e, P.z + e, y);
    b.decal('marking', P.x - e, P.z - e + w, P.x - e + w, P.z + e - w, y);
    b.decal('marking', P.x + e - w, P.z - e + w, P.x + e, P.z + e - w, y);
    // the cross: two bars 12 m by 4 m; the H 1 cm over it so the two never fight
    b.decal('marking', P.x - 6, P.z - 2, P.x + 6, P.z + 2, y);
    b.decal('marking', P.x - 2, P.z - 6, P.x + 2, P.z - 2, y);
    b.decal('marking', P.x - 2, P.z + 2, P.x + 2, P.z + 6, y);
    hLetter(b, 'marking-red', P.x, P.z, y + 0.01, 0.75);
    // the stair house: four walls 0.2 m thick and a roof, a door 2 m wide and 2.2 m high in the west wall
    const t = 0.2, h = top + S.h, [d0, d1] = S.door;
    b.box('plaster', S.x0, top, S.z0, S.x1, h, S.z0 + t, FACE.bottom);
    b.box('plaster', S.x0, top, S.z1 - t, S.x1, h, S.z1, FACE.bottom);
    b.box('plaster', S.x1 - t, top, S.z0 + t, S.x1, h, S.z1 - t, FACE.bottom | FACE.nz | FACE.pz);
    b.box('plaster', S.x0, top, S.z0 + t, S.x0 + t, h, d0, FACE.bottom | FACE.nz);
    b.box('plaster', S.x0, top, d1, S.x0 + t, h, S.z1 - t, FACE.bottom | FACE.pz);
    b.box('plaster', S.x0, top + 2.2, d0, S.x0 + t, h, d1, FACE.nz | FACE.pz);
    b.box('plaster', S.x0, h, S.z0, S.x1, h + 0.2, S.z1);
}

/**
 * A windsock on a 6 m pole: four bands of red and white, from 0.9 m across at the mouth to 0.5 m, 3.6 m long, pointing
 * west (downwind of the fixed east wind the planes land into) [usual sizes, estimates].
 */
function windsock(b: LevelBuilder, x: number, z: number): void {
    b.prism('metal', x, z, 0, 6.3, 0.08, 6);
    for (let k = 0; k < 4; k++) {
        const r = 0.45 - k * 0.05;
        b.box(k % 2 ? 'marking' : 'windsock', x - 0.9 * (k + 1), 6 - r, z - r, x - 0.9 * k, 6 + r, z + r);
    }
}
