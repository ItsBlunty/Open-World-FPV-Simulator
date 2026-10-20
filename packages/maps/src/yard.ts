// The industrial yard in the south-west (map v10; owner, 2026-10-19: "flesh out the area with the silos, buildings and
// shipping crates. Open some of the crates up to fly through, stack them somewhat more randomly"). Two warehouses (the
// big one now with pallet racking), a stack field of shipping containers with lanes between its blocks, some of them
// opened (doors swung back, both ends cut off, holes cut through the sides) and some laid across the tops of the stacks,
// lone stacks on the open apron, the grain silos with a headhouse, a conveyor gallery and a catwalk, hopper bins on legs,
// trailers at the docks, a site office, an open shed and a roofless old workshop. Metres, north is -z, east +x, y up.

import { FACE } from './builder';
import type { LevelBuilder, Material, Rng } from './builder';

/** A place for a golden prop, found while the yard was built. */
export interface YardSpot {
    x: number;
    y: number;
    z: number;
    spot: string;
}

// ---------------------------------------------------------------- shipping containers

/**
 * ISO 668 freight containers: 40 ft and 20 ft long (12.192 and 6.058 m), 8 ft wide (2.438 m), 8 ft 6 in high
 * (2.591 m). Inside one there is about 2.35 m across and 2.39 m up [typical makers' figures]: the walls here are 4 cm
 * steel, the floor 15 cm, the roof 5 cm.
 */
const L40 = 12.192, L20 = 6.058, CW = 2.438, CH = 2.591;
const WALL = 0.043, FLOOR = 0.15, ROOF = 0.05;
const CONTAINER_MATS: Material[] = ['container-a', 'container-b', 'container-c', 'container-d', 'container-e'];

/**
 * closed; `doors`: the doors at one end open, swung back flat against the sides; `tube`: both ends cut off, open
 * right through; `cut`: two openings cut through both sides, facing each other (a container turned workshop)
 */
type Opening = 'closed' | 'doors' | 'tube' | 'cut';

/**
 * A container from (x0, y0, z0), `len` long along x (alongX) or along z, CW wide. `doorsAt` is the end the doors are
 * at for `doors` (-1 the low end, +1 the high end).
 */
function container(b: LevelBuilder, m: Material, x0: number, y0: number, z0: number, alongX: boolean, len: number, open: Opening, doorsAt = 1): void {
    // a box in the container's own frame: u along it (0 to len), w across it (0 to CW), y up from y0
    const box = (u0: number, w0: number, ya: number, u1: number, w1: number, yb: number, skip = 0): void => {
        if (alongX) b.box(m, x0 + u0, y0 + ya, z0 + w0, x0 + u1, y0 + yb, z0 + w1, skip);
        else b.box(m, x0 + w0, y0 + ya, z0 + u0, x0 + w1, y0 + yb, z0 + u1, skip);
    };
    if (open === 'closed') { box(0, 0, 0, len, CW, CH); return; }
    box(0, 0, 0, len, CW, FLOOR); // floor
    box(0, 0, CH - ROOF, len, CW, CH); // roof
    // the sides, with the cut-outs if any: 3.6 m long, 0.4 to 2.3 m up, at a third and two thirds along a 40 ft box
    // (one in the middle of a 20 ft one)
    for (const [w0, w1] of [[0, WALL], [CW - WALL, CW]]) {
        if (open !== 'cut') { box(0, w0, FLOOR, len, w1, CH - ROOF); continue; }
        const holes = len > 10 ? [len / 3 - 1.8, 2 * len / 3 - 1.8] : [len / 2 - 1.8];
        let u = 0;
        for (const h of holes) {
            box(u, w0, FLOOR, h, w1, CH - ROOF);
            box(h, w0, FLOOR, h + 3.6, w1, 0.4);
            box(h, w0, 2.3, h + 3.6, w1, CH - ROOF);
            u = h + 3.6;
        }
        box(u, w0, FLOOR, len, w1, CH - ROOF);
    }
    // the ends
    const end = (u0: number, u1: number): void => box(u0, WALL, FLOOR, u1, CW - WALL, CH - ROOF);
    if (open === 'cut') { end(0, WALL); end(len - WALL, len); return; }
    if (open === 'tube') return;
    // doors: the far end closed, the two door leaves (each half the width) swung right round against the outside of the sides
    if (doorsAt > 0) end(0, WALL);
    else end(len - WALL, len);
    const ue = doorsAt > 0 ? len : 0;
    const u0 = doorsAt > 0 ? ue - CW / 2 : ue, u1 = doorsAt > 0 ? ue : ue + CW / 2;
    box(u0, -0.05, 0.05, u1, 0, CH - 0.05);
    box(u0, CW, 0.05, u1, CW + 0.05, CH - 0.05);
}

