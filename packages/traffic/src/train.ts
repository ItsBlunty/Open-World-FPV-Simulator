// The train (owner, 2026-10-19: "a train that travels through a railyard, stops, then continues ... slowly accel and
// deccel like a real train, should be steam engine"): a steam locomotive, its tender and three coaches going round the
// map's railway loop (maps railway.ts), through the tunnel, stopping at the station for DWELL_S and going on.
//
// Like the cars, the train is solid and its place is a function of the sim tick alone (replays). Its run from the
// station round the loop and back is worked out once, when it is built: a driver opening the regulator, the engine's
// pull limited by its tractive effort and then by its power, the train's resistance, and a brake application timed to
// stop the front at the station's stop mark. Every lap is that same run.
//
// The engine is modelled on the LMS Ivatt Class 2 2-6-0, a light mixed-traffic engine of the kind that worked branch
// trains (Wikipedia, "LMS Ivatt Class 2 2-6-0", read 2026-10-19): tractive effort 77.44 kN, engine 47.9 t, tender
// 37.7 t, 16.20 m long over engine and tender, coupled wheels 1.524 m (5 ft). Everything marked [estimate] is not from
// that page.
//
// Determinism: only + - * /, Math.sqrt, Math.floor and route.ts's dmath sine and cosine.

import type { Level } from '@owfpv/maps';
import { DT } from './model';
import { pathThrough, placeAt } from './route';
import type { Place, Route } from './route';

/** Bumped with any change that moves the train or changes its shape: part of the world hash (replays). */
export const TRAIN_VERSION = 1;

/** A solid box of a vehicle in its own frame, m: along it (f, + ahead), across it (s), up from the ground (y). */
export interface TrainBox {
    f0: number;
    f1: number;
    hw: number;
    y0: number;
    y1: number;
}

export interface Vehicle {
    kind: 'loco' | 'tender' | 'coach';
    /** over the buffers, m */
    length: number;
    /** half the distance between its two pivots (bogie centres, or the outer axles of a rigid frame), m */
    pivot: number;
    /** from the front of the train to this vehicle's middle, m */
    offset: number;
    boxes: readonly TrainBox[];
}

/** Rail top above the ground, m (maps railway.ts RAIL_TOP); the boxes start just above it */
const FLOOR = 0.55;

/**
 * The engine, 9.8 m over its buffers (16.20 m with the tender, of which the tender is 6.4 [estimate]): the frames and
 * wheels up to the running plate, the boiler, the cab at the back, the chimney at the front. The shapes are estimates
 * within Britain's loading gauge (about 2.8 m wide and 4 m high).
 */
const LOCO: TrainBox[] = [
    { f0: -4.6, f1: 4.6, hw: 1.35, y0: FLOOR, y1: 2.0 },
    { f0: -1.4, f1: 4.4, hw: 0.85, y0: 2.0, y1: 3.4 },
    { f0: -4.6, f1: -1.4, hw: 1.35, y0: 2.0, y1: 3.85 },
    { f0: 3.4, f1: 3.9, hw: 0.28, y0: 3.4, y1: 3.95 }
];
const TENDER: TrainBox[] = [{ f0: -3.0, f1: 3.0, hw: 1.35, y0: FLOOR, y1: 3.2 }];
/** A coach like a British Railways Mark 1: 19.66 m over the buffers, 2.82 m wide, 3.86 m high, bogies 14 m apart [estimates]. */
const COACH: TrainBox[] = [{ f0: -9.6, f1: 9.6, hw: 1.41, y0: FLOOR, y1: 3.86 }];

/** The chimney's top in the engine's frame, m: where the smoke comes out */
export const CHIMNEY = { f: 3.65, y: 3.95 } as const;
/** The engine's coupled wheels: diameter 1.524 m (5 ft); a two-cylinder engine exhausts four times a turn of them */
export const DRIVER_D = 1.524;
export const BEATS_PER_TURN = 4;

