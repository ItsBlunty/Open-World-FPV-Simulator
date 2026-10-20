// Time trials (owner, 2026-10-19): land on a course's pad and rest there 3 s to be offered the race; accept, and the
// quad is set down on the pad for a 3-2-1-GO countdown (leaving the pad before GO is a false start: back on the pad,
// the countdown again); then the gates in order, the last being the start arch, and the time. No DOM, so the Node
// tests check exactly what the page does.
//
// Determinism (CLAUDE.md): everything here is decided on the sim tick from the sim's state, checked after every 1 ms
// step (FlightSession hooks the runner's onStep), and times are counted in ticks. What reaches the flight goes
// through the respawn director (the quad set down on the pad), and the runner logs each respawn, so a saved flight
// replays the same without this code. The page's answer to the offer arrives when it arrives, and is logged the
// same way (as the respawn it starts).

import { S } from '@owfpv/sim-core';
import { gateAxes } from '@owfpv/maps';
import type { Gate, TimeTrial } from '@owfpv/maps';

/** Resting on a pad this long offers its race (owner: 3 s), ticks. */
export const PAD_HOLD_TICKS = 3000;
/** 3, 2, 1, GO (owner), ticks from being set down on the pad to GO. */
export const COUNTDOWN_TICKS = 3000;
/**
 * On the pad: the quad's centre over its top and at most this far above it, m (a landed 5-inch quad's centre sits a
 * few cm up; this leaves room for it rocking on its legs), and slower than PAD_SPEED.
 */
const PAD_ABOVE = 0.4;
const PAD_SPEED = 0.5;
/** Leaving the pad before GO: the centre this far from where it was set down, sideways or up, m. */
const FALSE_START_SIDE = 0.6;
const FALSE_START_UP = 0.35;
/**
 * Throttle down before the countdown (owner, 2026-10-19): the sim-core throttle channel (-1 to 1) at or under this, which
 * is 1050 us, Betaflight's default min_check, under which its arming checks count the throttle as down.
 */
export const THROTTLE_DOWN = -0.9;
/** A move longer than this in one tick is a respawn, not flight (50 m per 1 ms): it passes no gate. */
const JUMP_M = 1;

export type TrialPhase = 'free' | 'asking' | 'countdown' | 'racing';

export type TrialEvent =
    /** rested on course `course`'s pad for PAD_HOLD_TICKS: offer the race */
    | { type: 'ask'; course: number }
    /** set down on the pad: the countdown runs */
    | { type: 'ready'; course: number }
    | { type: 'false-start'; course: number }
    | { type: 'go'; course: number }
    /** gate `gate` (0 up) passed, `ms` after GO */
    | { type: 'gate'; course: number; gate: number; ms: number }
    /** through the arch: the time, ms (one tick each) */
    | { type: 'finish'; course: number; ms: number }
    | { type: 'quit'; course: number };

/** What the HUD shows of the time trial, read every frame. */
export interface TrialStatus {
    phase: TrialPhase;
    /** the course in play, or the pad being rested on (free), or -1 */
    course: number;
    /** free: how far through the 3 s on the pad (0-1) */
    hold: number;
    /** countdown: ticks to GO (null while being set down, or while the throttle is up) */
    toGo: number | null;
    /** countdown: on the pad, waiting for the throttle to come down before 3-2-1 */
    throttleUp: boolean;
    /** racing: ms since GO */
    ms: number;
    /** racing: the next gate (0 up) and how many there are */
    gate: number;
    gates: number;
}

/** Where the quad is set down on a pad: x, y, z, heading. */
export type Pose = [number, number, number, number];

export class TrialRunner {
    readonly courses: readonly TimeTrial[];
    phase: TrialPhase = 'free';
    /** the course in play (asking, countdown, racing); in free, the pad being rested on; -1 none */
    course = -1;
    private holdTicks = 0;
    /** a pad that was just offered, raced from or finished at: it must be left before it offers again */
    private leaveFirst = -1;
    /** countdown: waiting for the quad to be set down; then the tick it was */
    private placing = false;
    /** countdown: on the pad, but the throttle is not down yet, so the 3-2-1 has not started */
    private waitThrottle = false;
    private readyTick = 0;
    private goTick = 0;
    private next = 0;
    private tick = 0;
    private pose: Pose = [0, 0, 0, 0];
    private readonly prev = [0, 0, 0];
    private fresh: TrialEvent[] = [];
    /** while true, the pilot's sticks are held centred with the throttle down (the offer is up, or they were held for it) */
    private holdSticks = false;