/** A block of container rows in the stack field: its first row's north face, how many rows, and the lane spacing. */
interface StackBlock {
    z: number;
    rows: number;
}
/**
 * The stack field's blocks, north to south: rows 0.4 m apart in a block, lanes 3 to 10 m wide between blocks. The lane
 * at z 261.3-271 is the one the golden prop "Down the alley between the container rows" (-375, 1.2, 266) is in.
 */
const BLOCKS: StackBlock[] = [
    { z: 206, rows: 3 }, { z: 221, rows: 2 }, { z: 229.5, rows: 3 }, { z: 245, rows: 3 },
    { z: 256, rows: 2 }, { z: 271, rows: 3 }, { z: 286, rows: 2 }, { z: 298, rows: 3 }
];
/** slots along a row: a 40 ft container or two 20 ft ones, 0.6 m apart */
const SLOT = L40 + 0.6;
const ROW_GAP = 0.4;

function stackField(b: LevelBuilder, r: Rng): void {
    for (const blk of BLOCKS) {
        const x0 = -455 + r.int(0, 8) / 2;
        const slots = r.int(6, 8);
        const rowZ = (k: number): number => blk.z + k * (CW + ROW_GAP);
        // how high each stack stands: 0 (an empty slot) to 4
        const h: number[][] = [];
        for (let k = 0; k < blk.rows; k++) {
            h.push([]);
            for (let s = 0; s < slots; s++) {
                const u = r.int(0, 99);
                h[k].push(u < 10 ? 0 : u < 33 ? 1 : u < 63 ? 2 : u < 88 ? 3 : 4);
            }
        }
        const has = (k: number, s: number, tier: number): boolean => k >= 0 && k < blk.rows && s >= 0 && s < slots && h[k][s] > tier;
        for (let k = 0; k < blk.rows; k++) for (let s = 0; s < slots; s++) {
            const pair = r.chance(1, 4); // two 20 ft boxes in the slot
            for (let t = 0; t < h[k][s]; t++) {
                const m = r.pick(CONTAINER_MATS);
                // set down a little off the one below (no twistlocks in this yard), the top one now and then well off
                const top = t === h[k][s] - 1;
                const freeW = !has(k, s - 1, t), freeE = !has(k, s + 1, t);
                let dx = t === 0 ? 0 : top && r.chance(1, 6) ? r.int(-30, 30) / 10 : r.int(-4, 4) / 10;
                // (map v14) never into the next slot's box at this height: the slots are 0.6 m apart, so at most 0.25 m
                // towards a neighbour (before, a box set well off stood inside its neighbour, their faces flickering)
                if (!freeW && dx < -0.25) dx = -0.25;
                if (!freeE && dx > 0.25) dx = 0.25;
                const x = x0 + s * SLOT + dx, y = t * CH, z = rowZ(k);
                const sidesFree = !has(k - 1, s, t) && !has(k + 1, s, t);
                const u = r.int(0, 99);
                if (pair) {
                    // only the outer ends can be open
                    container(b, m, x, y, z, true, L20, freeW && u < 25 ? 'doors' : 'closed', -1);
                    container(b, r.pick(CONTAINER_MATS), x + L20 + 0.076, y, z, true, L20, freeE && u >= 75 ? 'doors' : 'closed', 1);
                    continue;
                }
                const open: Opening = freeW && freeE && u < 45 ? 'tube'
                    : (freeW || freeE) && u < 30 ? 'doors'
                        : sidesFree && u < 35 ? 'cut' : 'closed';
                container(b, m, x, y, z, true, L40, open, freeE ? 1 : -1);
            }
        }
        // now and then a container laid across the top of the block: on stacks of one height (or over an empty
        // middle row, as an arch). A 40 ft box on a 3-row block, 20 ft on a 2-row one, so it overhangs the lanes
        // by under 2.1 m.
        const width = blk.rows * CW + (blk.rows - 1) * ROW_GAP;
        for (let s = 0; s < slots; s++) {
            if (!r.chance(1, 5)) continue;
            const ends = [h[0][s], h[blk.rows - 1][s]];
            const tier = ends[0];
            if (tier < 1 || ends[1] !== tier) continue;
            if (blk.rows === 3 && h[1][s] !== tier && h[1][s] !== 0) continue;
            const len = blk.rows === 3 ? L40 : L20;
            const zc = blk.z + width / 2;
            const xc = x0 + s * SLOT + L40 / 2 + r.int(-20, 20) / 10;
            container(b, r.pick(CONTAINER_MATS), xc - CW / 2, tier * CH, zc - len / 2, false, len, r.chance(1, 2) ? 'tube' : 'closed');
        }
    }
}

