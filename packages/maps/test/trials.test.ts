// The time trials (owner, 2026-10-19): every course starts on a pad resting on the ground under a clear arch, every
// gate's opening is clear of geometry, the windows and gaps it names really are framed openings, and a quad can fly
// from the pad to the first gate, from each gate to the next, and back through the arch.

import { describe, expect, it } from 'vitest';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { buildFirstMap, gateAxes } from '../src/index';
import type { Gate } from '../src/index';

const level = buildFirstMap();
const world = new MeshContactWorld(level.collision);
const out = { x: 0, y: 0, z: 0 };

/** a 5-inch quad's body, m: the sphere that must fit along a path (the props reach a little further) */
const QUAD = 0.18;

/** Points over the gate's opening, `inset` m in from its edges, every `step` m. */
function across(g: Gate, inset: number, step: number): number[][] {
    const { u, v } = gateAxes(g);
    const pts: number[][] = [];
    for (let a = -(g.hw - inset); a <= g.hw - inset + 1e-9; a += step) for (let b = -(g.hh - inset); b <= g.hh - inset + 1e-9; b += step) {
        pts.push([g.x + u[0] * a + v[0] * b, g.y + u[1] * a + v[1] * b, g.z + u[2] * a + v[2] * b]);
    }
    return pts;
}

/** How far geometry is from the gate's centre along each of its four in-plane directions (Infinity: none within 30 m). */
function frame(g: Gate): number[] {
    const { u, v } = gateAxes(g);
    return [u, u.map((c) => -c), v, v.map((c) => -c)].map((d) => {
        const t = world.rayT(g.x, g.y, g.z, d[0], d[1], d[2], 30);
        return t < 0 ? Infinity : t;
    });
}

/**
 * A search over a grid of `G` m cells where a QUAD sphere fits, from a to b (6 neighbours): the number of cells looked
 * at, or -1 when there is no way through within `limit` cells. It only has to show a way exists, not the shortest, so
 * the distance still to go counts double (weighted A*): it heads for b instead of spreading out round every obstacle.
 */
function path(a: number[], b: number[], G = 0.3, limit = 1_500_000): number {
    const ti = Math.round((b[0] - a[0]) / G), tj = Math.round((b[1] - a[1]) / G), tk = Math.round((b[2] - a[2]) / G);
    const key = (i: number, j: number, k: number): number => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
    const free = (i: number, j: number, k: number): boolean => {
        const y = a[1] + j * G;
        return y > 0.1 + QUAD && !world.querySphere(a[0] + i * G, y, a[2] + k * G, QUAD, out);
    };
    const h = (i: number, j: number, k: number): number => 2 * (Math.abs(ti - i) + Math.abs(tj - j) + Math.abs(tk - k));
    // a binary heap of [f, g, i, j, k]
    const heap: number[][] = [[h(0, 0, 0), 0, 0, 0, 0]];
    const best = new Map<number, number>([[key(0, 0, 0), 0]]);
    const push = (n: number[]): void => {
        heap.push(n);
        for (let c = heap.length - 1; c > 0;) {
            const p = (c - 1) >> 1;
            if (heap[p][0] <= heap[c][0]) break;
            [heap[p], heap[c]] = [heap[c], heap[p]];
            c = p;
        }
    };
    const pop = (): number[] => {
        const top = heap[0], last = heap.pop()!;
        if (heap.length) {
            heap[0] = last;
            for (let c = 0; ;) {
                const l = 2 * c + 1, r = l + 1;
                let m = c;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === c) break;
                [heap[m], heap[c]] = [heap[c], heap[m]];
                c = m;
            }
        }
        return top;
    };
    let seen = 0;
    while (heap.length && seen < limit) {
        const [, g, i, j, k] = pop();
        if ((best.get(key(i, j, k)) ?? Infinity) < g) continue;
        seen++;
        if (Math.abs(ti - i) + Math.abs(tj - j) + Math.abs(tk - k) <= 1) return seen;
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const ni = i + di, nj = j + dj, nk = k + dk, nkey = key(ni, nj, nk);
            if ((best.get(nkey) ?? Infinity) <= g + 1 || !free(ni, nj, nk)) continue;
            best.set(nkey, g + 1);
            push([g + 1 + h(ni, nj, nk), g + 1, ni, nj, nk]);
        }
    }
    return -1;
}