    /**
     * place: set the quad down at this pose at the next tick (a 'start' respawn there), or null: back to the usual
     * start point. bodyBottom: how far the craft's lowest point is below its centre, m.
     */
    constructor(courses: readonly TimeTrial[], private readonly place: (p: Pose | null) => void, private readonly bodyBottom: number) {
        this.courses = courses;
    }

    /** Where the quad is set down on course c's pad: resting on its top, facing the race's heading. */
    padPose(c: number): Pose {
        const p = this.courses[c].pad;
        return [p.x, p.y + this.bodyBottom + 0.01, p.z, p.yawDeg];
    }

    /**
     * After every sim step: the quad's state vector at tick `tick`, and the throttle channel the sim applied on it (-1
     * to 1; the stick the pilot holds, or -1 while the sticks are held for the offer).
     */
    step(s: ArrayLike<number>, tick: number, throttle = -1): void {
        this.tick = tick;
        const x = s[S.px], y = s[S.py], z = s[S.pz];
        if (this.phase === 'free') this.rest(s, x, y, z);
        else if (this.phase === 'countdown') this.countdown(x, y, z, tick, throttle);
        else if (this.phase === 'racing') this.race(x, y, z, tick);
        this.prev[0] = x;
        this.prev[1] = y;
        this.prev[2] = z;
    }

    private onPad(c: number, x: number, y: number, z: number): boolean {
        const p = this.courses[c].pad;
        return Math.abs(x - p.x) <= p.half && Math.abs(z - p.z) <= p.half && y >= p.y && y - p.y <= PAD_ABOVE;
    }

    private rest(s: ArrayLike<number>, x: number, y: number, z: number): void {
        let on = -1;
        for (let c = 0; c < this.courses.length; c++) if (this.onPad(c, x, y, z)) on = c;
        if (on !== this.leaveFirst) this.leaveFirst = -1;
        const still = Math.hypot(s[S.vx], s[S.vy], s[S.vz]) < PAD_SPEED;
        if (on < 0 || on === this.leaveFirst || !still || on !== this.course) {
            // a new pad (or none, or moving): start counting again
            this.course = on >= 0 && on !== this.leaveFirst ? on : -1;
            this.holdTicks = 0;
            return;
        }
        if (++this.holdTicks < PAD_HOLD_TICKS) return;
        this.phase = 'asking';
        this.holdSticks = true;
        this.leaveFirst = on;
        this.fresh.push({ type: 'ask', course: on });
    }

    private countdown(x: number, y: number, z: number, tick: number, throttle: number): void {
        const [px, py, pz] = this.pose;
        const off = Math.hypot(x - px, z - pz) > FALSE_START_SIDE || y - py > FALSE_START_UP;
        if (this.placing) {
            // the respawn lands at the end of the step the page's answer reached: from then the quad is on the pad
            if (off) return;
            this.placing = false;
            this.waitThrottle = true;
        }
        if (this.waitThrottle) {
            // the 3-2-1 starts once the throttle is down (and the sticks are the pilot's again, not held for the offer)
            if (throttle > THROTTLE_DOWN || this.holdSticks) return;
            // flown off the pad meanwhile (the countdown had not started: no false start): back onto it first
            if (off) {
                this.setDown();
                return;
            }
            this.waitThrottle = false;
            this.readyTick = tick;
            this.fresh.push({ type: 'ready', course: this.course });
            return;
        }
        if (off) {
            this.fresh.push({ type: 'false-start', course: this.course });
            this.setDown();
            return;
        }
        if (tick - this.readyTick < COUNTDOWN_TICKS) return;
        this.phase = 'racing';
        this.goTick = tick;
        this.next = 0;
        this.fresh.push({ type: 'go', course: this.course });
    }

    private race(x: number, y: number, z: number, tick: number): void {
        const [ax, ay, az] = this.prev;
        if (Math.hypot(x - ax, y - ay, z - az) > JUMP_M) return;
        const gates = this.courses[this.course].gates;
        if (!crosses(gates[this.next], ax, ay, az, x, y, z)) return;
        const ms = tick - this.goTick;
        this.fresh.push({ type: 'gate', course: this.course, gate: this.next, ms });
        if (++this.next < gates.length) return;
        this.fresh.push({ type: 'finish', course: this.course, ms });
        this.end();
    }

