// Where the clouds' puffs are (owner, 2026-10-24: "Make lower stylized clouds, that players can go up and fly
// through"). Stylised cumulus, each a heap of round puffs squashed a little, big and high in the middle, smaller to
// the ends, their bottoms near one height, low enough to climb to: bases 180-280 m, over everything the map builds.
// Placed from a fixed seed on a jittered grid over a square round the map, and carried across it by the wind from the
// sim's time (owner, 2026-10-24: "The clouds should be moving across the sky"), so every visit and every replay has the
// same sky at the same moment. A cloud blown off one side comes back on the other: it shrinks away to nothing over the
// last FADE m before the edge and grows back after it, as clouds form and dissolve. Drawn only: no Three.js here, so
// Node tests check it.

/** a puff: its centre, radius across, how much shorter it is up and down than across, and its cloud's middle */
export interface Puff {
    x: number;
    y: number;
    z: number;
    r: number;
    sy: number;
    cx: number;
    cz: number;
}

/** the jittered grid's cell, m, and the share of cells with a cloud */
const CELL = 650;
const FILL = 0.38;
/** half the side of the square the clouds drift across, round the map's middle, m: 10 cells (past the Ultra view from the map's edge) */
export const CLOUD_FIELD = 10 * CELL;
/** a cloud shrinks away over this much before the square's edge, m */
const FADE = 1200;
/** the wind carrying them, m/s along +x (east) and +z (south) [estimate: fair-weather cumulus drift at 5-10 m/s] */
export const CLOUD_WIND = { x: 5, z: 2 };
/** the clouds' bases, m: the lowest and highest (stylised: real fair-weather bases are at 1-2 km) */
export const BASE_MIN = 180;
export const BASE_MAX = 280;
/** puffs are this much shorter up and down than across */
const SQUASH = 0.78;
/** the map's middle, m (packages/maps first-map.ts: the ground from -2000 to 2600 east, -2000 to 2000 north) */
const MID_X = 300;

/** a random value in [0, 1) for integer k and a seed */
function rand(k: number, seed: number): number {
    let h = Math.imul(k, 374761393) ^ Math.imul(seed + 1, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Every puff of every cloud. */
export function cloudPuffs(seed = 7): Puff[] {
    const out: Puff[] = [];
    let k = 0;
    const next = (): number => rand(k++, seed);
    const n = CLOUD_FIELD / CELL;
    for (let gz = -n; gz < n; gz++) for (let gx = -n; gx < n; gx++) {
        if (next() > FILL) continue;
        const cx = MID_X + (gx + 0.15 + 0.7 * next()) * CELL, cz = (gz + 0.15 + 0.7 * next()) * CELL;
        const base = BASE_MIN + (BASE_MAX - BASE_MIN) * next();
        const heading = Math.PI * next();
        // a cloud 90-260 m long, half to two thirds as wide, its middle standing a third to a half of its length up
        const len = 90 + 170 * next(), wide = len * (0.5 + 0.2 * next()), tall = len * (0.3 + 0.2 * next());
        const ca = Math.cos(heading), sa = Math.sin(heading);
        const puffs = Math.round(5 + len / 28);
        for (let i = 0; i < puffs; i++) {
            const u = -0.9 + (1.8 * (i + 0.2 + 0.6 * next())) / puffs;
            const v = (next() - 0.5) * 0.9;
            const core = 1 - 0.55 * (u * u + v * v);
            const r = wide * 0.4 * core * (0.8 + 0.35 * next());
            const ax = (u * len) / 2, az = (v * wide) / 2;
            // bottoms near the base; the middle ones lifted so the cloud heaps up
            const y = base + SQUASH * r * 0.65 + tall * 0.45 * Math.max(0, core - 0.45);
            out.push({ x: cx + ax * ca - az * sa, y, z: cz + ax * sa + az * ca, r, sy: SQUASH, cx, cz });
        }
        // two or three smaller puffs on top of the middle: the cauliflower top
        const tops = 2 + Math.floor(2 * next());
        for (let j = 0; j < tops; j++) {
            const u = (next() - 0.5) * 0.7, v = (next() - 0.5) * 0.4;
            const r = wide * (0.22 + 0.1 * next());
            const ax = (u * len) / 2, az = (v * wide) / 2;
            out.push({ x: cx + ax * ca - az * sa, y: base + tall * (0.55 + 0.2 * next()), z: cz + ax * sa + az * ca, r, sy: SQUASH, cx, cz });
        }
    }
    return out;
}

/** `v` into [-h, h), wrapping */
const wrap = (v: number, h: number): number => ((((v + h) % (2 * h)) + 2 * h) % (2 * h)) - h;

/**
 * The puffs where the wind has carried them `t` s on, into `out` (the same length as `puffs`, overwritten): each cloud
 * moved whole, wrapped round the square, its puffs shrunk near the square's edge (r 0 at the edge itself).
 */
export function drift(puffs: readonly Puff[], t: number, out: Puff[]): void {
    const H = CLOUD_FIELD;
    puffs.forEach((p, i) => {
        const cx = MID_X + wrap(p.cx - MID_X + CLOUD_WIND.x * t, H), cz = wrap(p.cz + CLOUD_WIND.z * t, H);
        const edge = H - Math.max(Math.abs(cx - MID_X), Math.abs(cz));
        const k = Math.min(1, edge / FADE);
        const s = k * k * (3 - 2 * k);
        const o = out[i];
        o.x = cx + (p.x - p.cx) * s;
        o.z = cz + (p.z - p.cz) * s;
        // shrinking towards the base, not the middle of the air
        const base = p.y - p.r * p.sy;
        o.y = base + (p.y - base) * s;
        o.r = p.r * s;
        o.sy = p.sy;
        o.cx = cx;
        o.cz = cz;
    });
}

/**
 * How deep in a cloud point (x, y, z) is, m: the most it is inside any puff (negative: how far outside the nearest).
 * Measured across the puff's squashed shape in units of its radius, then back to metres.
 */
export function insideDepth(puffs: readonly Puff[], x: number, y: number, z: number): number {
    let best = -Infinity;
    for (const p of puffs) {
        const dx = x - p.x, dy = (y - p.y) / p.sy, dz = z - p.z;
        // a quick reject: further off than its radius plus the fade's reach
        if (Math.abs(dx) > p.r + 50 || Math.abs(dz) > p.r + 50) continue;
        best = Math.max(best, p.r - Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    return best;
}
