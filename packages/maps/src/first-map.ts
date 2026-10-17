// The first map (SPEC.md 4.2): one open world with a park in the middle, a 5-storey bando to the
// west, city blocks to the north and an industrial yard to the south-west. Blockout geometry only;
// sizes are real-world ones so speeds and gaps feel right. North is -z, east +x, metres, y up.
//
// The layout is code, not a file: every number is here, and the seeded Rng makes the "random"
// choices (missing floor panels, building heights) the same on every machine. Changing anything
// here changes the collision hash, so bump MAP_VERSION with it.

import { LevelBuilder, Rng } from './builder';
import type { Level, Material } from './builder';

export const MAP_ID = 'mixed-1';
export const MAP_VERSION = 1;
const HALF = 500;
/** how far the ground reaches, so the horizon is not a cliff edge */
const GROUND = 2000;

export function buildFirstMap(): Level {
    const b = new LevelBuilder();
    ground(b);
    park(b, new Rng(1));
    bando(b, new Rng(2));
    city(b, new Rng(3));
    industrial(b, new Rng(4));
    southEast(b, new Rng(5));
    border(b, new Rng(6));
    b.spawn({ id: 'park', name: 'Park', x: 0, z: 40, yawDeg: 0 });
    b.spawn({ id: 'bando', name: 'Bando (front)', x: -250, z: 30, yawDeg: 0 });
    b.spawn({ id: 'bando-roof', name: 'Bando roof', x: -277, z: -9, yawDeg: 90 });
    b.spawn({ id: 'city', name: 'City street', x: 0, z: -130, yawDeg: 0 });
    b.spawn({ id: 'yard', name: 'Industrial yard', x: -330, z: 200, yawDeg: 180 });
    return b.build(MAP_ID, MAP_VERSION, 'Park, bando and city', HALF);
}

// ---------------------------------------------------------------- ground

/** Asphalt under the city and the yard, grass everywhere else, as rectangles that never overlap. */
function ground(b: LevelBuilder): void {
    const G = GROUND;
    b.floor('asphalt', -HALF, -HALF, HALF, -70);
    b.floor('asphalt', -460, 120, -200, 420);
    b.floor('grass', -G, -G, G, -HALF);
    b.floor('grass', -G, -HALF, -HALF, -70);
    b.floor('grass', HALF, -HALF, G, -70);
    b.floor('grass', -G, -70, G, 120);
    b.floor('grass', -G, 120, -460, 420);
    b.floor('grass', -200, 120, G, 420);
    b.floor('grass', -G, 420, G, G);
}

// ---------------------------------------------------------------- park

function tree(b: LevelBuilder, r: Rng, x: number, z: number, scale = 1): void {
    const trunkH = (2.5 + r.int(0, 10) / 10) * scale;
    const top = trunkH + (5 + r.int(0, 40) / 10) * scale;
    const rad = (2 + r.int(0, 15) / 10) * scale;
    b.prism('trunk', x, z, 0, trunkH + 0.5, 0.25 * scale, 6);
    if (r.chance(1, 3)) {
        // a round-ish tree: two stacked canopies
        b.cone('foliage', x, z, trunkH, top - 1, rad * 1.1, 8);
        b.cone('foliage', x, z, trunkH + 1.5, top + 1, rad * 0.8, 8);
    } else b.cone('foliage', x, z, trunkH, top, rad, 6);
}

