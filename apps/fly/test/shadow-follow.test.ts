// The sun's shadow square moves only when the camera has gone far enough from its centre (owner, 2026-10-18: moving it
// every frame made Firefox stutter; docs/notes/browsers-input-performance.md §0l).

import { describe, expect, it } from 'vitest';
import { RECENTRE_DEPTH_M, RECENTRE_M, shadowNeedsRecentre } from '../src/render/shadow-follow';

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
