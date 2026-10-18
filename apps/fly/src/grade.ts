// The trick grader, first prototype (owner, 2026-10-18; docs/notes/freestyle-grading.md §5, §7, §9, §10): it finds
// flips, rolls, power loops, split-S and dives in a flight and gives each a mark out of 10, F3A-style: start at 10,
// take off a deduction for each fault, and say why ("plane leaned 20° (-1.3)"). The owner asked for the reasons to
// be shown ("verbose for now"). Every threshold marked [estimate] is a starting value to tune with the owner's flying.
//
// How it finds tricks (§4, approach D): body rotation is summed from the body rates every 1 ms step (never from
// Euler angles, which break down near vertical). A rotation "episode" starts when the quad turns faster than
// ON_RATE and ends once it has turned slower than OFF_RATE for QUIET_MS; the episode's summed roll, pitch and yaw
// and its path then say which trick it was. Dives are a held state with their own check.
//
// It only reads the sim (state, sticks, events) and the level's ContactWorld, so a flight is the same with grading
// on or off. Determinism (§6): only + - * /, Math.sqrt and sim-core's datan2 in anything that makes a mark, and
// everything counts sim ticks, so a replay of the same sticks gives the same marks in every browser.

import { S, datan2 } from '@owfpv/sim-core';
import type { ContactWorld } from '@owfpv/sim-core';

/** Bump when the method or a threshold changes: a mark is only comparable with marks of the same version. */
export const GRADE_VERSION = 1;

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

// ---- finding episodes [estimate] ----
/** turning faster than this starts an episode, deg/s (a carved turn stays under it; a loop of 3 m at 10 m/s is 190) */
const ON_RATE = 200 * RAD;
/** an episode goes on while the quad turns faster than this, deg/s (a power loop can float slowly over the top) */
const OFF_RATE = 45 * RAD;
/** ...and ends once it has turned slower for this long, ms (a short pause between a split-S's roll and pitch is one trick) */
const QUIET_MS = 300;
/** an episode longer than this is ordinary flying, not one trick, ms */
const MAX_EPISODE_MS = 8000;
/** history kept, ms: the longest episode plus room for its entry and exit */
const KEEP_MS = 12000;
/** a turn smaller than this on its main axis is not reported at all, deg */
const NEAR_MISS_DEG = 240;

// ---- recognising tricks [estimate] (§9 detector sketches) ----
/** a full flip or roll: at least this much rotation, deg (§5: 330° allowed for a quick stop) */
const FULL_DEG = 330;
/** a double: deg */
const DOUBLE_DEG = 690;
/** a flip, roll or loop may turn the other two axes this much at most, deg */
const OFF_AXIS_MAX_DEG = 60;
/** a flip turns its velocity less than this, deg (else it flew a loop); a loop at least LOOP_TURN_DEG */
const FLIP_PATH_TURN_DEG = 90;
const LOOP_TURN_DEG = 270;
/**
 * a back flip whose path pointed this steeply up (at 3 m/s or more), having climbed at least half of it during the flip,
 * is a failed power loop (a teardrop), deg; a flip on a path that was already going straight up stays a flip
 */
const LOOP_START_DEG = 60;
/** speed below this has no direction worth summing, m/s */
const MIN_PATH_SPEED = 1.5;
/** a roll whose path strays further than this from a straight line is a barrel roll, m (§5: path radius above ~1 m) */
const BARREL_M = 1.0;
/** power loop: backwards speed while inverted (no teardrop), m/s (§10 must) */
const PL_BACK_MPS = 1.0;
/** power loop: the path must come back this near its entry point, m (§5: "within a few metres") */
const PL_BACK_THROUGH_M = 2.5;
/** split-S: half roll 180 ± this, deg; pitch back 180 ± SPLIT_PITCH_TOL; heading reversed 180 ± SPLIT_HEADING_TOL */
const SPLIT_ROLL_TOL = 40;
const SPLIT_PITCH_TOL = 60;
const SPLIT_HEADING_TOL = 45;
/** dive: nose and path within this of straight down, deg; speed, m/s; throttle stick under, 0..1; for at least, ms */
const DIVE_CONE_DEG = 30;
const DIVE_MIN_MPS = 5;
const DIVE_THR_MAX = 0.25;
const DIVE_MIN_MS = 1000;
/** dive: pulled out to level (body up within 30° of world up, falling slower than 3 m/s) within this long, ms */
const DIVE_PULLOUT_MS = 2500;

// ---- grading: deductions, F3A style ("1 point per 15°") [estimate] ----
/** 1 point per this many degrees of error (F3A's rule of thumb) */
const PER_DEG = 15;
/** 1 point per this many metres the path strays (F3N: 1 point per 50 cm) */
const PER_M = 0.5;
/** exit height: points per metre away from the entry height (§10) */
const HEIGHT_PER_M = 0.5;
/** rate steadiness: spread of the rate (std / mean) allowed before a deduction, and points per 0.1 above it */
const STEADY_FREE = 0.15;
const STEADY_PER_TENTH = 1;
const STEADY_CAP = 3;
/** a pause in a loop's rotation (rate under this share of its median for PAUSE_MS) is "broken loop motion", -2 (§10, ProWhooper) */
const PAUSE_SHARE = 0.3;
const PAUSE_MS = 100;
const PAUSE_MINUS = 2;
/** throttle chopped during a power loop's catch: the stick moved more than this (0..1) within CHOP_MS, -1 (§10 point 4) */
const CHOP_STICK = 0.5;
const CHOP_MS = 100;
const CHOP_MINUS = 1;
/** open-air loop roundness: 1 point per 0.1 of radius spread (std / mean) */
const ROUND_PER_TENTH = 1;
/** dive: 1 point per this many degrees the nose wanders (rms about its mean direction) */
const DIVE_RMS_PER_DEG = 5;
/** brushing anything during a trick (F3N "safe presentation"); a hit (a bounce) voids the trick */
const TOUCH_MINUS = 2;

