// The stylised clouds (owner, 2026-10-24: "lower stylized clouds, that players can go up and fly through"):
// render/cloud-puffs.ts and the fog inside them (render/clouds.ts cloudFog).
import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { BASE_MAX, BASE_MIN, CLOUD_FIELD, cloudPuffs, insideDepth } from '../src/render/cloud-puffs';
import { IN_CLOUD_SIGHT, cloudFog } from '../src/render/clouds';

describe('stylised clouds', () => {
    const puffs = cloudPuffs();

    it('are the same every time (a fixed seed: every visit and replay has the same sky)', () => {
        expect(cloudPuffs()).toEqual(puffs);
        expect(cloudPuffs(8)).not.toEqual(puffs);
    });

    it('are plenty, round the whole map, low enough to climb to', () => {
        expect(puffs.length).toBeGreaterThan(300);
        expect(puffs.length).toBeLessThan(2000);
        const bottoms = puffs.map((p) => p.y - p.r * p.sy);
        expect(Math.min(...bottoms)).toBeGreaterThan(BASE_MIN - 25);
        expect(Math.max(...puffs.map((p) => p.y + p.r * p.sy))).toBeLessThan(BASE_MAX + 200);
        for (const p of puffs) expect(Math.hypot(p.x - 300, p.z)).toBeLessThan(CLOUD_FIELD + 300);
        // some over the map itself
        expect(puffs.filter((p) => Math.abs(p.x - 300) < 2300 && Math.abs(p.z) < 2000).length).toBeGreaterThan(40);
    });

    it('stand clear above everything the map builds', () => {
        const level = buildFirstMap();
        let top = 0;
        for (const [, t] of level.parts) for (let i = 1; i < t.length; i += 3) top = Math.max(top, t[i]);
        const lowest = Math.min(...puffs.map((p) => p.y - p.r * p.sy));
        expect(lowest - top).toBeGreaterThan(10);
    });

    it('tell how deep in a cloud a point is', () => {
        const p = puffs[0];
        expect(insideDepth(puffs, p.x, p.y, p.z)).toBeGreaterThanOrEqual(p.r - 1e-9);
        expect(insideDepth(puffs, p.x, p.y + p.r * p.sy + 5, p.z)).toBeLessThan(insideDepth(puffs, p.x, p.y, p.z));
        expect(insideDepth(puffs, 300, 20, 0)).toBeLessThan(0);
    });

    it('fog the view to a few metres inside, the view distance\'s fog outside', () => {
        expect(cloudFog(0, 400, 3000)).toEqual({ near: 400, far: 3000 });
        const inside = cloudFog(1, 400, 3000);
        expect(inside.near).toBe(0);
        expect(inside.far).toBeCloseTo(IN_CLOUD_SIGHT, 6);
        // half way in, already much closer than half of 3 km
        expect(cloudFog(0.5, 400, 3000).far).toBeLessThan(300);
    });
});