/** The train's mass, kg: engine 47.9 t, tender 37.7 t, three coaches of 33 t each [estimate for a Mark 1]. */
const MASS = (47.9 + 37.7 + 3 * 33) * 1000;
/** The engine's tractive effort, N (77.44 kN, the class's starting figure) */
const TE = 77440;
/** How far a driver opens the regulator to start: this share of the tractive effort, reached over REG_S [estimates: gently, so the wheels do not slip] */
const START_SHARE = 0.6;
const REG_S = 6;
/** The engine's power at the rail, W, the limit once it is moving [estimate for a class of this size] */
const POWER = 450e3;
/** The train's rolling and air resistance, N: A + B v + C v^2 [estimates, about 2.2 kg per tonne at walking pace] */
const RES_A = 4000, RES_B = 100, RES_C = 12;
/** Top speed, m/s: 45 km/h, about the most a 110 m curve takes [estimate] */
export const TRAIN_VMAX = 12.5;
/**
 * The service brake, m/s^2 [estimate]: about half the 0.5-0.8 m/s^2 of the full vacuum-brake stops from 45 mph in the 1876
 * trials (Wikipedia, "Railway brake", the Abbots Ripton inquiry's table: 370-412 m in 26-30 s). It comes on and off at
 * BRAKE_JERK, as a vacuum brake takes a few seconds to apply [estimate].
 */
const BRAKE = 0.35;
const BRAKE_JERK = 0.25;
/** How long the train stands at the station, s [estimate] */
export const DWELL_S = 40;
/** The run is kept every SAMPLE ticks (10 ms) and interpolated between */
const SAMPLE = 10;

/** One sample of the run: distance from the station, speed, the engine's effort (its pull over TE) and the brake (m/s^2). */
interface Run {
    s: Float64Array;
    v: Float64Array;
    effort: Float32Array;
    brake: Float32Array;
}

/** The run round one lap of `L` m from a standstill at the stop mark to a standstill there again, every SAMPLE ticks. */
function driveLap(L: number): Run {
    const s: number[] = [], v: number[] = [], effort: number[] = [], brake: number[] = [];
    let x = 0, u = 0, b = 0, braking = false;
    const dt = DT;
    for (let k = 0; ; k++) {
        const t = k * dt;
        const d = L - x;
        // brake when the stop needs BRAKE (a little before, so the brake has time to come on); then track the rate
        // that stops the train at the mark (u^2 / 2d)
        const need = d > 1e-6 ? (u * u) / (2 * d) : BRAKE;
        if (!braking && need >= BRAKE * 0.9) braking = true;
        let pull = 0;
        if (braking) {
            const step = BRAKE_JERK * dt;
            b = need > b + step ? b + step : need < b - step ? b - step : need;
        } else {
            const reg = t < REG_S ? t / REG_S : 1;
            const start = START_SHARE * TE * reg;
            const power = POWER / (u > 0.1 ? u : 0.1);
            pull = start < power ? start : power;
            // the driver eases off nearing the top speed and holds it
            const res = RES_A + RES_B * u + RES_C * u * u;
            const hold = res + MASS * (TRAIN_VMAX - u) * 0.5;
            if (pull > hold) pull = hold > 0 ? hold : 0;
        }
        if (k % SAMPLE === 0) {
            s.push(x); v.push(u); effort.push(pull / TE); brake.push(b);
        }
        if (braking && (d <= 1e-4 || (u <= 1e-3 && d < 0.05))) break;
        const res = u > 0 ? RES_A + RES_B * u + RES_C * u * u : 0;
        let a = (pull - res) / MASS - b;
        if (u <= 0 && a < 0) a = 0;
        u += a * dt;
        if (u < 0) u = 0;
        x += u * dt;
        if (x > L) x = L;
    }
    // the last sample: at the mark, stood still
    s.push(L); v.push(0); effort.push(0); brake.push(0);
    return { s: Float64Array.from(s), v: Float64Array.from(v), effort: Float32Array.from(effort), brake: Float32Array.from(brake) };
}

/** Where along the route the point (x, z) lies, on one of its straights. */
function along(route: Route, x: number, z: number): number {
    for (const g of route.segs) {
        if (g.arc) continue;
        const u = (x - g.ax) * g.dx + (z - g.az) * g.dz;
        const off = -(x - g.ax) * g.dz + (z - g.az) * g.dx;
        if (u >= 0 && u <= g.len && off * off < 1e-6) return g.s0 + u;
    }
    throw new RangeError(`(${x}, ${z}) is not on a straight of the railway`);
}

