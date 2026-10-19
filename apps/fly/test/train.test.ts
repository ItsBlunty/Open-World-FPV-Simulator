// The steam train (packages/traffic train.ts) on its own and in a real session: its runs between the two stations pull
// away and stop like a train (gentle rates, a smooth brake, the front on each stop mark), slow for every curve and climb
// to the city viaduct; its vehicles stay coupled round the loop; and it is solid: it shoves a hovering quad ahead without
// the quad going into it, carries a quad on a coach roof through the tunnel, leaves room for a quad under each coach,
// through every window and along the coaches through their end doors, and the same flight beside it twice gives the
// same run hash.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, hoverStickOf } from '@owfpv/sim-core';
import type { PresetJson, Sim } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import { COACH, DWELL_S, NetTraffic, TRAIN_VCURVE, TRAIN_VMAX, Train, makeTrains, newTrainPlace, worldSha256 } from '@owfpv/traffic';
import type { TrafficConfig, TrainState } from '@owfpv/traffic';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from '../src/session';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
const TRAIN: TrafficConfig = { cars: false, people: false, signals: false, train: true };
const GAME = { crashOn: false };
const newState = (): TrainState => ({ run: 0, s: 0, v: 0, effort: 0, brake: 0 });
/** a 5-inch quad with its props, m (as the map tests) */
const QUAD = 0.25;

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

