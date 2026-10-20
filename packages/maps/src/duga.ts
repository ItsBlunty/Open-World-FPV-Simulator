// The Duga radar's receiving antennas (map v17; owner, 2026-10-20: "add the duga radar array ... a simplified poly
// version of duga. It should still look like duga but not very high poly"), north of the city past the border trees.
//
// Real ones (Chernobyl-2, Ukraine): two curtains end to end in one straight line, a low-band one 541 m long and 150 m
// high and a high-band one 276 m long, each 34 m deep at the foot (OpenStreetMap ways 432924904 and 437725923, heights:
// the first way's `height`, and chernobylx.com: "a high-frequency antenna with a height of 100 meters"). Each is a row of
// lattice towers carrying horizontal dipoles, every dipole a pair of cages (a cylinder with a cone at its fed end) held
// out in front of the towers on stand-off arms, a wire reflector behind them (Wikipedia, Duga radar; Commons photos).
//
// Simplified (sizes not given by any source, read off the photos [estimates]): towers 6 m wide and 12 m deep at about
// 34 m (low band) and 23 m (high band) apart, a level every 12.5 m, two dipoles per bay on every level (576 in all; one
// source counts 600 elements), cages 6-sided, the reflector wires left out (too thin to see past a few metres), raking
// struts at the towers' backs out to the 34 m footprint. Full size: it is meant to be seen from all over the map.
//
// Metres, north is -z, east +x, y up. No random choices, so the rest of the map is drawn as before it.

import type { LevelBuilder } from './builder';

/** One curtain: its towers stand from x0 to x1 along the front face z = front; it faces +z (the city). */
interface Curtain {
    x0: number;
    x1: number;
    /** tower rows (towers = bays + 1) */
    bays: number;
    height: number;
    /** levels of girders and of dipoles */
    levels: number;
    /** one cage's length and width, m, and how far in front of the towers the dipoles hang */
    cage: number;
    cageW: number;
    reach: number;
}

/** the front face of both curtains, m; the city's north kerb is at z -499 and the border trees reach about -560 */
export const DUGA_FRONT = -600;
/** each tower's width along the line and depth back from the front face, m [estimates from photos] */
const TOWER_W = 6;
const TOWER_D = 12;
/** the main legs (rusted, as they are now), the bracing and the arms (grey paint), m across [estimates] */
const LEG = 1.0;
const BRACE = 0.4;
const GIRDER = 0.5;
const ARM = 0.3;
/** the struts behind each tower: from this high on its back legs down to the ground this far behind them */
const STRUT_Y = 30;
const STRUT_OUT = 20;

export const DUGA: readonly Curtain[] = [
    // the low band: 541 m, 150 m high (16 bays of 33.8 m)
    { x0: -408, x1: 133, bays: 16, height: 150, levels: 12, cage: 6, cageW: 1.6, reach: 6 },
    // the high band: 276 m, 100 m high (12 bays of 23 m), its first tower the low band's last
    { x0: 133, x1: 409, bays: 12, height: 100, levels: 8, cage: 4, cageW: 1.2, reach: 4.5 }
];

export function duga(b: LevelBuilder): void {
    // the sandy strip they stand on (real ones stand in cleared sand), 5 cm up like the park's paths
    b.box('path', DUGA[0].x0 - 15, 0, DUGA_FRONT - TOWER_D - STRUT_OUT - 5, DUGA[DUGA.length - 1].x1 + 15, 0.05, DUGA_FRONT + 20);
    DUGA.forEach((c, i) => curtain(b, c, i > 0));
}

