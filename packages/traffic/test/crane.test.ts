// The tower crane at work (crane.ts, map v23): its day repeats, nothing jumps, every crate is in one place and the one on
// the hook hangs under it, the jib, rope, hook and crates stay clear of the buildings and the steel frame all day, and the
// quad is pushed by it.

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { AirWorld, TowerCrane, makeCrane, newAirPlace } from '../src/index';
import type { AirPlace, APart } from '../src/index';

const level = buildFirstMap();
const crane = makeCrane(level.crane)!;
const mesh = new MeshContactWorld(level.collision);

/** Point (lf, lu, ls) of a mover placed at p, in the world. */
function world(p: AirPlace, q: readonly number[]): [number, number, number] {
    return [0, 1, 2].map((j) => [p.x, p.y, p.z][j] + q[0] * p.f[j] + q[1] * p.u[j] + q[2] * p.s[j]) as [number, number, number];
}

/** Points along a part every `step` m (a box along its longest axis, a rope down its length), and a radius for each. */
function samples(pt: APart, p: AirPlace, step: number): { at: [number, number, number]; r: number }[] {
    const out: { at: [number, number, number]; r: number }[] = [];
    if (pt.kind === 'cap') {
        const b = pt.rope ? [pt.a[0], pt.a[1] - p.len, pt.a[2]] : pt.b;
        const l = Math.hypot(b[0] - pt.a[0], b[1] - pt.a[1], b[2] - pt.a[2]);
        const n = Math.max(1, Math.ceil(l / step));
        for (let k = 0; k <= n; k++) out.push({ at: world(p, [0, 1, 2].map((j) => pt.a[j] + ((b[j] - pt.a[j]) * k) / n)), r: pt.r * 0.9 });
        return out;
    }
    const long = pt.e[0] >= pt.e[1] && pt.e[0] >= pt.e[2] ? 0 : pt.e[1] >= pt.e[2] ? 1 : 2;
    const r = Math.min(...pt.e) * 0.9;
    const n = Math.max(1, Math.ceil((2 * pt.e[long]) / step));
    for (let k = 0; k <= n; k++) {
        const v = -pt.e[long] + (2 * pt.e[long] * k) / n;
        const q = [0, 1, 2].map((j) => pt.c[j] + v * pt.R[long * 3 + j]);
        out.push({ at: world(p, q), r });
    }
    return out;
}