/** The train's state at a tick: its front's distance round the route (unwrapped), speed, effort, brake. */
export interface TrainState {
    /** distance the train has run since tick 0, m (the wheels turn by this) */
    run: number;
    /** its front's distance along the route, m (any value: the route wraps) */
    s: number;
    v: number;
    effort: number;
    brake: number;
}

export class Train {
    readonly route: Route;
    readonly vehicles: readonly Vehicle[];
    readonly length: number;
    /** the route's distance of the station's stop mark, m */
    readonly stopS: number;
    /** one lap's run and the stand at the station, ticks */
    readonly runTicks: number;
    readonly cycleTicks: number;
    readonly tunnel: NonNullable<Level['railway']>['tunnel'];
    private readonly lap: Run;
    private readonly a: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    private readonly b: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };

    constructor(level: Level) {
        const rw = level.railway;
        if (!rw) throw new Error(`${level.id} has no railway`);
        this.route = pathThrough(rw.corners, rw.radius, true, 0);
        this.tunnel = rw.tunnel;
        this.stopS = along(this.route, rw.stopX, rw.stopZ);
        const v: Vehicle[] = [];
        let o = 0;
        const add = (kind: Vehicle['kind'], length: number, pivot: number, boxes: TrainBox[]): void => {
            v.push({ kind, length, pivot, offset: o + length / 2, boxes });
            o += length;
        };
        add('loco', 9.8, 3.5, LOCO);
        add('tender', 6.4, 2.2, TENDER);
        for (let k = 0; k < 3; k++) add('coach', 19.66, 7.0, COACH);
        this.vehicles = v;
        this.length = o;
        this.lap = driveLap(this.route.length);
        this.runTicks = (this.lap.s.length - 1) * SAMPLE;
        this.cycleTicks = this.runTicks + Math.round(DWELL_S / DT);
    }

    /** The state at `tick` (fractions too: the renderer's), into out. */
    state(tick: number, out: TrainState): TrainState {
        const c = this.cycleTicks;
        const laps = Math.floor(tick / c);
        const t = tick - laps * c;
        const L = this.route.length;
        const r = this.lap;
        let s: number, v: number, e: number, br: number;
        if (t >= this.runTicks) { s = L; v = 0; e = 0; br = 0; } else {
            // cubic Hermite between samples, from their distances and speeds
            const k = Math.floor(t / SAMPLE);
            const h = SAMPLE * DT;
            const w = (t - k * SAMPLE) / SAMPLE;
            const w2 = w * w, w3 = w2 * w;
            const s0 = r.s[k], s1 = r.s[k + 1], v0 = r.v[k], v1 = r.v[k + 1];
            s = (2 * w3 - 3 * w2 + 1) * s0 + (w3 - 2 * w2 + w) * h * v0 + (-2 * w3 + 3 * w2) * s1 + (w3 - w2) * h * v1;
            v = v0 + (v1 - v0) * w;
            e = r.effort[k] + (r.effort[k + 1] - r.effort[k]) * w;
            br = r.brake[k] + (r.brake[k + 1] - r.brake[k]) * w;
        }
        out.run = laps * L + s;
        out.s = this.stopS + s;
        out.v = v;
        out.effort = e;
        out.brake = br;
        return out;
    }

    private readonly st: TrainState = { run: 0, s: 0, v: 0, effort: 0, brake: 0 };

    /** Vehicle i's middle and heading at `tick`: halfway between its two pivots on the track, facing from the back one to the front one. */
    place(i: number, tick: number, out: Place): Place {
        const front = this.state(tick, this.st).s;
        return this.placeAtS(i, front, out);
    }

    /** Vehicle i's place with the train's front at route distance `front`. */
    placeAtS(i: number, front: number, out: Place): Place {
        const vh = this.vehicles[i];
        const c = front - vh.offset;
        const p = placeAt(this.route, c + vh.pivot, this.a);
        const q = placeAt(this.route, c - vh.pivot, this.b);
        const dx = p.x - q.x, dz = p.z - q.z;
        const l = Math.sqrt(dx * dx + dz * dz);
        out.x = (p.x + q.x) / 2;
        out.y = 0;
        out.z = (p.z + q.z) / 2;
        out.hx = dx / l;
        out.hz = dz / l;
        return out;
    }
}

/** The train for a level, if it has a railway and the config wants one. */
export function makeTrain(level: Level, on: boolean | undefined): Train | null {
    return on && level.railway ? new Train(level) : null;
}
