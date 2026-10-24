// The clouds' picture (owner, 2026-10-24: "add clouds"): fair-weather cumulus seen from below, as a square that tiles
// with itself. Fractal value noise on a lattice that wraps at the square's edge; where it rises past the coverage it
// is cloud, opaque and white at its thin edges, greyer where it is thicker (a cumulus' base is in its own shade).
// Made from a fixed seed, so every visit has the same sky. Drawn only: no Three.js here, so Node tests check it.

/** the picture's side, pixels */
export const CLOUD_TEX = 1024;
/** how much of the sky is cloud, about: noise above 1 - this (fair-weather cumulus, "few" to "scattered" in METAR terms) */
export const CLOUD_COVER = 0.35;

/** a lattice of `period` x `period` random values in [0, 1), from `seed` */
function lattice(period: number, seed: number): Float32Array {
    const out = new Float32Array(period * period);
    for (let k = 0; k < out.length; k++) {
        let h = Math.imul(k, 374761393) ^ Math.imul(seed + 1, 0x27d4eb2d);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
        out[k] = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
    }
    return out;
}

/** smooth value noise in [0, 1] at (x, y) on a lattice of cells of 1 that wraps every `period` cells */
function noise(l: Float32Array, period: number, x: number, y: number): number {
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    const x0 = ((xf % period) + period) % period, y0 = ((yf % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = l[y0 * period + x0], b = l[y0 * period + x1], c = l[y1 * period + x0], d = l[y1 * period + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function smoothstep(e0: number, e1: number, v: number): number {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/**
 * The clouds as RGBA, `side` x `side` pixels, row by row; each edge continues on the opposite one. Six octaves from 8
 * cells across the square (one cloud or a gap each) down to 256 (ragged edges), where two more noises (which wrap too) push
 * the lookup about, so the clouds don't line up with the lattice.
 */
export function cloudPixels(side = CLOUD_TEX, seed = 7): Uint8Array {
    const out = new Uint8Array(side * side * 4);
    const OCTAVES = 6, BASE = 8, WARP = 6;
    let norm = 0;
    for (let o = 0; o < OCTAVES; o++) norm += 0.5 ** o;
    const edge = 1 - CLOUD_COVER;
    const octaves = Array.from({ length: OCTAVES }, (_, o) => lattice(BASE << o, seed + o));
    const warpU = lattice(WARP, seed + 100), warpV = lattice(WARP, seed + 101);
    for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
            const u = i / side, v = j / side;
            // the warp: up to a third of a base cell either way
            const wu = (noise(warpU, WARP, u * WARP, v * WARP) - 0.5) * 0.66 / BASE;
            const wv = (noise(warpV, WARP, u * WARP, v * WARP) - 0.5) * 0.66 / BASE;
            let n = 0;
            for (let o = 0; o < OCTAVES; o++) {
                const cells = BASE << o;
                n += noise(octaves[o], cells, (u + wu) * cells, (v + wv) * cells) * 0.5 ** o;
            }
            n /= norm;
            // the noise's spread is narrow (a sum of octaves): stretch it about 0.5 so the cover is about CLOUD_COVER
            n = 0.5 + (n - 0.5) * 2.4;
            const alpha = smoothstep(edge - 0.04, edge + 0.1, n);
            const thick = smoothstep(edge, edge + 0.45, n);
            const k = 4 * (j * side + i);
            // white at the edges, a blue-grey base where thick
            out[k] = Math.round(255 * (1 - 0.3 * thick));
            out[k + 1] = Math.round(255 * (1 - 0.27 * thick));
            out[k + 2] = Math.round(255 * (1 - 0.2 * thick));
            out[k + 3] = Math.round(255 * alpha);
        }
    }
    return out;
}
