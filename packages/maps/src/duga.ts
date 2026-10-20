// The Duga radar's receiving antennas (map v17; owner, 2026-10-20: "add the duga radar array ... a simplified poly
// version of duga. It should still look like duga but not very high poly"), north of the city past the border trees.
// Remade in map v18 (owner, 2026-10-20: "the duga array doesn't look right"), after the Wikimedia Commons photos; map
// v19 (owner, 2026-10-20, with a photo of the face): no wires across between the towers, the dipole rows staggered.
// v20 (owner, 2026-10-20, with a photo of the face: "spacing is one on every tower, then the next layer is one between
// every tower, you have twice as many"): one dipole per bay on each row, longer.
//
// Real ones (Chernobyl-2, Ukraine): two curtains end to end in one straight line, a low-band one 541 m long and 150 m
// high and a high-band one 276 m long, each 34 m deep at the foot (OpenStreetMap ways 432924904 and 437725923, heights:
// the first way's `height`, and chernobylx.com: "a high-frequency antenna with a height of 100 meters"). Each is a row of
// separate lattice towers (only feed pipes between them) with a free-standing tapered mast at each end; the dipoles,
// each a pair of cages (a cone at the fed end, a cylinder, a taper at the outer end), hang in front on feed pipes that
// run out from the face and bend down to them, each row half a dipole along from the rows over and under it (Wikipedia,
// Duga radar; Commons photos: from afar, from below, along the face, the end masts; the owner's photo of the face).
// Left out: the thin reflector wires some photos show from below (owner: not the straight wires across).
//
// Simplified (sizes not given by any source, read off the photos [estimates]): towers 12 m deep, their rusted legs 8 m
// apart (high band 6 m) inside a grey frame 14 m wide (10 m), about half a bay; a level every 12.5 m, a wider frame on
// top; the end masts 8 m in from each end, the first tower 0.8 of a bay further in (low band 15 towers, as counted in
// the photo from afar; high band 11); a row every 6.25 m, one dipole in front of each tower, then one mid-bay on the
// next row, each about 0.7 of a bay end to end (owner's photo of the face); raking struts at the towers' backs out to the
// 34 m footprint.
// Full size: it is meant to be seen from all over the map.
//
// Metres, north is -z, east +x, y up. No random choices, so the rest of the map is drawn as before it.

import type { LevelBuilder } from './builder';

/** One curtain from x0 to x1 along the front face z = front; it faces +z (the city). */
interface Curtain {
    x0: number;
    x1: number;
    /** bays between its towers (towers = bays + 1) */
    bays: number;
    height: number;
    /** each tower's rusted legs apart along the line, and its grey frame out past them on each side, m */
    legs: number;
    frame: number;
    /** levels of bracing, and rows of dipoles (photos of the face: rows about 4-6 m apart) */
    levels: number;
    rows: number;
    /** one cage's width, m, and how far in front of the towers the dipoles hang */
    cageW: number;
    reach: number;
}

/** the front face of both curtains, m; the city's north kerb is at z -499 and the border trees reach about -560 */
export const DUGA_FRONT = -600;
/** each tower's depth back from the front face, m [estimate from photos] */
const TOWER_D = 12;
/** the main legs (rusted, as they are now), the bracing and arms (grey paint), the feed pipes (rusted ochre), m across [estimates] */
const LEG = 1.0;
const BRACE = 0.4;
const OUTRIGGER = 0.5;
const PIPE = 0.45;
/** the top frame: out past the grey frame, its tips turned up this much, and the rod on top, m */
const TOP_OUT = 1.5;
const TOP_TIP = 1.5;
const ROD = 6;
/** the beams on top of each tower, out past the dipoles this far and up this much at their tips [estimates from a photo] */
const TOP_BEAM_OUT = 3;
const TOP_BEAM_UP = 4;
/** the struts behind each tower: from this high on its back legs down to the ground this far behind them */
const STRUT_Y = 30;
const STRUT_OUT = 20;
/** the end masts: centre this far in from the curtain's end, half widths at the foot and the top, m */
const MAST_IN = 8;
const MAST_FOOT = 5;
const MAST_TOP = 1.5;
/** from the end mast to the first tower, in bays */
const END_GAP = 0.8;
/**
 * The feed pipes: one along the face over each row, this far in front of it and this high over the row; each dipole's
 * pipe runs straight out level, bends down 45 deg over PIPE_UP, and runs level again the last PIPE_END m into the middle
 * of the dipole (owner's photos of the pipes, 2026-10-20).
 */
const PIPE_OUT = 0.6;
const PIPE_UP = 3;
const PIPE_END = 1;
/** a dipole's length end to end, in bays (owner's photo of the face: about 0.7) [estimate] */
const DIPOLE = 0.7;
/** the gap between a dipole's two cages, m, each side of its feed point */
const CAGE_GAP = 0.3;

