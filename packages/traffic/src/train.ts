// The train (owner, 2026-10-19: "a train that travels through a railyard, stops, then continues ... slowly accel and
// deccel like a real train, should be steam engine"; then: "travel around the entire map ... another station inside the
// city ... slightly less close to the ground so you could fly a quad under it ... open windows and add people inside"):
// a steam locomotive, its tender and three coaches going round the map's railway loop (maps railway.ts), stopping DWELL_S
// at each station.
//
// Like the cars, the train is solid and its place is a function of the sim tick alone (replays). Each run from one
// station to the next is worked out once, when the train is built: a driver opening the regulator, the engine's pull
// limited by its tractive effort and then by its power, the train's resistance and the grades, slowing for the curves
// in time, and a brake application timed to stop the front at the next station's stop mark. Every lap is the same.
//
// The engine is modelled on the LMS Ivatt Class 2 2-6-0, a light mixed-traffic engine of the kind that worked branch
// trains (Wikipedia, "LMS Ivatt Class 2 2-6-0", read 2026-10-19): tractive effort 77.44 kN, engine 47.9 t, tender
// 37.7 t, 16.20 m long over engine and tender, coupled wheels 1.524 m (5 ft). Everything marked [estimate] is not from
// that page.
//
// Determinism: only + - * /, Math.sqrt, Math.floor, Math.imul and route.ts's dmath sine and cosine.

import { bedAt, gradeAt } from '@owfpv/maps';
import type { Level, Railway } from '@owfpv/maps';
import { DT } from './model';
import { pathThrough, placeAt } from './route';
import type { Place, Route } from './route';

/** Bumped with any change that moves the train or changes its shape: part of the world hash (replays). */
export const TRAIN_VERSION = 2;

/** What a box is, for the renderer's colours (the collision treats them all alike). */
export type TrainPart = 'loco' | 'tender' | 'floor' | 'wall' | 'roof' | 'bogie' | 'seat' | 'rider';

