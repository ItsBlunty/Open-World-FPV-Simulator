// Solid traffic in a real session (sim-core/0.5.0 moving surfaces, packages/traffic): a car driving into a
// hovering quad shoves it without the quad going into the car; a quad on a car's roof with the car's speed
// rides along on a straight, still; a quad set on a roof from rest is dragged at about mu g; the same
// flight among the signalled traffic, a car hitting the quad, twice gives the same run hash.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, hoverStickOf } from '@owfpv/sim-core';
import type { PresetJson, Sim } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import { CAR, makeTraffic } from '@owfpv/traffic';
import type { Place, TrafficConfig } from '@owfpv/traffic';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from '../src/session';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
const LOOPS: TrafficConfig = { cars: true, people: false, signals: false };
/** the game's default: damage and crashes off, every hit a bounce (owner, 2026-10-17) */
const GAME = { crashOn: false };
/** sim.ts MU, the friction coefficient of every contact */
const MU = 0.4;
const G = 9.81;
const newPlace = (): Place => ({ x: 0, y: 0, z: 0, hx: 1, hz: 0 });

/** World centres and radii of the craft's collision spheres. */
function spheres(sim: Sim): number[][] {
    const s = sim.s, sp = sim.p.spheres;
    const w = s[S.qw], x = s[S.qx], y = s[S.qy], z = s[S.qz];
    const out: number[][] = [];
    for (let i = 0; i < sp.length; i += 4) {
        const vx = sp[i], vy = sp[i + 1], vz = sp[i + 2];
        const tx = y * vz - z * vy + w * vx, ty = z * vx - x * vz + w * vy, tz = x * vy - y * vx + w * vz;
        out.push([s[S.px] + vx + 2 * (y * tz - z * ty), s[S.py] + vy + 2 * (z * tx - x * tz), s[S.pz] + vz + 2 * (x * ty - y * tx), sp[i + 3]]);
    }
    return out;
}

/** How far the deepest sphere is into anything (car, ground, level), m; positive: clear by that much. */
function clearance(sim: Sim): number {
    // the state after a step lines up with the movers one tick on (the solver closes gaps against where they go)
    const world = sim.contactWorld!;
    world.at?.(sim.tick + 1);
    const out = new Float64Array(32);
    let worst = Infinity;
    for (const [x, y, z, r] of spheres(sim)) {
        const k = world.contacts(x, y, z, r + 0.05, out, 8);
        for (let j = 0; j < k; j++) worst = Math.min(worst, out[j * 4 + 3] - r);
    }
    return worst;
}

/** The first tick from `from` (in 100 ms steps) at which car `i` keeps one heading for the next `ms`. */
function onStraight(s: FlightSession, i: number, from: number, ms: number): number {
    const t = s.traffic!;
    const a = newPlace(), b = newPlace();
    for (let tick = from; tick < from + 600000; tick += 100) {
        let same = true;
        t.place(i, tick, a);
        for (let k = 100; k <= ms && same; k += 100) {
            t.place(i, tick + k, b);
            same = Math.abs(a.hx - b.hx) < 1e-12 && Math.abs(a.hz - b.hz) < 1e-12;
        }
        if (same) return tick;
    }
    throw new Error('no straight');
}

/** Steps the session's runner until the sim tick is `tick`, sticks as they are. */
function stepTo(s: FlightSession, tick: number): void {
    while (s.sim.tick < tick) s.runner.stepOnce();
}

