// The first map: geometry sanity (every face wound outwards, nothing degenerate), its collision hash
// pinned (any change to the layout must bump MAP_VERSION and this hash together), and every spawn point
// resting on a surface with room around it for a 5-inch quad.

import { describe, expect, it } from 'vitest';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { LevelBuilder, MAP_VERSION, buildFirstMap, levelSha256, spawnPose } from '../src/index';

/** For a closed shape around `c`, every triangle's normal must point away from c. */
function outward(tris: Float32Array, c: number[]): number {
    let bad = 0;
    for (let i = 0; i < tris.length; i += 9) {
        const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
        const ux = tris[i + 3] - ax, uy = tris[i + 4] - ay, uz = tris[i + 5] - az;
        const vx = tris[i + 6] - ax, vy = tris[i + 7] - ay, vz = tris[i + 8] - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const mx = (ax + tris[i + 3] + tris[i + 6]) / 3 - c[0];
        const my = (ay + tris[i + 4] + tris[i + 7]) / 3 - c[1];
        const mz = (az + tris[i + 5] + tris[i + 8]) / 3 - c[2];
        if (nx * mx + ny * my + nz * mz <= 0) bad++;
    }
    return bad;
}

describe('level builder', () => {
    it('winds boxes, prisms and cones outwards', () => {
        for (const n of [4, 6, 8]) {
            const b = new LevelBuilder().prism('metal', 1, 2, 0, 3, 0.5, n).build('t', 1, 't', 1);
            expect(outward(b.parts.get('metal')!, [1, 1.5, 2])).toBe(0);
            const c = new LevelBuilder().cone('metal', 1, 2, 0, 3, 0.5, n).build('t', 1, 't', 1);
            expect(outward(c.parts.get('metal')!, [1, 0.75, 2])).toBe(0);
        }
        const x = new LevelBuilder().box('metal', 0, 0, 0, 2, 3, 4).build('t', 1, 't', 1);
        expect(outward(x.parts.get('metal')!, [1, 1.5, 2])).toBe(0);
        const f = new LevelBuilder().floor('grass', 0, 0, 1, 1).build('t', 1, 't', 1).parts.get('grass')!;
        expect(outward(f, [0.5, -1, 0.5])).toBe(0);
    });
});

describe('first map', () => {
    const level = buildFirstMap();
    const world = new MeshContactWorld(level.collision);

    it('builds the same triangles every time (pinned hash)', () => {
        console.log(`map ${level.id} v${MAP_VERSION}: ${level.triangleCount} triangles, sha256 ${levelSha256(level)}`);
        expect(levelSha256(buildFirstMap())).toBe(levelSha256(level));
        expect(world.degenerate).toBe(0);
        expect(levelSha256(level)).toBe(PINNED);
    });

    it('puts every spawn point on a surface with room for the quad', () => {
        const groundY = (x: number, z: number): number => {
            const hit = world.queryRay(x, 500, z, 0, -1, 0, 1000);
            if (!hit) throw new Error(`nothing under ${x}, ${z}`);
            return hit.y;
        };
        const out = { x: 0, y: 0, z: 0 };
        for (const s of level.spawns) {
            const [x, y, z] = spawnPose(s, groundY, 0.03);
            // a sphere of 0.25 m (a 5-inch quad with props) around the body clears everything
            expect(world.querySphere(x, y + 0.25, z, 0.25, out), s.id).toBe(false);
            // nothing just above: the quad can climb out
            expect(world.queryRay(x, y + 0.3, z, 0, 1, 0, 3), s.id).toBeNull();
        }
    });
});

const PINNED = '86ca74a03ded09bba5c35a6d6ddcbf31a5e63363d66fcf3f9aff14a462e60a78';
