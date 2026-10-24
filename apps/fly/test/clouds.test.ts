// The stylised clouds (owner, 2026-10-24: "lower stylized clouds, that players can go up and fly through"):
// render/cloud-puffs.ts and the fog inside them (render/clouds.ts cloudFog).
import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { BASE_MAX, BASE_MIN, CLOUD_FIELD, CLOUD_WIND, cloudPuffs, drift, insideDepth } from '../src/render/cloud-puffs';
import type { Puff } from '../src/render/cloud-puffs';
import { IN_CLOUD_SIGHT, cloudFog } from '../src/render/clouds';

describe('stylised clouds', () => {
    const puffs = cloudPuffs();

    it('are the same every time (a fixed seed: every visit and replay has the same sky)', () => {
        expect(cloudPuffs()).toEqual(puffs);
        expect(cloudPuffs(8)).not.toEqual(puffs);
    });

    it('are plenty, round the whole map, low enough to climb to', () => {
        expect(puffs.length).toBeGreaterThan(300);
        expect(puffs.length).toBeLessThan(2500);
        const bottoms = puffs.map((p) => p.y - p.r * p.sy);
        expect(Math.min(...bottoms)).toBeGreaterThan(BASE_MIN - 25);
        expect(Math.max(...puffs.map((p) => p.y + p.r * p.sy))).toBeLessThan(BASE_MAX + 200);
        for (const p of puffs) expect(Math.max(Math.abs(p.cx - 300), Math.abs(p.cz))).toBeLessThan(CLOUD_FIELD);
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

    it('drift with the wind (owner, 2026-10-24: "moving across the sky"), smoothly, coming back round the square', () => {
        const at = (t: number): Puff[] => {
            const out = puffs.map((p) => ({ ...p }));
            drift(puffs, t, out);
            return out;
        };
        const a = at(600), b = at(600.1);
        // a tenth of a second on: every puff moved by about the wind, none jumped (a wrapping cloud is shrunk to nothing)
        const wind = Math.hypot(CLOUD_WIND.x, CLOUD_WIND.z) * 0.1;
        for (let i = 0; i < a.length; i++) {
            const step = Math.hypot(b[i].x - a[i].x, b[i].z - a[i].z);
            if (a[i].r > 0.5 && b[i].r > 0.5) expect(step).toBeLessThan(wind + 0.5);
        }
        // the middle of a cloud well inside the square moves with the wind and keeps its size
        const k = puffs.findIndex((p) => Math.abs(p.cx - 300) < 1000 && Math.abs(p.cz) < 1000);
        const c0 = at(0)[k], c1 = at(100)[k];
        expect(c1.cx - c0.cx).toBeCloseTo(CLOUD_WIND.x * 100, 6);
        expect(c1.r).toBeCloseTo(puffs[k].r, 6);
        // an hour on, still within the square, and the same sky every time at the same moment
        for (const p of at(3600)) expect(Math.max(Math.abs(p.cx - 300), Math.abs(p.cz))).toBeLessThanOrEqual(CLOUD_FIELD);
        expect(at(1234)).toEqual(at(1234));
        // a cloud at the square's edge is gone (its puffs 0 across)
        const edge = at(3600).filter((p) => CLOUD_FIELD - Math.max(Math.abs(p.cx - 300), Math.abs(p.cz)) < 1);
        for (const p of edge) expect(p.r).toBeLessThan(0.01);
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