describe('solid traffic in a session', () => {
    it('a car driving into a hovering quad shoves it ahead without the quad going into it', () => {
        const s = new FlightSession({ preset, level, traffic: LOOPS, overrides: GAME });
        const r = s.runner;
        const car = 0;
        const v = s.traffic!.movers[car].v;
        // the quad waits 0.6 s ahead of the car, on its lane, at the height of the car's body
        const t0 = onStraight(s, car, 2000, 2500);
        const ahead = newPlace();
        s.traffic!.place(car, t0 + 600, ahead);
        const ch = new Float32Array([0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0]);
        r.enqueue({ tUs: 1000, ch });
        for (let i = 0; i < 100; i++) r.stepOnce();
        ch[4] = 1;
        r.enqueue({ tUs: r.tUs + 1000, ch });
        for (let i = 0; i < 100; i++) r.stepOnce();
        expect(s.sim.armed).toBe(true);
        stepTo(s, t0 - 1);
        const roadY = s.groundY(ahead.x, ahead.z);
        r.respawn(ahead.x, roadY + 0.6, ahead.z, 0, { platform: false, keepArmed: true }, 'manual-start');
        ch[2] = hoverStickOf(s.sim.p) * 2 - 1;
        r.enqueue({ tUs: r.tUs + 1000, ch });
        let worst = Infinity, along = 0;
        const n = r.events.length;
        for (let t = 0; t < 1500; t++) {
            r.stepOnce();
            worst = Math.min(worst, clearance(s.sim));
            along = Math.max(along, s.sim.s[S.vx] * ahead.hx + s.sim.s[S.vz] * ahead.hz);
        }
        const hits = r.events.slice(n).filter((e) => e.type === 'contact' || e.type === 'crash').length;
        console.log(`shove: car at ${v.toFixed(1)} m/s; quad's fastest along the car's way ${along.toFixed(2)} m/s; ` +
            `least clearance to anything ${(worst * 1000).toFixed(2)} mm (negative: inside); ${hits} contact events`);
        expect(hits).toBeGreaterThan(0);
        expect(worst).toBeGreaterThan(-0.01);
        expect(along).toBeGreaterThan(0.8 * v);
    });

    /** A disarmed quad on the roof of car 0, `fwd` m ahead of the roof's centre, with velocity `vel` x the car's. */
    function onRoof(fwd: number, vel: number) {
        const s = new FlightSession({ preset, level, traffic: LOOPS, overrides: GAME });
        const car = 0;
        const v = s.traffic!.movers[car].v;
        const t0 = onStraight(s, car, 2000, 2000);
        stepTo(s, t0 - 1);
        const pl = newPlace();
        s.traffic!.place(car, t0, pl);
        const f = fwd - CAR.cabBack;
        const roof = pl.y + CAR.cabY1 + s.sim.p.bodyBottom + 0.0005;
        s.runner.respawn(pl.x + pl.hx * f, roof, pl.z + pl.hz * f, 0, { platform: false }, 'manual-start');
        const st = s.sim.s;
        st[S.hold] = 0;
        st[S.vx] = pl.hx * v * vel;
        st[S.vz] = pl.hz * v * vel;
        return { s, car, v, t0, pl, f };
    }

    it('a quad on a car\'s roof with the car\'s speed rides along on a straight, still', () => {
        const { s, car, pl, f } = onRoof(0, 1);
        const at = newPlace();
        let drift = 0, maxW = 0, yLo = Infinity, yHi = -Infinity, dx0 = NaN, dz0 = NaN;
        for (let t = 0; t < 1500; t++) {
            s.runner.stepOnce();
            s.traffic!.place(car, s.sim.tick, at);
            const st = s.sim.s;
            // the quad's offset from the roof spot; how much it changes (the state after a step is one tick on
            // from the movers' place at that tick, a constant offset of one tick's travel)
            const dx = st[S.px] - (at.x + at.hx * f), dz = st[S.pz] - (at.z + at.hz * f);
            if (t === 0) { dx0 = dx; dz0 = dz; }
            drift = Math.max(drift, Math.hypot(dx - dx0, dz - dz0));
            if (t >= 200) {
                maxW = Math.max(maxW, Math.hypot(st[S.wx], st[S.wy], st[S.wz]));
                yLo = Math.min(yLo, st[S.py]); yHi = Math.max(yHi, st[S.py]);
            }
        }
        console.log(`ride: drift on the roof ${(drift * 1000).toFixed(3)} mm over 1.5 s; gyro ${maxW.toExponential(2)} rad/s; ` +
            `height range ${((yHi - yLo) * 1000).toFixed(4)} mm`);
        expect(pl.hx * pl.hx + pl.hz * pl.hz).toBeCloseTo(1, 9);
        expect(drift).toBeLessThan(0.005);
        expect(maxW).toBeLessThan(1e-3);
        expect(yHi - yLo).toBeLessThan(1e-4);
    });

    it('a quad set on a car\'s roof from rest is dragged at about mu g', () => {
        // at the front of the roof: the car slides 0.5 v^2 / (mu g) under it while it catches up, so this
        // measures only the first 0.1 s (about 0.9 m of the 2.2 m roof)
        const { s, v, pl } = onRoof(0.8, 0);
        for (let t = 0; t < 100; t++) s.runner.stepOnce();
        const st = s.sim.s;
        const a = (st[S.vx] * pl.hx + st[S.vz] * pl.hz) / 0.1;
        console.log(`drag: car at ${v.toFixed(1)} m/s; quad accelerated at ${a.toFixed(3)} m/s^2 over 0.1 s (mu g ${(MU * G).toFixed(3)})`);
        expect(a).toBeGreaterThan(0.85 * MU * G);
        expect(a).toBeLessThan(1.05 * MU * G);
    });

    // 2026-10-20 (docs/physics-review.md F7): the old run-hash flight's quad stayed exactly level with motors at 0.98 / 0.06;
    // it was inside an SUV (between its body and glass boxes), not on the roof. On the roof it tips as on any floor.
    it('armed on a moving car\'s roof in angle mode, under hover throttle with roll and pitch stick: it tips onto its edge', () => {
        const s = new FlightSession({ preset, level, traffic: LOOPS, overrides: GAME });
        const r = s.runner;
        const car = 0;
        const v = s.traffic!.movers[car].v;
        const t0 = onStraight(s, car, 2000, 2000);
        const ch = new Float32Array([0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0]);
        r.enqueue({ tUs: 1000, ch });
        for (let i = 0; i < 100; i++) r.stepOnce();
        ch[4] = 1;
        r.enqueue({ tUs: r.tUs + 1000, ch });
        stepTo(s, t0 - 1);
        expect(s.sim.armed).toBe(true);
        const pl = newPlace();
        s.traffic!.place(car, t0, pl);
        // car 0 is an SUV: its roof is its shape's top (CAR is the saloon's), over the middle of its glass box
        const top = s.traffic!.movers[car].shape!.top, f = -0.6;
        r.respawn(pl.x + pl.hx * f, pl.y + top + s.sim.p.bodyBottom + 0.0005, pl.z + pl.hz * f, 0, { platform: false, keepArmed: true }, 'manual-start');
        s.sim.s[S.vx] = pl.hx * v;
        s.sim.s[S.vz] = pl.hz * v;
        ch[0] = 0.3; ch[1] = 0.2; ch[2] = hoverStickOf(s.sim.p) * 0.9 * 2 - 1;
        r.enqueue({ tUs: r.tUs + 1000, ch });
        // 0.3 s: later it slides back along the roof (riding at the car's speed through still air the rotors
        // get translational lift, so 90 % of hover thrust hops it a few cm)
        for (let t = 0; t < 300; t++) r.stepOnce();
        const st = s.sim.s;
        const upY = 1 - 2 * (st[S.qx] ** 2 + st[S.qz] ** 2);
        const at = newPlace();
        s.traffic!.place(car, s.sim.tick, at);
        const above = st[S.py] - at.y - top;
        console.log(`roof tip: body up-vector y ${upY.toFixed(5)} (${(Math.acos(upY) * 57.29578).toFixed(1)} deg), centre ${(above * 1000).toFixed(1)} mm over the roof`);
        expect(s.sim.armed).toBe(true);
        expect(upY).toBeLessThan(0.995);
        expect(above).toBeGreaterThan(0);
        expect(above).toBeLessThan(0.1);
    });

    it('is the same flight among the signalled traffic twice (run hash), a car hitting the quad in it', () => {
        // a copy of the traffic (a function of the tick alone) finds a car driving at least 5 m in 0.6 s on a straight;
        // network traffic places movers only at the tick it was brought to (at), so a session cannot look ahead
        const cfg: TrafficConfig = { cars: true, people: true, signals: true };
        const scout = makeTraffic(level, cfg)!;
        const a = newPlace(), ahead = newPlace();
        const from = new Map<number, number[]>();
        let car = -1, t0 = 1000;
        for (; car < 0; t0 += 500) {
            scout.at(t0);
            scout.movers.forEach((m, i) => { if (m.kind === 'car') { scout.place(i, t0, a); from.set(i, [a.x, a.z, a.hx, a.hz]); } });
            scout.at(t0 + 600);
            for (const [i, [x, z, hx, hz]] of from) {
                scout.place(i, t0 + 600, ahead);
                if (Math.hypot(ahead.x - x, ahead.z - z) > 5 && Math.abs(ahead.hx - hx) < 1e-6 && Math.abs(ahead.hz - hz) < 1e-6) { car = i; break; }
            }
            if (car >= 0) break;
        }
        const run = (): { hash: string; hits: number } => {
            // the session starts 0.3 s before; the quad hovers in the car's lane where it will be 0.6 s later
            const s = new FlightSession({ preset, level, traffic: cfg, runHash: true, overrides: GAME, startTick: t0 - 300 });
            const r = s.runner;
            const ch = new Float32Array([0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0]);
            r.enqueue({ tUs: r.tUs + 1000, ch });
            for (let i = 0; i < 100; i++) r.stepOnce();
            ch[4] = 1;
            r.enqueue({ tUs: r.tUs + 1000, ch });
            stepTo(s, t0);
            r.respawn(ahead.x, s.groundY(ahead.x, ahead.z) + 0.6, ahead.z, 30, { platform: false, keepArmed: true }, 'manual-start');
            const hover = hoverStickOf(s.sim.p) * 2 - 1;
            const n = r.events.length;
            for (let t = 0; t < 4000; t++) {
                if (t % 4 === 0) {
                    ch[0] = 0.3 * Math.sin(t * 0.002);
                    ch[1] = 0.2 * Math.cos(t * 0.0013);
                    ch[2] = hover + 0.05 * Math.sin(t * 0.003);
                    r.enqueue({ tUs: r.tUs + 1000, ch });
                }
                r.stepOnce();
            }
            return { hash: r.traceHash(), hits: r.events.slice(n).filter((e) => e.type === 'contact').length };
        };
        const first = run();
        console.log(`run hash: car ${car} (${scout.movers[car].shape!.kind}) from tick ${t0}; ${first.hits} contact events`);
        expect(first.hits).toBeGreaterThan(0);
        expect(run()).toEqual(first);
    });
});
