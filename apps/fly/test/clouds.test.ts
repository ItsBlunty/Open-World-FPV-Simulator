// The volumetric clouds' noise (owner, 2026-10-24: "3d pillowy clouds"): render/cloud-texture.ts.
import { describe, expect, it } from 'vitest';
import { coverageMap, shapeVolume } from '../src/render/cloud-texture';

/** the biggest step between neighbours along x inside, and across the wrap from the last column to the first */
function steps(get: (i: number, j: number) => number, side: number, rows: number): { inside: number; seam: number } {
    let inside = 0, seam = 0;
    for (let j = 0; j < rows; j++) {
        for (let i = 1; i < side; i++) inside = Math.max(inside, Math.abs(get(i, j) - get(i - 1, j)));
        seam = Math.max(seam, Math.abs(get(0, j) - get(side - 1, j)));
    }
    return { inside, seam };
}

describe('cloud noise', () => {
    const cov = coverageMap(128);
    const S = 32;
    const shape = shapeVolume(S);

    it('is the same every time (fixed seeds: every visit has the same sky)', () => {
        expect(coverageMap(128)).toEqual(cov);
        expect(shapeVolume(S)).toEqual(shape);
        expect(coverageMap(128, 8)).not.toEqual(cov);
    });

    it('has clear sky and thick cover both on the coverage map', () => {
        let clear = 0, thick = 0;
        for (const v of cov) {
            if (v < 100) clear++;
            if (v > 180) thick++;
        }
        expect(clear / cov.length).toBeGreaterThan(0.15);
        expect(thick / cov.length).toBeGreaterThan(0.15);
    });

    it('tiles: each edge runs on into the opposite one as smoothly as inside', () => {
        const c = steps((i, j) => cov[j * 128 + i], 128, 128);
        expect(c.seam).toBeLessThanOrEqual(c.inside);
        // the volume along x, on every row of every slice; and along z
        const x = steps((i, j) => shape[j * S + i], S, S * S);
        expect(x.seam).toBeLessThanOrEqual(x.inside);
        const z = steps((k, j) => shape[(k * S) * S + j], S, S);
        expect(z.seam).toBeLessThanOrEqual(z.inside);
    });

    it('has lumps and gaps in the shape volume', () => {
        let lo = 255, hi = 0;
        for (const v of shape) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
        }
        expect(hi - lo).toBeGreaterThan(120);
    });
});