    private setDown(): void {
        this.placing = true;
        this.waitThrottle = false;
        this.pose = this.padPose(this.course);
        this.place(this.pose);
    }

    private end(): void {
        this.leaveFirst = this.course;
        this.phase = 'free';
        this.course = -1;
        this.holdTicks = 0;
        this.place(null);
    }

    /** The pilot's answer to the offer: race (the quad goes onto the pad for the countdown) or not. */
    answer(race: boolean): void {
        if (this.phase !== 'asking') return;
        if (!race) {
            this.phase = 'free';
            this.course = -1;
            this.holdTicks = 0;
            return;
        }
        this.phase = 'countdown';
        this.setDown();
    }

    /** R (the respawn switch) during a race or its countdown: back on the pad, the countdown again. True if it did. */
    restart(): boolean {
        if (this.phase !== 'countdown' && this.phase !== 'racing') return false;
        this.phase = 'countdown';
        this.setDown();
        return true;
    }

    /** Leave the race (the pause menu), or drop it because the flight started over (settings, start point). */
    quit(): void {
        if (this.phase === 'free') return;
        const c = this.course;
        if (this.phase !== 'asking') this.fresh.push({ type: 'quit', course: c });
        this.leaveFirst = c;
        this.phase = 'free';
        this.course = -1;
        this.holdTicks = 0;
        this.holdSticks = false;
        this.place(null);
    }

    /** The events since the last call. */
    drain(): TrialEvent[] {
        const f = this.fresh;
        this.fresh = [];
        return f;
    }

    status(): TrialStatus {
        const racing = this.phase === 'racing';
        return {
            phase: this.phase,
            course: this.course,
            hold: this.phase === 'free' && this.course >= 0 ? Math.min(1, this.holdTicks / PAD_HOLD_TICKS) : this.phase === 'asking' ? 1 : 0,
            toGo: this.phase === 'countdown' && !this.placing && !this.waitThrottle ? Math.max(0, COUNTDOWN_TICKS - (this.tick - this.readyTick)) : null,
            throttleUp: this.phase === 'countdown' && this.waitThrottle,
            ms: racing ? this.tick - this.goTick : 0,
            gate: racing ? this.next : 0,
            gates: this.course >= 0 ? this.courses[this.course].gates.length : 0
        };
    }

    /**
     * The pilot's sticks on their way to the sim (sim-core channels: roll, pitch, throttle, yaw, arm, ...): while the
     * offer is up they are held centred with the throttle down (the owner: the popup takes the controls; the pilot
     * answers with the sticks), and after it until roll and yaw are back near the centre, so the answer's stick moves
     * never fly the quad. Returns `ch` or `out` filled with the held sticks.
     */
    filter(ch: ArrayLike<number>, out: Float32Array): ArrayLike<number> {
        if (!this.holdSticks) return ch;
        if (this.phase !== 'asking' && Math.abs(ch[0]) < 0.25 && Math.abs(ch[3]) < 0.25) {
            this.holdSticks = false;
            return ch;
        }
        for (let i = 0; i < 8; i++) out[i] = ch[i] ?? 0;
        out[0] = 0;
        out[1] = 0;
        out[2] = -1;
        out[3] = 0;
        return out;
    }
}

/** Does the step from a to b pass through gate g's rectangle (either way)? */
export function crosses(g: Gate, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const da = (ax - g.x) * g.nx + (ay - g.y) * g.ny + (az - g.z) * g.nz;
    const db = (bx - g.x) * g.nx + (by - g.y) * g.ny + (bz - g.z) * g.nz;
    if (da === db || (da < 0 && db < 0) || (da > 0 && db > 0) || da === 0) return false;
    const t = da / (da - db);
    const px = ax + (bx - ax) * t - g.x, py = ay + (by - ay) * t - g.y, pz = az + (bz - az) * t - g.z;
    const { u, v } = gateAxes(g);
    return Math.abs(px * u[0] + py * u[1] + pz * u[2]) <= g.hw && Math.abs(px * v[0] + py * v[1] + pz * v[2]) <= g.hh;
}