/** A solid box of a vehicle in its own frame, m: along it (f, + ahead), across it (s, + to the right), up from its base (y). */
export interface TrainBox {
    f0: number;
    f1: number;
    s0: number;
    s1: number;
    y0: number;
    y1: number;
    part: TrainPart;
    /** a rider's looks (colours) and the way they face along the coach (+1 ahead, -1 back): the renderer's */
    look?: number;
    face?: number;
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

/**
 * A vehicle's place: its base (halfway between its pivots, 0.45 m under the rails' top, where the ground would be beside
 * ballasted track), its horizontal heading (hx, hz), and its frame: f along it (it tilts on a grade), up square to it;
 * across it is (-hz, 0, hx).
 */
export interface TrainPlace extends Place {
    fx: number;
    fy: number;
    fz: number;
    ux: number;
    uy: number;
    uz: number;
}

/** Rail top above a vehicle's base, m (maps railway.ts: ballast 0.3, rails 0.15 over it) */
const RAIL_TOP = 0.45;
/** the base under the bed: the rails' top is the bed + 0.15, the base 0.45 under that */
const BASE_UNDER_BED = 0.3;
/** The engine's and tender's boxes start just above the rails */
const FLOOR = 0.55;

const sym = (f0: number, f1: number, hw: number, y0: number, y1: number, part: TrainPart): TrainBox => ({ f0, f1, s0: -hw, s1: hw, y0, y1, part });

/**
 * The engine, 9.8 m over its buffers (16.20 m with the tender, of which the tender is 6.4 [estimate]): the frames and
 * wheels up to the running plate, the boiler, the cab at the back, the chimney at the front. The shapes are estimates
 * within Britain's loading gauge (about 2.8 m wide and 4 m high).
 */
const LOCO: TrainBox[] = [
    sym(-4.6, 4.6, 1.35, FLOOR, 2.0, 'loco'),
    sym(-1.4, 4.4, 0.85, 2.0, 3.4, 'loco'),
    sym(-4.6, -1.4, 1.35, 2.0, 3.85, 'loco'),
    sym(3.4, 3.9, 0.28, 3.4, 3.95, 'loco')
];
const TENDER: TrainBox[] = [sym(-3.0, 3.0, 1.35, FLOOR, 3.2, 'tender')];

/**
 * A coach like a British Railways Mark 1 (19.66 m over the buffers, 2.82 m wide [estimates]), hollow: its body stands
 * 1.35 m up on two bogies 14 m apart, so a quad fits under it between them (0.9 m between the rails' top and the
 * floor; owner, 2026-10-19). Seven open windows a side, 1.6 m wide and 1.2 m high; a doorway at each end onto the next
 * coach; bays of facing seats either side of a 0.6 m aisle; people in about four seats in ten.
 */
export const COACH = {
    halfL: 9.6, halfW: 1.41, wall: 0.06, bottom: 1.35, floor: 1.5, top: 4.0, roof: 0.15,
    windows: 7, windowPitch: 2.6, windowHalfW: 0.8, sill: 2.25, head: 3.45, door: 0.45, doorTop: 3.5
} as const;
/** of 100 seats, how many have someone in them */
const RIDERS_PER_100 = 40;

/** A coach's boxes; `index` (its place in the train) picks who sits where. */
function coachBoxes(index: number): TrainBox[] {
    const C = COACH;
    const out: TrainBox[] = [];
    const box = (f0: number, f1: number, s0: number, s1: number, y0: number, y1: number, part: TrainPart, extra: Partial<TrainBox> = {}): void => {
        out.push({ f0: Math.min(f0, f1), f1: Math.max(f0, f1), s0: Math.min(s0, s1), s1: Math.max(s0, s1), y0, y1, part, ...extra });
    };
    const L = C.halfL, W = C.halfW, w = C.wall;
    box(-L, L, -W, W, C.bottom, C.floor, 'floor');
    box(-L, L, -W, W, C.top - C.roof, C.top, 'roof');
    for (const f of [-7, 7]) box(f - 1.5, f + 1.5, -1.1, 1.1, FLOOR, C.bottom, 'bogie');
    const fk = (k: number): number => (k - (C.windows - 1) / 2) * C.windowPitch;
    for (const side of [-1, 1]) {
        const s0 = side * (W - w), s1 = side * W;
        box(-L, L, s0, s1, C.floor, C.sill, 'wall');
        box(-L, L, s0, s1, C.head, C.top - C.roof, 'wall');
        // piers between the windows (and the ends beyond the first and last)
        let a = -L;
        for (let k = 0; k < C.windows; k++) {
            box(a, fk(k) - C.windowHalfW, s0, s1, C.sill, C.head, 'wall');
            a = fk(k) + C.windowHalfW;
        }
        box(a, L, s0, s1, C.sill, C.head, 'wall');
        // the end walls, a doorway in the middle
        const e0 = side * (L - w), e1 = side * L;
        box(e0, e1, -(W - w), -C.door, C.floor, C.top - C.roof, 'wall');
        box(e0, e1, C.door, W - w, C.floor, C.top - C.roof, 'wall');
        box(e0, e1, -C.door, C.door, C.doorTop, C.top - C.roof, 'wall');
    }
    // the seats: in each window's bay two rows face each other across a table gap; each row is a bench and its back,
    // either side of the aisle, two seats a side (window and aisle)
    let seat = 0;
    for (let k = 0; k < C.windows; k++) for (const face of [1, -1]) {
        const fb = fk(k) - face * 0.75; // the bench's middle
        for (const side of [-1, 1]) {
            box(fb - 0.25, fb + 0.25, side * 0.3, side * (W - w), C.floor, 1.95, 'seat');
            box(fb - face * 0.25, fb - face * 0.31, side * 0.3, side * (W - w), 1.95, 2.6, 'seat');
            for (const across of [0.6, 1.0]) {
                const h = Math.imul((index + 1) * 7919 + seat * 104729 + 12345, -1640531535) >>> 0;
                seat++;
                if ((h >>> 8) % 100 >= RIDERS_PER_100) continue;
                // sat on the bench, back to the seat back: a body and head up to 1.3 m over the floor [estimate]
                const fr = fb + face * 0.05;
                box(fr - 0.22, fr + 0.22, side * across - 0.2, side * across + 0.2, 1.95, C.floor + 1.3, 'rider', { look: h, face });
            }
        }
    }
    return out;
}

/** The chimney's top in the engine's frame, m: where the smoke comes out */
export const CHIMNEY = { f: 3.65, y: 3.95 } as const;
/** The engine's coupled wheels: diameter 1.524 m (5 ft); a two-cylinder engine exhausts four times a turn of them */
export const DRIVER_D = 1.524;
export const BEATS_PER_TURN = 4;

/** The train's mass, kg: engine 47.9 t, tender 37.7 t, three coaches of 33 t each [estimate for a Mark 1]. */
const MASS = (47.9 + 37.7 + 3 * 33) * 1000;
const G = 9.81;
/** The engine's tractive effort, N (77.44 kN, the class's starting figure) */
const TE = 77440;
/** How far a driver opens the regulator to start: this share of the tractive effort, reached over REG_S [estimates: gently, so the wheels do not slip] */
const START_SHARE = 0.6;
const REG_S = 6;
/** The engine's power at the rail, W, the limit once it is moving [estimate for a class of this size] */
const POWER = 450e3;
/** The train's rolling and air resistance, N: A + B v + C v^2 [estimates, about 2.2 kg per tonne at walking pace] */
const RES_A = 4000, RES_B = 100, RES_C = 12;
/** Top speed on the straights, m/s (72 km/h, 45 mph [estimate for a branch line]); round the 100 m curves, 12.5 m/s (45 km/h) */
export const TRAIN_VMAX = 20;
export const TRAIN_VCURVE = 12.5;
/**
 * The service brake, m/s^2 [estimate]: about half the 0.5-0.8 m/s^2 of the full vacuum-brake stops from 45 mph in the 1876
 * trials (Wikipedia, "Railway brake", the Abbots Ripton inquiry's table: 370-412 m in 26-30 s). It comes on and off at
 * BRAKE_JERK, as a vacuum brake takes a few seconds to apply [estimate]. The driver slows for a curve at PLAN_BRAKE.
 */
const BRAKE = 0.35;
const BRAKE_JERK = 0.25;
const PLAN_BRAKE = 0.22;
/** the driver aims this far under a curve's limit, m/s, and opens and closes the regulator no faster than PULL_JERK m/s^3 [estimates] */
const CURVE_MARGIN = 0.4;
const PULL_JERK = 0.3;
/** How long the train stands at each station, s [estimate] */
export const DWELL_S = 35;
/** A run is kept every SAMPLE ticks (10 ms) and interpolated between */
const SAMPLE = 10;

/** One run's samples: distance from its station, speed, the engine's effort (its pull over TE), the brake (m/s^2). */
interface Run {
    s: Float64Array;
    v: Float64Array;
    effort: Float32Array;
    brake: Float32Array;
}

/** One run between stations: where it starts on the route, how far it goes, its samples and how long they last. */
interface Leg {
    s0: number;
    D: number;
    run: Run;
    runTicks: number;
    /** the run's ticks plus the stand at the station it ends at */
    ticks: number;
    /** distance from the first station to this run's start, m */
    before: number;
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
    readonly railway: Railway;
    readonly vehicles: readonly Vehicle[];
    readonly length: number;
    /** each station's stop mark: its distance along the route, in the order the train calls (the first is where it starts) */
    readonly stops: readonly { name: string; s: number }[];
    /** one lap: every run and every stand, ticks */
    readonly cycleTicks: number;
    readonly tunnel: Railway['tunnel'];
    private readonly legs: Leg[];
    private readonly a: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    private readonly b: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    private readonly st: TrainState = { run: 0, s: 0, v: 0, effort: 0, brake: 0 };