describe('the tower crane (map v23)', () => {
    it('has its site, five crates in six places and a day of 30 jobs that comes round again', () => {
        expect(crane).toBeInstanceOf(TowerCrane);
        expect(crane.movers.map((m) => m.kind)).toEqual(['slewing', 'trolley', 'hook', 'crate', 'crate', 'crate', 'crate', 'crate']);
        console.log(`crane day ${crane.day.toFixed(0)} s`);
        expect(crane.day).toBeGreaterThan(30 * 60);
        const a = newAirPlace(), b = newAirPlace();
        for (let i = 0; i < crane.movers.length; i++) {
            crane.place(i, 0, a);
            crane.place(i, Math.round(crane.day * 1000), b);
            for (const k of ['x', 'y', 'z', 'len'] as const) expect(b[k], `mover ${i} ${k}`).toBeCloseTo(a[k], 6);
            for (let j = 0; j < 3; j++) expect(b.f[j], `mover ${i} f`).toBeCloseTo(a.f[j], 9);
        }
    });

    it('never jumps: every mover moves no faster than its top speed, all day', () => {
        const a = newAirPlace(), b = newAirPlace();
        let worst = 0;
        for (let i = 0; i < crane.movers.length; i++) {
            for (let t = 0; t < crane.day * 1000; t += 100) {
                crane.place(i, t, a);
                crane.place(i, t + 100, b);
                // the farthest point moves at most the origin's travel plus the turn of the frame times its reach across the
                // axis it turns about: the jib's 50 m, the rest a couple of metres (the trolley's rope hangs on its axis)
                const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) + Math.hypot(b.f[0] - a.f[0], b.f[2] - a.f[2]) * (i === 0 ? 50 : 2);
                worst = Math.max(worst, d / 0.1 / crane.movers[i].vmax);
            }
        }
        expect(worst).toBeLessThan(1.05);
    });

    it('keeps each crate in a place of its own, the one on the hook under it', () => {
        const p = newAirPlace(), h = newAirPlace();
        let carried = 0;
        for (let t = 0; t < crane.day * 1000; t += 2000) {
            const st = crane.state(t);
            crane.place(2, t, h);
            const seen = new Set<string>();
            for (let i = 3; i < crane.movers.length; i++) {
                crane.place(i, t, p);
                if (st.carry === i - 3) {
                    carried++;
                    expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeLessThan(1e-9);
                    expect(h.y - p.y).toBeCloseTo(2, 9);
                    continue;
                }
                const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
                expect(seen.has(key), `two crates at ${key}, ${t} ms`).toBe(false);
                seen.add(key);
                expect(level.crane!.spots.some(([x, y, z]) => Math.hypot(x - p.x, y - p.y, z - p.z) < 1e-9)).toBe(true);
            }
        }
        expect(carried).toBeGreaterThan(100);
    });

    it('keeps its jib, counter-jib, rope, hook and crates clear of the buildings and the steel frame all day', () => {
        const out = new Float64Array(8 * 4);
        const p = newAirPlace();
        const hits = new Map<string, string>();
        for (let t = 0; t < crane.day * 1000; t += 1000) {
            for (let i = 0; i < crane.movers.length; i++) {
                crane.place(i, t, p);
                for (const pt of crane.movers[i].shape.parts) {
                    if (pt.gear && p.g < 0.5) continue;
                    for (const s of samples(pt, p, 1)) {
                        // a crate resting on its place touches it at its bottom: its middle is half its height up
                        if (mesh.contacts(s.at[0], s.at[1], s.at[2], s.r, out, 8) > 0) {
                            const k = `${crane.movers[i].kind} ${pt.role}`;
                            if (!hits.has(k)) hits.set(k, `at ${t / 1000} s (${s.at.map((v) => v.toFixed(1)).join(', ')})`);
                        }
                    }
                }
            }
        }
        expect([...hits.entries()].map(([k, v]) => `${k}: ${v}`)).toEqual([]);
    });

    it('has an open lattice jib: a quad fits through each of its first ten panels', () => {
        const w = new AirWorld(mesh, crane);
        w.at(0);
        const q = w.placeOf(0), o = { x: 0, y: 0, z: 0 };
        for (let k = 0; k < 10; k++) {
            // the middle of a panel, 0.6 m on from its strut, 0.4 m off the jib's centre line, half way up the triangle
            const [x, y, z] = world(q, [1.2 + 2.5 * k + 0.6, 1.0 + 0.45, 0.25]);
            expect(w.pushOut(x, y, z, 0.12, o), `jib panel ${k}`).toBe(false);
        }
        // the operator sits in a hollow cab
        const [x, y, z] = world(q, [1.25, 1.3, 2.05]);
        expect(w.pushOut(x, y, z, 0.05, o)).toBe(true);
        const [ex, ey, ez] = world(q, [1.7, 2.2, 1.6]);
        expect(w.pushOut(ex, ey, ez, 0.1, o)).toBe(false);
    });

    it('is solid: a point in the jib is pushed out, and moves with it as it slews', () => {
        const w = new AirWorld(mesh, crane);
        // a moment the jib is turning fast
        let tick = 0;
        for (let t = 0; t < crane.day * 1000; t += 500) {
            const a = crane.state(t).th, b = crane.state(t + 500).th;
            if (Math.abs(b - a) > 0.03) { tick = t; break; }
        }
        w.at(tick);
        const q = w.placeOf(0);
        // 30 m out on the jib's bottom chord
        const [x, y, z] = world(q, [30, 1.0, 0.8]);
        const o = { x: 0, y: 0, z: 0 };
        expect(w.pushOut(x, y, z, 0.05, o)).toBe(true);
        const out = new Float64Array(8 * 4), vel = new Float64Array(8 * 3);
        expect(w.contacts(x, y, z, 0.05, out, 8, vel)).toBeGreaterThan(0);
        expect(Math.hypot(vel[0], vel[1], vel[2])).toBeGreaterThan(0.5);
    });
});