/**
 * Lone stacks on the open apron south of the stack field, set down any which way: one to three high, a lot of them
 * opened up. The first is placed by hand: an open tube on top of a closed box, a golden prop inside it.
 */
function apron(b: LevelBuilder, r: Rng): YardSpot {
    const taken: number[][] = [];
    const fits = (x0: number, z0: number, x1: number, z1: number): boolean => taken.every(([a, c, d, e]) => x1 + 3 < a || d + 3 < x0 || z1 + 3 < c || e + 3 < z0);
    // the hand-placed one, its tube looking east-west
    const hx = -425, hz = 352;
    container(b, 'container-b', hx, 0, hz, true, L40, 'closed');
    container(b, 'container-e', hx + 0.3, CH, hz, true, L40, 'tube');
    taken.push([hx, hz, hx + L40 + 0.3, hz + CW]);
    let n = 0;
    for (let k = 0; k < 400 && n < 13; k++) {
        const alongX = r.chance(1, 2);
        const len = r.chance(1, 3) ? L20 : L40;
        const x = -455 + r.int(0, 200) / 2, z = 316 + r.int(0, 170) / 2;
        const sx = alongX ? len : CW, sz = alongX ? CW : len;
        if (x + sx > -348 || z + sz > 408 || !fits(x, z, x + sx, z + sz)) continue;
        const tiers = r.int(1, 3);
        let ox = 0, oz = 0;
        for (let t = 0; t < tiers; t++) {
            const u = r.int(0, 99);
            const open: Opening = u < 30 ? 'tube' : u < 50 ? 'doors' : u < 65 ? 'cut' : 'closed';
            container(b, r.pick(CONTAINER_MATS), x + ox, t * CH, z + oz, alongX, len, open, r.chance(1, 2) ? 1 : -1);
            // the next one up set down a little off this one
            if (alongX) ox += r.int(-12, 12) / 10;
            else oz += r.int(-12, 12) / 10;
        }
        taken.push([x - 1.2 * tiers, z - 1.2 * tiers, x + sx + 1.2 * tiers, z + sz + 1.2 * tiers]);
        n++;
    }
    return { x: hx + 0.3 + L40 / 2, y: CH + FLOOR + 1.1, z: hz + CW / 2, spot: 'Through the open container on top of a stack, on the yard apron' };
}

// ---------------------------------------------------------------- buildings

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
    // roof trusses visible through the gaps, wall to wall (map v14: they ended flush with the walls' outsides, and flickered there)
    for (let x = x0 + 6; x < x0 + sx; x += 12) b.box('rust', x - 0.2, h - 1, z0 + t, x + 0.2, h, z0 + sz - t);
}

/**
 * Pallet racking down the west half of the big warehouse: three back-to-back rows along z, 2.2 m deep, aisles 7.8 m
 * wide between them, bays of 2.7 m with beams at 1.6, 3.2, 4.8 and 6.4 m [typical selective racking, estimates], and
 * pallets (1.2 x 1.0 m, 14.4 cm, the EUR / ISO 6780 sizes) with wrapped loads on six in ten places.
 */
