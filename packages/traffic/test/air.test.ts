// The airport's day (air.ts): it builds, it repeats, every mover is where the tick says (replays), no two movers ever
// touch, the planes stay clear of the level's geometry, the small planes tour the city, and a quad gets hit and pushed
// by a taxiing plane.

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { AIR_DAY, AirTraffic, AirWorld, HELI, TOURS, bladeAxes, newAirPlace, placeOnLeg, propRest } from '../src/index';
import type { AirMover, AirPlace, Prop } from '../src/index';

const level = buildFirstMap();

/** A mover's footprint: an oriented rectangle on the ground (centre, half sizes along its level heading and across) and its height range. */
interface Foot { cx: number; cz: number; hx: number; hz: number; ef: number; es: number; y0: number; y1: number }

function foot(m: AirMover, p: AirPlace): Foot {
    const sh = m.shape;
    const l = Math.hypot(p.f[0], p.f[2]) || 1;
    const hx = p.f[0] / l, hz = p.f[2] / l;
    const mid = (sh.nose + sh.tail) / 2;
    return { cx: p.x + hx * mid, cz: p.z + hz * mid, hx, hz, ef: (sh.nose - sh.tail) / 2, es: sh.half, y0: p.y - 1, y1: p.y + sh.reach };
}

/** Do two footprints overlap (grown by `pad` m)? Separating axis test in 2D, then the heights. */
function overlap(a: Foot, b: Foot, pad: number): boolean {
    if (a.y1 < b.y0 || b.y1 < a.y0) return false;
    const axes = [[a.hx, a.hz], [-a.hz, a.hx], [b.hx, b.hz], [-b.hz, b.hx]];
    const dx = b.cx - a.cx, dz = b.cz - a.cz;
    for (const [ux, uz] of axes) {
        const ra = a.ef * Math.abs(a.hx * ux + a.hz * uz) + a.es * Math.abs(-a.hz * ux + a.hx * uz);
        const rb = b.ef * Math.abs(b.hx * ux + b.hz * uz) + b.es * Math.abs(-b.hz * ux + b.hx * uz);
        if (Math.abs(dx * ux + dz * uz) > ra + rb + pad) return false;
    }
    return true;
}

/** Pairs that are meant to be close: the medics with each other and with the helicopter they get out of; the controllers. */
function ignored(a: AirMover, b: AirMover): boolean {
    const medic = (m: AirMover): boolean => m.kind === 'walker' || m.kind === 'stretcher';
    if (a.kind === 'sitter' || b.kind === 'sitter') return true;
    if (medic(a) && medic(b)) return true;
    return (medic(a) && b.kind === 'heli') || (medic(b) && a.kind === 'heli');
}

