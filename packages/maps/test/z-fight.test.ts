// Flickering faces (map v14, owner 2026-10-19: "objects clipping and flashing both models back and forth"): two faces of
// different materials in one plane, facing the same way and overlapping, z-fight (the depth test picks either one from
// pixel to pixel and frame to frame). This finds them in the drawn triangles: same normal (to 0.01), same plane (to
// 4 mm), overlapping by more than 1 cm² in the plane. Bottoms resting on the ground (facing down under 0.2 m) are never
// seen and are left out.

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '../src/index';

interface Tri { m: string; p: number[]; n: number[]; d: number; ax: number }

/** Polygon `poly` clipped to the anticlockwise triangle a, b, c (Sutherland-Hodgman), in 2D. */
function clip(poly: number[][], a: number[], b: number[], c: number[]): number[][] {
    let out = poly;
    for (const [e0, e1] of [[a, b], [b, c], [c, a]]) {
        const inp = out;
        out = [];
        const ex = e1[0] - e0[0], ey = e1[1] - e0[1];
        const inside = (q: number[]): boolean => ex * (q[1] - e0[1]) - ey * (q[0] - e0[0]) >= -1e-9;
        for (let i = 0; i < inp.length; i++) {
            const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
            if (inside(cur) !== inside(prev)) {
                const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
                const den = ex * dy - ey * dx;
                const t = den === 0 ? 0 : (ex * (e0[1] - prev[1]) - ey * (e0[0] - prev[0])) / den;
                out.push([prev[0] + dx * t, prev[1] + dy * t]);
            }
            if (inside(cur)) out.push(cur);
        }
        if (!out.length) break;
    }
    return out;
}

function area(poly: number[][]): number {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        s += a[0] * b[1] - a[1] * b[0];
    }
    return Math.abs(s) / 2;
}

/** Every pair of materials whose faces z-fight, with the overlapping area, m², and a place. */
function zFights(): Map<string, { area: number; at: string }> {
    const level = buildFirstMap();
    const tris: Tri[] = [];
    for (const [m, t] of level.parts) {
        for (let i = 0; i < t.length; i += 9) {
            const p = Array.from(t.subarray(i, i + 9));
            const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const l = Math.hypot(nx, ny, nz);
            if (l < 1e-9) continue;
            nx /= l; ny /= l; nz /= l;
            const ax = Math.abs(nx) > Math.abs(ny) ? (Math.abs(nx) > Math.abs(nz) ? 0 : 2) : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
            tris.push({ m, p, n: [nx, ny, nz], d: nx * p[0] + ny * p[1] + nz * p[2], ax });
        }
    }
    // by plane (normal to 0.01, offset to 4 mm) and 8 m square in the plane
    const buckets = new Map<string, number[]>();
    tris.forEach((t, i) => {
        const u = [0, 1, 2].filter((k) => k !== t.ax);
        const xs = [0, 1, 2].map((v) => t.p[v * 3 + u[0]]), ys = [0, 1, 2].map((v) => t.p[v * 3 + u[1]]);
        const nk = t.n.map((v) => Math.round(v * 100)).join(','), dk = Math.round(t.d / 0.004);
        for (let cx = Math.floor(Math.min(...xs) / 8); cx <= Math.floor(Math.max(...xs) / 8); cx++)
            for (let cy = Math.floor(Math.min(...ys) / 8); cy <= Math.floor(Math.max(...ys) / 8); cy++) {
                const k = `${nk}|${dk}|${cx},${cy}`;
                const b = buckets.get(k);
                if (b) b.push(i); else buckets.set(k, [i]);
            }
    });
    const found = new Map<string, { area: number; at: string }>();
    const done = new Set<string>();
    for (const [k, idx] of buckets) {
        const [nk, dk, ck] = k.split('|');
        const all = idx.concat(buckets.get(`${nk}|${Number(dk) + 1}|${ck}`) ?? []);
        if (new Set(all.map((i) => tris[i].m)).size < 2) continue;
        for (const ia of idx) for (const ib of all) {
            const A = tris[ia], B = tris[ib];
            if (A.m >= B.m || Math.abs(A.d - B.d) > 0.004) continue;
            if (A.n[1] < -0.9 && A.d > -0.2) continue; // a bottom resting on the ground
            const pk = `${Math.min(ia, ib)}-${Math.max(ia, ib)}`;
            if (done.has(pk)) continue;
            done.add(pk);
            const u = [0, 1, 2].filter((q) => q !== A.ax);
            const P = (t: Tri): number[][] => [0, 1, 2].map((v) => [t.p[v * 3 + u[0]], t.p[v * 3 + u[1]]]);
            let pb = P(B);
            if ((pb[1][0] - pb[0][0]) * (pb[2][1] - pb[0][1]) - (pb[1][1] - pb[0][1]) * (pb[2][0] - pb[0][0]) < 0) pb = [pb[0], pb[2], pb[1]];
            const ov = area(clip(P(A), pb[0], pb[1], pb[2]));
            if (ov < 1e-4) continue;
            const key = `${A.m} / ${B.m}`;
            const f = found.get(key) ?? { area: 0, at: A.p.slice(0, 3).map((v) => v.toFixed(1)).join(', ') };
            f.area += ov;
            found.set(key, f);
        }
    }
    return found;
}

describe('flickering faces', () => {
    it('leaves almost nothing in one plane with another material', () => {
        const f = zFights();
        const total = [...f.values()].reduce((s, v) => s + v.area, 0);
        console.log(`z-fighting: ${total.toFixed(2)} m² in ${f.size} pairs of materials: ` +
            [...f.entries()].sort((a, b) => b[1].area - a[1].area).map(([k, v]) => `${k} ${v.area.toFixed(2)} m² at ${v.at}`).join('; '));
        // Map v13: 135 m² in 16 pairs (stacked containers inside their neighbours, trusses and beams flush with walls, the
        // site's decks on its columns' feet). What is left (measured 4.2 m²) is out of sight (the fountain's water on its basin, inside the hopper bins'
        // legs), slight slopes this test reads as flat (ramps and rails, 1-4 deg) and a few cm² at the fields station.
        expect(total).toBeLessThan(5);
        for (const m of ['container-a', 'container-b', 'container-c', 'container-d', 'container-e']) {
            for (const k of f.keys()) expect(k.includes(m), k).toBe(false);
        }
    });
});