    constructor(level: Level) {
        const rw = level.railway;
        if (!rw) throw new Error(`${level.id} has no railway`);
        this.railway = rw;
        this.route = pathThrough(rw.corners, rw.radius, true, 0);
        this.tunnel = rw.tunnel;
        const v: Vehicle[] = [];
        let o = 0;
        const add = (kind: Vehicle['kind'], length: number, pivot: number, boxes: TrainBox[]): void => {
            v.push({ kind, length, pivot, offset: o + length / 2, boxes });
            o += length;
        };
        add('loco', 9.8, 3.5, LOCO);
        add('tender', 6.4, 2.2, TENDER);
        for (let k = 0; k < 3; k++) add('coach', 19.66, 7.0, coachBoxes(k));
        this.vehicles = v;
        this.length = o;
        const L = this.route.length;
        const stops = rw.stops.map((p) => ({ name: p.name, s: along(this.route, p.x, p.z) }));
        // in the order the train reaches them from the first
        const ahead = (s: number): number => { const d = s - stops[0].s; return d - Math.floor(d / L) * L; };
        stops.sort((p, q) => ahead(p.s) - ahead(q.s));
        this.stops = stops;
        this.legs = [];
        let before = 0, cycle = 0;
        for (let i = 0; i < stops.length; i++) {
            const s0 = stops[i].s;
            const D = i + 1 < stops.length ? ahead(stops[i + 1].s) - ahead(s0) : L - ahead(s0);
            const run = this.drive(s0, D);
            const runTicks = (run.s.length - 1) * SAMPLE;
            const ticks = runTicks + Math.round(DWELL_S / DT);
            this.legs.push({ s0, D, run, runTicks, ticks, before });
            before += D;
            cycle += ticks;
        }
        this.cycleTicks = cycle;
    }