describe('the airport', () => {
    const air = new AirTraffic(level);

    it('builds a day of ten planes, three tugs, the helicopter, its medics and the controllers', () => {
        const count = (k: string): number => air.movers.filter((m) => m.kind === k).length;
        expect(count('plane')).toBe(10);
        expect(count('tug')).toBe(3);
        expect(count('heli')).toBe(1);
        expect(count('walker') + count('stretcher')).toBe(3);
        expect(count('sitter')).toBe(4);
        for (const e of air.events) expect(e.liftoff).toBeGreaterThan(e.touchdown);
    });

    it('never puts two movers in each other over the whole day', () => {
        const ps = air.movers.map(newAirPlace);
        const clashes = new Map<string, number>();
        for (let t = 0; t < AIR_DAY; t += 0.5) {
            const tick = Math.round(t * 1000);
            air.movers.forEach((_, i) => air.place(i, tick, ps[i]));
            for (let i = 0; i < ps.length; i++) {
                if (ps[i].hidden) continue;
                const fa = foot(air.movers[i], ps[i]);
                for (let j = i + 1; j < ps.length; j++) {
                    if (ps[j].hidden || ignored(air.movers[i], air.movers[j])) continue;
                    if (!overlap(fa, foot(air.movers[j], ps[j]), 0.5)) continue;
                    const k = `${air.movers[i].type?.kind ?? air.movers[i].kind}/${air.movers[j].type?.kind ?? air.movers[j].kind}`;
                    if (!clashes.has(k)) clashes.set(k, t);
                }
            }
        }
        expect([...clashes.entries()].map(([k, t]) => `${k} at ${t} s`)).toEqual([]);
    });

    it('keeps the planes, the tugs and the helicopter (props and rotors too) clear of the buildings, the trees and the ground', () => {
        const mesh = new MeshContactWorld(level.collision);
        const ps = newAirPlace();
        const out = new Float64Array(8 * 4);
        const hits = new Map<string, string>();
        air.movers.forEach((m, i) => {
            if (m.kind === 'walker' || m.kind === 'stretcher' || m.kind === 'sitter') return;
            for (let t = 0; t < AIR_DAY; t += 1) {
                air.place(i, Math.round(t * 1000), ps);
                if (ps.hidden || ps.y > 200) continue;
                for (const pt of m.shape.parts) {
                    if (pt.role === 'gear' || pt.role === 'skid') continue;
                    // a capsule's ends, a box's middle
                    const at = pt.kind === 'cap' ? [pt.a, pt.b] : [pt.c];
                    for (const q of at) {
                        const x = ps.x + q[0] * ps.f[0] + q[1] * ps.u[0] + q[2] * ps.s[0];
                        const y = ps.y + q[0] * ps.f[1] + q[1] * ps.u[1] + q[2] * ps.s[1];
                        const z = ps.z + q[0] * ps.f[2] + q[1] * ps.u[2] + q[2] * ps.s[2];
                        const r = pt.kind === 'cap' ? pt.r : Math.min(...pt.e);
                        if (mesh.contacts(x, y, z, r * 0.9, out, 8) > 0) {
                            const k = m.type?.kind ?? m.kind;
                            if (!hits.has(k)) hits.set(k, `${pt.role} at ${t} s (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
                        }
                    }
                }
                // the props and rotors (solid since 2026-10-24): a turning one's rim, a stopped one's blade tips
                for (const pr of m.shape.props) {
                    for (let k = 0; k < 8; k++) {
                        const a = ps.e > 0 ? (2 * Math.PI * k) / 8 : propRest(pr.blades) + (2 * Math.PI * k) / pr.blades;
                        if (ps.e === 0 && k >= pr.blades) break;
                        const d = bladeAxes(pr.axis, a).d;
                        const q = [0, 1, 2].map((j) => pr.p[j] + d[j] * pr.r);
                        const x = ps.x + q[0] * ps.f[0] + q[1] * ps.u[0] + q[2] * ps.s[0];
                        const y = ps.y + q[0] * ps.f[1] + q[1] * ps.u[1] + q[2] * ps.s[1];
                        const z = ps.z + q[0] * ps.f[2] + q[1] * ps.u[2] + q[2] * ps.s[2];
                        if (mesh.contacts(x, y, z, 0.03, out, 8) > 0) {
                            const kind = m.type?.kind ?? m.kind;
                            if (!hits.has(kind + ' prop')) hits.set(kind + ' prop', `${pr.axis} ${ps.e > 0 ? 'disc' : 'blade'} at ${t} s (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
                        }
                    }
                }
            }
        });
        expect([...hits.entries()].map(([k, v]) => `${k}: ${v}`)).toEqual([]);
    });

    it('flies the Cub, the 172 and the SR22 round the city all day between their stops, on an unbroken path', () => {
        const p = newAirPlace(), q = newAirPlace();
        for (const i of air.planes) {
            const m = air.movers[i], tour = TOURS[m.type!.kind];
            if (!tour) continue;
            const legs = m.legs;
            // its day is exactly the airport's, and each leg starts where the last ended (the last where the first starts)
            expect(legs[legs.length - 1].t1 - legs[0].t0).toBeCloseTo(AIR_DAY, 9);
            for (let k = 0; k < legs.length; k++) {
                placeOnLeg(legs[k === 0 ? legs.length - 1 : k - 1], legs[k === 0 ? legs.length - 1 : k - 1].t1, p);
                placeOnLeg(legs[k], legs[k].t0, q);
                expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-6);
            }
            // never hidden; over the city (x -489 to 489, z -499 to -81) at its tour height for minutes
            let over = 0;
            for (let t = 0; t < AIR_DAY; t += 1) {
                air.place(i, t * 1000, p);
                expect(p.hidden).toBe(false);
                if (p.x > -489 && p.x < 489 && p.z > -499 && p.z < -81) {
                    over++;
                    expect(p.y).toBeCloseTo(tour.y, 6);
                }
            }
            expect(over).toBeGreaterThan(300);
        }
    });

    it('puts every mover at the same place for the same tick, built again', () => {
        const a = newAirPlace(), b = newAirPlace();
        const again = new AirTraffic(level);
        for (const t of [123456, 987654, 1500000, 4567890]) {
            air.movers.forEach((_, i) => {
                air.place(i, t, a);
                again.place(i, t, b);
                expect([b.x, b.y, b.z, ...b.f, ...b.u]).toEqual([a.x, a.y, a.z, ...a.f, ...a.u]);
            });
        }
    });

    it('is solid: a point in a taxiing plane is pushed out, and moves with it', () => {
        const world = new AirWorld(new MeshContactWorld(level.collision), air);
        const i = air.planes[0];
        const p = newAirPlace();
        // find the ATR rolling on the ground, faster than 3 m/s
        let tick = 0;
        for (let t = 0; t < AIR_DAY; t += 1) {
            air.place(i, t * 1000, p);
            if (!p.hidden && p.y < 1 && p.v > 3) { tick = t * 1000; break; }
        }
        world.at(tick);
        const q = world.placeOf(i);
        // a point 1 m up the fuselage's side from its centre line, near the wing
        const x = q.x + q.u[0] * 2.15 + q.s[0] * 1.0, y = q.y + q.u[1] * 2.15 + q.s[1] * 1.0, z = q.z + q.u[2] * 2.15 + q.s[2] * 1.0;
        const o = { x: 0, y: 0, z: 0 };
        expect(world.pushOut(x, y, z, 0.05, o)).toBe(true);
        const out = new Float64Array(8 * 4), vel = new Float64Array(8 * 3);
        const n = world.contacts(x, y, z, 0.05, out, 8, vel);
        expect(n).toBeGreaterThan(0);
        expect(Math.hypot(vel[0], vel[1], vel[2])).toBeGreaterThan(2);
    });

    it('has solid props and rotors (owner, 2026-10-24): parked blades clear of the ground', () => {
        const shapes = [...new Set(air.movers.map((m) => m.shape))];
        let n = 0;
        for (const sh of shapes) for (const pr of sh.props) {
            expect(pr.rest.length).toBe(pr.blades);
            if (pr.axis !== 'f') continue;
            // the lowest blade tip, with half the chord, over the ground the mover stands on
            const low = Math.min(...pr.rest.map((b) => b.c[1] - Math.abs(b.R[1]) * b.e[0] - Math.abs(b.R[7]) * b.e[2]));
            expect(low, `a prop at ${pr.p.join(', ')}`).toBeGreaterThan(0.1);
            n++;
        }
        expect(n).toBeGreaterThan(10);
        // sitting level, every prop's disc clears the ground; wing engines' by 7 in (14 CFR 25.925(a))
        for (const m of air.movers) for (const pr of m.shape.props) {
            if (pr.axis !== 'f') continue;
            expect(pr.p[1] - pr.r, `${m.type?.kind}`).toBeGreaterThan(0);
            if (Math.abs(pr.p[2]) > 0.5) expect(pr.p[1] - pr.r, `${m.type?.kind} wing prop`).toBeGreaterThanOrEqual(7 * 0.0254 - 1e-9);
        }
        // the rest angle: a 2-blade prop stops level, a 4-blade one in an X
        expect(bladeAxes('f', propRest(2)).d.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, 1]);
        expect(Math.abs(bladeAxes('f', propRest(4)).d[1])).toBeCloseTo(Math.SQRT1_2, 9);
        expect(HELI.props.map((p) => p.axis)).toEqual(['u', 's']);
    });

    it('is solid on the blades only of a stopped prop, and across the whole disc of a turning one', () => {
        const world = new AirWorld(new MeshContactWorld(level.collision), air);
        const p = newAirPlace();
        /** the world point at radius k r of prop pr of mover i, angle a about its axis, as placed */
        const at = (q: AirPlace, pr: Prop, a: number, k: number): [number, number, number] => {
            const d = bladeAxes(pr.axis, a).d;
            const lf = pr.p[0] + d[0] * k * pr.r, lu = pr.p[1] + d[1] * k * pr.r, ls = pr.p[2] + d[2] * k * pr.r;
            return [0, 1, 2].map((j) => [q.x, q.y, q.z][j] + q.f[j] * lf + q.u[j] * lu + q.s[j] * ls) as [number, number, number];
        };
        const o = { x: 0, y: 0, z: 0 };
        let stopped = 0, turning = 0;
        for (const i of air.planes) {
            const pr = air.movers[i].shape.props[0];
            if (!pr) continue;
            const rest = propRest(pr.blades), half = Math.PI / pr.blades;
            let gotStop = false, gotTurn = false;
            for (let t = 0; t < AIR_DAY && !(gotStop && gotTurn); t += 7) {
                air.place(i, t * 1000, p);
                if (p.hidden || p.y > 1) continue;
                if (!gotStop && p.e === 0) {
                    world.at(t * 1000);
                    const q = world.placeOf(i);
                    // on a blade, 0.7 of the way out: inside; between two blades: clear
                    expect(world.pushOut(...at(q, pr, rest, 0.7), 0.01, o), `plane ${i} blade at ${t} s`).toBe(true);
                    expect(world.pushOut(...at(q, pr, rest + half, 0.7), 0.01, o), `plane ${i} gap at ${t} s`).toBe(false);
                    gotStop = true; stopped++;
                }
                if (!gotTurn && p.e > 0.5) {
                    world.at(t * 1000);
                    const q = world.placeOf(i);
                    // between the blades' rest places, in the disc: inside now
                    expect(world.pushOut(...at(q, pr, rest + half, 0.7), 0.01, o), `plane ${i} disc at ${t} s`).toBe(true);
                    gotTurn = true; turning++;
                }
            }
        }
        expect(stopped).toBeGreaterThan(5);
        expect(turning).toBeGreaterThan(5);
    });
});
