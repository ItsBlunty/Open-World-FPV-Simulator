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
    it('draws decals but leaves them out of the collision', () => {
        const l = new LevelBuilder().floor('asphalt', 0, 0, 10, 10).decal('marking', 1, 1, 2, 4).build('t', 1, 't', 1);
        expect(l.triangleCount).toBe(2);
        expect(l.collision.length).toBe(18);
        const m = l.parts.get('marking')!;
        expect(m.length).toBe(18);
        expect(outward(m, [1.5, -1, 2.5])).toBe(0); // faces up
        for (let i = 1; i < m.length; i += 3) expect(m[i]).toBeCloseTo(0.02, 6);
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

    it('runs the bando columns unbroken through every floor slab', () => {
        // a ray from the west along the bando's south wall line (z = -12), at the middle of each floor
        // slab's thickness: it must meet the corner column's west face (x = -280.25), not stop at the
        // slab edge (x = -280) as the per-storey columns of map v1 let it
        for (let k = 1; k <= 5; k++) {
            const hit = world.queryRay(-300, k * 3.6 - 0.15, -12, 1, 0, 0, 40);
            expect(hit, `slab ${k}`).not.toBeNull();
            expect(hit!.x, `slab ${k}`).toBeCloseTo(-280.25, 6);
        }
    });

    it('rests every bando wall on a beam and runs it up to the next, missing floor panels or not', () => {
        // a ray from outside at every floor's beam (20 cm under the floor's top), at every exterior bay's
        // middle, meets the edge beam's face 15 cm out from the column line. Map v3 hung the walls from
        // the floor panels, so a missing panel left a 30 cm gap under or over the wall (owner, 2026-10-18).
        let n = 0;
        for (let k = 1; k <= 5; k++) {
            const y = k * 3.6 - 0.2;
            for (let i = 0; i < 10; i++) {
                const x = -280 + i * 6 + 3;
                expect(world.queryRay(x, y, -20, 0, 0, 1, 10)!.z, `floor ${k}, bay ${i}, north`).toBeCloseTo(-12.15, 6);
                expect(world.queryRay(x, y, 20, 0, 0, -1, 10)!.z, `floor ${k}, bay ${i}, south`).toBeCloseTo(12.15, 6);
                n += 2;
            }
            for (let j = 0; j < 4; j++) {
                const z = -12 + j * 6 + 3;
                expect(world.queryRay(-290, y, z, 1, 0, 0, 12)!.x, `floor ${k}, bay ${j}, west`).toBeCloseTo(-280.15, 6);
                expect(world.queryRay(-210, y, z, -1, 0, 0, 12)!.x, `floor ${k}, bay ${j}, east`).toBeCloseTo(-219.85, 6);
                n += 2;
            }
        }
        expect(n).toBe(140);
    });

    it("stands the bando's roof tank on steel beams across the roof beams", () => {
        // the first surface under each leg's foot (18.4 m) is the steel beam's underside on the roof (18 m),
        // never a hole where a roof panel is missing; the steel beams end on the roof beams (17.55-18 m) of
        // column lines 7 and 8 (x = -238 and -232)
        for (const [x, z] of [[-236.5, 4.5], [-233.5, 4.5], [-236.5, 7.5], [-233.5, 7.5]]) {
            expect(world.queryRay(x, 18.39, z, 0, -1, 0, 20)!.y, `leg at ${x}, ${z}`).toBeCloseTo(18, 6);
            for (const xb of [-238, -232]) expect(world.queryRay(xb, 17, z, 0, 1, 0, 5)!.y, `beam under ${xb}, ${z}`).toBeCloseTo(17.55, 6);
        }
    });

    it('sets city windows back into the walls', () => {
        // rays at the first upper storey's window height into the south faces of the southmost row of
        // blocks: every building face shows exactly two depths, the wall and the glass 15 cm behind it
        let faces = 0;
        for (let a = 0; a < 12; a++) {
            const depths = new Set<number>();
            for (let x = -480 + a * 80 + 9 + 6; x < -480 + a * 80 + 9 + 56; x += 0.1) {
                const hit = world.queryRay(x, 0.15 + 3.5 + 1.75, -95, 0, 0, -1, 30);
                if (hit && hit.z < -100) depths.add(Math.round(hit.z * 1e4) / 1e4);
            }
            if (depths.size !== 2) continue;
            const [p, q] = [...depths].sort((u, v) => u - v);
            expect(q - p, `block ${a}`).toBeCloseTo(0.15, 6);
            faces++;
        }
        expect(faces).toBeGreaterThanOrEqual(3);
        expect(level.parts.get('window')!.length).toBeGreaterThan(0);
        expect(level.parts.get('window-ribbon')!.length).toBeGreaterThan(0);
    });

    it('ramps the car park up to its first level through an opening in it', () => {
        // the car park's block: x0 = 89, z0 = -161; the first ramp in lane A (x 138.5-142), z -141 to -121,
        // from the sidewalk (0.15) to level 1 (3.35)
        const mid = world.queryRay(140.25, 3, -131, 0, -1, 0, 5);
        expect(mid!.y).toBeCloseTo(0.15 + 1.6, 6);
        // over it the opening in level 1; the first thing above is level 2's underside (6.55 - 0.3)
        const over = world.queryRay(140.25, 2, -131, 0, 1, 0, 10);
        expect(over!.y).toBeCloseTo(6.25, 6);
        // the top of the ramp meets level 1 flush
        expect(world.queryRay(140.25, 5, -121.5, 0, -1, 0, 5)!.y).toBeCloseTo(0.15 + 3.2 * 19.5 / 20, 6);
        expect(world.queryRay(140.25, 5, -120.5, 0, -1, 0, 5)!.y).toBeCloseTo(3.35, 6);
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

const PINNED = 'e6d95de18404af1d3cf4076f7effc1f3e1e75b6520e342530cc5eeda237fa75e';