export interface Deduction {
    why: string;
    minus: number;
}

export interface GradedTrick {
    /** e.g. "Back flip", "Power loop", "Nearly a power loop" */
    name: string;
    startTick: number;
    endTick: number;
    /** out of 10; null when the move was not the trick (see `miss`) */
    mark: number | null;
    deductions: Deduction[];
    /** measured facts that cost nothing: "loop 6.1 m tall", "dive 1.4 s" */
    facts: string[];
    /** why a nearly-trick did not count: "teardrop: never moved backwards over the top" */
    miss?: string;
}

// one tick in the history ring
const F = {
    px: 0, py: 1, pz: 2, vx: 3, vy: 4, vz: 5,
    ux: 6, uy: 7, uz: 8, // body up in world
    bx: 9, by: 10, bz: 11, // body back in world (the nose points along -back)
    rR: 12, rP: 13, rY: 14, // pilot rates, rad/s: roll + right, pitch + nose down, yaw + right
    aR: 15, aP: 16, aY: 17, // the same summed since the last reset, rad
    thr: 18, // throttle stick 0..1
    touch: 19, // something was touched on this tick: 1 a brush (slide), 2 a hit (bounce)
    size: 20
} as const;

const fmt = (x: number, d = 0): string => x.toFixed(d);

/** Angle between two vectors, rad (0..pi), with datan2 (Math.acos may differ between engines). */
function angle(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    return datan2(Math.sqrt(cx * cx + cy * cy + cz * cz), ax * bx + ay * by + az * bz);
}

/** Signed angle from horizontal heading a to b, rad (-pi..pi), + = turned right (clockwise seen from above). */
function headingTurn(ax: number, az: number, bx: number, bz: number): number {
    // world y up, so right of a heading (x, z) is (-z, x)
    return datan2(-(ax * bz - az * bx), ax * bx + az * bz);
}

/** Points off, rounded to 0.1 and capped. */
function minus(x: number, cap = 10): number {
    const m = x > cap ? cap : x;
    return Math.round(m * 10) / 10;
}

export class Grader {
    /** tricks found so far, in the order they ended */
    readonly tricks: GradedTrick[] = [];
    private readonly world: ContactWorld | null;
    private readonly keep = KEEP_MS;
    private readonly ring = new Float64Array(KEEP_MS * F.size);
    /** ticks written since the last reset (the ring holds the last `keep` of them) */
    private n = 0;
    private tick0 = 0;
    private aR = 0; private aP = 0; private aY = 0;
    private touched = 0;
    // episode
    private inEp = false;
    private epStart = 0;
    private quiet = 0;
    private lastSlow = 0;
    private overlong = false;
    // dive
    private diveFrom = -1;
    private diveEnd = -1;
    private diveLowThr = 0;
    private readonly cbuf = new Float64Array(4 * 8);

    constructor(world: ContactWorld | null = null) {
        this.world = world;
    }

    /** A new life (respawn) or a break in the flight: forget the history, keep the tricks. */
    reset(): void {
        this.n = 0;
        this.aR = this.aP = this.aY = 0;
        this.inEp = false;
        this.quiet = 0;
        this.overlong = false;
        this.diveFrom = -1;
        this.diveEnd = -1;
        this.touched = 0;
    }

    /** The quad touched something (a sim contact event) on the current tick: brushed it, or hit it (a bounce). */
    touch(hit = false): void {
        const v = hit ? 2 : 1;
        if (v > this.touched) this.touched = v;
    }

    /** A crash: whatever was being flown does not count. */
    crash(tick: number): void {
        if (this.inEp && this.n > 0) {
            const t0 = this.tick0 + this.epStart;
            this.tricks.push({ name: 'Crashed in a trick', startTick: t0, endTick: tick, mark: null, deductions: [], facts: [], miss: 'crashed' });
        }
        this.reset();
    }

    /** After every 1 ms sim step: the state `s` (sim-core S layout) and the channels `ch` at sim tick `tick`. */
    step(tick: number, s: Float64Array, ch: ArrayLike<number>): void {
        if (s[S.armed] <= 0 || s[S.crashed] > 0) {
            if (this.n > 0) this.reset();
            return;
        }
        if (this.n === 0) this.tick0 = tick;
        else if (tick !== this.tick0 + this.n) { // a jump in ticks: a new life
            this.reset();
            this.tick0 = tick;
        }
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const rR = -s[S.wz], rP = -s[S.wx], rY = -s[S.wy];
        this.aR += rR * 0.001; this.aP += rP * 0.001; this.aY += rY * 0.001;
        const o = (this.n % this.keep) * F.size;
        const r = this.ring;
        r[o + F.px] = s[S.px]; r[o + F.py] = s[S.py]; r[o + F.pz] = s[S.pz];
        r[o + F.vx] = s[S.vx]; r[o + F.vy] = s[S.vy]; r[o + F.vz] = s[S.vz];
        r[o + F.ux] = 2 * (qx * qy - qw * qz); r[o + F.uy] = 1 - 2 * (qx * qx + qz * qz); r[o + F.uz] = 2 * (qy * qz + qw * qx);
        r[o + F.bx] = 2 * (qx * qz + qw * qy); r[o + F.by] = 2 * (qy * qz - qw * qx); r[o + F.bz] = 1 - 2 * (qx * qx + qy * qy);
        r[o + F.rR] = rR; r[o + F.rP] = rP; r[o + F.rY] = rY;
        r[o + F.aR] = this.aR; r[o + F.aP] = this.aP; r[o + F.aY] = this.aY;
        r[o + F.thr] = (ch[2] + 1) * 0.5;
        r[o + F.touch] = this.touched;
        this.touched = 0;
        const i = this.n++;
        this.episode(i, rR * rR + rP * rP + rY * rY);
        this.dive(i);
    }

