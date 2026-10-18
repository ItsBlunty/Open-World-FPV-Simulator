// The golden props (owner, 2026-10-18) and the street furniture they hide in: every prop clear of the geometry and
// reachable by a 5-inch quad from the open sky, the shelters out of the people's walking lanes and open to the road,
// the billboards hiding what is behind them.

import { describe, expect, it } from 'vitest';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { buildFirstMap } from '../src/index';

const level = buildFirstMap();
const world = new MeshContactWorld(level.collision);
const out = { x: 0, y: 0, z: 0 };

/** a 5-inch quad with its props, m (as the spawn and crane tests) */
const QUAD = 0.25;
/** the game collects a prop when the quad's centre comes this near (apps/fly collect.ts COLLECT_RADIUS) */
const REACH = 1.0;
/** the drawn prop's radius, m (apps/fly render/collectibles.ts) */
const PROP = 0.4;

/**
 * Can the quad get from the prop to the open sky? A flood over a 0.4 m grid of spots where the quad fits, from the
 * spots within REACH of the prop, until one has nothing over it for 300 m.
 */
function reachable(px: number, py: number, pz: number): { ok: boolean; cells: number } {
    const G = 0.4;
    const key = (i: number, j: number, k: number): string => `${i},${j},${k}`;
    const seen = new Set<string>();
    const queue: number[][] = [];
    const R = Math.ceil(REACH / G);
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
        if ((i * i + j * j + k * k) * G * G > (REACH - 0.05) * (REACH - 0.05)) continue;
        queue.push([i, j, k]);
        seen.add(key(i, j, k));
    }
    let head = 0;
    while (head < queue.length && head < 60000) {
        const [i, j, k] = queue[head++];
        const x = px + i * G, y = py + j * G, z = pz + k * G;
        if (y < 0.05 + QUAD || world.querySphere(x, y, z, QUAD, out)) continue;
        if (world.queryRay(x, y, z, 0, 1, 0, 300) === null) return { ok: true, cells: head };
        for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const n = key(i + a, j + b, k + c);
            if (seen.has(n)) continue;
            seen.add(n);
            queue.push([i + a, j + b, k + c]);
        }
    }
    return { ok: false, cells: head };
}

describe('golden props', () => {
    it('numbers them 1 up, a bunch of them, in every area', () => {
        const c = level.collectibles;
        for (const p of c) console.log(`#${p.n} ${p.area}: ${p.spot} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
        expect(c.map((p) => p.n)).toEqual(c.map((_, i) => i + 1));
        expect(c.length).toBeGreaterThanOrEqual(45);
        for (const a of ['Park', 'Bando', 'City', 'Industrial yard', 'Fields']) expect(c.some((p) => p.area === a), a).toBe(true);
        expect(c.filter((p) => p.spot.startsWith('In the bus shelter')).length).toBe(10);
        expect(c.filter((p) => p.spot.startsWith('Behind the billboard')).length).toBe(6);
        expect(c.filter((p) => p.spot.includes('dumpster')).length).toBe(6);
        expect(new Set(c.map((p) => p.spot)).size).toBe(c.length);
    });

    it('keeps every prop clear of the geometry, and a quad can reach each one from the open sky', () => {
        for (const p of level.collectibles) {
            expect(world.querySphere(p.x, p.y, p.z, PROP + 0.05, out), `#${p.n} ${p.spot} touches something`).toBe(false);
            const r = reachable(p.x, p.y, p.z);
            expect(r.ok, `#${p.n} ${p.spot}: no way out after ${r.cells} cells`).toBe(true);
        }
    });

    it('stands the bus shelters behind the walking lane, open to the road and frosted behind', () => {
        for (const p of level.collectibles.filter((q) => q.spot.startsWith('In the bus shelter'))) {
            const blk = level.blocks.find((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1)!;
            // the kerb nearest the prop is the road side; from there to the prop nothing is in the way
            const d = [p.z - blk.z0, blk.z1 - p.z, p.x - blk.x0, blk.x1 - p.x];
            const k = d.indexOf(Math.min(...d));
            const nx = [0, 0, -1, 1][k], nz = [-1, 1, 0, 0][k];
            expect(d[k]).toBeCloseTo(2.7, 6);
            expect(world.queryRay(p.x + nx * 2.7, p.y, p.z + nz * 2.7, -nx, 0, -nz, 2.6), p.spot).toBeNull();
            // the people's lane (1.0 to 1.6 m in, 0.3 m wide) is clear along the shelter, at their height
            for (const lane of [0.7, 1.9]) for (let s = -2.5; s <= 2.5; s += 0.25) {
                const lx = p.x + nx * (2.7 - lane) - nz * s, lz = p.z + nz * (2.7 - lane) + nx * s;
                expect(world.querySphere(lx, blk.y + 1, lz, 0.05, out), `${p.spot}, lane at ${lane} m`).toBe(false);
            }
            // from the building side, the first thing on the way to the prop is a frosted panel
            const hit = world.queryRay(p.x - nx * 0.95, p.y, p.z - nz * 0.95, nx, 0, nz, 1);
            expect(hit, p.spot).not.toBeNull();
            expect(Math.abs(hit!.x - p.x) + Math.abs(hit!.z - p.z), p.spot).toBeCloseTo(0.79, 6);
        }
    });

    it('hides the billboard props from the front', () => {
        for (const p of level.collectibles.filter((q) => q.spot.startsWith('Behind the billboard'))) {
            // towards the street, level with the prop, the back of the panel is 1.5 m away
            const d = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dz]) => world.queryRay(p.x, p.y, p.z, dx, 0, dz, 20))
                .map((hit) => (hit ? Math.abs(hit.x - p.x) + Math.abs(hit.z - p.z) : Infinity));
            expect(d.some((v) => Math.abs(v - 1.5) < 1e-6), `${p.spot}: ${d.join(', ')}`).toBe(true);
        }
    });
});
