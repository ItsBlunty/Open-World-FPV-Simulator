// Traffic on the first map, both models. Loops (signals off): smooth routes, nothing through the level,
// cars off the sidewalks, nothing on a route catching up, cars on different routes never meeting. Network
// (signals on): every lane, turn, sidewalk, queue and crossing clear of the level, signals clear of it too;
// over ten minutes no two cars overlap, no car enters a junction on red, no person crosses while a car
// is near, and the traffic keeps flowing; the same state at a tick however it was reached. The physics
// against movers is tested where it is flown (apps/fly/test/traffic.test.ts).

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { CAR, DT, LoopTraffic, NetTraffic, PERSON, TrafficWorld, makeTraffic, placeAt, rectRoute, worldSha256 } from '../src/index';
import type { Place, Route } from '../src/index';

const level = buildFirstMap();
const mesh = new MeshContactWorld(level.collision);
const newPlace = (): Place => ({ x: 0, y: 0, z: 0, hx: 0, hz: 0 });
const ALL = { cars: true, people: true };

/** spheres filling a car's body and cabin (f along the heading, s across, y up), clear of the road */
const CAR_BALLS: number[][] = [];
for (const f of [-1.6, -0.8, 0, 0.8, 1.6]) for (const s of [-0.55, 0, 0.55]) CAR_BALLS.push([f, s, 0.56, 0.4]);
for (const f of [-0.8, -0.27, 0.27, 0.8]) for (const s of [-0.5, 0, 0.5]) CAR_BALLS.push([f - CAR.cabBack, s, 1.28, 0.27]);

/** Checks a car (or a person) at every half metre of a route against the level; the number of places checked. */
function clearOfLevel(rt: Route, kind: 'car' | 'walk', label: string, open: boolean): number {
    const out = { x: 0, y: 0, z: 0 };
    const pl = newPlace();
    let n = 0;
    for (let s = 0; s <= rt.length; s += 0.5) {
        placeAt(rt, s, pl, open);
        n++;
        if (kind === 'car') {
            for (const [f, sd, y, r] of CAR_BALLS) {
                const x = pl.x + f * pl.hx - sd * pl.hz, z = pl.z + f * pl.hz + sd * pl.hx;
                expect(mesh.querySphere(x, rt.y + y, z, r, out), `${label} at ${s} m`).toBe(false);
            }
            // the body's footprint corners are on the road, not over a kerb
            for (const f of [-CAR.bodyHalfL, CAR.bodyHalfL]) for (const sd of [-CAR.bodyHalfW, CAR.bodyHalfW]) {
                const x = pl.x + f * pl.hx - sd * pl.hz, z = pl.z + f * pl.hz + sd * pl.hx;
                for (const b of level.blocks) expect(x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1, `${label} at ${s} m`).toBe(false);
            }
        } else {
            // the capsule above the ground (its bottom stands on it; the kerb's 15 cm is stepped over)
            const g = Math.max(rt.y, 0.15);
            for (const y of [0.6, PERSON.y1]) expect(mesh.querySphere(pl.x, g + y, pl.z, PERSON.r, out), `${label} at ${s} m`).toBe(false);
        }
    }
    return n;
}

describe('routes', () => {
    it('are continuous with unit headings, through every corner', () => {
        const rt = rectRoute([[10, 0], [10, 20], [0, 20], [0, 0]], 3, 0);
        // straights 4 + 14 + 4 + 14 m, four quarter circles of radius 3
        expect(rt.length).toBeCloseTo(36 + 4 * 3 * (Math.PI / 2), 9);
        const a = newPlace(), b = newPlace();
        const step = 0.01;
        for (let s = 0; s < rt.length * 2; s += step) {
            placeAt(rt, s, a);
            placeAt(rt, s + step, b);
            expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThanOrEqual(step * (1 + 1e-9));
            expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(step * 0.999);
            expect(Math.hypot(a.hx, a.hz)).toBeCloseTo(1, 12);
            // the heading points where the mover goes next
            expect(((b.x - a.x) * a.hx + (b.z - a.z) * a.hz) / step).toBeGreaterThan(0.999);
        }
    });
});