    // ---- the history ring: index i = ticks since the last reset ----

    private at(i: number, f: number): number {
        return this.ring[(i % this.keep) * F.size + f];
    }

    /** the oldest index still kept */
    private get first(): number {
        return this.n > this.keep ? this.n - this.keep : 0;
    }

    // ---- rotation episodes ----

    private episode(i: number, w2: number): void {
        if (!this.inEp) {
            if (w2 < OFF_RATE * OFF_RATE) this.lastSlow = i;
            if (w2 > ON_RATE * ON_RATE) {
                this.inEp = true;
                this.epStart = this.lastSlow + 1 > this.first ? this.lastSlow + 1 : this.first;
                this.quiet = 0;
                this.overlong = false;
            }
            return;
        }
        if (w2 < OFF_RATE * OFF_RATE) this.quiet++;
        else this.quiet = 0;
        if (!this.overlong && i - this.epStart > MAX_EPISODE_MS) this.overlong = true;
        if (this.quiet >= QUIET_MS) {
            this.inEp = false;
            this.lastSlow = i;
            if (!this.overlong) this.classify(this.epStart, i - this.quiet, i);
        }
    }

    /** An episode from index b to e (its last fast tick), with the quiet after it up to `now`. */
    private classify(b: number, e: number, now: number): void {
        const R = (this.at(e, F.aR) - this.at(b, F.aR)) * DEG;
        const P = (this.at(e, F.aP) - this.at(b, F.aP)) * DEG;
        const Y = (this.at(e, F.aY) - this.at(b, F.aY)) * DEG;
        const aR = Math.abs(R), aP = Math.abs(P), aY = Math.abs(Y);
        const t0 = this.tick0 + b, t1 = this.tick0 + e;
        const push = (t: Omit<GradedTrick, 'startTick' | 'endTick'>): void => {
            // a hit (not a brush) spoils whatever it was: the tumble after it is no trick either (F3N "safe presentation")
            if (t.mark !== null && this.touchedIn(b, now) >= 2) {
                t = { name: `${t.name}: hit something`, mark: null, deductions: [], facts: t.facts, miss: 'hit something during it' };
            }
            this.tricks.push({ startTick: t0, endTick: t1, ...t });
        };
        // split-S first: its half roll and half pitch would not pass as anything else
        if (aR > 180 - SPLIT_ROLL_TOL && aR < 180 + SPLIT_ROLL_TOL && P < -(180 - SPLIT_PITCH_TOL) && P > -(180 + SPLIT_PITCH_TOL)) {
            push(this.splitS(b, e, now, R, P, Y));
            return;
        }
        const offP = this.excursion(b, e, F.aP), offR = this.excursion(b, e, F.aR), offY = this.excursion(b, e, F.aY);
        if (aP >= aR && aP >= aY) {
            if (aP < NEAR_MISS_DEG) return;
            // a loop's path keeps turning after the rotation stops (the catch), so its turn counts up to the exit
            const turnS = this.pathTurn(b, now, P);
            const turn = turnS < 0 ? -turnS : turnS;
            const loopish = turn >= FLIP_PATH_TURN_DEG;
            if (aP < FULL_DEG) {
                const what = loopish ? (P < 0 ? 'power loop' : 'loop') : P > 0 ? 'front flip' : 'back flip';
                push({ name: `Nearly a ${what}`, mark: null, deductions: [], facts: [], miss: `only ${fmt(aP)}° of pitch` });
                return;
            }
            if (offR > OFF_AXIS_MAX_DEG || offY > OFF_AXIS_MAX_DEG) {
                push({ name: 'Mixed rotation', mark: null, deductions: [], facts: [`pitch ${fmt(P)}°, roll ${fmt(R)}°, yaw ${fmt(Y)}°`], miss: `too much ${offR > offY ? 'roll' : 'yaw'} for a ${loopish ? 'loop' : 'flip'} (${fmt(offR > offY ? offR : offY)}°)` });
                return;
            }
            const same = (turnS < 0) === (P < 0); // the path turned the way the quad pitched
            if (turn >= LOOP_TURN_DEG && same && P < 0) push(this.powerLoop(b, e, now, P, offR, offY, turn));
            else if (turn >= LOOP_TURN_DEG && same) push({ name: 'Outside loop', mark: null, deductions: [], facts: [`path turned ${fmt(turn)}°`], miss: 'not graded yet' });
            else if (P < 0 && this.climb(b, e) >= LOOP_START_DEG && this.climb(b, e) - this.climb(b, b) >= LOOP_START_DEG / 2) {
                // it climbed into it like a loop but did not come round
                const back = this.backSpeed(b, e);
                push({
                    name: 'Nearly a power loop', mark: null, deductions: [], facts: [`path climbed at up to ${fmt(this.climb(b, e))}°, turned ${fmt(turn)}°`],
                    miss: back < PL_BACK_MPS ? 'teardrop: went up and came back down without moving backwards over the top' : `the path turned only ${fmt(turn)}°`
                });
            } else if (!loopish) push(this.flip(b, e, now, P, offR, offY, 'pitch'));
            else push({ name: 'Between a flip and a loop', mark: null, deductions: [], facts: [], miss: `the path turned ${fmt(turn)}°: under ${FLIP_PATH_TURN_DEG}° is a flip, over ${LOOP_TURN_DEG}° a loop` });
            return;
        }
        if (aR >= aY) {
            if (aR < NEAR_MISS_DEG) return;
            if (aR < FULL_DEG) {
                push({ name: 'Nearly a roll', mark: null, deductions: [], facts: [], miss: `only ${fmt(aR)}° of roll` });
                return;
            }
            if (offP > OFF_AXIS_MAX_DEG || offY > OFF_AXIS_MAX_DEG) {
                push({ name: 'Mixed rotation', mark: null, deductions: [], facts: [`pitch ${fmt(P)}°, roll ${fmt(R)}°, yaw ${fmt(Y)}°`], miss: `too much ${offP > offY ? 'pitch' : 'yaw'} for a roll (${fmt(offP > offY ? offP : offY)}°)` });
                return;
            }
            push(this.flip(b, e, now, R, offP, offY, 'roll'));
        }
        // yaw spins come next (owner's list); until then a yaw episode is not reported
    }

