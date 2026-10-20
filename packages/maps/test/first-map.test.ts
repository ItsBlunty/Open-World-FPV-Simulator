// The first map: geometry sanity (every face wound outwards, nothing degenerate), its collision hash
// pinned (any change to the layout must bump MAP_VERSION and this hash together), and every spawn point
// resting on a surface with room around it for a 5-inch quad.

import { describe, expect, it } from 'vitest';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { CLEARING, DUGA, DUGA_FRONT, FOREST, dugaScreen, dugaTowers, LevelBuilder, MAP_VERSION, RAIL_CORNERS, RAIL_RADIUS, bedAt, buildFirstMap, levelSha256, loopPieces, nearTrack, spawnPose } from '../src/index';

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
        // a hopper: a cone pointing down
        for (const n of [6, 8]) {
            const h = new LevelBuilder().cone('metal', 1, 2, 3, 0, 0.5, n).build('t', 1, 't', 1);
            expect(outward(h.parts.get('metal')!, [1, 2.25, 2])).toBe(0);
            const l = new LevelBuilder().blob('foliage', 1, 2, 3, 1.5, 1, n).build('t', 1, 't', 1);
            expect(outward(l.parts.get('foliage')!, [1, 2, 3])).toBe(0);
            expect(l.triangleCount).toBe(4 * n);
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
    const out = { x: 0, y: 0, z: 0 };

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

    it('leaves the train room all round the railway loop: on the ground, up the climbs, over the city, through the tunnel', () => {
        const rw = level.railway!;
        expect(rw.corners).toEqual(RAIL_CORNERS);
        const { pieces, length } = loopPieces(rw.corners, rw.radius);
        expect(rw.length).toBe(length);
        expect(length).toBeCloseTo(175 + 430 + 150 + 1020 + 525 + 390 + 6 * (Math.PI / 2) * RAIL_RADIUS, 6);
        const out = { x: 0, y: 0, z: 0 };
        // the train's outline (packages/traffic train.ts): 2.82 m wide, 0.55 to 4.0 m over the ground under the ballast
        // (0.3 m under the bed). Spheres of 0.15 m on that outline every metre round the loop touch nothing still (on
        // the curves the coaches' ends swing out a little more)
        let n = 0, highest = 0;
        for (const g of pieces) for (let u = 0; u < g.len; u += 1) {
            let x: number, z: number, hx: number, hz: number;
            if (!g.arc) { x = g.ax + g.dx * u; z = g.az + g.dz * u; hx = g.dx; hz = g.dz; } else {
                const th = g.a0 + g.sweep * (u / g.len), sg = g.sweep > 0 ? 1 : -1;
                x = g.cx + rw.radius * Math.cos(th); z = g.cz + rw.radius * Math.sin(th); hx = -Math.sin(th) * sg; hz = Math.cos(th) * sg;
            }
            const base = bedAt(rw, g.s0 + u) - 0.3;
            highest = Math.max(highest, base);
            for (const o of [-1.3, 0, 1.3]) for (const y of [0.7, 2, 3.2, 3.9]) {
                n++;
                expect(world.querySphere(x - hz * o, base + y, z + hx * o, 0.15, out), `at ${x.toFixed(1)}, ${z.toFixed(1)}, ${o} m across, ${y} m up`).toBe(false);
            }
        }
        expect(n).toBeGreaterThan(12 * 3600);
        expect(highest).toBeCloseTo(8, 6);
        // the city viaduct: its deck's top 8.3 m up over the street's centre, its underside 7.1 m; under it only the piers,
        // mid-block, so the street is open at every junction
        for (let x = -495; x <= 495; x += 1) {
            expect(world.queryRay(x, 20, -250, 0, -1, 0, 20)!.y, `deck at ${x}`).toBeCloseTo(8.3, 6);
            // only the piers, and only mid-block (18-62 m past a junction)
            const k = (((x + 480) % 80) + 80) % 80;
            if (k < 17 || k > 63) expect(world.queryRay(x, 0.2, -248, 0, 1, 0, 6.8), `under the deck at ${x}`).toBeNull();
        }
        for (let a = 0; a <= 12; a++) expect(world.queryRay(-480 + 80 * a, 0.2, -250, 0, 1, 0, 6.8), `junction ${a}`).toBeNull();
        // the tunnel along z at x 20: open along the bore at head height, the arch's crown 6.5 m up, the hill over it
        const t = rw.tunnel;
        expect(t.axis).toBe('z');
        expect(world.queryRay(t.c, 3, t.a0 - 30, 0, 0, 1, t.a1 - t.a0 + 60)).toBeNull();
        expect(world.queryRay(t.c, 1, (t.a0 + t.a1) / 2, 0, 1, 0, 50)!.y).toBeCloseTo(t.crown, 6);
        expect(world.queryRay(t.c, 100, (t.a0 + t.a1) / 2, 0, -1, 0, 100)!.y).toBeGreaterThan(20);
        // the fields platform's top 0.9 m up, its edge 1.5 m from the track; the city platforms 0.45 m over the rails
        expect(world.queryRay(292, 10, 480, 0, -1, 0, 20)!.y).toBeCloseTo(0.9, 6);
        expect(world.queryRay(292, 0.6, 475, 0, 0, 1, 5)!.z).toBeCloseTo(476.5, 6);
        expect(world.queryRay(10, 20, -253.3, 0, -1, 0, 20)!.y).toBeCloseTo(9.45, 6);
        expect(world.queryRay(10, 20, -246.7, 0, -1, 0, 20)!.y).toBeCloseTo(9.45, 6);
        expect(rw.stops.map((s) => s.name)).toEqual(['Fields station', 'City station']);
    });

    it('gives people a clear way from the garden up the stair and over the footbridge to the city platform', () => {
        const w = level.railway!.walkway!;
        const blk = level.blocks[w.block];
        expect([blk.x0, blk.z0, blk.x1, blk.z1]).toEqual([9, -241, 71, -179]);
        const out = { x: 0, y: 0, z: 0 };
        // a person: spheres of 0.28 m at their legs and head along the walk, every 10 cm; their feet on what is under them
        let n = 0;
        for (let i = 0; i + 1 < w.up.length; i++) {
            const [ax, ay, az] = w.up[i], [bx, by, bz] = w.up[i + 1];
            const len = Math.hypot(bx - ax, bz - az);
            for (let u = 0; u <= len; u += 0.1) {
                const t = len > 0 ? u / len : 0;
                const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
                for (const h of [0.6, 1.5]) expect(world.querySphere(x, y + h, z, 0.28, out), `walk at ${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)}`).toBe(false);
                const under = world.queryRay(x, y + 0.3, z, 0, -1, 0, 1)!.y;
                expect(y - under, `feet at ${z.toFixed(1)}`).toBeLessThan(0.2);
                expect(y - under).toBeGreaterThan(-0.01);
                n++;
            }
        }
        expect(n).toBeGreaterThan(400);
        expect(w.up[0][1]).toBeCloseTo(0.15, 6);
        expect(w.up[w.up.length - 1][1]).toBeCloseTo(w.platformY, 6);
        // the garden's cross path from the west sidewalk to the east, clear for people
        for (let x = blk.x0 + 1.3; x <= blk.x1 - 1.3; x += 0.2) expect(world.querySphere(x, 0.15 + 0.6, w.plazaZ, 0.28, out), `cross path at ${x.toFixed(1)}`).toBe(false);
    });

    it('grows the forest in thickets and open woodland, the clearing open to the sky (map v10)', () => {
        // how much of each 30 m square of the forest a quad can't be in, 6 m up (the thickets' crowns, the open woods'
        // limbs): sampled every metre
        const cover: number[] = [];
        for (let x0 = FOREST.x0; x0 + 30 <= FOREST.x1; x0 += 30) for (let z0 = FOREST.z0; z0 + 30 <= FOREST.z1; z0 += 30) {
            let hit = 0;
            for (let x = x0 + 0.5; x < x0 + 30; x += 1) for (let z = z0 + 0.5; z < z0 + 30; z += 1) if (world.querySphere(x, 6, z, 0.25, out)) hit++;
            cover.push(hit / 900);
        }
        cover.sort((a, b) => a - b);
        const q = (p: number): number => cover[Math.floor(p * (cover.length - 1))];
        console.log(`forest cover 6 m up, per 30 m square: least ${q(0).toFixed(3)}, quartile ${q(0.25).toFixed(3)}, median ${q(0.5).toFixed(3)}, most ${q(1).toFixed(3)}`);
        expect(q(0.25)).toBeLessThan(0.03); // open woodland: a few trunks and limbs
        expect(q(1)).toBeGreaterThan(0.12); // a thicket: the canopy filling in
        expect(q(1)).toBeGreaterThan(5 * q(0.25));
        // and nowhere solid: even the thickest square leaves most of its air to fly in
        expect(q(1)).toBeLessThan(0.5);
        // the clearing: nothing over its ground but the lone oak's crown in the middle
        for (const [dx, dz] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, -10]]) {
            expect(world.queryRay(CLEARING.x + dx, 1.5, CLEARING.z + dz, 0, 1, 0, 300), `clearing at ${dx}, ${dz}`).toBeNull();
        }
    });

    it('opens up containers and the grain gallery to fly through (map v10)', () => {
        // the open box on top of the apron stack (yard.ts apron): a clear run right through it, end to end
        expect(world.queryRay(-426, 2.591 + 0.15 + 1.1, 353.219, 1, 0, 0, 14)).toBeNull();
        for (let x = -424.6; x <= -413; x += 0.4) expect(world.querySphere(x, 2.591 + 0.15 + 1.1, 353.219, 0.25, out), `tube at ${x.toFixed(1)}`).toBe(false);
        // the conveyor gallery: a quad fits all the way along inside it, over the belt
        const yb = (x: number): number => 2 + 24 * (x - -338) / (-263.5 - -338);
        for (let x = -337; x <= -264.5; x += 0.25) expect(world.querySphere(x, yb(x) + 1.4, 288, 0.25, out), `gallery at ${x.toFixed(2)}`).toBe(false);
        // under the hopper bins: through between the legs, under the braces, east to west under each
        for (const z of [250, 260, 270, 280]) for (let x = -240; x <= -224; x += 0.25) expect(world.querySphere(x, 2.2, z, 0.25, out), `bin ${z} at ${x}`).toBe(false);
    });

    it('joins the map up: a kerbed city edge, wires on crossarms square to the line, level crossings (map v11)', () => {
        const down = (x: number, z: number): number => world.queryRay(x, 30, z, 0, -1, 0, 40)!.y;
        // outside the ring road: its sidewalk at kerb height (on map v10 the asphalt ran on, and the roads with it), then grass
        expect(down(-440, -79)).toBeCloseTo(0.15, 6);
        expect(down(-480, -78)).toBeCloseTo(0.15, 6);
        expect(down(-491, -300)).toBeCloseTo(0.15, 6);
        expect(down(-497, -300)).toBeCloseTo(0, 6);
        expect(down(-360, -78)).toBeCloseTo(0, 6); // the yard road leaves through a gap in it
        // the power line: a wire at mid-span between the poles at x 175 and 225, sagging about 0.6 m from the pins (11.61 m)
        const wire = down(200, -40 - 1.1);
        expect(wire).toBeGreaterThan(10.95);
        expect(wire).toBeLessThan(11.1);
        // the crossarm runs across the line (along z): 1 m off the line's centre it is in the way of a ray along x
        expect(world.queryRay(170, 11.4, -39, 1, 0, 0, 10)!.x).toBeCloseTo(174.95, 6);
        // the level crossing's deck 1 cm under the rails' tops (0.45 m), the foot crossing's the same
        expect(down(-360, 100)).toBeCloseTo(0.44, 6);
        expect(down(-102, 100)).toBeCloseTo(0.44, 6);
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

const PINNED = '6cae921068f2acee9de1d880ae9d044aa7125708cdae8bfaa02dbc9e708283a4';

describe('the Duga radar (map v18)', () => {
    const level = buildFirstMap();
    const world = new MeshContactWorld(level.collision);
    const out = { x: 0, y: 0, z: 0 };
    const down = (x: number, z: number): number | undefined => world.queryRay(x, 400, z, 0, -1, 0, 400)?.y;
    const [low, high] = DUGA;

    it('stands at its real size: 541 m by 150 m and 276 m by 100 m, end to end', () => {
        expect(low.x1 - low.x0).toBe(541);
        expect(high.x1 - high.x0).toBe(276);
        expect(high.x0).toBe(low.x1);
        // the low band's first tower and the high band's last: their front legs' tops, the top frame (0.5 m) over them
        const lo = dugaTowers(low), hi = dugaTowers(high);
        expect(down(lo.first - 3, DUGA_FRONT)).toBeCloseTo(150.25, 6);
        expect(down(hi.first + high.bays * hi.bay + 3, DUGA_FRONT)).toBeCloseTo(100.25, 6);
        // 15 towers in the low band, as counted in the photo from afar; bays of about 34 m and 22 m
        expect(low.bays + 1).toBe(15);
        expect(lo.bay).toBeCloseTo(33.65, 2);
        expect(hi.bay).toBeCloseTo(22.41, 2);
    });

    it('keeps clear of the railway and the border trees, and has room to fly along its face', () => {
        for (let x = low.x0 - 15; x <= high.x1 + 15; x += 5) for (const z of [DUGA_FRONT + 20, DUGA_FRONT - 40]) expect(nearTrack(x, z, 5), `${x}, ${z}`).toBe(false);
        // along its front, 15 m out and 5 m up: nothing in the way (trees end short of it)
        for (let x = low.x0 - 10; x <= high.x1 + 10; x += 1) expect(world.querySphere(x, 5, DUGA_FRONT + 15, 0.25, out), `front at ${x}`).toBe(false);
        // between the dipoles and the reflector, 2.5 m out and 5 m up, from the first tower to the last
        const lo = dugaTowers(low), hi = dugaTowers(high);
        for (let x = lo.first; x <= hi.first + high.bays * hi.bay; x += 0.5) expect(world.querySphere(x, 5, DUGA_FRONT + 2.5, 0.25, out), `face at ${x}`).toBe(false);
    });

    it('has a reflector of wires 1.5 m apart: a quad hits a wire, or threads between two', () => {
        const lo = dugaTowers(low), x = lo.first + 4.5 * lo.bay;
        const through = (y: number): boolean => {
            for (let z = DUGA_FRONT + 2.5; z >= DUGA_FRONT - 20; z -= 0.05) if (world.querySphere(x, y, z, 0.12, out)) return false;
            return true;
        };
        expect(through(6)).toBe(false);
        expect(through(6.75)).toBe(true);
        const s = dugaScreen(low);
        expect(s.x1 - s.x0).toBe(525);
        expect(s.y1).toBe(150);
    });
});

describe('street vendors (map v15)', () => {
    const level = buildFirstMap();
    const world = new MeshContactWorld(level.collision);
    const out = { x: 0, y: 0, z: 0 };

    it('stand behind their carts, clear of the level, with room to walk past in front', () => {
        const kinds = new Set(level.vendors.map((v) => v.kind));
        console.log(`vendors: ${level.vendors.length} (${level.vendors.map((v) => `${v.name} at ${v.cx.toFixed(1)}, ${v.cz.toFixed(1)}`).join('; ')})`);
        expect(level.vendors.length).toBeGreaterThanOrEqual(14);
        // three in the station garden (the lot by the city station), facing its cross path
        expect(level.vendors.filter((v) => v.cx > 9 && v.cx < 71 && v.cz > -241 && v.cz < -179).length).toBe(3);
        expect(kinds.size).toBe(5);
        for (const v of level.vendors) {
            // the vendor: a person's capsule (0.3 m round, 1.75 m tall, traffic PERSON) stands clear
            for (const y of [0.32, 0.9, 1.45]) expect(world.querySphere(v.x, v.y + y, v.z, 0.28, out), `${v.name} at ${v.x}, ${v.z}`).toBe(false);
            // the cart in front of them (its back face; a sphere wholly inside a box touches no face)
            expect(world.querySphere(v.cx - v.nx * v.halfD, v.y + 0.6, v.cz - v.nz * v.halfD, 0.1, out), `${v.name}'s cart`).toBe(true);
            // in front of the cart, where customers stand and people walk past: clear from the ground to over a head
            const fx = v.cx + v.nx * (v.halfD + 0.45), fz = v.cz + v.nz * (v.halfD + 0.45);
            for (const y of [0.4, 1.0, 1.7]) expect(world.querySphere(fx, v.y + y, fz, 0.3, out), `in front of ${v.name}'s cart`).toBe(false);
        }
        // (map v16: one stood in front of a building's inner face, inside the next building, which spheres on surfaces
        // cannot see) no cart, vendor or umbrella over a building's footprint
        for (const v of level.vendors) {
            // its outline: the counter's front edge, back to the vendor (0.9 m, 0.3 m round) and the umbrella (1.2 m round),
            // and across to the umbrella's side (0.33 m off the cart's middle)
            const front = v.halfD + 0.07, back = 1.2, side = 1.53;
            const xs = [v.cx + v.nx * front - v.nz * side, v.cx - v.nx * back + v.nz * side];
            const zs = [v.cz + v.nz * front + v.nx * side, v.cz - v.nz * back - v.nx * side];
            const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
            const bd = level.buildings.find((b) => x1 > b.x0 && x0 < b.x1 && z1 > b.z0 && z0 < b.z1);
            expect(bd?.name, `${v.name} at ${v.cx}, ${v.cz}`).toBeUndefined();
            // nothing (a tree's crown, a wall) in the ring just outside the umbrella's rim
            const ux = v.cx - v.nz * 0.325, uz = v.cz + v.nx * 0.325;
            for (let k = 0; k < 16; k++) {
                const a = (k / 16) * 2 * Math.PI;
                expect(world.querySphere(ux + 1.4 * Math.cos(a), v.y + 2.3, uz + 1.4 * Math.sin(a), 0.12, out), `over ${v.name}'s umbrella at ${v.cx}, ${v.cz}`).toBe(false);
            }
        }
        // the sidewalk carts stand off the walking line (people fill the first 1.9 m from the kerb)
        for (const v of level.vendors) {
            const blk = level.blocks.find((b) => v.cx > b.x0 && v.cx < b.x1 && v.cz > b.z0 && v.cz < b.z1);
            if (!blk) continue;
            const kerb = Math.min(v.cx - blk.x0, blk.x1 - v.cx, v.cz - blk.z0, blk.z1 - v.cz);
            expect(kerb - v.halfD - 0.07, `${v.name} at ${v.cx}, ${v.cz}`).toBeGreaterThanOrEqual(1.9);
        }
    });
});