describe('the world hash and the factory', () => {
    it('names what moves, and is the level\'s own when nothing does', () => {
        expect(worldSha256('abc', { cars: false, people: false, signals: true })).toBe('abc');
        const hs = new Set<string>();
        for (const cars of [true, false]) for (const people of [true, false]) for (const signals of [true, false]) {
            if (cars || people) hs.add(worldSha256('abc', { cars, people, signals }));
        }
        expect(hs.size).toBe(6);
        expect(makeTraffic(level, { cars: false, people: false, signals: true })).toBeNull();
        expect(makeTraffic(level, { ...ALL, signals: false })).toBeInstanceOf(LoopTraffic);
        expect(makeTraffic(level, { ...ALL, signals: true })).toBeInstanceOf(NetTraffic);
    });
});

describe('loop traffic (signals off)', () => {
    const traffic = new LoopTraffic(level, { ...ALL, signals: false });
    const cars = traffic.movers.filter((m) => m.kind === 'car');
    const people = traffic.movers.filter((m) => m.kind === 'person');

    it('has cars and people round every block, and the config leaves the others where they were', () => {
        console.log(`loops: ${level.blocks.length} blocks, ${cars.length} cars, ${people.length} people`);
        expect(level.blocks.length).toBe(60);
        expect(cars.length).toBeGreaterThanOrEqual(60);
        expect(people.length).toBeGreaterThanOrEqual(120);
        const carsOnly = new LoopTraffic(level, { cars: true, people: false, signals: false });
        expect(carsOnly.movers).toEqual(cars);
    });

    it('never drives or walks through the level, and keeps cars off the sidewalks', () => {
        let n = 0;
        traffic.routes.forEach((rt, k) => {
            const ids = traffic.byRoute[k];
            if (ids.length) n += clearOfLevel(rt, traffic.movers[ids[0]].kind === 'car' ? 'car' : 'walk', `route ${k}`, false);
        });
        console.log(`loops: ${n} places checked`);
    });

    it('keeps everything on a route apart (one speed per route, spread round it)', () => {
        traffic.routes.forEach((rt, k) => {
            const ids = traffic.byRoute[k];
            if (ids.length < 2) return;
            const gap = traffic.movers[ids[0]].kind === 'car' ? 2 * CAR.bodyHalfL + 4 : 2 * PERSON.r + 0.6;
            const ss = ids.map((i) => traffic.movers[i].s0).sort((a, b) => a - b);
            for (let j = 0; j < ss.length; j++) {
                const next = j + 1 < ss.length ? ss[j + 1] : ss[0] + rt.length;
                expect(next - ss[j], `route ${k}`).toBeGreaterThan(gap);
            }
            expect(new Set(ids.map((i) => traffic.movers[i].v)).size).toBe(1);
        });
    });

    it('never lets cars on different routes meet, and moves each mover by its speed per tick', () => {
        const ids = traffic.movers.map((m, i) => (m.kind === 'car' ? i : -1)).filter((i) => i >= 0);
        const ps = ids.map(newPlace);
        let closest = Infinity;
        for (let tick = 0; tick < 120000; tick += 997) {
            ids.forEach((i, j) => traffic.place(i, tick, ps[j]));
            for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
                if (traffic.movers[ids[a]].route === traffic.movers[ids[b]].route) continue;
                closest = Math.min(closest, Math.hypot(ps[a].x - ps[b].x, ps[a].z - ps[b].z));
            }
        }
        console.log(`loops: closest cars on different routes ${closest.toFixed(2)} m`);
        expect(closest).toBeGreaterThan(2 * CAR.bodyHalfL + 1);
        const a = newPlace(), b = newPlace();
        traffic.movers.forEach((m, i) => {
            for (const tick of [0, 12345, 3600000]) {
                traffic.place(i, tick, a);
                traffic.place(i, tick + 1, b);
                expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThanOrEqual(m.v * DT * (1 + 1e-6));
            }
        });
    });
});