    /** The largest swing of a summed angle away from its start during b..e, deg. */
    private excursion(b: number, e: number, f: number): number {
        const a0 = this.at(b, f);
        let m = 0;
        for (let i = b; i <= e; i++) {
            const d = this.at(i, f) - a0;
            const ad = d < 0 ? -d : d;
            if (ad > m) m = ad;
        }
        return m * DEG;
    }

    /**
     * How far the velocity direction turned during b..now about the entry's body right axis, summed every 10 ms, deg,
     * in pitch's sign (- = turned the way a nose-up pitch turns, as in a power loop). Only the turn in the pitch plane
     * counts, so the drop of a flip and its catch do not add up to a loop. Where the path reverses through a stop
     * (straight up, then straight down: more than 90° in 10 ms) it cannot say which way it went, so it takes the way
     * the quad pitched (`sense`): a teardrop then counts as a loop's turn, and the power loop's "no teardrop" check
     * (backwards over the top) is what turns it down, with the reason.
     */
    private pathTurn(b: number, e: number, sense: number): number {
        // body right = up x back
        const ux = this.at(b, F.ux), uy = this.at(b, F.uy), uz = this.at(b, F.uz);
        const bx = this.at(b, F.bx), by = this.at(b, F.by), bz = this.at(b, F.bz);
        const ax = uy * bz - uz * by, ay = uz * bx - ux * bz, az = ux * by - uy * bx;
        let sum = 0;
        let px = 0, py = 0, pz = 0, have = false;
        for (let i = b; i <= e; i += 10) {
            const vx = this.at(i, F.vx), vy = this.at(i, F.vy), vz = this.at(i, F.vz);
            // too slow for a direction: keep the last one, so the turn through a slow top still counts
            if (vx * vx + vy * vy + vz * vz < MIN_PATH_SPEED * MIN_PATH_SPEED) continue;
            if (have) {
                const cx = py * vz - pz * vy, cy = pz * vx - px * vz, cz = px * vy - py * vx;
                const ca = cx * ax + cy * ay + cz * az, dot = px * vx + py * vy + pz * vz;
                // nose-up pitch turns about +right, and pitch + is nose down: hence the minus
                if (dot >= 0) sum -= datan2(ca, dot);
                else sum += (sense < 0 ? -1 : 1) * datan2(ca < 0 ? -ca : ca, dot);
            }
            px = vx; py = vy; pz = vz; have = true;
        }
        return sum * DEG;
    }

    /** The steepest the path pointed upwards during b..e while moving at 3 m/s or more, deg above the horizon. */
    private climb(b: number, e: number): number {
        let m = -90;
        for (let i = b; i <= e; i += 10) {
            const vx = this.at(i, F.vx), vy = this.at(i, F.vy), vz = this.at(i, F.vz);
            const h = Math.sqrt(vx * vx + vz * vz);
            if (h * h + vy * vy < 9) continue;
            const a = datan2(vy, h) * DEG;
            if (a > m) m = a;
        }
        return m;
    }

    /** Largest speed against the entry heading while inverted during b..e, m/s: a power loop flings backwards over the top. */
    private backSpeed(b: number, e: number): number {
        const [hx, hz] = this.heading(b);
        let back = 0;
        for (let i = b; i <= e; i++) {
            if (this.at(i, F.uy) >= 0) continue;
            const v = -(this.at(i, F.vx) * hx + this.at(i, F.vz) * hz);
            if (v > back) back = v;
        }
        return back;
    }

    /** The horizontal heading at i: of the velocity, or where the nose points when nearly still; unit (x, z). */
    private heading(i: number): [number, number] {
        let hx = this.at(i, F.vx), hz = this.at(i, F.vz);
        let hl = Math.sqrt(hx * hx + hz * hz);
        if (hl < 1) { hx = -this.at(i, F.bx); hz = -this.at(i, F.bz); hl = Math.sqrt(hx * hx + hz * hz); }
        return hl > 1e-6 ? [hx / hl, hz / hl] : [0, -1];
    }

