// The clouds' picture (owner, 2026-10-24: "add clouds"): render/cloud-texture.ts.
import { describe, expect, it } from 'vitest';
import { CLOUD_COVER, cloudPixels } from '../src/render/cloud-texture';

describe('cloud picture', () => {
    const side = 256;
    const p = cloudPixels(side);
    const alpha = (i: number, j: number): number => p[4 * (((j + side) % side) * side + ((i + side) % side)) + 3];

    it('is the same every time (a fixed seed: every visit has the same sky)', () => {
        expect(cloudPixels(side)).toEqual(p);
        expect(cloudPixels(side, 8)).not.toEqual(p);
    });

    it('covers about CLOUD_COVER of the sky', () => {
        let cloud = 0;
        for (let k = 3; k < p.length; k += 4) if (p[k] > 127) cloud++;
        const share = cloud / (side * side);
        expect(share).toBeGreaterThan(CLOUD_COVER - 0.12);
        expect(share).toBeLessThan(CLOUD_COVER + 0.05);
    });

    it('tiles: each edge runs on into the opposite one as smoothly as inside the picture', () => {
        // the biggest step between neighbours across the seam is no bigger than the biggest inside
        let inside = 0, seam = 0;
        for (let j = 0; j < side; j++) {
            for (let i = 1; i < side; i++) inside = Math.max(inside, Math.abs(alpha(i, j) - alpha(i - 1, j)));
            seam = Math.max(seam, Math.abs(alpha(0, j) - alpha(side - 1, j)), Math.abs(alpha(j, 0) - alpha(j, side - 1)));
        }
        expect(seam).toBeLessThanOrEqual(inside);
    });

    it('is white at a cloud\'s edge and greyer where it is thick', () => {
        let edge = 0, thick = 0;
        for (let k = 0; k < p.length; k += 4) {
            if (p[k + 3] > 0 && p[k + 3] < 64) edge = Math.max(edge, p[k]);
            if (p[k + 3] === 255) thick = Math.max(thick, 255 - p[k]);
        }
        expect(edge).toBeGreaterThan(245);
        expect(thick).toBeGreaterThan(30);
    });
});
