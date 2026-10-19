// The first map: geometry sanity (every face wound outwards, nothing degenerate), its collision hash
// pinned (any change to the layout must bump MAP_VERSION and this hash together), and every spawn point
// resting on a surface with room around it for a 5-inch quad.

import { describe, expect, it } from 'vitest';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { LevelBuilder, MAP_VERSION, RAIL_CORNERS, RAIL_RADIUS, buildFirstMap, levelSha256, loopPieces, spawnPose } from '../src/index';

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

    it('builds the tower crane as open lattice: a quad fits through the tower and the jib', () => {
        // the construction block: x0 = -71, z0 = -241; the crane's tower at x0 + 31, z0 + 31
        const cx = -40, cz = -210;
        const top = 0.65 + 12 * 3.9;
        // the slewing unit's top, straight over the tower
        expect(world.queryRay(cx, 100, cz, 0, -1, 0, 100)!.y).toBeCloseTo(top + 1, 6);
        const out = { x: 0, y: 0, z: 0 };
        const quad = 0.25; // a 5-inch quad with its props, m
        // the tower is hollow, and every section's south face has room for the quad to pass through it
        for (let s = 0; s < 12; s++) {
            const y0 = 0.65 + s * 3.9;
            expect(world.querySphere(cx, y0 + 1.95, cz, 0.5, out), `inside section ${s}`).toBe(false);
            let gaps = 0;
            for (let x = -0.5; x <= 0.5; x += 0.1) for (let y = 0.3; y <= 3.6; y += 0.1) {
                if (!world.querySphere(cx + x, y0 + y, cz - 0.8, quad, out)) gaps++;
            }
            expect(gaps, `section ${s}`).toBeGreaterThan(0);
        }
        // the jib: a ray down through each of its first ten panels' bottom face finds a gap to the ground or the
        // steel frame (the bottom face's diagonal leaves room either side of it)
        const sy = top + 1;
        for (let k = 0; k < 10; k++) {
            const x = cx + 1.2 + 2.5 * k + 0.6;
            if (Math.abs(x - (cx + 20)) < 1.5) continue; // the trolley
            const hit = world.queryRay(x, sy + 0.3, cz + 0.4, 0, -1, 0, 30);
            expect(hit === null || hit.y < sy - 1, `jib panel ${k}`).toBe(true);
        }
        // the hook hangs on its rope above the frame (24.15 m): straight under the trolley the first thing is the
        // hook block's top
        expect(world.queryRay(cx + 20, sy - 0.6, cz + 0.1, 0, -1, 0, 30)!.y).toBeCloseTo(31.1, 6);
    });

    it('names every city building and gives it a street door with no sill', () => {
        expect(level.buildings.length).toBeGreaterThan(100);
        expect(new Set(level.buildings.map((b) => b.name)).size).toBe(level.buildings.length);
        const MASK: Record<string, number> = { '0,-1': 4, '0,1': 8, '-1,0': 16, '1,0': 32 };
        for (const b of level.buildings) {
            const d = level.doors[b.door];
            expect(d.building).toBe(level.buildings.indexOf(b));
            // on a face that looks onto a street
            expect(b.street & MASK[`${d.nx},${d.nz}`], b.name).toBeTruthy();
            // 15 cm above the sidewalk, from just outside, the first thing in is the glass in the reveal (no sill)
            const hit = world.queryRay(d.x + d.nx * 0.5, d.y + 0.15, d.z + d.nz * 0.5, -d.nx, 0, -d.nz, 2);
            expect(hit, b.name).not.toBeNull();
            expect(Math.abs(hit!.x - d.x) + Math.abs(hit!.z - d.z), b.name).toBeCloseTo(d.depth, 6);
            // beside the opening, the wall's sill comes first, on the face
            const sx = d.x - d.nz * (d.width / 2 + 0.2), sz = d.z + d.nx * (d.width / 2 + 0.2);
            const sill = world.queryRay(sx + d.nx * 0.5, d.y + 0.15, sz + d.nz * 0.5, -d.nx, 0, -d.nz, 2);
            expect(Math.abs(sill!.x - sx) + Math.abs(sill!.z - sz), b.name).toBeCloseTo(0, 6);
        }
    });

    it('leaves the train room all round the railway loop, through the tunnel and past the platform', () => {
        const rw = level.railway!;
        expect(rw.corners).toEqual(RAIL_CORNERS);
        const { pieces, length } = loopPieces(rw.corners, rw.radius);
        expect(length).toBeCloseTo(2 * 270 + 2 * 10 + 2 * Math.PI * RAIL_RADIUS, 6);
        const out = { x: 0, y: 0, z: 0 };
        // the train's outline (packages/traffic train.ts): 2.82 m wide, 0.55 to 3.95 m up. Spheres of 0.15 m on that
        // outline every metre round the loop touch nothing still (on the curves the coaches' ends swing out a little more)
        let n = 0;
        for (const g of pieces) for (let u = 0; u < g.len; u += 1) {
            let x: number, z: number, hx: number, hz: number;
            if (!g.arc) { x = g.ax + g.dx * u; z = g.az + g.dz * u; hx = g.dx; hz = g.dz; } else {
                const th = g.a0 + g.sweep * (u / g.len), sg = g.sweep > 0 ? 1 : -1;
                x = g.cx + rw.radius * Math.cos(th); z = g.cz + rw.radius * Math.sin(th); hx = -Math.sin(th) * sg; hz = Math.cos(th) * sg;
            }
            for (const o of [-1.3, 0, 1.3]) for (const y of [0.7, 2, 3.2, 3.8]) {
                n++;
                expect(world.querySphere(x - hz * o, y, z + hx * o, 0.15, out), `at ${x.toFixed(1)}, ${z.toFixed(1)}, ${o} m across, ${y} m up`).toBe(false);
            }
        }
        expect(n).toBeGreaterThan(12 * 1200);
        // the tunnel: open along the bore at head height, the arch's crown 6.5 m up, the hill's grass over it
        const t = rw.tunnel;
        expect(world.queryRay(t.x0 - 30, 3, t.z, 1, 0, 0, t.x1 - t.x0 + 60)).toBeNull();
        expect(world.queryRay(-10, 1, t.z, 0, 1, 0, 50)!.y).toBeCloseTo(t.crown, 6);
        expect(world.queryRay(-10, 100, t.z, 0, -1, 0, 100)!.y).toBeGreaterThan(20);
        // the platform's top 0.9 m up, its edge 1.5 m from the track; the station spawn stands on it
        expect(world.queryRay(32, 10, 480, 0, -1, 0, 20)!.y).toBeCloseTo(0.9, 6);
        expect(world.queryRay(32, 0.6, rw.stopZ, 0, 0, 1, 5)!.z).toBeCloseTo(rw.stopZ + 1.5, 6);
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

const PINNED = 'a4e18ec2a1267b0c2fbea3505c202972d8f2356df576466bf9caa6d97a4b1c48';
