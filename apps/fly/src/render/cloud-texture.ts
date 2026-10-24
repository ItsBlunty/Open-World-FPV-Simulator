// The volumetric clouds' noise (owner, 2026-10-24: "3d pillowy clouds"), made once at load from fixed seeds so every
// visit has the same sky: a 2D coverage map (where the clouds stand, how tall they grow) and a 3D shape volume (the
// billows they are made of), both wrapping at their edges so they tile. The shape is Worley noise turned inside out
// (round lumps round the cells' points) over value noise, the "Perlin-Worley" of Schneider's Horizon Zero Dawn clouds
// (SIGGRAPH 2015, "The real-time volumetric cloudscapes of Horizon Zero Dawn"). clouds.ts ray-marches through them.
// Drawn only: no Three.js here, so Node tests check it.

/** the coverage map's side, texels */
export const COVERAGE_TEX = 256;
/** the shape volume's side, voxels */
export const SHAPE_TEX = 64;

/** a random value in [0, 1) for integer k and a seed */
function rand(k: number, seed: number): number {
    let h = Math.imul(k, 374761393) ^ Math.imul(seed + 1, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** `n` random values in [0, 1) */
function randoms(n: number, seed: number): Float32Array {
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = rand(k, seed);
    return out;
}

const wrap = (i: number, p: number): number => ((i % p) + p) % p;
const fade = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** smooth 2D value noise in [0, 1) on a lattice `l` wrapping every `p` cells */
function noise2(l: Float32Array, p: number, x: number, y: number): number {
    const xf = Math.floor(x), yf = Math.floor(y);
    const sx = fade(x - xf), sy = fade(y - yf);
    const x0 = wrap(xf, p), y0 = wrap(yf, p), x1 = wrap(xf + 1, p), y1 = wrap(yf + 1, p);
    return lerp(lerp(l[y0 * p + x0], l[y0 * p + x1], sx), lerp(l[y1 * p + x0], l[y1 * p + x1], sx), sy);
}

/** smooth 3D value noise in [0, 1) on a lattice `l` wrapping every `p` cells */
function noise3(l: Float32Array, p: number, x: number, y: number, z: number): number {
    const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
    const sx = fade(x - xf), sy = fade(y - yf), sz = fade(z - zf);
    const x0 = wrap(xf, p), x1 = wrap(xf + 1, p), y0 = wrap(yf, p), y1 = wrap(yf + 1, p), z0 = wrap(zf, p), z1 = wrap(zf + 1, p);
    const at = (x: number, y: number, z: number): number => l[(z * p + y) * p + x];
    return lerp(
        lerp(lerp(at(x0, y0, z0), at(x1, y0, z0), sx), lerp(at(x0, y1, z0), at(x1, y1, z0), sx), sy),
        lerp(lerp(at(x0, y0, z1), at(x1, y0, z1), sx), lerp(at(x0, y1, z1), at(x1, y1, z1), sx), sy), sz);
}

/**
 * Worley noise inside out at (x, y, z) in cells, wrapping every `p` cells: 1 at a cell's random point, falling to 0 a
 * cell's width away. `pts` holds each cell's point (3 per cell, within the cell).
 */
function worley(pts: Float32Array, p: number, x: number, y: number, z: number): number {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const k = 3 * ((wrap(cz, p) * p + wrap(cy, p)) * p + wrap(cx, p));
        const ex = cx + pts[k] - x, ey = cy + pts[k + 1] - y, ez = cz + pts[k + 2] - z;
        best = Math.min(best, ex * ex + ey * ey + ez * ez);
    }
    return Math.max(0, 1 - Math.sqrt(best));
}

/**
 * Where the clouds stand: a coverage value per texel (0-255), fractal value noise from 5 cells across down to 80,
 * stretched about its middle so both clear sky and big clouds occur. clouds.ts sets the cover from it.
 */
export function coverageMap(side = COVERAGE_TEX, seed = 7): Uint8Array {
    const out = new Uint8Array(side * side);
    const OCT = 5, BASE = 5;
    const ls = Array.from({ length: OCT }, (_, o) => randoms((BASE << o) ** 2, seed + o));
    let norm = 0;
    for (let o = 0; o < OCT; o++) norm += 0.5 ** o;
    for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
            let n = 0;
            for (let o = 0; o < OCT; o++) {
                const c = BASE << o;
                n += noise2(ls[o], c, (i / side) * c, (j / side) * c) * 0.5 ** o;
            }
            n = 0.5 + (n / norm - 0.5) * 2.2;
            out[j * side + i] = Math.round(255 * Math.min(1, Math.max(0, n)));
        }
    }
    return out;
}

/**
 * The clouds' billows: a value per voxel (0-255), x fastest, then y, then z. Inside-out Worley at 4, 8 and 16 cells
 * across (big lumps with smaller ones on them), carving 3D value noise at 4 and 8: what is left is round and lumpy.
 */
export function shapeVolume(side = SHAPE_TEX, seed = 11): Uint8Array {
    const out = new Uint8Array(side ** 3);
    const W = [4, 8, 16];
    const pts = W.map((c, o) => randoms(3 * c ** 3, seed + 20 + o));
    const V = [4, 8];
    const vl = V.map((c, o) => randoms(c ** 3, seed + o));
    for (let z = 0; z < side; z++) for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const u = x / side, v = y / side, w = z / side;
        const wor = 0.625 * worley(pts[0], W[0], u * W[0], v * W[0], w * W[0])
            + 0.25 * worley(pts[1], W[1], u * W[1], v * W[1], w * W[1])
            + 0.125 * worley(pts[2], W[2], u * W[2], v * W[2], w * W[2]);
        const val = (noise3(vl[0], V[0], u * V[0], v * V[0], w * V[0]) + 0.5 * noise3(vl[1], V[1], u * V[1], v * V[1], w * V[1])) / 1.5;
        // Schneider's remap of the value noise from [wor - 1, 1] onto [0, 1]: the Worley's gaps cut into it
        const n = (val - (wor - 1)) / (2 - wor);
        out[(z * side + y) * side + x] = Math.round(255 * Math.min(1, Math.max(0, n * wor * 1.6)));
    }
    return out;
}