    /** The bed's height under route distance s (any value). */
    bed(s: number): number {
        return bedAt(this.railway, s);
    }

    /**
     * The fastest the driver wants to go with the front at route distance s: the top speed, held to TRAIN_VCURVE from
     * the front reaching a curve until the back has left it, and braked down to that in time at PLAN_BRAKE.
     */
    private target(s: number): number {
        const L = this.route.length;
        let t = TRAIN_VMAX;
        for (const g of this.route.segs) {
            if (!g.arc) continue;
            const d0 = g.s0 - s;
            const d = d0 - Math.floor(d0 / L) * L; // how far ahead the curve starts
            const vc = TRAIN_VCURVE - CURVE_MARGIN;
            if (d > L - (g.len + this.length)) { t = t < vc ? t : vc; continue; } // in it
            const brake = Math.sqrt(vc * vc + 2 * PLAN_BRAKE * d);
            if (brake < t) t = brake;
        }
        return t;
    }

    /** The run from the stop mark at s0 to the next, D m on, every SAMPLE ticks. */
    private drive(s0: number, D: number): Run {
        const s: number[] = [], v: number[] = [], effort: number[] = [], brake: number[] = [];
        let x = 0, u = 0, b = 0, stopping = false, pulled = 0;
        const dt = DT;
        for (let k = 0; ; k++) {
            if (k > 3600000) throw new Error('the train never reached the next station');
            const t = k * dt;
            const d = D - x;
            // stop at the mark: brake when the stop needs BRAKE (a little before, so the brake has time to come on), then
            // track the rate that stops the train there (u^2 / 2d)
            const need = d > 1e-6 ? (u * u) / (2 * d) : BRAKE;
            if (!stopping && need >= BRAKE * 0.9) stopping = true;
            // the grade under the train's middle pulls it back uphill and on downhill
            const grav = MASS * G * gradeAt(this.railway, s0 + x - this.length / 2);
            const res = u > 0 ? RES_A + RES_B * u + RES_C * u * u : 0;
            let pull = 0, want = 0;
            if (stopping) want = need;
            else {
                // the driver works the regulator and the brake towards the speed he wants
                const force = res + grav + MASS * (this.target(s0 + x) - u) * 0.5;
                if (force > 0) {
                    const reg = t < REG_S ? t / REG_S : 1;
                    const start = START_SHARE * TE * reg;
                    const power = POWER / (u > 0.1 ? u : 0.1);
                    const avail = start < power ? start : power;
                    pull = force < avail ? force : avail;
                } else want = -force / MASS < BRAKE ? -force / MASS : BRAKE;
            }
            // the regulator opens and closes gradually (the start is gentler still: reg above)
            const dp = PULL_JERK * MASS * dt;
            pull = pull > pulled + dp ? pulled + dp : pull < pulled - dp ? pulled - dp : pull;
            if (pull < 0) pull = 0;
            pulled = pull;
            const step = BRAKE_JERK * dt;
            b = want > b + step ? b + step : want < b - step ? b - step : want;
            if (k % SAMPLE === 0) {
                s.push(x); v.push(u); effort.push(pull / TE); brake.push(b);
            }
            if (stopping && (d <= 1e-4 || (u <= 1e-3 && d < 0.05))) break;
            let a = (pull - res - grav) / MASS - b;
            if (u <= 0 && a < 0) a = 0;
            u += a * dt;
            if (u < 0) u = 0;
            x += u * dt;
            if (x > D) x = D;
        }
        // the last sample: at the mark, stood still
        s.push(D); v.push(0); effort.push(0); brake.push(0);
        return { s: Float64Array.from(s), v: Float64Array.from(v), effort: Float32Array.from(effort), brake: Float32Array.from(brake) };
    }