function park(b: LevelBuilder, r: Rng): void {
    // spawn pad and paths (thin slabs, 5 cm)
    b.block('concrete', 0, 40, 5, 5, 0, 0.1);
    b.box('path', -3, 0, -60, 3, 0.05, 37.5); // north-south path, stops at the pad
    b.box('path', -3, 0, 42.5, 3, 0.05, 200);
    b.box('path', -150, 0, 77, 150, 0.05, 83); // east-west path
    b.box('path', -100, 0, 150, 100, 0.05, 154); // southern loop
    b.box('path', -104, 0, 77, -100, 0.05, 154);
    b.box('path', 100, 0, 77, 104, 0.05, 154);
    // fountain on the crossing
    b.prism('concrete', 0, 80, 0, 0.6, 7, 8);
    b.prism('water', 0, 80, 0.6, 0.62, 6.4, 8);
    b.prism('concrete', 0, 80, 0.6, 3.5, 0.8, 8);
    // pond
    b.box('water', 50, 0, 100, 95, 0.05, 140);
    // gazebo: 8 posts and a roof
    for (let i = 0; i < 4; i++) {
        const x = -70 + (i % 2) * 8;
        const z = 110 + Math.floor(i / 2) * 8;
        b.prism('wood', x, z, 0, 3, 0.15, 4);
    }
    b.box('wood', -70.5, 3, 109.5, -61.5, 3.4, 118.5);
    b.cone('wood', -66, 114, 3.4, 6, 6.4, 4);
    // benches along the east-west path
    for (let x = -120; x <= 120; x += 30) {
        if (x === 0) continue;
        b.box('wood', x - 1, 0.45, 85, x + 1, 0.55, 85.5);
        b.box('metal', x - 0.9, 0, 85.1, x - 0.8, 0.45, 85.4);
        b.box('metal', x + 0.8, 0, 85.1, x + 0.9, 0.45, 85.4);
    }
    // a gate of two posts and a bar, and a low wall line to fly along: freestyle features
    b.box('concrete', 30, 0, 10, 31, 6, 11);
    b.box('concrete', 40, 0, 10, 41, 6, 11);
    b.box('concrete', 30, 6, 10, 41, 7, 11);
    for (let i = 0; i < 6; i++) b.box('concrete', -60 + i * 6, 0, 20, -57 + i * 6, 1 + i * 0.5, 21);
    // power line: poles every 50 m along z = -40 (no wires: a sim wire is invisible at speed)
    for (let x = -450; x <= 450; x += 50) {
        b.prism('wood', x, -40, 0, 12, 0.2, 6);
        b.box('wood', x - 1.5, 11, -40.1, x + 1.5, 11.25, -39.9);
    }
    // trees: scattered, kept off the paths, the pad, the fountain and the pond
    const clear = (x: number, z: number): boolean =>
        !(Math.abs(x) < 8) && !(z > 72 && z < 88) && !(z > 145 && z < 159 && Math.abs(x) < 108)
        && !(x > 44 && x < 101 && z > 94 && z < 146) && !(x > -78 && x < -54 && z > 102 && z < 126)
        && !(x > 25 && x < 46 && z > 5 && z < 16) && !(x > -64 && x < -20 && z > 16 && z < 25)
        && !(z > -46 && z < -34);
    let n = 0;
    for (let k = 0; k < 400 && n < 70; k++) {
        const x = r.int(-140, 140);
        const z = r.int(-55, 195);
        if (!clear(x, z)) continue;
        tree(b, r, x, z);
        n++;
    }
}

// ---------------------------------------------------------------- bando

/** Storey height, slab thickness, bay size of the bando. */
const H = 3.6;
const SLAB = 0.3;
const BAY = 6;

function wallX(b: LevelBuilder, m: Material, x0: number, x1: number, z: number, y0: number, y1: number, kind: 'solid' | 'window' | 'door'): void {
    const t = 0.25;
    if (kind === 'solid') b.box(m, x0, y0, z - t / 2, x1, y1, z + t / 2);
    else if (kind === 'window') {
        b.box(m, x0, y0, z - t / 2, x1, y0 + 1, z + t / 2);
        b.box(m, x0, y0 + 2.8, z - t / 2, x1, y1, z + t / 2);
        b.box(m, x0, y0 + 1, z - t / 2, x0 + 1.5, y0 + 2.8, z + t / 2);
        b.box(m, x1 - 1.5, y0 + 1, z - t / 2, x1, y0 + 2.8, z + t / 2);
    } else {
        b.box(m, x0, y0 + 2.6, z - t / 2, x1, y1, z + t / 2);
        b.box(m, x0, y0, z - t / 2, x0 + 1.5, y0 + 2.6, z + t / 2);
        b.box(m, x1 - 1.5, y0, z - t / 2, x1, y0 + 2.6, z + t / 2);
    }
}

function wallZ(b: LevelBuilder, m: Material, z0: number, z1: number, x: number, y0: number, y1: number, kind: 'solid' | 'window' | 'door'): void {
    const t = 0.25;
    if (kind === 'solid') b.box(m, x - t / 2, y0, z0, x + t / 2, y1, z1);
    else if (kind === 'window') {
        b.box(m, x - t / 2, y0, z0, x + t / 2, y0 + 1, z1);
        b.box(m, x - t / 2, y0 + 2.8, z0, x + t / 2, y1, z1);
        b.box(m, x - t / 2, y0 + 1, z0, x + t / 2, y0 + 2.8, z0 + 1.5);
        b.box(m, x - t / 2, y0 + 1, z1 - 1.5, x + t / 2, y0 + 2.8, z1);
    } else {
        b.box(m, x - t / 2, y0 + 2.6, z0, x + t / 2, y1, z1);
        b.box(m, x - t / 2, y0, z0, x + t / 2, y0 + 2.6, z0 + 1.5);
        b.box(m, x - t / 2, y0, z1 - 1.5, x + t / 2, y0 + 2.6, z1);
    }
}

