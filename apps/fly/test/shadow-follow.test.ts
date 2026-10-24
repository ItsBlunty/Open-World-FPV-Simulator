// The sun's shadow square moves only when the camera has gone far enough from its centre (owner, 2026-10-18: moving it
// every frame made Firefox stutter; docs/notes/browsers-input-performance.md §0l).

import { describe, expect, it } from 'vitest';
import { RECENTRE_DEPTH_M, RECENTRE_M, SHADOW_REACHES, SHADOW_REACH_IDS, isShadowReach, shadowDepth, shadowNeedsRecentre, shadowReach } from '../src/render/shadow-follow';

describe('shadow square recentring', () => {
    const c = { x: 10, y: -5, z: 300 };

    it('moves on the first frame', () => {
        expect(shadowNeedsRecentre(null, c)).toBe(true);
    });

    it('stays put inside RECENTRE_M across the sun and RECENTRE_DEPTH_M along it', () => {
        expect(shadowNeedsRecentre(c, { x: c.x + RECENTRE_M * 0.7, y: c.y + RECENTRE_M * 0.7, z: c.z })).toBe(false);
        expect(shadowNeedsRecentre(c, { x: c.x, y: c.y, z: c.z - RECENTRE_DEPTH_M })).toBe(false);
    });

    it('moves past either limit', () => {
        expect(shadowNeedsRecentre(c, { x: c.x + RECENTRE_M + 0.01, y: c.y, z: c.z })).toBe(true);
        expect(shadowNeedsRecentre(c, { x: c.x, y: c.y - RECENTRE_M * 0.8, z: c.z })).toBe(false);
        expect(shadowNeedsRecentre(c, { x: c.x + RECENTRE_M * 0.8, y: c.y - RECENTRE_M * 0.8, z: c.z })).toBe(true);
        expect(shadowNeedsRecentre(c, { x: c.x, y: c.y, z: c.z + RECENTRE_DEPTH_M + 0.01 })).toBe(true);
    });
});

describe('shadow reach', () => {
    it('keeps near as the old 240 m square on a 4096 map', () => {
        expect(SHADOW_REACHES.near).toEqual({ half: 120, map: 4096 });
    });

    it('reaches further with each step, never blurrier than 13 cm a texel (on a GPU with 16384² textures)', () => {
        let last = 0;
        for (const id of SHADOW_REACH_IDS) {
            const r = shadowReach(id, 16384);
            expect(r.half - RECENTRE_M).toBeGreaterThan(last);
            expect((2 * r.half) / r.map).toBeLessThan(0.13);
            last = r.half - RECENTRE_M;
        }
    });

    it('keeps the map within the GPU largest texture', () => {
        expect(shadowReach('far', 4096).map).toBe(4096);
        expect(shadowReach('far', 16384).map).toBe(8192);
        // ultra (owner, 2026-10-24): 16384² where the GPU allows it, else 8192² (25 cm texels)
        expect(shadowReach('ultra', 16384)).toEqual({ half: 1016, map: 16384 });
        expect(shadowReach('ultra', 8192).map).toBe(8192);
    });

    it('stands the shadow camera far enough up-sun for the whole square under a camera 400 m up, at every reach', () => {
        // the sun 54 deg up (render/world.ts SUN_DIR): the square's edge lies cot(54) half along the view, the ground under
        // a camera h up sin(54) h further, and the square moves after 100 m along it
        const sunUp = Math.asin(500 / Math.hypot(300, 500, 200));
        for (const id of SHADOW_REACH_IDS) {
            const half = SHADOW_REACHES[id].half;
            expect(shadowDepth(half)).toBeGreaterThan(half / Math.tan(sunUp) + 400 * Math.sin(sunUp) + RECENTRE_DEPTH_M);
            expect(shadowDepth(half)).toBeGreaterThanOrEqual(600);
        }
    });

    it('accepts only known reaches from storage', () => {
        expect(isShadowReach('far')).toBe(true);
        expect(isShadowReach('toString')).toBe(false);
        expect(isShadowReach(250)).toBe(false);
    });
});