    /** How long the run from station i to the next takes, s (the stand after it apart). */
    runSeconds(i: number): number {
        return this.legs[i].runTicks * DT;
    }

    /** The state at `tick` (fractions too: the renderer's), into out. */
    state(tick: number, out: TrainState): TrainState {
        const c = this.cycleTicks;
        const laps = Math.floor(tick / c);
        let t = tick - laps * c;
        const L = this.route.length;
        let leg = this.legs[this.legs.length - 1];
        for (const g of this.legs) {
            if (t < g.ticks) { leg = g; break; }
            t -= g.ticks;
        }
        const r = leg.run;
        let s: number, v: number, e: number, br: number;
        if (t >= leg.runTicks) { s = leg.D; v = 0; e = 0; br = 0; } else {
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
        out.run = laps * L + leg.before + s;
        out.s = leg.s0 + s;
        out.v = v;
        out.effort = e;
        out.brake = br;
        return out;
    }

    /** Vehicle i's place at `tick`. */
    place(i: number, tick: number, out: TrainPlace): TrainPlace {
        return this.placeAtS(i, this.state(tick, this.st).s, out);
    }

    /** Vehicle i's place with the train's front at route distance `front`: its base halfway between its two pivots on the track, its frame from the back one to the front one. */
    placeAtS(i: number, front: number, out: TrainPlace): TrainPlace {
        const vh = this.vehicles[i];
        const c = front - vh.offset;
        const p = placeAt(this.route, c + vh.pivot, this.a);
        const q = placeAt(this.route, c - vh.pivot, this.b);
        const py = this.bed(c + vh.pivot) - BASE_UNDER_BED, qy = this.bed(c - vh.pivot) - BASE_UNDER_BED;
        const dx = p.x - q.x, dy = py - qy, dz = p.z - q.z;
        const lh = Math.sqrt(dx * dx + dz * dz);
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        out.x = (p.x + q.x) / 2;
        out.y = (py + qy) / 2;
        out.z = (p.z + q.z) / 2;
        out.hx = dx / lh;
        out.hz = dz / lh;
        out.fx = dx / l; out.fy = dy / l; out.fz = dz / l;
        // up: (across) x (along), across being (-hz, 0, hx)
        out.ux = -out.hx * out.fy;
        out.uy = out.hx * out.fx + out.hz * out.fz;
        out.uz = -out.hz * out.fy;
        return out;
    }
}

/** A fresh TrainPlace. */
export function newTrainPlace(): TrainPlace {
    return { x: 0, y: 0, z: 0, hx: 1, hz: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0 };
}

/** The train for a level, if it has a railway and the config wants one. */
export function makeTrain(level: Level, on: boolean | undefined): Train | null {
    return on && level.railway ? new Train(level) : null;
}

/** Rail top above a vehicle's base, m, for the renderer's wheels. */
export const TRAIN_RAIL_TOP = RAIL_TOP;