/**
 * A 60 x 24 m concrete frame of 5 storeys (3.6 m each, roof at 18 m): columns on a 6 m grid, floor
 * panels per bay with some missing and a collapse through floors 3 and 4, an open shaft through
 * every floor, exterior walls that are solid, windowed or gone, and rubble under the collapse.
 */
function bando(b: LevelBuilder, r: Rng): void {
    const x0 = -280;
    const z0 = -12;
    const NX = 10;
    const NZ = 4;
    const storeys = 5;
    const shaft = (i: number, j: number): boolean => i === 8 && j === 1;
    const collapse = (k: number, i: number, j: number): boolean => (k === 3 || k === 4) && i >= 3 && i <= 4 && j >= 2;
    const keep = (k: number, i: number, j: number): boolean => k === storeys && i === 0 && j === 0; // the roof spawn
    // ground slab
    b.box('concrete-dark', x0 - 0.5, 0, z0 - 0.5, x0 + NX * BAY + 0.5, 0.1, z0 + NZ * BAY + 0.5);
    // columns, one per storey per grid point
    for (let k = 0; k < storeys; k++) {
        const y0 = k === 0 ? 0.1 : k * H;
        const y1 = (k + 1) * H - SLAB;
        for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
            // a few columns are gone on the top storey (the roof there sags onto the walls)
            if (k === storeys - 1 && i > 0 && i < NX && j > 0 && j < NZ && r.chance(1, 4)) continue;
            b.block('concrete', x0 + i * BAY, z0 + j * BAY, 0.5, 0.5, y0, y1 - y0);
        }
    }
    // floor panels, slab k's top at k * H
    for (let k = 1; k <= storeys; k++) {
        for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
            const missing = shaft(i, j) || collapse(k, i, j) || r.chance(k === storeys ? 28 : 16, 100);
            if (missing && !keep(k, i, j)) continue;
            b.box('concrete', x0 + i * BAY, k * H - SLAB, z0 + j * BAY, x0 + (i + 1) * BAY, k * H, z0 + (j + 1) * BAY);
        }
    }
    // exterior walls per bay and storey; the ground floor has more doorways
    const pickWall = (k: number): 'solid' | 'window' | 'door' | null => {
        const u = r.int(0, 99);
        if (k === 0) return u < 30 ? 'door' : u < 55 ? null : u < 80 ? 'window' : 'solid';
        return u < 45 ? 'window' : u < 70 ? null : 'solid';
    };
    for (let k = 0; k < storeys; k++) {
        const y0 = k === 0 ? 0.1 : k * H;
        const y1 = (k + 1) * H - SLAB;
        const m: Material = k < 2 ? 'brick' : 'concrete';
        for (let i = 0; i < NX; i++) {
            const xa = x0 + i * BAY + 0.25;
            const xb = x0 + (i + 1) * BAY - 0.25;
            const s = pickWall(k);
            if (s) wallX(b, m, xa, xb, z0, y0, y1, s);
            const n = pickWall(k);
            if (n) wallX(b, m, xa, xb, z0 + NZ * BAY, y0, y1, n);
        }
        for (let j = 0; j < NZ; j++) {
            const za = z0 + j * BAY + 0.25;
            const zb = z0 + (j + 1) * BAY - 0.25;
            const w = pickWall(k);
            if (w) wallZ(b, m, za, zb, x0, y0, y1, w);
            const e = pickWall(k);
            if (e) wallZ(b, m, za, zb, x0 + NX * BAY, y0, y1, e);
        }
        // the shaft's side walls, with a door on the ground floor
        const sx0 = x0 + 8 * BAY;
        wallZ(b, 'concrete-dark', z0 + BAY + 0.25, z0 + 2 * BAY - 0.25, sx0, y0, y1, k === 0 ? 'door' : 'solid');
        wallZ(b, 'concrete-dark', z0 + BAY + 0.25, z0 + 2 * BAY - 0.25, sx0 + BAY, y0, y1, 'solid');
        // interior partitions on the lower floors
        if (k < 3) {
            for (let i = 1; i < NX - 1; i++) {
                if (!r.chance(1, 3) || i === 8 || i === 9) continue;
                wallZ(b, 'plaster', z0 + 2 * BAY + 0.25, z0 + 3 * BAY - 0.25, x0 + i * BAY, y0, y1, 'door');
            }
        }
    }
    // roof parapet with gaps, a water tank on legs
    const top = storeys * H;
    for (let i = 0; i < NX; i++) {
        if (!r.chance(1, 4)) b.box('concrete', x0 + i * BAY, top, z0 - 0.15, x0 + (i + 1) * BAY, top + 1, z0 + 0.15);
        if (!r.chance(1, 4)) b.box('concrete', x0 + i * BAY, top, z0 + NZ * BAY - 0.15, x0 + (i + 1) * BAY, top + 1, z0 + NZ * BAY + 0.15);
    }
    for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) b.block('rust', x0 + 43.5 + dx, z0 + 16.5 + dz, 0.3, 0.3, top, 4);
    b.block('rust', x0 + 45, z0 + 18, 4.5, 4.5, top + 4, 3);
    // rubble under the collapse and scattered on the ground floor
    for (let n = 0; n < 40; n++) {
        const x = x0 + 18 + r.int(0, 120) / 10;
        const z = z0 + 12 + r.int(0, 110) / 10;
        const s = 0.4 + r.int(0, 12) / 10;
        b.block('rubble', x, z, s, s * (0.6 + r.int(0, 8) / 10), 0.1, 0.3 + r.int(0, 10) / 10);
    }
    // a loading dock on the south side: a 2-storey annex with an open front
    const ax = x0 + 6;
    const az = z0 + NZ * BAY;
    b.box('concrete', ax, 0, az, ax + 18, 1.2, az + 10); // dock platform
    b.box('concrete', ax, 7, az, ax + 18, 7.3, az + 10); // annex roof
    for (const dx of [0, 6, 12, 18]) b.block('concrete', ax + dx, az + 10, 0.4, 0.4, 1.2, 5.8);
    b.box('concrete', ax - 0.25, 1.2, az, ax, 7, az + 10);
}