/** Route distance of a point on a straight of the loop. */
function sOf(tr: Train, x: number, z: number): number {
    for (const g of tr.route.segs) {
        if (g.arc) continue;
        const u = (x - g.ax) * g.dx + (z - g.az) * g.dz;
        if (u >= 0 && u <= g.len && Math.abs(-(x - g.ax) * g.dz + (z - g.az) * g.dx) < 1e-6) return g.s0 + u;
    }
    throw new Error(`(${x}, ${z}) is not on a straight`);
}

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

    it('runs between its two stations like a train: gentle pull, slow round the curves, a smooth stop on each mark', () => {
        const st = newState();
        const dt = 100;
        let vMax = 0, aMax = 0, dMax = 0, jMax = 0, prevA = 0, curveMax = 0, high = 0;
        let v0 = tr.state(0, st).v;
        const L = tr.route.length;
        const arcs = tr.route.segs.filter((g) => g.arc);
        for (let t = dt; t <= tr.cycleTicks; t += dt) {
            const v = tr.state(t, st).v;
            const a = (v - v0) / (dt / 1000);
            vMax = Math.max(vMax, v);
            aMax = Math.max(aMax, a);
            dMax = Math.max(dMax, -a);
            if (t > dt) jMax = Math.max(jMax, Math.abs(a - prevA) / (dt / 1000));
            prevA = a;
            v0 = v;
            const f = ((st.s % L) + L) % L;
            high = Math.max(high, tr.bed(f));
            // any part of the train on a curve
            for (const g of arcs) {
                const d = f - g.s0;
                if (d >= 0 && d <= g.len + tr.length) curveMax = Math.max(curveMax, v);
            }
        }
        // each stop: the front on the mark, stood still for the dwell
        let t = 0;
        const marks: string[] = [];
        for (let i = 0; i < tr.stops.length; i++) {
            t += tr.runSeconds(i) * 1000;
            const end = tr.state(t, st);
            const next = tr.stops[(i + 1) % tr.stops.length];
            const off = (((end.s - next.s) % L) + L) % L;
            marks.push(`${next.name} ${((off > L / 2 ? off - L : off) * 1000).toFixed(3)} mm`);
            expect(Math.abs(off > L / 2 ? off - L : off), next.name).toBeLessThan(0.001);
            for (let k = 0; k < DWELL_S * 1000; k += 1000) expect(tr.state(t + k, st).v).toBe(0);
            t += DWELL_S * 1000;
        }
        expect(t).toBe(tr.cycleTicks);
        console.log(`train: loop ${L.toFixed(0)} m, runs ${tr.stops.map((_, i) => tr.runSeconds(i).toFixed(0)).join(' + ')} s, ${DWELL_S} s at each station ` +
            `(lap ${(tr.cycleTicks / 60000).toFixed(1)} min); top ${vMax.toFixed(2)} m/s, on the curves at most ${curveMax.toFixed(2)}; ` +
            `most pull ${aMax.toFixed(3)} m/s^2, most brake ${dMax.toFixed(3)}, most jerk ${jMax.toFixed(3)} m/s^3; up to ${high.toFixed(2)} m; stops: ${marks.join(', ')}`);
        expect(vMax).toBeLessThanOrEqual(TRAIN_VMAX + 1e-6);
        expect(curveMax).toBeLessThan(TRAIN_VCURVE + 0.2);
        expect(aMax).toBeLessThan(0.3);
        expect(dMax).toBeLessThan(0.4);
        expect(jMax).toBeLessThan(0.6);
        expect(high).toBeCloseTo(8.3, 6);
        expect(tr.stops.map((s) => s.name)).toEqual(['Fields station', 'City station']);
        // the same numbers from a train built again (it is worked out when built)
        const again = new Train(level);
        for (const k of [0, 12345, 77777, 150001, 400000, 1e6]) expect(again.state(k, newState())).toEqual(tr.state(k, newState()));
    });

    it('keeps its vehicles coupled round the loop: ends never overlap, gaps stay under a metre', () => {
        const a = newTrainPlace(), b = newTrainPlace();
        let least = Infinity, most = 0;
        for (let s = 0; s < tr.route.length; s += 2) {
            for (let i = 0; i + 1 < tr.vehicles.length; i++) {
                const vi = tr.vehicles[i], vj = tr.vehicles[i + 1];
                tr.placeAtS(i, s, a);
                tr.placeAtS(i + 1, s, b);
                const bi = Math.min(...vi.boxes.map((x) => x.f0)), fj = Math.max(...vj.boxes.map((x) => x.f1));
                const gx = (b.x + b.fx * fj) - (a.x + a.fx * bi), gy = (b.y + b.fy * fj) - (a.y + a.fy * bi), gz = (b.z + b.fz * fj) - (a.z + a.fz * bi);
                const gap = -(gx * a.fx + gy * a.fy + gz * a.fz);
                least = Math.min(least, gap);
                most = Math.max(most, Math.hypot(gx, gy, gz));
            }
        }
        console.log(`couplings: body ends ${least.toFixed(3)} to ${most.toFixed(3)} m apart round the loop`);
        expect(least).toBeGreaterThan(0.2);
        expect(most).toBeLessThan(1);
    });

    it('runs a second train half a lap behind the first, never near it', () => {
        const [a, b] = makeTrains(level, true);
        expect(b.lag).toBe(Math.round(a.cycleTicks / 2));
        const L = a.route.length, sa = newState(), sb = newState();
        let least = Infinity;
        for (let t = 0; t < a.cycleTicks; t += 500) {
            const d = (((a.state(t, sa).s - b.state(t, sb).s) % L) + L) % L;
            least = Math.min(least, d, L - d);
        }
        console.log(`two trains: their fronts at least ${least.toFixed(0)} m apart round the ${L.toFixed(0)} m loop`);
        expect(least).toBeGreaterThan(300);
    });

    it('takes people up to the city station, on board while a train stands there, and back down off it', () => {
        const t = new NetTraffic(level, { cars: false, people: true, signals: true, train: true });
        const trains = makeTrains(level, true);
        const city = trains[0].stops.findIndex((x) => x.name === 'City station');
        const standing = (tick: number): boolean => trains.some((tr) => tr.standing(tick, city) !== null);
        const n = t.movers.length;
        const was = new Int32Array(n).fill(-1);
        let boarded = 0, off = 0, up = 0, mostWaiting = 0, wrong = 0;
        const step = 50;
        for (let tick = 0; tick <= 25 * 60000; tick += step) {
            t.at(tick);
            let waiting = 0;
            for (let i = 0; i < n; i++) {
                const ph = t.inspect(i).phase;
                if (ph === 15) waiting++;
                if (ph === 9 && was[i] !== 9) up++;
                // stepping into a coach (on board) or out of one onto the platform: only with a train there
                if (ph === 12 && was[i] === 11) { boarded++; if (!standing(tick)) wrong++; }
                if (ph === 13 && was[i] === 12) { off++; if (!standing(tick)) wrong++; }
                was[i] = ph;
            }
            mostWaiting = Math.max(mostWaiting, waiting);
        }
        console.log(`by train over 25 min: ${up} went up the walkway, ${boarded} boarded, ${off} got off, at most ${mostWaiting} waiting on the platform`);
        expect(wrong).toBe(0);
        expect(up).toBeGreaterThan(10);
        expect(boarded).toBeGreaterThan(5);
        expect(off).toBeGreaterThan(10);
    });

    it('names the train in the collision hash, and leaves the old hashes alone without it', () => {
        const sha = 'f'.repeat(64);
        const off = { cars: true, people: true, signals: true };
        expect(worldSha256(sha, { ...off, train: false })).toBe(worldSha256(sha, off));
        expect(worldSha256(sha, { ...off, train: true })).not.toBe(worldSha256(sha, off));
        expect(worldSha256(sha, TRAIN)).not.toBe(sha);
        expect(worldSha256(sha, { ...TRAIN, train: false })).toBe(sha);
    });

    it('leaves a quad room under every coach, through every window and along the coaches through their doors', () => {
        const s = new FlightSession({ preset, level, traffic: TRAIN, overrides: GAME });
        const world = s.sim.contactWorld!;
        // stood at the fields station, 10 s into its stand
        const t0 = Math.round(tr.runSeconds(1) * 1000) + Math.round(tr.runSeconds(0) * 1000) + DWELL_S * 1000 + 10000;
        world.at?.(t0);
        const train = s.train!;
        expect(train.state(t0, newState()).v).toBe(0);
        const out = { x: 0, y: 0, z: 0 };
        const p = newTrainPlace();
        // a point in coach i's frame, in the world
        const at = (i: number, f: number, y: number, side: number): number[] => {
            train.place(i, t0, p);
            return [p.x + p.fx * f + p.ux * y - p.hz * side, p.y + p.fy * f + p.uy * y, p.z + p.fz * f + p.uz * y + p.hx * side];
        };
        const free = (q: number[]): boolean => !world.pushOut(q[0], q[1], q[2], QUAD, out);
        const fk = (k: number): number => (k - (COACH.windows - 1) / 2) * COACH.windowPitch;
        let windows = 0;
        for (let i = 2; i < 5; i++) {
            // under the coach between its bogies: across the track 0.9 m up (the platform side is the coach's left)
            for (const f of [-4, 0, 4]) for (let side = -1.2; side <= 3; side += 0.1) expect(free(at(i, f, 0.9, side)), `under coach ${i} at ${f}, ${side.toFixed(1)}`).toBe(true);
            // in through each window, across the coach between the facing seats, out through the window opposite
            for (let k = 0; k < COACH.windows; k++) {
                for (let side = -2.5; side <= 2.5; side += 0.1) expect(free(at(i, fk(k), 3.0, side)), `coach ${i} window ${k} at ${side.toFixed(1)}`).toBe(true);
                windows++;
            }
            // and a wall beside each window (it is a coach, not a cage)
            expect(free(at(i, fk(0) + 1.3, 3.0, COACH.halfW))).toBe(false);
            // and a person-sized way in through each side door on the platform side (the coach's right at a westbound stop: s < 0 here)
            for (const f of [-9.21, 9.21]) for (let side = -2.5; side <= -0.6; side += 0.1) expect(free(at(i, f, 2.5, side)), `coach ${i} door at ${f}, ${side.toFixed(1)}`).toBe(true);
        }
        // down the aisle of the second coach, through its front door and the third's back door, down the third's aisle
        for (let f = 5; f <= 19.66 + 5; f += 0.1) expect(free(at(3, f, 2.4, 0)), `the aisle at ${f.toFixed(1)}`).toBe(true);
        console.log(`room for a quad under 3 coaches, through ${windows} windows and along the aisles`);
    });

    it('shoves a quad hovering on the line ahead without the quad going into it', () => {
        const s = new FlightSession({ preset, level, traffic: TRAIN, overrides: GAME });
        const r = s.runner;
        const train = s.train!;
        // on the ground line west past the bando (z 100, westbound), at x -300
        const t0 = frontAt(train, sOf(train, -300, 100));
        const ch = armed(s);
        while (s.sim.tick < t0 - 500) r.stepOnce();
        r.respawn(-301.5, 2.2, 100, 270, { platform: false, keepArmed: true }, 'manual-start');
        ch[2] = hoverStickOf(s.sim.p) * 2 - 1;
        r.enqueue({ tUs: r.tUs + 1000, ch });
        const v = train.state(t0, newState()).v;
        let worst = Infinity, along = 0;
        const n = r.events.length;
        for (let t = 0; t < 2000; t++) {
            r.stepOnce();
            worst = Math.min(worst, clearance(s.sim));
            along = Math.max(along, -s.sim.s[S.vx]);
        }
        const hits = r.events.slice(n).filter((e) => e.type === 'contact' || e.type === 'crash').length;
        console.log(`train shove: train at ${v.toFixed(2)} m/s; quad's fastest west ${along.toFixed(2)} m/s; least clearance ${(worst * 1000).toFixed(2)} mm; ${hits} contact events`);
        expect(v).toBeGreaterThan(10);
        expect(hits).toBeGreaterThan(0);
        expect(worst).toBeGreaterThan(-0.01);
        expect(along).toBeGreaterThan(0.8 * v);
    });

    it('carries a quad on a coach roof through the tunnel, still', () => {
        const s = new FlightSession({ preset, level, traffic: TRAIN, overrides: GAME });
        const train = s.train!;
        const coach = 3;
        // the line north through the tunnel (x 20, z 298 to 226): the front at z 210, the second coach inside it
        const t0 = frontAt(train, sOf(train, 20, 210));
        while (s.sim.tick < t0 - 1) s.runner.stepOnce();
        const pl = newTrainPlace();
        train.place(coach, t0, pl);
        const v = train.state(t0, newState()).v;
        const roof = pl.y + Math.max(...train.vehicles[coach].boxes.map((b) => b.y1)) + s.sim.p.bodyBottom + 0.0005;
        s.runner.respawn(pl.x, roof, pl.z, 0, { platform: false }, 'manual-start');
        const st = s.sim.s;
        st[S.hold] = 0;
        st[S.vx] = pl.hx * v;
        st[S.vz] = pl.hz * v;
        const at = newTrainPlace();
        let drift = 0, maxW = 0, dx0 = NaN, dz0 = NaN, z0 = NaN;
        for (let t = 0; t < 1500; t++) {
            s.runner.stepOnce();
            train.place(coach, s.sim.tick, at);
            const dx = st[S.px] - at.x, dz = st[S.pz] - at.z;
            if (t === 0) { dx0 = dx; dz0 = dz; z0 = st[S.pz]; }
            drift = Math.max(drift, Math.hypot(dx - dx0, dz - dz0));
            if (t >= 200) maxW = Math.max(maxW, Math.hypot(st[S.wx], st[S.wy], st[S.wz]));
        }
        console.log(`train ride: at ${v.toFixed(2)} m/s from z ${z0.toFixed(1)} to ${st[S.pz].toFixed(1)} (the tunnel is z 226 to 298); ` +
            `drift on the roof ${(drift * 1000).toFixed(3)} mm over 1.5 s; gyro ${maxW.toExponential(2)} rad/s`);
        expect(z0).toBeLessThan(298 - 10);
        expect(st[S.pz]).toBeGreaterThan(226);
        expect(drift).toBeLessThan(0.005);
        expect(maxW).toBeLessThan(1e-3);
    });

    it('is the same flight beside the train twice (run hash)', () => {
        const hash = (): string => {
            const s = new FlightSession({ preset, level, traffic: { cars: true, people: true, signals: true, train: true }, runHash: true, overrides: GAME });
            const r = s.runner;
            const ch = armed(s);
            const t0 = frontAt(s.train!, sOf(s.train!, -300, 100));
            while (s.sim.tick < t0 - 800) r.stepOnce();
            r.respawn(-300, 1.5, 101, 270, { platform: false, keepArmed: true }, 'manual-start');
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