export const DUGA: readonly Curtain[] = [
    // the low band: 541 m, 150 m high
    { x0: -408, x1: 133, bays: 14, height: 150, legs: 8, frame: 3, levels: 12, rows: 24, cageW: 1.6, reach: 6 },
    // the high band: 276 m, 100 m high
    { x0: 133, x1: 409, bays: 10, height: 100, legs: 6, frame: 2, levels: 8, rows: 16, cageW: 1.2, reach: 4.5 }
];

/** Where a curtain's towers stand: the first tower's x and the bay between towers, m. */
export function dugaTowers(c: Curtain): { first: number; bay: number } {
    const span = c.x1 - c.x0 - 2 * MAST_IN;
    const bay = span / (c.bays + 2 * END_GAP);
    return { first: c.x0 + MAST_IN + END_GAP * bay, bay };
}

export function duga(b: LevelBuilder): void {
    // the sandy strip they stand on (real ones stand in cleared sand), 5 cm up like the park's paths
    b.box('path', DUGA[0].x0 - 15, 0, DUGA_FRONT - TOWER_D - STRUT_OUT - 5, DUGA[DUGA.length - 1].x1 + 15, 0.05, DUGA_FRONT + 20);
    for (const c of DUGA) curtain(b, c);
}

function curtain(b: LevelBuilder, c: Curtain): void {
    const zf = DUGA_FRONT, zb = DUGA_FRONT - TOWER_D, h = c.height;
    const { first, bay } = dugaTowers(c);
    const hw = c.legs / 2 + c.frame;
    for (let t = 0; t <= c.bays; t++) tower(b, c, first + t * bay, zf, zb, t);
    mast(b, c.x0 + MAST_IN, h, c.levels);
    mast(b, c.x1 - MAST_IN, h, c.levels);
    // the dipoles, each fed in the middle from a pipe along the face over its row: even rows one in front of each
    // tower, odd rows one in the middle of each bay (owner's photo of the face)
    const pitch = h / c.rows, len = (DIPOLE * bay) / 2 - CAGE_GAP;
    for (let k = 0; k < c.rows; k++) {
        const y = (k + 0.5) * pitch, yp = y + PIPE_UP, zp = zf + PIPE_OUT, z = zf + c.reach;
        for (let t = 0; t < c.bays; t++) b.bar('duga-pipe', [first + t * bay + hw, yp, zp], [first + (t + 1) * bay - hw, yp, zp], PIPE);
        const odd = k % 2 === 1;
        for (let i = 0; i < c.bays + (odd ? 0 : 1); i++) {
            const x = first + (i + (odd ? 0.5 : 0)) * bay;
            // out level from the face (through the pipe along it), down 45 deg, level again into the gap between the cages
            const z2 = z - PIPE_END, z1 = z2 - PIPE_UP;
            b.bar('duga-pipe', [x, yp, zf], [x, yp, z1], PIPE);
            b.bar('duga-pipe', [x, yp, z1], [x, y, z2], PIPE);
            b.bar('duga-pipe', [x, y, z2], [x, y, z], PIPE);
            cage(b, x, y, z, len, c.cageW, -1);
            cage(b, x, y, z, len, c.cageW, 1);
        }
    }
}

/**
 * One tower: four rusted legs and, out past them on each side, a grey frame (photos: the towers' grey lattice is about
 * half a bay wide, the rusted legs inside it); a braced panel every level, a wider top frame with its tips turned up
 * and a rod on top.
 */