// ---------------------------------------------------------------- city

const MATS_BUILDING: Material[] = ['concrete', 'brick', 'plaster', 'glass', 'concrete-dark'];

function building(b: LevelBuilder, r: Rng, x0: number, z0: number, x1: number, z1: number, maxFloors: number): void {
    const floors = r.int(2, maxFloors);
    const h = floors * 3.5;
    const m = h > 40 && r.chance(1, 2) ? 'glass' : r.pick(MATS_BUILDING);
    if (h > 30 && r.chance(1, 2)) {
        // podium and a set-back tower
        b.box(m === 'glass' ? 'concrete' : m, x0, 0.15, z0, x1, 0.15 + 3 * 3.5, z1);
        const ix = Math.min(6, (x1 - x0) / 4);
        const iz = Math.min(6, (z1 - z0) / 4);
        b.box(m, x0 + ix, 0.15 + 3 * 3.5, z0 + iz, x1 - ix, 0.15 + h, z1 - iz);
    } else b.box(m, x0, 0.15, z0, x1, 0.15 + h, z1);
    // rooftop clutter: AC units, a stair head
    const top = 0.15 + h;
    const n = r.int(0, 3);
    for (let k = 0; k < n; k++) {
        const cx = x0 + 3 + r.int(0, Math.max(0, Math.floor(x1 - x0 - 6)));
        const cz = z0 + 3 + r.int(0, Math.max(0, Math.floor(z1 - z0 - 6)));
        if (h > 30) continue; // a set-back tower's roof is smaller; keep it clear
        b.block('metal', cx, cz, 2, 1.5, top, 1.2);
    }
}

/** A steel frame under construction: columns and beams, no walls, a crane. */
function construction(b: LevelBuilder, x0: number, z0: number): void {
    const levels = 6;
    for (let k = 0; k <= levels; k++) {
        const y = 0.15 + k * 4;
        for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) {
            if (k < levels) b.block('rust', x0 + 6 + i * 10, z0 + 6 + j * 10, 0.4, 0.4, y, 4);
        }
        if (k === 0) continue;
        for (let i = 0; i <= 5; i++) b.box('rust', x0 + 6 + i * 10 - 0.2, y - 0.5, z0 + 6, x0 + 6 + i * 10 + 0.2, y, z0 + 56);
        for (let j = 0; j <= 5; j++) b.box('rust', x0 + 6, y - 0.5, z0 + 6 + j * 10 - 0.2, x0 + 56, y, z0 + 6 + j * 10 + 0.2);
        // a few decks of planks
        if (k % 2 === 0) b.box('wood', x0 + 6, y, z0 + 6, x0 + 26, y + 0.1, z0 + 26);
    }
    // tower crane: mast, jib, counter-jib
    const cx = x0 + 31;
    const cz = z0 + 31;
    b.block('metal', cx, cz, 1.6, 1.6, 0.15, 45);
    b.box('metal', cx - 12, 45, cz - 0.6, cx + 40, 46.5, cz + 0.6);
    b.box('concrete', cx - 12, 43, cz - 1.5, cx - 6, 45, cz + 1.5);
}