function racking(b: LevelBuilder, r: Rng): void {
    const Z0 = 143, BAYS = 10, BAY = 2.7;
    const LEVELS = [0, 1.6, 3.2, 4.8, 6.4];
    for (const xc of [-432, -422, -412]) {
        for (let i = 0; i <= BAYS; i++) for (const dx of [-1.05, 0, 1.05]) b.block('metal', xc + dx, Z0 + i * BAY, 0.1, 0.1, 0, 7.4);
        for (const y of LEVELS.slice(1)) for (const dx of [-1.05, 1.05]) b.box('metal', xc + dx - 0.05, y - 0.14, Z0, xc + dx + 0.05, y, Z0 + BAYS * BAY);
        for (let i = 0; i < BAYS; i++) for (const y of LEVELS) for (const side of [-1, 1]) for (const p of [0, 1]) {
            if (!r.chance(3, 5)) continue;
            const za = Z0 + i * BAY + 0.15 + p * 1.25;
            const xa = side < 0 ? xc - 1.0 : xc + 0.05, xb = xa + 0.95;
            b.box('wood', xa, y, za, xb, y + 0.144, za + 1.2);
            b.box('plaster', xa + 0.05, y + 0.144, za + 0.05, xb - 0.05, y + 0.144 + 0.6 + r.int(0, 6) / 10, za + 1.15);
        }
    }
}

/** A stack of n pallets (1.2 x 1.0 m, 14.4 cm each) at (x, z). */
function pallets(b: LevelBuilder, x: number, z: number, n: number): void {
    b.box('wood', x, 0, z, x + 1.2, n * 0.144, z + 1.0);
}

/**
 * A semi-trailer backed up to a warehouse door: a 13.6 m box van body, 2.55 m wide, its floor 1.2 m up and its roof at
 * 4 m [the usual European sizes], on a chassis of two rails, three axles at the back and landing legs at the front.
 * There is a 1 m gap under it between the wheels and the legs. `z0` is its back (doors) end; it runs south from there.
 */
function trailer(b: LevelBuilder, xc: number, z0: number): void {
    const hw = 1.275;
    b.box('plaster', xc - hw, 1.2, z0, xc + hw, 4.0, z0 + 13.6);
    for (const s of [-1, 1]) b.box('metal', xc + s * 0.5 - 0.15, 1.0, z0 + 0.1, xc + s * 0.5 + 0.15, 1.2, z0 + 13.5);
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
        const zc = z0 + 1.3 + 1.31 * k;
        b.box('rail', s < 0 ? xc - 1.25 : xc + 0.75, 0, zc - 0.48, s < 0 ? xc - 0.75 : xc + 1.25, 1.0, zc + 0.48);
    }
    for (const s of [-1, 1]) b.block('metal', xc + s * 0.9, z0 + 10.6, 0.15, 0.15, 0, 1.0);
}

/** The site office: three portable cabins (9.75 x 3 x 2.8 m [estimate]), one on top, and a steel stair up to it. */
function siteOffice(b: LevelBuilder): void {
    const x0 = -455, x1 = x0 + 9.75;
    const cabin = (z0: number, y0: number): void => {
        b.box('plaster', x0, y0, z0, x1, y0 + 2.8, z0 + 3);
        for (const wx of [x0 + 1.5, x0 + 6]) b.box('window', wx, y0 + 1.0, z0 - 0.03, wx + 1.6, y0 + 2.1, z0, FACE.pz);
        b.box('window', x1, y0 + 0.1, z0 + 1, x1 + 0.03, y0 + 2.1, z0 + 2, FACE.nx); // the door's glass
    };
    cabin(186, 0);
    cabin(189.2, 0);
    cabin(186, 2.8);
    // the stair up the east end to a landing at the top cabin's door
    b.rampZ('metal', x1 + 0.3, x1 + 1.3, 199.2, 189.4, 0, 2.8, 0.15);
    b.box('metal', x1 + 0.05, 2.65, 186, x1 + 1.3, 2.8, 189.4);
    for (const z of [186.2, 189.2]) b.block('metal', x1 + 1.2, z, 0.1, 0.1, 0, 2.65);
}