describe('time trials', () => {
    it('has three courses, each ending back through its start arch', () => {
        const t = level.trials;
        expect(t.map((c) => c.id)).toEqual(['park', 'bando', 'yard']);
        for (const c of t) {
            expect(c.gates.length, c.id).toBeGreaterThanOrEqual(6);
            const f = c.gates[c.gates.length - 1];
            expect([f.x, f.z], c.id).toEqual([c.pad.x, c.pad.z]);
            for (const g of c.gates) expect(Math.hypot(g.nx, g.ny, g.nz), `${c.id}: ${g.name}`).toBeCloseTo(1, 12);
            expect(new Set(c.gates.map((g) => g.name)).size, c.id).toBe(c.gates.length);
        }
    });

    it('rests each pad on the ground, with room for a quad on it under the arch', () => {
        for (const c of level.trials) {
            const p = c.pad;
            // from under the arch's banner down to the pad's top, from beside the pad down to the ground
            expect(world.queryRay(p.x, p.y + 3, p.z, 0, -1, 0, 5)?.y, c.id).toBeCloseTo(p.y, 6);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const g = world.queryRay(p.x + dx * (p.half + 0.3), p.y + 1, p.z + dz * (p.half + 0.3), 0, -1, 0, 5);
                expect(g?.y, `${c.id}: ground beside the pad`).toBeCloseTo(p.y - 0.2, 6);
            }
            for (let y = p.y + 0.6; y < p.y + 2.7; y += 0.3) expect(world.querySphere(p.x, y, p.z, 0.5, out), `${c.id} at ${y}`).toBe(false);
        }
    });

    it('keeps every gate\'s opening clear', () => {
        for (const c of level.trials) for (const g of c.gates) {
            for (const [x, y, z] of across(g, QUAD, 0.2)) expect(world.querySphere(x, y, z, QUAD, out), `${c.id}: ${g.name} at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
        }
    });

    it('puts the window and gap gates in real openings, framed on all four sides', () => {
        const framed: string[] = [];
        for (const c of level.trials) for (const g of c.gates) {
            const d = frame(g);
            // the frame within 0.5 m of the gate's edges, all round (the wires are only framed across: the poles are 24 m off)
            if (d[0] < g.hw + 0.5 && d[1] < g.hw + 0.5 && d[2] < g.hh + 0.5 && d[3] < g.hh + 0.5) framed.push(`${c.id}: ${g.name}`);
        }
        expect(framed).toEqual([
            'park: Under the bar of the post gate',
            'park: Under the gazebo roof',
            'park: Back through the start arch',
            'bando: In at a first-floor window, south side',
            'bando: Out at a first-floor window, north side',
            'bando: In at the ground-floor window by the shaft',
            'bando: Up the lift shaft and out at the roof',
            'bando: Between the water tank\'s legs',
            'bando: Into the loading dock',
            'bando: Out of the dock\'s open end',
            'bando: Back through the start arch',
            'yard: Under the gantry',
            'yard: Under the hopper bins, in at the south end',
            'yard: Out under the north bin',
            'yard: Out of the headhouse\'s south side',
            'yard: Back through the start arch'
        ]);
    });

    it('can be flown: a quad fits from the pad to each gate in turn and back through the arch', () => {
        for (const c of level.trials) {
            let from = [c.pad.x, c.pad.y + 0.5, c.pad.z];
            for (const g of c.gates) {
                const to = [g.x, g.y, g.z];
                const n = path(from, to);
                console.log(`${c.id}: to "${g.name}": ${n} cells`);
                expect(n, `${c.id}: no way to "${g.name}"`).toBeGreaterThan(0);
                from = to;
            }
        }
    });
});