/** An open multi-storey car park: slabs on columns, low parapets. */
function carPark(b: LevelBuilder, x0: number, z0: number): void {
    for (let k = 1; k <= 4; k++) {
        const y = 0.15 + k * 3.2;
        b.box('concrete', x0 + 4, y - 0.3, z0 + 4, x0 + 58, y, z0 + 58);
        b.box('concrete', x0 + 4, y, z0 + 4, x0 + 58, y + 1, z0 + 4.3);
        b.box('concrete', x0 + 4, y, z0 + 57.7, x0 + 58, y + 1, z0 + 58);
    }
    for (let k = 0; k < 4; k++) {
        const y0 = 0.15 + k * 3.2;
        for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) b.block('concrete', x0 + 4.3 + i * 8.9, z0 + 4.3 + j * 8.9, 0.5, 0.5, y0, 3.2 - 0.3);
    }
}

function city(b: LevelBuilder, r: Rng): void {
    const PITCH = 80;
    const ROAD = 18;
    const BLOCK = PITCH - ROAD;
    for (let a = 0; a < 12; a++) {
        for (let c = 0; c < 5; c++) {
            const x0 = -HALF + 20 + a * PITCH + ROAD / 2;
            const z1 = -70 - 20 - c * PITCH - ROAD / 2;
            const z0 = z1 - BLOCK;
            const x1 = x0 + BLOCK;
            b.box('sidewalk', x0, 0, z0, x1, 0.15, z1);
            // street lamps at the block's corners
            for (const [lx, lz] of [[x0 + 1, z0 + 1], [x1 - 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z1 - 1]]) {
                b.prism('metal', lx, lz, 0.15, 7, 0.12, 4);
            }
            // taller towards the middle of the city (x = 0, z = -290)
            const cx = (x0 + x1) / 2;
            const cz = (z0 + z1) / 2;
            const d = Math.sqrt(cx * cx + (cz + 290) * (cz + 290));
            const maxFloors = d < 150 ? 22 : d < 300 ? 12 : 6;
            if (a === 5 && c === 1) { construction(b, x0, z0); continue; }
            if (a === 7 && c === 0) { carPark(b, x0, z0); continue; }
            const u = r.int(0, 99);
            if (u < 10) {
                // plaza: planters with trees
                for (let k = 0; k < 6; k++) {
                    const tx = x0 + 8 + r.int(0, BLOCK - 16);
                    const tz = z0 + 8 + r.int(0, BLOCK - 16);
                    b.block('concrete', tx, tz, 3, 3, 0.15, 0.6);
                    tree(b, r, tx, tz, 0.8);
                }
                continue;
            }
            if (u < 18) {
                // surface parking: low walls only
                b.box('concrete', x0 + 2, 0.15, z0 + 2, x1 - 2, 1.0, z0 + 2.3);
                continue;
            }
            const set = 2 + r.int(0, 3);
            const split = r.int(0, 2);
            if (split === 0) building(b, r, x0 + set, z0 + set, x1 - set, z1 - set, maxFloors);
            else if (split === 1) {
                const mid = x0 + BLOCK / 2;
                building(b, r, x0 + set, z0 + set, mid - 2, z1 - set, maxFloors);
                building(b, r, mid + 2, z0 + set, x1 - set, z1 - set, maxFloors);
            } else {
                const mx = x0 + BLOCK / 2;
                const mz = z0 + BLOCK / 2;
                building(b, r, x0 + set, z0 + set, mx - 2, mz - 2, maxFloors);
                building(b, r, mx + 2, z0 + set, x1 - set, mz - 2, maxFloors);
                building(b, r, x0 + set, mz + 2, mx - 2, z1 - set, maxFloors);
                building(b, r, mx + 2, mz + 2, x1 - set, z1 - set, maxFloors);
            }
        }
    }
}