    /** Spread of a rate (std / mean of its size) over the middle of the rotation: from 10 % to 90 % of the summed angle. */
    private steadiness(b: number, e: number, fRate: number, fSum: number): { spread: number; mean: number; pauses: number } {
        const a0 = this.at(b, fSum), total = this.at(e, fSum) - a0;
        const lo = 0.1 * total, hi = 0.9 * total;
        let n = 0, s1 = 0, s2 = 0;
        for (let i = b; i <= e; i++) {
            const d = this.at(i, fSum) - a0;
            const inside = total > 0 ? d >= lo && d <= hi : d <= lo && d >= hi;
            if (!inside) continue;
            const r = this.at(i, fRate);
            const ar = r < 0 ? -r : r;
            n++; s1 += ar; s2 += ar * ar;
        }
        if (n < 2) return { spread: 0, mean: 0, pauses: 0 };
        const mean = s1 / n;
        const v = s2 / n - mean * mean;
        // pauses: the rate under PAUSE_SHARE of the mean for PAUSE_MS in a row, inside the middle part
        let pauses = 0, run = 0;
        for (let i = b; i <= e; i++) {
            const d = this.at(i, fSum) - a0;
            const inside = total > 0 ? d >= lo && d <= hi : d <= lo && d >= hi;
            const r = this.at(i, fRate);
            const ar = r < 0 ? -r : r;
            if (inside && ar < PAUSE_SHARE * mean) {
                run++;
                if (run === PAUSE_MS) pauses++;
            } else run = 0;
        }
        return { spread: mean > 0 ? Math.sqrt(v > 0 ? v : 0) / mean : 0, mean, pauses };
    }

    /** The hardest touch during b..e: 0 none, 1 a brush, 2 a hit. */
    private touchedIn(b: number, e: number): number {
        let m = 0;
        for (let i = b; i <= e; i++) if (this.at(i, F.touch) > m) m = this.at(i, F.touch);
        return m;
    }

    /** Body-up change between two ticks, deg. */
    private upChange(i: number, j: number): number {
        return angle(this.at(i, F.ux), this.at(i, F.uy), this.at(i, F.uz), this.at(j, F.ux), this.at(j, F.uy), this.at(j, F.uz)) * DEG;
    }