function tower(b: LevelBuilder, c: Curtain, x: number, zf: number, zb: number, t: number): void {
    const h = c.height, step = h / c.levels, hw = c.legs / 2, fw = hw + c.frame;
    for (const lx of [x - hw, x + hw]) for (const lz of [zf, zb]) b.bar('duga-rust', [lx, 0, lz], [lx, h, lz], LEG);
    for (const lx of [x - fw, x + fw]) for (const lz of [zf, zb]) b.bar('duga-grey', [lx, 0, lz], [lx, h, lz], BRACE);
    for (let k = 0; k < c.levels; k++) {
        const y0 = k * step, y1 = y0 + step;
        const flip = (k + t) % 2 === 0;
        // across the tower's depth at the top of the panel, and a zigzag on each side
        for (const lx of [x - hw, x + hw]) b.bar('duga-grey', [lx, y1, zf], [lx, y1, zb], BRACE);
        b.bar('duga-grey', [x - hw, y0, flip ? zf : zb], [x - hw, y1, flip ? zb : zf], BRACE);
        b.bar('duga-grey', [x + hw, y0, flip ? zb : zf], [x + hw, y1, flip ? zf : zb], BRACE);
        for (const lz of [zf, zb]) {
            // on the front and back: a zigzag between the legs and in each side of the frame, a rail across the top
            b.bar('duga-grey', [flip ? x - hw : x + hw, y0, lz], [flip ? x + hw : x - hw, y1, lz], BRACE);
            b.bar('duga-grey', [x - fw, flip ? y0 : y1, lz], [x - hw, flip ? y1 : y0, lz], BRACE);
            b.bar('duga-grey', [x + hw, flip ? y0 : y1, lz], [x + fw, flip ? y1 : y0, lz], BRACE);
            if (k < c.levels - 1) b.bar('duga-grey', [x - fw, y1, lz], [x + fw, y1, lz], OUTRIGGER);
        }
    }
    // the top frame, wider than the tower, front and back, its tips turned up, and a rod at the middle of the front
    const tw = fw + TOP_OUT;
    for (const lz of [zf, zb]) {
        b.bar('duga-grey', [x - tw, h, lz], [x + tw, h, lz], OUTRIGGER);
        b.bar('duga-grey', [x - tw, h, lz], [x - tw - TOP_TIP, h + TOP_TIP, lz], BRACE);
        b.bar('duga-grey', [x + tw, h, lz], [x + tw + TOP_TIP, h + TOP_TIP, lz], BRACE);
    }
    b.bar('duga-grey', [x, h + 0.25, zf], [x, h + ROD, zf], BRACE);
    // a beam from the top of each back leg out over the dipoles, rising a little (owner's photo from below the face)
    for (const lx of [x - hw, x + hw]) b.bar('duga-grey', [lx, h, zb], [lx, h + TOP_BEAM_UP, zf + c.reach + TOP_BEAM_OUT], OUTRIGGER);
    // raking struts from the back legs down to the ground behind
    for (const lx of [x - hw, x + hw]) b.bar('duga-rust', [lx, STRUT_Y, zb], [lx, 0, zb - STRUT_OUT], LEG * 0.7);
}

/** An end mast: a square lattice tapering from MAST_FOOT to MAST_TOP half width, centred on the reflector's line. */
function mast(b: LevelBuilder, x: number, h: number, levels: number): void {
    const z = DUGA_FRONT, step = h / levels;
    const half = (y: number): number => MAST_FOOT + (MAST_TOP - MAST_FOOT) * (y / h);
    const corner = (y: number, sx: number, sz: number): number[] => [x + sx * half(y), y, z + sz * half(y)];
    const sides: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of sides) b.bar('duga-rust', corner(0, sx, sz), corner(h, sx, sz), LEG * 0.8);
    for (let k = 0; k < levels; k++) {
        const y0 = k * step, y1 = y0 + step;
        for (let i = 0; i < 4; i++) {
            const [ax, az] = sides[i], [bx, bz] = sides[(i + 1) % 4];
            // a ring at the top of the panel and a diagonal across each face, turning every panel
            b.bar('duga-grey', corner(y1, ax, az), corner(y1, bx, bz), BRACE);
            if (k % 2) b.bar('duga-grey', corner(y0, ax, az), corner(y1, bx, bz), BRACE);
            else b.bar('duga-grey', corner(y0, bx, bz), corner(y1, ax, az), BRACE);
        }
    }
}

/** sqrt(3)/2, for the cages' hexagons */
const S3 = 0.8660254037844386;

/**
 * One cage of a dipole, fed at (x, y, z) and reaching dir (+1 east, -1 west) along x: a 6-sided cone from the feed point
 * out a quarter of its length to its full width, a 6-sided cylinder, then a taper over its last 15 % to 60 % of its
 * width and a flat end (photos). 34 triangles.
 */
function cage(b: LevelBuilder, x: number, y: number, z: number, len: number, w: number, dir: number): void {
    const gap = CAGE_GAP, r = w / 2;
    const xt = x + dir * gap, xm = xt + dir * len * 0.25, xn = xt + dir * len * 0.85, xe = xt + dir * len;
    // a hexagon across the cage, a corner at the top
    const ring = (cx: number, s: number): number[][] =>
        [[0, 1], [S3, 0.5], [S3, -0.5], [0, -1], [-S3, -0.5], [-S3, 0.5]].map(([dz, dy]) => [cx, y + dy * s, z + dz * s]);
    const tip = [xt, y, z], m = ring(xm, r), n = ring(xn, r), e = ring(xe, r * 0.6);
    const centre = [(xt + xe) / 2, y, z];
    for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        b.triOut('duga-cage', centre, tip, m[i], m[j]);
        b.quadOut('duga-cage', centre, m[i], m[j], n[j], n[i]);
        b.quadOut('duga-cage', centre, n[i], n[j], e[j], e[i]);
    }
    for (let i = 1; i < 5; i++) b.triOut('duga-cage', centre, e[0], e[i], e[i + 1]);
}