// ---------------------------------------------------------------- industrial yard

function warehouse(b: LevelBuilder, x0: number, z0: number, sx: number, sz: number, h: number): void {
    const t = 0.3;
    // three full walls, the fourth (south) with two big doors; a roof with skylight gaps
    b.box('metal', x0, 0, z0, x0 + sx, h, z0 + t);
    b.box('metal', x0, 0, z0, x0 + t, h, z0 + sz);
    b.box('metal', x0 + sx - t, 0, z0, x0 + sx, h, z0 + sz);
    const zs = z0 + sz - t;
    b.box('metal', x0, 0, zs, x0 + 6, h, zs + t);
    b.box('metal', x0 + 14, 0, zs, x0 + sx - 14, h, zs + t);
    b.box('metal', x0 + sx - 6, 0, zs, x0 + sx, h, zs + t);
    b.box('metal', x0 + 6, 6, zs, x0 + 14, h, zs + t);
    b.box('metal', x0 + sx - 14, 6, zs, x0 + sx - 6, h, zs + t);
    for (let x = x0; x < x0 + sx; x += 12) {
        const w = Math.min(12, x0 + sx - x);
        if ((x - x0) % 36 === 24) continue; // skylight gap
        b.box('rust', x, h, z0, x + w, h + 0.3, z0 + sz);
    }
    // roof trusses visible through the gaps
    for (let x = x0 + 6; x < x0 + sx; x += 12) b.box('rust', x - 0.2, h - 1, z0, x + 0.2, h, z0 + sz);
}

function industrial(b: LevelBuilder, r: Rng): void {
    warehouse(b, -440, 140, 72, 36, 10);
    warehouse(b, -350, 140, 60, 30, 12);
    // container rows, stacked one to three high (12.2 x 2.44 x 2.6 m, ISO 40 ft)
    const mats: Material[] = ['container-a', 'container-b', 'container-c'];
    for (let row = 0; row < 5; row++) {
        const z = 230 + row * 14;
        for (let k = 0; k < 6; k++) {
            if (r.chance(1, 5)) continue;
            const x = -440 + k * 13;
            const stack = r.int(1, 3);
            for (let s = 0; s < stack; s++) b.box(r.pick(mats), x, s * 2.6, z, x + 12.2, (s + 1) * 2.6, z + 2.44);
        }
    }
    // silos and a gantry to fly through
    for (let i = 0; i < 3; i++) b.prism('metal', -260, 250 + i * 12, 0, 22, 4.5, 8);
    b.box('rust', -310, 0, 330, -309, 14, 331);
    b.box('rust', -280, 0, 330, -279, 14, 331);
    b.box('rust', -310, 13, 329, -279, 15, 332);
    // yard fence posts
    for (let x = -460; x <= -200; x += 10) b.prism('metal', x, 420, 0, 2.4, 0.08, 4);
    for (let z = 120; z <= 420; z += 10) b.prism('metal', -200, z, 0, 2.4, 0.08, 4);
}

// ---------------------------------------------------------------- south-east fields

function southEast(b: LevelBuilder, r: Rng): void {
    // water tower: four legs, a tank
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.prism('metal', 250 + dx, 260 + dz, 0, 24, 0.4, 6);
    b.box('metal', 245.5, 12, 259.8, 254.5, 12.4, 260.2);
    b.prism('metal', 250, 260, 24, 32, 7, 8);
    b.cone('metal', 250, 260, 32, 35, 7.2, 8);
    // hay bales and a tree line
    for (let k = 0; k < 25; k++) b.prism('wood', 150 + r.int(0, 250), 300 + r.int(0, 150), 0, 1.4, 0.8, 8);
    for (let x = 120; x <= 480; x += 9) tree(b, r, x, 220 + r.int(-3, 3), 1.1);
}

// ---------------------------------------------------------------- border

/** A ring of trees just outside the playable square, so its edge reads as a place, not a line. */
function border(b: LevelBuilder, r: Rng): void {
    const e = HALF + 20;
    for (let t = -e; t <= e; t += 14) {
        tree(b, r, t + r.int(-3, 3), -e + r.int(-3, 3), 1.3);
        tree(b, r, t + r.int(-3, 3), e + r.int(-3, 3), 1.3);
        tree(b, r, -e + r.int(-3, 3), t + r.int(-3, 3), 1.3);
        tree(b, r, e + r.int(-3, 3), t + r.int(-3, 3), 1.3);
    }
}