/** An open shed: a monopitch roof on columns, 30 x 15 m, 6.5 m at the back falling to 5 m, clad at the back only. */
function openShed(b: LevelBuilder, r: Rng): void {
    const x0 = -328, x1 = -298, z0 = 362, z1 = 377;
    for (let x = x0; x <= x1; x += 6) {
        b.block('rust', x, z0 + 0.15, 0.3, 0.3, 0, 6.5);
        b.block('rust', x, z1 - 0.15, 0.3, 0.3, 0, 5);
    }
    b.rampZ('metal', x0 - 0.5, x1 + 0.5, z0 - 0.5, z1 + 0.5, 6.6, 5.0, 0.15);
    b.box('metal', x0, 0, z0 - 0.05, x1, 6.4, z0 + 0.05);
    // what is kept in it: pallets, a workshop container
    for (let k = 0; k < 6; k++) pallets(b, x0 + 2 + k * 2.2, z0 + 1.5, r.int(3, 12));
    container(b, 'container-d', x0 + 14, 0, z0 + 6, true, L20, 'doors', 1);
}

/**
 * A roofless old brick workshop, 30 x 20 m, walls 6 m high in 5 m bays: some bays with a window, some with a doorway,
 * some solid, some fallen down to a stub; three steel roof beams still span it; rubble inside.
 */
function oldWorkshop(b: LevelBuilder, r: Rng): void {
    const x0 = -256, x1 = -226, z0 = 336, z1 = 356, H = 6, T = 0.3, BAY = 5;
    // one bay of wall between a and c along the wall: `seg(a, c, y0, y1)` draws the wall's piece there
    const bay = (seg: (a: number, c: number, y0: number, y1: number) => void, a: number, c: number): void => {
        const u = r.int(0, 99);
        if (u < 35) { // a window, 1.2 to 3.6 m up
            seg(a, c, 0, 1.2);
            seg(a, c, 3.6, H);
            seg(a, a + 1.4, 1.2, 3.6);
            seg(c - 1.4, c, 1.2, 3.6);
        } else if (u < 55) { // a doorway
            seg(a, c, 3.6, H);
            seg(a, a + 1, 0, 3.6);
            seg(c - 1, c, 0, 3.6);
        } else if (u < 80) seg(a, c, 0, H);
        else seg(a, c, 0, 0.6 + r.int(0, 10) / 10); // fallen down
    };
    for (let x = x0; x < x1; x += BAY) {
        bay((a, c, ya, yb) => b.box('brick', a, ya, z0, c, yb, z0 + T), x, x + BAY);
        bay((a, c, ya, yb) => b.box('brick', a, ya, z1 - T, c, yb, z1), x, x + BAY);
    }
    for (let z = z0 + T; z < z1 - T - 0.01; z += BAY) {
        const c = Math.min(z + BAY, z1 - T);
        bay((a, e, ya, yb) => b.box('brick', x0, ya, a, x0 + T, yb, e), z, c);
        bay((a, e, ya, yb) => b.box('brick', x1 - T, ya, a, x1, yb, e), z, c);
    }
    // the roof beams, wall to wall (map v14: they ended flush with the walls' outsides and tops, and flickered there)
    for (const x of [x0 + 7.5, x0 + 15, x0 + 22.5]) b.box('rust', x - 0.15, H - 0.45, z0 + T, x + 0.15, H, z1 - T);
    for (let k = 0; k < 25; k++) {
        const s = 0.4 + r.int(0, 12) / 10;
        b.block('rubble', x0 + 2 + r.int(0, 260) / 10, z0 + 2 + r.int(0, 160) / 10, s, s * (0.6 + r.int(0, 8) / 10), 0, 0.3 + r.int(0, 10) / 10);
    }
}

// ---------------------------------------------------------------- the grain plant

/** The silos (as on map v1-9): three 22 m bins at x -260, z 250, 262 and 274, 4.5 m to their corners, coned roofs to 24 m. */
const SILO_X = -260;
const SILO_Z = [250, 262, 274];

/**
 * The headhouse: a steel tower 7 x 7 m south of the silos with a machinery room on top (30-35 m), and a deck at 25.8 m
 * where the conveyor gallery comes in. Grain comes in by truck at the intake shed, up the gallery, and down spouts to
 * the bins [how country grain elevators are laid out; the sizes are estimates].
 */