function curtain(b: LevelBuilder, c: Curtain, sharesFirst: boolean): void {
    const zf = DUGA_FRONT, zb = DUGA_FRONT - TOWER_D, h = c.height;
    const bay = (c.x1 - c.x0) / c.bays, step = h / c.levels, hw = TOWER_W / 2;
    for (let t = sharesFirst ? 1 : 0; t <= c.bays; t++) {
        const x = c.x0 + t * bay;
        for (const lx of [x - hw, x + hw]) for (const lz of [zf, zb]) b.bar('duga-rust', [lx, 0, lz], [lx, h, lz], LEG);
        for (let k = 0; k < c.levels; k++) {
            const y0 = k * step, y1 = y0 + step;
            // across the tower's depth at the top of the panel, and a zigzag on each side and on its front and back
            for (const lx of [x - hw, x + hw]) b.bar('duga-grey', [lx, y1, zf], [lx, y1, zb], BRACE);
            const flip = k % 2 === 0;
            b.bar('duga-grey', [x - hw, y0, flip ? zf : zb], [x - hw, y1, flip ? zb : zf], BRACE);
            b.bar('duga-grey', [x + hw, y0, flip ? zb : zf], [x + hw, y1, flip ? zf : zb], BRACE);
            for (const lz of [zf, zb]) b.bar('duga-grey', [flip ? x - hw : x + hw, y0, lz], [flip ? x + hw : x - hw, y1, lz], BRACE);
        }
        // raking struts from the back legs down to the ground behind
        for (const lx of [x - hw, x + hw]) b.bar('duga-rust', [lx, STRUT_Y, zb], [lx, 0, zb - STRUT_OUT], LEG * 0.7);
    }
    // girders the whole length at every level, front and back, and a diagonal across each bay's back every other level
    for (let k = 1; k <= c.levels; k++) {
        // (a curtain sharing its first tower starts its girders inside that tower, clear of the other curtain's)
        for (const lz of [zf, zb]) b.bar('duga-grey', [c.x0 + (sharesFirst ? hw : -hw), k * step, lz], [c.x1 + hw, k * step, lz], GIRDER);
        if (k % 2) continue;
        for (let t = 0; t < c.bays; t++) {
            const xa = c.x0 + t * bay + hw, xb = c.x0 + (t + 1) * bay - hw;
            b.bar('duga-grey', [t % 2 ? xa : xb, (k - 2) * step, zb], [t % 2 ? xb : xa, k * step, zb], BRACE);
        }
    }
    // the dipoles: two per bay on each level, mid-panel, each a pair of cages fed in the middle, on an arm from the front girder
    for (let k = 0; k < c.levels; k++) {
        const y = (k + 0.5) * step;
        for (let t = 0; t < c.bays; t++) {
            for (const f of [0.25, 0.75]) {
                const x = c.x0 + (t + f) * bay, z = zf + c.reach;
                b.bar('duga-grey', [x, y, zf], [x, y, z - c.cageW / 2], ARM);
                cage(b, x, y, z, c.cage, c.cageW, -1);
                cage(b, x, y, z, c.cage, c.cageW, 1);
            }
        }
    }
}

/** sqrt(3)/2, for the cages' hexagons */
const S3 = 0.8660254037844386;

/**
 * One cage of a dipole, fed at (x, y, z) and reaching dir (+1 east, -1 west) along x: a 6-sided cone from the feed point
 * out a third of its length to its full width, then a 6-sided cylinder to its flat outer end. 22 triangles.
 */
function cage(b: LevelBuilder, x: number, y: number, z: number, len: number, w: number, dir: number): void {
    const gap = 0.3, r = w / 2;
    const xt = x + dir * gap, xm = x + dir * (gap + len / 3), xe = x + dir * (gap + len);
    // a hexagon across the cage, a corner at the top
    const ring = (cx: number): number[][] => [[0, 1], [S3, 0.5], [S3, -0.5], [0, -1], [-S3, -0.5], [-S3, 0.5]].map(([dz, dy]) => [cx, y + dy * r, z + dz * r]);
    const tip = [xt, y, z], m = ring(xm), e = ring(xe);
    const centre = [(xt + xe) / 2, y, z];
    for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        b.triOut('duga-cage', centre, tip, m[i], m[j]);
        b.quadOut('duga-cage', centre, m[i], m[j], e[j], e[i]);
    }
    for (let i = 1; i < 5; i++) b.triOut('duga-cage', centre, e[0], e[i], e[i + 1]);
}
