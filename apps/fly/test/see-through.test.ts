// The chase camera's see-through circle (owner, 2026-10-19): it shows when a wall stands between the camera and the
// quad, not for a wall behind the quad or one the quad rests against, and its mask fades smoothly to the edge.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { CLEAR_M, INNER, blocked, maskAt } from '../src/render/see-through';

/** a 10 x 10 m wall across the Z axis at z = 0 (two triangles) */
const wall = new MeshContactWorld([-5, -5, 0, 5, -5, 0, 5, 5, 0, -5, -5, 0, 5, 5, 0, -5, 5, 0]);
const rayT = wall.rayT.bind(wall);
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

describe('see-through circle', () => {
    it('is blocked by a wall between the camera and the quad', () => {
        expect(blocked(v(0, 1, 3), v(0, 1, -1), rayT)).toBe(true);
        // from the other side as well: the collision mesh is two-sided
        expect(blocked(v(0, 1, -3), v(0, 1, 1), rayT)).toBe(true);
    });

    it('is not blocked with the wall behind the quad, beside the view, or touching the quad', () => {
        expect(blocked(v(0, 1, 5), v(0, 1, 1), rayT)).toBe(false);
        expect(blocked(v(8, 1, 3), v(8, 1, -1), rayT)).toBe(false);
        // the quad just past the wall, closer than CLEAR_M: not counted
        expect(blocked(v(0, 1, 3), v(0, 1, -(CLEAR_M - 0.05)), rayT)).toBe(false);
    });

    it('masks fully inside, fades to nothing at the edge', () => {
        expect(maskAt(0)).toBe(1);
        expect(maskAt(INNER)).toBe(1);
        expect(maskAt(1)).toBe(0);
        expect(maskAt(1.4)).toBe(0);
        let prev = 1;
        for (let r = INNER; r <= 1; r += 0.01) {
            const m = maskAt(r);
            expect(m).toBeLessThanOrEqual(prev);
            prev = m;
        }
    });
});