const HEAD = { x0: -263.5, x1: -256.5, z0: 284.5, z1: 291.5, top: 30 };
/** The conveyor gallery: from the intake at x -338 (2 m up) to the headhouse's west face (26 m up), along z 288: 17.9°, under the 18-20° a grain belt climbs [estimate]. */
const GAL = { xa: -338, ya: 2, xb: HEAD.x0, yb: 26, z: 288, w: 2.4, h: 2.4 };
/** The hopper bins on legs, east of the silos: 8 m to their hopper's rim, so a truck drives under to load [estimate]. */
const BIN_X = -232;
const BIN_Z = [250, 260, 270, 280];

function grainPlant(b: LevelBuilder): YardSpot[] {
    for (const z of SILO_Z) {
        b.prism('metal', SILO_X, z, 0, 22, 4.5, 8);
        b.cone('metal', SILO_X, z, 22, 24, 4.6, 8);
    }
    // the headhouse frame: corner columns, beams every 6 m, braced on its north and east faces
    const H = HEAD;
    for (const x of [H.x0, H.x1]) for (const z of [H.z0, H.z1]) b.block('rust', x, z, 0.45, 0.45, 0, H.top);
    for (let y = 6; y <= H.top; y += 6) {
        for (const z of [H.z0, H.z1]) b.box('rust', H.x0, y - 0.5, z - 0.15, H.x1, y, z + 0.15);
        for (const x of [H.x0, H.x1]) b.box('rust', x - 0.15, y - 0.5, H.z0, x + 0.15, y, H.z1);
        if (y < H.top) {
            b.bar('rust', [H.x0, y - 0.5, H.z0], [H.x1, y + 5.5, H.z0], 0.15);
            b.bar('rust', [H.x1, y - 0.5, H.z0], [H.x1, y + 5.5, H.z1], 0.15);
        }
    }
    b.box('metal', H.x0 - 0.3, H.top, H.z0 - 0.3, H.x1 + 0.3, H.top + 5, H.z1 + 0.3); // the machinery room
    b.box('metal', H.x0 + 0.25, 25.7, H.z0 + 0.25, H.x1 - 0.25, 25.8, H.z1 - 0.25); // the deck the gallery comes in on
    // the catwalk from the headhouse north over the silo tops, 1.2 m wide with hand rails, its deck at 24.2-24.3 m
    const cz0 = 245.5, cz1 = H.z0;
    b.box('metal', SILO_X - 0.6, 24.2, cz0, SILO_X + 0.6, 24.3, cz1);
    for (const s of [-1, 1]) {
        b.box('metal', SILO_X + s * 0.6 - 0.025, 25.25, cz0, SILO_X + s * 0.6 + 0.025, 25.3, cz1);
        for (let z = cz0 + 0.5; z < cz1; z += 3) b.box('metal', SILO_X + s * 0.6 - 0.025, 24.3, z, SILO_X + s * 0.6 + 0.025, 25.25, z + 0.05);
    }
    // the conveyor gallery: an open truss 2.4 m square, four chords, a frame every 3 m, a diagonal in each side face per
    // panel, the belt on its idlers along the bottom (a 0.5 m bar). Open sided: fly along inside it or through its sides.
    const G = GAL;
    const yb = (x: number): number => G.ya + (G.yb - G.ya) * (x - G.xa) / (G.xb - G.xa);
    const hw = G.w / 2;
    for (const s of [-1, 1]) for (const up of [0, G.h]) b.bar('rust', [G.xa, G.ya + up, G.z + s * hw], [G.xb, G.yb + up, G.z + s * hw], 0.15);
    b.bar('rail', [G.xa, G.ya + 0.25, G.z], [G.xb, G.yb + 0.25, G.z], 0.5);
    const P = 3;
    for (let x = G.xa; x <= G.xb + 0.01; x += P) {
        const y = yb(x), xn = Math.min(x + P, G.xb);
        b.bar('rust', [x, y, G.z - hw], [x, y, G.z + hw], 0.1);
        b.bar('rust', [x, y + G.h, G.z - hw], [x, y + G.h, G.z + hw], 0.1);
        for (const s of [-1, 1]) {
            b.bar('rust', [x, y, G.z + s * hw], [x, y + G.h, G.z + s * hw], 0.1);
            if (xn > x + 0.5) b.bar('rust', [x, y, G.z + s * hw], [xn, yb(xn) + G.h, G.z + s * hw], 0.08);
        }
    }
    // trestles holding it up: two legs and a cross beam under the bottom chords
    for (const x of [-320, -302, -284]) {
        const y = yb(x) - 0.08;
        for (const s of [-1, 1]) b.block('rust', x, G.z + s * 1.6, 0.35, 0.35, 0, y);
        b.box('rust', x - 0.2, y - 0.4, G.z - 1.8, x + 0.2, y, G.z + 1.8);
        b.bar('rust', [x, 0.5, G.z - 1.6], [x, y - 0.4, G.z + 1.6], 0.12);
    }
    // the intake shed over the truck dump pit at its foot: a roof on four posts, the pit's grating
    b.box('metal', -344, 6, 283, -332, 6.25, 293);
    for (const x of [-343.7, -332.3]) for (const z of [283.3, 292.7]) b.block('metal', x, z, 0.3, 0.3, 0, 6);
    b.box('metal', -342, 0, 285, -334, 0.12, 291);
    // the hopper bins on legs: a coned roof, the barrel 8-16 m, a hopper down to 5.4 m, four legs braced at 4.4 m
    for (const z of BIN_Z) {
        b.prism('metal', BIN_X, z, 8, 16, 3.2, 8);
        b.cone('metal', BIN_X, z, 16, 17.4, 3.3, 8);
        b.cone('metal', BIN_X, z, 8, 5.4, 3.2, 8);
        for (const dx of [-2.2, 2.2]) for (const dz of [-2.2, 2.2]) b.block('rust', BIN_X + dx, z + dz, 0.3, 0.3, 0, 8);
        for (const dz of [-2.2, 2.2]) b.box('rust', BIN_X - 2.2, 4.4, z + dz - 0.1, BIN_X + 2.2, 4.6, z + dz + 0.1);
        for (const dx of [-2.2, 2.2]) b.box('rust', BIN_X + dx - 0.1, 4.4, z - 2.2, BIN_X + dx + 0.1, 4.6, z + 2.2);
    }
    // spouts from the machinery room down to the two nearest bins
    for (const z of [BIN_Z[2], BIN_Z[3]]) b.bar('metal', [H.x1 + 0.3, H.top + 1, H.z0 + 1], [BIN_X, 17.6, z], 0.35);
    const xm = (G.xa + G.xb) / 2;
    return [
        { x: xm, y: yb(xm) + 1.4, z: G.z, spot: 'Inside the grain conveyor gallery, half-way up' },
        { x: BIN_X, y: 2.2, z: BIN_Z[1], spot: 'Under the hopper bins on legs' }
    ];
}