    /**
     * Largest distance of the path from the line between its ends, during b..e, m. Only the part across the line
     * (`flat`: the sideways part only, out of the plane of the entry velocity and world up).
     */
    private stray(b: number, e: number, flat: boolean): number {
        const x0 = this.at(b, F.px), y0 = this.at(b, F.py), z0 = this.at(b, F.pz);
        let dx = this.at(e, F.px) - x0, dy = this.at(e, F.py) - y0, dz = this.at(e, F.pz) - z0;
        if (flat) {
            // sideways: across the entry heading, horizontally
            let hx = this.at(b, F.vx), hz = this.at(b, F.vz);
            let hl = Math.sqrt(hx * hx + hz * hz);
            if (hl < 0.5) { hx = -this.at(b, F.bx); hz = -this.at(b, F.bz); hl = Math.sqrt(hx * hx + hz * hz); }
            if (hl < 1e-6) return 0;
            const sx = -hz / hl, sz = hx / hl;
            let m = 0;
            for (let i = b; i <= e; i += 5) {
                const d = (this.at(i, F.px) - x0) * sx + (this.at(i, F.pz) - z0) * sz;
                const ad = d < 0 ? -d : d;
                if (ad > m) m = ad;
            }
            return m;
        }
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L < 1e-6) { dx = 0; dy = 0; dz = 0; } else { dx /= L; dy /= L; dz /= L; }
        let m = 0;
        for (let i = b; i <= e; i += 5) {
            const qx = this.at(i, F.px) - x0, qy = this.at(i, F.py) - y0, qz = this.at(i, F.pz) - z0;
            const along = qx * dx + qy * dy + qz * dz;
            const ox = qx - along * dx, oy = qy - along * dy, oz = qz - along * dz;
            const d = Math.sqrt(ox * ox + oy * oy + oz * oz);
            if (d > m) m = d;
        }
        return m;
    }

    /** A flip (axis 'pitch') or a roll (axis 'roll'). `A` its summed angle, offA / offB the other two axes' swings. */
    private flip(b: number, e: number, now: number, A: number, offA: number, offB: number, axis: 'pitch' | 'roll'): Omit<GradedTrick, 'startTick' | 'endTick'> {
        const aA = A < 0 ? -A : A;
        const double = aA >= DOUBLE_DEG;
        let name: string;
        let barrel = false;
        if (axis === 'pitch') name = A > 0 ? 'Front flip' : 'Back flip';
        else {
            barrel = this.stray(b, e, false) > BARREL_M;
            name = `${barrel ? 'Barrel roll' : 'Roll'} ${A > 0 ? 'right' : 'left'}`;
        }
        if (double) name = `Double ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
        const d: Deduction[] = [];
        const facts: string[] = [];
        const dur = (e - b) / 1000;
        const st = this.steadiness(b, e, axis === 'pitch' ? F.rP : F.rR, axis === 'pitch' ? F.aP : F.aR);
        facts.push(`${fmt(aA)}° in ${fmt(dur, 2)} s, ${fmt(st.mean * DEG)}°/s`);
        const offs = axis === 'pitch' ? ['roll', 'yaw'] : ['pitch', 'yaw'];
        if (offA / PER_DEG >= 0.1) d.push({ why: `${offs[0]} wobble ${fmt(offA)}°`, minus: minus(offA / PER_DEG) });
        if (offB / PER_DEG >= 0.1) d.push({ why: `${offs[1]} wobble ${fmt(offB)}°`, minus: minus(offB / PER_DEG) });
        // the stop: the quad should end where it started (level, if it started level); over- or under-rotation shows here
        const turns = double ? 720 : 360;
        const over = aA - turns;
        const stopErr = this.upChange(b, e);
        if (stopErr / PER_DEG >= 0.1) d.push({ why: `stopped ${fmt(stopErr)}° off the entry attitude (${over >= 0 ? 'over' : 'under'}-rotated)`, minus: minus(stopErr / PER_DEG) });
        if (st.spread > STEADY_FREE) d.push({ why: `uneven rate (spread ${fmt(st.spread * 100)} %)`, minus: minus(((st.spread - STEADY_FREE) / 0.1) * STEADY_PER_TENTH, STEADY_CAP) });
        // the path: sideways for a flip (F3N 1 point per 50 cm); off a straight line for an axial roll
        if (!barrel) {
            const side = axis === 'pitch' ? this.stray(b, e, true) : this.stray(b, e, false);
            if (side / PER_M >= 0.1) d.push({ why: `path strayed ${fmt(side, 1)} m ${axis === 'pitch' ? 'sideways' : 'off a straight line'}`, minus: minus(side / PER_M) });
        }
        const drop = this.at(b, F.py) - this.at(e, F.py);
        facts.push(drop >= 0 ? `lost ${fmt(drop, 1)} m of height` : `gained ${fmt(-drop, 1)} m of height`);
        if (this.touchedIn(b, now) > 0) d.push({ why: 'brushed something', minus: TOUCH_MINUS });
        return { name, mark: markOf(d), deductions: d, facts };
    }

    /** A loop pitched backwards (nose up): a power loop if it fits the §10 musts. */
    private powerLoop(b: number, e: number, now: number, P: number, offR: number, offY: number, turn: number): Omit<GradedTrick, 'startTick' | 'endTick'> {
        const facts: string[] = [`${fmt(-P)}° of pitch in ${fmt((e - b) / 1000, 2)} s, path turned ${fmt(turn)}°`];
        // no teardrop: moving backwards (against the entry heading) at some point while inverted
        const back = this.backSpeed(b, e);
        if (back < PL_BACK_MPS) {
            return { name: 'Nearly a power loop', mark: null, deductions: [], facts, miss: `teardrop: moved backwards at only ${fmt(back, 1)} m/s over the top (needs ${fmt(PL_BACK_MPS, 1)})` };
        }
        // back through the same place: the path after the top comes near the entry point
        const x0 = this.at(b, F.px), y0 = this.at(b, F.py), z0 = this.at(b, F.pz);
        const mid = b + ((e - b) >> 1);
        let near = 1e9;
        for (let i = mid; i <= now; i += 5) {
            const dx = this.at(i, F.px) - x0, dy = this.at(i, F.py) - y0, dz = this.at(i, F.pz) - z0;
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd < near) near = dd;
        }
        near = Math.sqrt(near);
        if (near > PL_BACK_THROUGH_M) {
            return { name: 'Nearly a power loop', mark: null, deductions: [], facts, miss: `came back ${fmt(near, 1)} m from where it started (needs ${fmt(PL_BACK_THROUGH_M, 1)})` };
        }
        // the loop's plane: the normal is the sum of the turns of the velocity; its circle: centre and radii in that plane
        let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, k = 0, top = -1e9, bottom = 1e9;
        for (let i = b; i + 10 <= e; i += 10) {
            const ax = this.at(i, F.vx), ay = this.at(i, F.vy), az = this.at(i, F.vz);
            const bx = this.at(i + 10, F.vx), by = this.at(i + 10, F.vy), bz = this.at(i + 10, F.vz);
            nx += ay * bz - az * by; ny += az * bx - ax * bz; nz += ax * by - ay * bx;
            cx += this.at(i, F.px); cy += this.at(i, F.py); cz += this.at(i, F.pz); k++;
            const y = this.at(i, F.py);
            if (y > top) top = y;
            if (y < bottom) bottom = y;
        }
        cx /= k; cy /= k; cz /= k;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const lean = datan2(ny < 0 ? -ny : ny, Math.sqrt(nx * nx + nz * nz)) * DEG;
        let rs = 0, rs2 = 0, m = 0;
        for (let i = b; i <= e; i += 10) {
            const qx = this.at(i, F.px) - cx, qy = this.at(i, F.py) - cy, qz = this.at(i, F.pz) - cz;
            const along = qx * nx + qy * ny + qz * nz;
            const ox = qx - along * nx, oy = qy - along * ny, oz = qz - along * nz;
            const rr = Math.sqrt(ox * ox + oy * oy + oz * oz);
            rs += rr; rs2 += rr * rr; m++;
        }
        const rMean = rs / m;
        const rv = rs2 / m - rMean * rMean;
        const roundness = rMean > 0 ? Math.sqrt(rv > 0 ? rv : 0) / rMean : 0;
        facts.push(`loop ${fmt(top - bottom, 1)} m tall`);
        const around = this.solidInside(cx, cy, cz, rMean);
        const name = around ? 'Power loop' : 'Power loop (open air)';
        if (!around) facts.push('nothing inside the loop');
        const d: Deduction[] = [];
        const st = this.steadiness(b, e, F.rP, F.aP);
        if (st.pauses > 0) d.push({ why: 'broken loop motion (the rotation paused)', minus: PAUSE_MINUS });
        if (st.spread > STEADY_FREE) d.push({ why: `uneven rotation (spread ${fmt(st.spread * 100)} %)`, minus: minus(((st.spread - STEADY_FREE) / 0.1) * STEADY_PER_TENTH, STEADY_CAP) });
        if (lean / PER_DEG >= 0.1) d.push({ why: `loop leaned ${fmt(lean)}° from vertical`, minus: minus(lean / PER_DEG) });
        const off = offR > offY ? offR : offY;
        if (off / PER_DEG >= 0.1) d.push({ why: `${offR > offY ? 'roll' : 'yaw'} in the loop ${fmt(off)}°`, minus: minus(off / PER_DEG) });
        const dh = this.at(e, F.py) - this.at(b, F.py);
        const adh = dh < 0 ? -dh : dh;
        if (adh * HEIGHT_PER_M >= 0.1) d.push({ why: `exit ${fmt(adh, 1)} m ${dh < 0 ? 'below' : 'above'} the entry height`, minus: minus(adh * HEIGHT_PER_M) });
        const ex = this.at(now, F.vx), ez = this.at(now, F.vz), ix = this.at(b, F.vx), iz = this.at(b, F.vz);
        if (ex * ex + ez * ez > 1 && ix * ix + iz * iz > 1) {
            const t = headingTurn(ix, iz, ex, ez) * DEG;
            const at = t < 0 ? -t : t;
            if (at / PER_DEG >= 0.1) d.push({ why: `exit heading ${fmt(at)}° off the entry heading`, minus: minus(at / PER_DEG) });
        }
        // the catch: from inverted at the top to the exit, the throttle stick should come back smoothly
        let inv = -1;
        for (let i = b; i <= e; i++) if (this.at(i, F.uy) < 0) { inv = i; break; }
        if (inv >= 0) {
            let chop = 0;
            for (let i = inv; i + CHOP_MS <= now; i += 10) {
                const dt = this.at(i + CHOP_MS, F.thr) - this.at(i, F.thr);
                const a = dt < 0 ? -dt : dt;
                if (a > chop) chop = a;
            }
            if (chop > CHOP_STICK) d.push({ why: `throttle jumped ${fmt(chop * 100)} % in ${CHOP_MS} ms in the catch`, minus: CHOP_MINUS });
        }
        if (!around && roundness * 10 * ROUND_PER_TENTH >= 0.1) d.push({ why: `not round (radius varied ${fmt(roundness * 100)} %)`, minus: minus(roundness * 10 * ROUND_PER_TENTH) });
        if (this.touchedIn(b, now) > 0) d.push({ why: 'brushed something', minus: TOUCH_MINUS });
        return { name, mark: markOf(d), deductions: d, facts };
    }

    /** Is there anything solid inside the loop (around its centre, in its plane)? */
    private solidInside(cx: number, cy: number, cz: number, r: number): boolean {
        const w = this.world;
        if (!w || r <= 0) return false;
        return w.contacts(cx, cy, cz, 0.7 * r, this.cbuf, 1) > 0;
    }

    private splitS(b: number, e: number, now: number, R: number, P: number, Y: number): Omit<GradedTrick, 'startTick' | 'endTick'> {
        const facts: string[] = [`roll ${fmt(R)}°, pitch ${fmt(-P)}° back`];
        // roll first: when the roll is three-quarters done, the pitch has barely started
        const r0 = this.at(b, F.aR), p0 = this.at(b, F.aP);
        let ok = false;
        for (let i = b; i <= e; i++) {
            const dr = (this.at(i, F.aR) - r0) * DEG;
            if ((dr < 0 ? -dr : dr) >= 135) {
                const dp = (this.at(i, F.aP) - p0) * DEG;
                ok = (dp < 0 ? -dp : dp) < 60;
                break;
            }
        }
        if (!ok) return { name: 'Nearly a split-S', mark: null, deductions: [], facts, miss: 'pitched before the half roll was done' };
        const hx = this.at(b, F.vx), hz = this.at(b, F.vz), ex = this.at(now, F.vx), ez = this.at(now, F.vz);
        if (hx * hx + hz * hz < 1 || ex * ex + ez * ez < 1) return { name: 'Nearly a split-S', mark: null, deductions: [], facts, miss: 'too slow to tell the heading' };
        const turn = headingTurn(hx, hz, ex, ez) * DEG;
        const at = turn < 0 ? -turn : turn;
        const drop = this.at(b, F.py) - this.at(e, F.py);
        facts.push(`heading turned ${fmt(at)}°`, `lost ${fmt(drop, 1)} m of height`);
        if (at < 180 - SPLIT_HEADING_TOL) return { name: 'Nearly a split-S', mark: null, deductions: [], facts, miss: `heading turned only ${fmt(at)}° (needs ${180 - SPLIT_HEADING_TOL}°)` };
        if (drop <= 0) return { name: 'Nearly a split-S', mark: null, deductions: [], facts, miss: 'did not go down' };
        const d: Deduction[] = [];
        const herr = 180 - at;
        if (herr / PER_DEG >= 0.1) d.push({ why: `heading reversed ${fmt(at)}° (not 180°)`, minus: minus(herr / PER_DEG) });
        const rerr = (R < 0 ? -R : R) - 180;
        const arerr = rerr < 0 ? -rerr : rerr;
        if (arerr / PER_DEG >= 0.1) d.push({ why: `half roll ${rerr < 0 ? 'short' : 'long'} by ${fmt(arerr)}°`, minus: minus(arerr / PER_DEG) });
        const aY = Y < 0 ? -Y : Y;
        if (aY / PER_DEG >= 0.1) d.push({ why: `yaw in it ${fmt(aY)}°`, minus: minus(aY / PER_DEG) });
        // exit level: body up against world up at the end
        const uy = this.at(e, F.uy);
        const lvl = datan2(Math.sqrt(this.at(e, F.ux) * this.at(e, F.ux) + this.at(e, F.uz) * this.at(e, F.uz)), uy) * DEG;
        if (lvl / PER_DEG >= 0.1) d.push({ why: `exit ${fmt(lvl)}° off level`, minus: minus(lvl / PER_DEG) });
        if (this.touchedIn(b, now) > 0) d.push({ why: 'brushed something', minus: TOUCH_MINUS });
        return { name: 'Split-S', mark: markOf(d), deductions: d, facts };
    }

    // ---- dives: a held state ----

    private dive(i: number): void {
        const vx = this.at(i, F.vx), vy = this.at(i, F.vy), vz = this.at(i, F.vz);
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const cosC = COS_DIVE;
        // the nose (-back) and the path both within the cone around straight down
        const diving = sp >= DIVE_MIN_MPS && this.at(i, F.by) >= cosC && -vy >= cosC * sp;
        if (this.diveEnd < 0) {
            if (diving) {
                if (this.diveFrom < 0) { this.diveFrom = i; this.diveLowThr = 0; }
                if (this.at(i, F.thr) <= DIVE_THR_MAX) this.diveLowThr++;
            } else if (this.diveFrom >= 0) {
                if (i - this.diveFrom >= DIVE_MIN_MS) this.diveEnd = i;
                else this.diveFrom = -1;
            }
            return;
        }
        // after the dive: wait for the pull-out to level
        const level = this.at(i, F.uy) >= 0.866 && vy > -3;
        if (level || i - this.diveEnd >= DIVE_PULLOUT_MS) {
            this.gradeDive(this.diveFrom, this.diveEnd, i, level);
            this.diveFrom = -1;
            this.diveEnd = -1;
        }
    }

    private gradeDive(b: number, e: number, out: number, level: boolean): void {
        const t0 = this.tick0 + b, t1 = this.tick0 + out;
        const dur = (e - b) / 1000;
        const drop = this.at(b, F.py) - this.at(e, F.py);
        let top = 0;
        for (let i = b; i <= e; i++) {
            const v = -this.at(i, F.vy);
            if (v > top) top = v;
        }
        const facts = [`${fmt(dur, 1)} s, ${fmt(drop, 1)} m down, up to ${fmt(top * 3.6)} km/h`, `pulled out in ${fmt((out - e) / 1000, 2)} s`];
        if (!level) {
            this.tricks.push({ name: 'Nearly a dive', startTick: t0, endTick: t1, mark: null, deductions: [], facts, miss: 'no pull-out to level flight' });
            return;
        }
        const d: Deduction[] = [];
        if (this.diveLowThr < 0.8 * (e - b)) d.push({ why: `throttle above ${fmt(DIVE_THR_MAX * 100)} % for ${fmt(100 - (this.diveLowThr / (e - b)) * 100)} % of it`, minus: 1 });
        // steadiness of the nose: how far it wandered about its mean direction (rms, so the swing into the dive
        // at its start does not decide it alone)
        let mx = 0, my = 0, mz = 0;
        for (let i = b; i <= e; i += 5) { mx -= this.at(i, F.bx); my -= this.at(i, F.by); mz -= this.at(i, F.bz); }
        let s2 = 0, k = 0;
        for (let i = b; i <= e; i += 5) {
            const a = angle(mx, my, mz, -this.at(i, F.bx), -this.at(i, F.by), -this.at(i, F.bz)) * DEG;
            s2 += a * a; k++;
        }
        const wob = Math.sqrt(s2 / k);
        if (wob / DIVE_RMS_PER_DEG >= 0.1) d.push({ why: `nose wandered ${fmt(wob, 1)}° (rms)`, minus: minus(wob / DIVE_RMS_PER_DEG) });
        const side = this.stray(b, e, false);
        if (side / PER_M >= 0.1) d.push({ why: `path strayed ${fmt(side, 1)} m off a straight line`, minus: minus(side / PER_M) });
        const hit = this.touchedIn(b, out);
        if (hit >= 2) {
            this.tricks.push({ name: 'Dive: hit something', startTick: t0, endTick: t1, mark: null, deductions: [], facts, miss: 'hit something during it' });
            return;
        }
        if (hit > 0) d.push({ why: 'brushed something', minus: TOUCH_MINUS });
        this.tricks.push({ name: 'Dive', startTick: t0, endTick: t1, mark: markOf(d), deductions: d, facts });
    }
}

/** cos 30°, the dive cone (the one place a cosine is needed: a constant, so no Math.cos at run time) */
const COS_DIVE = 0.8660254037844387;
if (DIVE_CONE_DEG !== 30) throw new Error('COS_DIVE is cos 30°: change both together');

/** 10 minus the deductions, never below 0, to 0.1. */
function markOf(d: Deduction[]): number {
    let m = 10;
    for (const x of d) m -= x.minus;
    return m < 0 ? 0 : Math.round(m * 10) / 10;
}
