// The steam train (packages/traffic train.ts) on its own and in a real session: its run round the loop pulls away and
// stops like a train (gentle rates, a smooth brake, the front on the stop mark), its vehicles stay coupled round the
// curves, and it is solid: it shoves a hovering quad ahead without the quad going into it, carries a quad on a coach
// roof through the tunnel, and the same flight beside it twice gives the same run hash.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, hoverStickOf } from '@owfpv/sim-core';
import type { PresetJson, Sim } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import { DWELL_S, TRAIN_VMAX, Train, worldSha256 } from '@owfpv/traffic';
import type { Place, TrafficConfig, TrainState } from '@owfpv/traffic';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from '../src/session';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
const TRAIN: TrafficConfig = { cars: false, people: false, signals: false, train: true };
const GAME = { crashOn: false };
const newPlace = (): Place => ({ x: 0, y: 0, z: 0, hx: 1, hz: 0 });
const newState = (): TrainState => ({ run: 0, s: 0, v: 0, effort: 0, brake: 0 });

/** World centres and radii of the craft's collision spheres (as traffic.test.ts). */
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

/** How far the deepest sphere is into anything, m; positive: clear by that much. */
function clearance(sim: Sim): number {
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

/** The first tick of the first lap (10 ms steps) at which the train's front is at route distance s (mod the loop). */
function frontAt(tr: Train, s: number): number {
    const L = tr.route.length, st = newState();
    const want = ((s % L) + L) % L;
    let prev = -1;
    for (let t = 0; t < tr.cycleTicks; t += 10) {
        const f = ((tr.state(t, st).s % L) + L) % L;
        if (prev >= 0 && prev <= want && f >= want && f - prev < 1) return t;
        prev = f;
    }
    throw new Error(`the front never passes ${s}`);
}

/** Route distance of the north straight's point at x (it runs east from x = -145 at s = 10 + 110 pi / 2). */
const north = (x: number): number => 10 + (110 * Math.PI) / 2 + (x + 145);

function armed(s: FlightSession): Float32Array {
    const r = s.runner;
    const ch = new Float32Array([0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0]);
    r.enqueue({ tUs: 1000, ch });
    for (let i = 0; i < 100; i++) r.stepOnce();
    ch[4] = 1;
    r.enqueue({ tUs: r.tUs + 1000, ch });
    for (let i = 0; i < 100; i++) r.stepOnce();
    return ch;
}

describe('the steam train', () => {
    const tr = new Train(level);

    it('pulls away gently, holds 45 km/h, brakes smoothly and stops on the mark, then stands', () => {
        const st = newState();
        const dt = 100;
        let vMax = 0, aMax = 0, dMax = 0, jMax = 0, prevA = 0, toTop = -1;
        let v0 = tr.state(0, st).v;
        for (let t = dt; t <= tr.runTicks; t += dt) {
            const v = tr.state(t, st).v;
            const a = (v - v0) / (dt / 1000);
            vMax = Math.max(vMax, v);
            aMax = Math.max(aMax, a);
            dMax = Math.max(dMax, -a);
            if (t > dt) jMax = Math.max(jMax, Math.abs(a - prevA) / (dt / 1000));
            if (toTop < 0 && v > 0.99 * TRAIN_VMAX) toTop = t / 1000;
            prevA = a;
            v0 = v;
        }
        const L = tr.route.length;
        const end = tr.state(tr.runTicks, st);
        console.log(`train: loop ${L.toFixed(1)} m, run ${(tr.runTicks / 1000).toFixed(1)} s + ${DWELL_S} s at the station; top ${vMax.toFixed(2)} m/s ` +
            `after ${toTop.toFixed(1)} s; most pull ${aMax.toFixed(3)} m/s^2, most brake ${dMax.toFixed(3)} m/s^2, most jerk ${jMax.toFixed(3)} m/s^3; ` +
            `stops ${((end.s - tr.stopS - L) * 1000).toFixed(3)} mm from the mark`);
        expect(vMax).toBeLessThanOrEqual(TRAIN_VMAX + 1e-6);
        expect(vMax).toBeGreaterThan(0.99 * TRAIN_VMAX);
        expect(aMax).toBeLessThan(0.3);
        expect(dMax).toBeLessThan(0.4);
        expect(jMax).toBeLessThan(0.5);
        expect(Math.abs(end.s - tr.stopS - L)).toBeLessThan(0.001);
        // it stands at the station for the dwell, then the next lap starts from there
        for (let t = tr.runTicks; t < tr.cycleTicks; t += 1000) expect(tr.state(t, st).v).toBe(0);
        expect(tr.cycleTicks - tr.runTicks).toBe(DWELL_S * 1000);
        expect(tr.state(tr.cycleTicks, st).s).toBeCloseTo(tr.stopS, 9);
        expect(tr.state(tr.cycleTicks + 5000, st).run).toBeCloseTo(L + tr.state(5000, newState()).run, 6);
        // the same numbers from a train built again (it is worked out when built)
        const again = new Train(level);
        for (const t of [0, 12345, 77777, 150001, 400000]) expect(again.state(t, newState())).toEqual(tr.state(t, newState()));
    });

    it('keeps its vehicles coupled round the curves: ends never overlap, gaps stay under a metre', () => {
        const a = newPlace(), b = newPlace();
        let least = Infinity, most = 0;
        for (let s = 0; s < tr.route.length; s += 2) {
            for (let i = 0; i + 1 < tr.vehicles.length; i++) {
                const vi = tr.vehicles[i], vj = tr.vehicles[i + 1];
                tr.placeAtS(i, s, a);
                tr.placeAtS(i + 1, s, b);
                // the back of vehicle i's body and the front of vehicle i + 1's, on their centre lines
                const bi = Math.min(...vi.boxes.map((x) => x.f0)), fj = Math.max(...vj.boxes.map((x) => x.f1));
                const gx = (b.x + b.hx * fj) - (a.x + a.hx * bi), gz = (b.z + b.hz * fj) - (a.z + a.hz * bi);
                // positive when i + 1's front is behind i's back, along i's heading
                const gap = -(gx * a.hx + gz * a.hz);
                least = Math.min(least, gap);
                most = Math.max(most, Math.hypot(gx, gz));
            }
        }
        console.log(`couplings: body ends ${least.toFixed(3)} to ${most.toFixed(3)} m apart round the loop`);
        expect(least).toBeGreaterThan(0.2);
        expect(most).toBeLessThan(1);
    });

    it('names the train in the collision hash, and leaves the old hashes alone without it', () => {
        const sha = 'f'.repeat(64);
        const off = { cars: true, people: true, signals: true };
        expect(worldSha256(sha, { ...off, train: false })).toBe(worldSha256(sha, off));
        expect(worldSha256(sha, { ...off, train: true })).not.toBe(worldSha256(sha, off));
        expect(worldSha256(sha, TRAIN)).not.toBe(sha);
        expect(worldSha256(sha, { ...TRAIN, train: false })).toBe(sha);
    });

    it('shoves a quad hovering on the line ahead without the quad going into it', () => {
        const s = new FlightSession({ preset, level, traffic: TRAIN, overrides: GAME });
        const r = s.runner;
        const train = s.train!;
        // at x -100 on the north straight, before the tunnel, the train is at its top speed
        const t0 = frontAt(train, north(-100) - 1);
        const ch = armed(s);
        while (s.sim.tick < t0 - 500) r.stepOnce();
        r.respawn(-100 + 1.5, 2.2, 245, 90, { platform: false, keepArmed: true }, 'manual-start');
        ch[2] = hoverStickOf(s.sim.p) * 2 - 1;
        r.enqueue({ tUs: r.tUs + 1000, ch });
        const v = train.state(t0, newState()).v;
        let worst = Infinity, along = 0;
        const n = r.events.length;
        for (let t = 0; t < 2000; t++) {
            r.stepOnce();
            worst = Math.min(worst, clearance(s.sim));
            along = Math.max(along, s.sim.s[S.vx]);
        }
        const hits = r.events.slice(n).filter((e) => e.type === 'contact' || e.type === 'crash').length;
        console.log(`train shove: train at ${v.toFixed(2)} m/s; quad's fastest east ${along.toFixed(2)} m/s; least clearance ${(worst * 1000).toFixed(2)} mm; ${hits} contact events`);
        expect(v).toBeGreaterThan(0.99 * TRAIN_VMAX);
        expect(hits).toBeGreaterThan(0);
        expect(worst).toBeGreaterThan(-0.01);
        expect(along).toBeGreaterThan(0.8 * v);
    });

    it('carries a quad on a coach roof through the tunnel, still', () => {
        const s = new FlightSession({ preset, level, traffic: TRAIN, overrides: GAME });
        const train = s.train!;
        const coach = 3;
        // the front at x 60, out of the tunnel: the second coach is inside it, all of it on the straight
        const t0 = frontAt(train, north(60));
        while (s.sim.tick < t0 - 1) s.runner.stepOnce();
        const pl = newPlace();
        train.place(coach, t0, pl);
        const v = train.state(t0, newState()).v;
        const roof = train.vehicles[coach].boxes[0].y1 + s.sim.p.bodyBottom + 0.0005;
        s.runner.respawn(pl.x, roof, pl.z, 0, { platform: false }, 'manual-start');
        const st = s.sim.s;
        st[S.hold] = 0;
        st[S.vx] = pl.hx * v;
        st[S.vz] = pl.hz * v;
        const at = newPlace();
        let drift = 0, maxW = 0, dx0 = NaN, dz0 = NaN, x0 = NaN;
        for (let t = 0; t < 1500; t++) {
            s.runner.stepOnce();
            train.place(coach, s.sim.tick, at);
            const dx = st[S.px] - at.x, dz = st[S.pz] - at.z;
            if (t === 0) { dx0 = dx; dz0 = dz; x0 = st[S.px]; }
            drift = Math.max(drift, Math.hypot(dx - dx0, dz - dz0));
            if (t >= 200) maxW = Math.max(maxW, Math.hypot(st[S.wx], st[S.wy], st[S.wz]));
        }
        console.log(`train ride: at ${v.toFixed(2)} m/s from x ${x0.toFixed(1)} to ${st[S.px].toFixed(1)} (the tunnel is x -56 to 36); ` +
            `drift on the roof ${(drift * 1000).toFixed(3)} mm over 1.5 s; gyro ${maxW.toExponential(2)} rad/s`);
        expect(x0).toBeLessThan(36 - 10);
        expect(drift).toBeLessThan(0.005);
        expect(maxW).toBeLessThan(1e-3);
    });

    it('is the same flight beside the train twice (run hash)', () => {
        const hash = (): string => {
            const s = new FlightSession({ preset, level, traffic: { cars: true, people: true, signals: true, train: true }, runHash: true, overrides: GAME });
            const r = s.runner;
            const ch = armed(s);
            const t0 = frontAt(s.train!, north(-100));
            while (s.sim.tick < t0 - 800) r.stepOnce();
            r.respawn(-100, 1.5, 246, 90, { platform: false, keepArmed: true }, 'manual-start');
            const hover = hoverStickOf(s.sim.p) * 2 - 1;
            for (let t = 0; t < 3000; t++) {
                if (t % 4 === 0) {
                    ch[0] = 0.3 * Math.sin(t * 0.002);
                    ch[2] = hover + 0.05 * Math.sin(t * 0.003);
                    r.enqueue({ tUs: r.tUs + 1000, ch });
                }
                r.stepOnce();
            }
            return r.traceHash();
        };
        expect(hash()).toBe(hash());
    });
});