/** The yard: buildings, containers, the grain plant, fence posts (those on the railway are left out by `onTrack`). */
export function industrial(b: LevelBuilder, r: Rng, onTrack: (x: number, z: number) => boolean): YardSpot[] {
    warehouse(b, -440, 140, 72, 36, 10);
    warehouse(b, -350, 140, 60, 30, 12);
    racking(b, r);
    trailer(b, -430, 177.5);
    trailer(b, -378, 177.5);
    for (const [x, z, n] of [[-420, 180, 8], [-418.4, 180, 5], [-366, 181, 11], [-310, 173, 6], [-307.5, 173.5, 12]]) pallets(b, x, z, n);
    siteOffice(b);
    stackField(b, r);
    const spots = [apron(b, r), ...grainPlant(b)];
    openShed(b, r);
    oldWorkshop(b, r);
    // the gantry (as before)
    b.box('rust', -310, 0, 330, -309, 14, 331);
    b.box('rust', -280, 0, 330, -279, 14, 331);
    b.box('rust', -310, 13, 329, -279, 15, 332);
    // yard fence posts, with gaps where the railway runs through (map v7)
    for (let x = -460; x <= -200; x += 10) if (!onTrack(x, 420)) b.prism('metal', x, 420, 0, 2.4, 0.08, 4);
    for (let z = 120; z <= 420; z += 10) if (!onTrack(-200, z)) b.prism('metal', -200, z, 0, 2.4, 0.08, 4);
    spots.push({ x: -430, y: 0.5, z: 185.8, spot: 'Under a trailer at the big warehouse' });
    return spots;
}