/** Two oriented car bodies overlap (separating axis test in x-z). */
function carsOverlap(a: Place, b: Place): boolean {
    const axes = [[a.hx, a.hz], [-a.hz, a.hx], [b.hx, b.hz], [-b.hz, b.hx]];
    const corners = (p: Place): number[][] => [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([f, s]) => [
        p.x + f * CAR.bodyHalfL * p.hx - s * CAR.bodyHalfW * p.hz, p.z + f * CAR.bodyHalfL * p.hz + s * CAR.bodyHalfW * p.hx]);
    const ca = corners(a), cb = corners(b);
    for (const [ux, uz] of axes) {
        const pa = ca.map(([x, z]) => x * ux + z * uz), pb = cb.map(([x, z]) => x * ux + z * uz);
        if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
    return true;
}

describe('network traffic (signals on)', () => {
    const net = new NetTraffic(level, { ...ALL, signals: true });
    const n = net.movers.length;
    const carIds = net.movers.map((m, i) => (m.kind === 'car' ? i : -1)).filter((i) => i >= 0);
    const peopleIds = net.movers.map((m, i) => (m.kind === 'person' ? i : -1)).filter((i) => i >= 0);

    it('has every lane, turn, sidewalk, queue and crossing clear of the level, and the signals too', () => {
        console.log(`network: ${carIds.length} cars, ${peopleIds.length} people, ${net.signals.length} signal heads`);
        expect(carIds.length).toBeGreaterThan(100);
        expect(peopleIds.length).toBeGreaterThan(150);
        let places = 0;
        net.paths().forEach((p, k) => { places += clearOfLevel(p.route, p.kind, `${p.kind} path ${k}`, true); });
        console.log(`network: ${places} places checked`);
        const out = { x: 0, y: 0, z: 0 };
        for (const b of net.allStatics()) {
            // a small sphere at the box's centre and over its ends, above the sidewalk
            const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
            for (const y of [Math.max(b.y0, 0.4), (b.y0 + b.y1) / 2, b.y1]) {
                expect(mesh.querySphere(cx, y, cz, 0.08, out), `signal box at ${cx}, ${cz}`).toBe(false);
            }
        }
    });

    it('over ten minutes: no cars overlap, none enters a junction on red, no one crosses near a car, all keeps moving', () => {
        const pl = Array.from({ length: n }, newPlace);
        const was = Array.from({ length: n }, () => net.inspect(0));
        let speedSum = 0, speedN = 0, redRuns = 0, overlaps = 0, nearCrossers = 0, crossings = 0, waited = 0, braked = 0;
        let lastSum = 0, lastN = 0, longestStill = 0, arrowTurns = 0;
        const still = new Map<number, number>(carIds.map((i) => [i, 0]));
        const STEPS = 12000; // 20 Hz
        net.at(0);
        for (let i = 0; i < n; i++) was[i] = net.inspect(i);
        for (let k = 1; k <= STEPS; k++) {
            const tick = k * 50;
            // the step this runs starts at `tick`; inspect() then shows the state at its end
            net.at(tick);
            for (let i = 0; i < n; i++) net.place(i, tick, pl[i]);
            for (const i of carIds) {
                const now = net.inspect(i);
                // entering a junction: the light during the step it went in was green or yellow
                if (was[i].link && !now.link && net.carSignal(was[i].j, was[i].group, tick) === 'red') redRuns++;
                // light groups 0 and 2 are the left-turn arrows
                if (was[i].link && !now.link && now.group % 2 === 0) arrowTurns++;
                if (net.braking(i)) braked++;
                speedSum += now.v;
                speedN++;
                if (k > STEPS - 1200) { lastSum += now.v; lastN++; }
                const st = now.v < 0.1 ? still.get(i)! + 1 : 0;
                still.set(i, st);
                if (st > longestStill) longestStill = st;
                was[i] = now;
            }
            for (const q of peopleIds) {
                const now = net.inspect(q);
                if (now.phase === 2) waited++;
                if (was[q].phase !== 3 && now.phase === 3) crossings++;
                if (now.phase === 3) {
                    for (const i of carIds) if (Math.hypot(pl[i].x - pl[q].x, pl[i].z - pl[q].z) < CAR.bodyHalfL + 1) nearCrossers++;
                }
                was[q] = now;
            }
            if (k % 20 === 0) {
                for (let a = 0; a < carIds.length; a++) for (let b = a + 1; b < carIds.length; b++) {
                    const p = pl[carIds[a]], q = pl[carIds[b]];
                    if (Math.abs(p.x - q.x) < 5 && Math.abs(p.z - q.z) < 5 && carsOverlap(p, q)) overlaps++;
                }
            }
        }
        const mean = speedSum / speedN, lastMean = lastSum / lastN;
        console.log(`network, 10 min: ${crossings} crossings started, ${waited} person-steps waiting, ${braked} car-steps braking, ` +
            `mean car speed ${mean.toFixed(2)} m/s (last minute ${lastMean.toFixed(2)}), longest stand-still ${longestStill / 20} s; ` +
            `overlaps ${overlaps}, red runs ${redRuns}, crossers near cars ${nearCrossers}, arrow turns ${arrowTurns}`);
        expect(overlaps).toBe(0);
        expect(redRuns).toBe(0);
        expect(nearCrossers).toBe(0);
        expect(crossings).toBeGreaterThan(200);
        expect(waited).toBeGreaterThan(1000);
        expect(braked).toBeGreaterThan(1000);
        // Left turns on their arrows (measured 313 in these 10 min).
        expect(arrowTurns).toBeGreaterThan(150);
        // Flowing, not jammed: no car waits longer than one light cycle (84 s), and the last minute is as quick as
        // the whole run (a jam that grows shows as a falling speed; before left turns, the edge lane they now leave
        // by trapped cars and the speed fell from 3.0 to 1.4 m/s over 30 min). The mean itself is set by the
        // lights: straight on has green 15 s in 84, and a car behind one waiting for its arrow waits too (one lane).
        // Measured 1.89 m/s over these 10 min, steady at 1.83-1.92 over 30 min; the bound leaves room for tuning.
        expect(longestStill / 20).toBeLessThan(84);
        expect(lastMean).toBeGreaterThan(0.8 * mean);
        expect(mean).toBeGreaterThan(1.6);
    });

    it('walks people in through the buildings\' doors and out again, through the opening only', () => {
        expect(level.doors.length).toBeGreaterThan(100);
        const out = { x: 0, y: 0, z: 0 };
        for (const d of level.doors) {
            // the way out from the doorway to the walking line is clear of the level: a person's capsule as spheres (2 cm
            // smaller: standing on the sidewalk is touching it)
            const b = level.blocks[d.block];
            const kerb = d.nz < 0 ? d.z - b.z0 : d.nx > 0 ? b.x1 - d.x : d.nz > 0 ? b.z1 - d.z : d.x - b.x0;
            for (let s = PERSON.r + 0.05; s <= kerb - 1.3; s += 0.25) {
                for (const y of [PERSON.y0, (PERSON.y0 + PERSON.y1) / 2, PERSON.y1]) {
                    expect(mesh.querySphere(d.x + d.nx * s, d.y + y, d.z + d.nz * s, PERSON.r - 0.02, out), `door at ${d.x}, ${d.z}`).toBe(false);
                }
            }
        }
        const t = new NetTraffic(level, { ...ALL, signals: true });
        const ids = t.movers.map((m, i) => (m.kind === 'person' ? i : -1)).filter((i) => i >= 0);
        const pl = newPlace();
        const was = ids.map(() => -1);
        let entered = 0, left = 0, hiddenMax = 0, hiddenNow = 0, offLine = 0;
        const STEPS = 6000; // 5 min at 20 Hz
        for (let k = 1; k <= STEPS; k++) {
            const tick = k * 50;
            t.at(tick);
            hiddenNow = 0;
            ids.forEach((q, n) => {
                const ph = t.inspect(q).phase;
                if (ph === 7 && was[n] !== 7) entered++;
                if (ph === 8 && was[n] === 7) left++;
                if (t.hidden(q)) hiddenNow++;
                const d = t.doorUse(q);
                if (d >= 0) {
                    // in the doorway: on the line through the door's middle, square to its face
                    const door = level.doors[d];
                    t.place(q, tick, pl);
                    const lateral = Math.abs((pl.x - door.x) * door.nz - (pl.z - door.z) * door.nx);
                    if (lateral > door.width / 2 - PERSON.r) offLine++;
                }
                if (ph === 7) {
                    // inside the building it went into
                    t.place(q, tick, pl);
                    const bd = level.buildings.find((b) => pl.x > b.x0 && pl.x < b.x1 && pl.z > b.z0 && pl.z < b.z1);
                    expect(bd, `person ${q} inside`).toBeDefined();
                }
                was[n] = ph;
            });
            hiddenMax = Math.max(hiddenMax, hiddenNow);
        }
        console.log(`doors, 5 min: ${entered} went in, ${left} came out, ${hiddenNow} of ${ids.length} inside at the end (most ${hiddenMax}), off the door line ${offLine}`);
        expect(entered).toBeGreaterThan(50);
        expect(left).toBeGreaterThan(20);
        expect(offLine).toBe(0);
        // most people stay out on the streets
        expect(hiddenMax).toBeLessThan(ids.length * 0.4);
    });

    it('is the same at a tick however it got there: straight there, step by step, or back in time', () => {
        const ticks = [0, 61234, 300000, 75000, 300001, 1000];
        const fresh = (): NetTraffic => new NetTraffic(buildFirstMap(), { ...ALL, signals: true });
        const snap = (t: NetTraffic, tick: number): number[] => {
            t.at(tick);
            const p = newPlace();
            const out: number[] = [];
            for (let i = 0; i < t.movers.length; i++) { t.place(i, tick, p); out.push(p.x, p.y, p.z, p.hx, p.hz); }
            return out;
        };
        const back = fresh();
        for (const tick of ticks) {
            const direct = snap(fresh(), tick);
            expect(snap(back, tick), `tick ${tick}`).toEqual(direct);
        }
    });

    it('moves each mover by no more than its top speed per tick, between and across steps', () => {
        const a = newPlace(), b = newPlace();
        for (const tick of [1000, 1049, 1050, 77777]) {
            net.at(tick);
            for (let i = 0; i < n; i++) {
                net.place(i, tick, a);
                net.place(i, tick + 1, b);
                expect(Math.hypot(b.x - a.x, b.z - a.z), `mover ${i} at ${tick}`).toBeLessThanOrEqual(net.movers[i].v * DT * 1.6 + 1e-9);
            }
        }
    });
});

describe('the traffic world', () => {
    const loops = new LoopTraffic(level, { ...ALL, signals: false });
    const world = new TrafficWorld(mesh, loops);
    const car = loops.movers.findIndex((m) => m.kind === 'car');
    const tick = 5000;

    it('reports a car\'s roof under a point above it, moving with the car', () => {
        world.at(tick);
        const pl = world.placeOf(car);
        const out = new Float64Array(16), vel = new Float64Array(12);
        const k = world.contacts(pl.x, CAR.cabY1 + 0.04, pl.z, 0.05, out, 4, vel);
        expect(k).toBe(1);
        expect(out[0]).toBeCloseTo(0, 12);
        expect(out[1]).toBe(1);
        expect(out[2]).toBeCloseTo(0, 12);
        expect(out[3]).toBeCloseTo(0.04, 9);
        expect(Math.hypot(vel[0], vel[2])).toBeCloseTo(loops.movers[car].v, 3);
        // nothing far from the traffic and the level
        expect(world.contacts(0, 50, 40, 0.05, out, 4, vel)).toBe(0);
    });

    it('stops a sweep into a car at its side, and pushes a sphere inside it out', () => {
        world.at(tick);
        const pl = world.placeOf(car);
        const sx = -pl.hz, sz = pl.hx;
        const y = (CAR.bodyY0 + CAR.bodyY1) / 2;
        const c0 = new Float64Array([pl.x - sx * 3, y, pl.z - sz * 3]);
        const c1 = new Float64Array([pl.x + sx * 3, y, pl.z + sz * 3]);
        const o = { sphere: -1, nx: 0, ny: 0, nz: 0 };
        const t = world.sweep(c0, c1, new Float64Array([0.05]), new Float64Array([0]), 1, o);
        expect(t).toBeCloseTo((3 - CAR.bodyHalfW - 0.05) / 6, 4);
        expect(o.nx * sx + o.nz * sz).toBeCloseTo(-1, 9);
        const push = { x: 0, y: 0, z: 0 };
        expect(world.pushOut(pl.x + sx * (CAR.bodyHalfW - 0.01), y, pl.z + sz * (CAR.bodyHalfW - 0.01), 0.05, push)).toBe(true);
        expect(push.x * sx + push.z * sz).toBeCloseTo(0.06, 9);
    });

    it('has the signal poles solid and still', () => {
        const net = new NetTraffic(level, { ...ALL, signals: true });
        const w = new TrafficWorld(mesh, net);
        w.at(0);
        const b = net.allStatics()[0];
        const cz = (b.z0 + b.z1) / 2;
        const out = new Float64Array(16), vel = new Float64Array(12).fill(7);
        // 3 cm off the pole's +x face, at head height
        const k = w.contacts(b.x1 + 0.03, 3, cz, 0.05, out, 4, vel);
        expect(k).toBe(1);
        expect(out[0]).toBe(1);
        expect(out[3]).toBeCloseTo(0.03, 9);
        expect([vel[0], vel[1], vel[2]]).toEqual([0, 0, 0]);
    });
});
