// The replay viewer's data (owner, 2026-10-18: the next step toward the trick report: draw a saved flight's path and
// play it back from the FPV, chase, free or spotter camera). A saved flight is stick records, so to watch it the
// flight is flown again from them once (sim-core LifePlayer, life by life as checkFlight does) and the craft's pose is
// kept every TRACK_STEP ticks: the track. Watching then only reads the track, so scrubbing back and forth costs nothing
// and the viewer never steps a sim. No DOM and no Three.js, so the Node tests check exactly this.
//
// Determinism: building the track is a replay (it also checks every life's hash, like checkFlight). Playing it back
// uses the page's clock freely, since nothing here feeds back into a simulation.

import { LifePlayer, S } from '@owfpv/sim-core';
import type { RespawnReason } from '@owfpv/sim-core';
import { levelSha256 } from '@owfpv/maps';
import type { Level } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import type { TrafficConfig } from '@owfpv/traffic';
import { FLIGHT_FORMAT, asLife, lifeDeps, trafficConfigFor } from './flights';
import { GRADE_VERSION, Grader } from './grade';
import type { GradedTrick } from './grade';
import type { Flight } from './flights';

/** Ticks between kept poses: 2 ms (500 a second), smooth at any frame rate once interpolated, about 1.3 MB a minute. */
export const TRACK_STEP = 2;

/** One pose in Track.data: position, rotation, velocity, the sticks and two flags. */
export const T = {
    px: 0, py: 1, pz: 2,
    qx: 3, qy: 4, qz: 5, qw: 6,
    vx: 7, vy: 8, vz: 9,
    /** sim-core channels: roll, pitch, throttle, yaw, each -1..1 */
    roll: 10, pitch: 11, thr: 12, yaw: 13,
    armed: 14, crashed: 15,
    /** each rotor's speed, rad/s (signed), for the sound */
    w0: 16, w1: 17, w2: 18, w3: 19,
    size: 20
} as const;

/** A teleport between two poses (a respawn): further apart than this, m, is never one flight path. */
const JUMP_M = 5;

export type MarkKind = 'crash' | 'respawn' | 'prop' | 'trick';

/** Something on the timeline: a crash, a respawn (and why), a golden prop taken, a trick (graded.ts). */
export interface Mark {
    tick: number;
    kind: MarkKind;
    label: string;
}

export interface Track {
    startTick: number;
    endTick: number;
    /** the tick of each pose (rising; a life's first pose has the same tick as the last pose of the life before) */
    ticks: Int32Array;
    /** T.size floats per pose */
    data: Float32Array;
    /** each life: where it starts and ends and the traffic it flew with (cars and people move with the tick) */
    lives: { startTick: number; endTick: number; traffic: TrafficConfig; ok: boolean }[];
    marks: Mark[];
    /** golden props taken in the flight: [number, tick], by tick */
    props: [number, number][];
    /** the tricks the grader found while the flight was flown again (grade.ts), in the order they ended */
    tricks: GradedTrick[];
    /** the grader's version that marked them */
    gradeVersion: number;
    /** every life's replay gave its saved hash */
    ok: boolean;
}

const REASONS: Record<RespawnReason, string> = {
    crash: 'respawn after a crash', 'stuck-flipped': 'respawn (lying flipped)', 'stuck-wedged': 'respawn (stuck)',
    'manual-start': 'back to the start', 'manual-rewind': 'rewind', settings: 'settings changed', scene: 'map changed', world: 'map changed'
};

/**
 * Flies the flight again from its records and keeps the poses. onProgress gets the share done (0..1) now and then.
 * Throws when the flight cannot be replayed on this build (another map version, a changed traffic).
 */
export function buildTrack(flight: Flight, level: Level, mesh: MeshContactWorld = new MeshContactWorld(level.collision), onProgress?: (done: number) => void): Track {
    if (flight.format !== FLIGHT_FORMAT) throw new Error(`unknown flight format ${String(flight.format)}`);
    if (flight.lives.length === 0) throw new Error('the flight has no lives');
    const levelSha = levelSha256(level);
    const total = Math.max(1, flight.endTick - flight.startTick);
    // an upper bound on the poses: every TRACK_STEP ticks, plus each life's first and last
    const cap = Math.ceil(total / TRACK_STEP) + 2 * flight.lives.length + 2;
    const ticks = new Int32Array(cap);
    const data = new Float32Array(cap * T.size);
    let n = 0;
    const keep = (tick: number, s: Float64Array, ch: ArrayLike<number>, omegaMaxPerVolt: number): void => {
        ticks[n] = tick;
        const o = n * T.size;
        data[o + T.px] = s[S.px]; data[o + T.py] = s[S.py]; data[o + T.pz] = s[S.pz];
        data[o + T.qx] = s[S.qx]; data[o + T.qy] = s[S.qy]; data[o + T.qz] = s[S.qz]; data[o + T.qw] = s[S.qw];
        data[o + T.vx] = s[S.vx]; data[o + T.vy] = s[S.vy]; data[o + T.vz] = s[S.vz];
        data[o + T.roll] = ch[0]; data[o + T.pitch] = ch[1]; data[o + T.thr] = ch[2]; data[o + T.yaw] = ch[3];
        data[o + T.armed] = s[S.armed] > 0 ? 1 : 0;
        data[o + T.crashed] = s[S.crashed] > 0 ? 1 : 0;
        for (let i = 0; i < 4; i++) data[o + T.w0 + i] = s[S.m0 + i] * omegaMaxPerVolt * s[S.volt];
        n++;
    };
    const lives: Track['lives'] = [];
    const marks: Mark[] = [];
    // the grader watches the replay as it would a live flight; each life starts it afresh
    const grader = new Grader(mesh);
    let done = 0;
    flight.lives.forEach((saved, i) => {
        const life = asLife(saved);
        const player = new LifePlayer(life, lifeDeps(flight, saved, level, levelSha, mesh));
        const sim = player.sim;
        const first = sim.tick;
        if (i > 0) marks.push({ tick: first, kind: 'respawn', label: REASONS[saved.header.life.reason as RespawnReason] ?? 'respawn' });
        keep(first, sim.s, sim.ch, sim.p.omegaMaxPerVolt);
        grader.reset();
        player.onStep = (x) => {
            if (x.tick % TRACK_STEP === 0 || x.tick === player.endTick) keep(x.tick, x.s, x.ch, x.p.omegaMaxPerVolt);
            grader.step(x.tick, x.s, x.ch);
        };
        player.onEvent = (e) => {
            if (e.type === 'crash') {
                marks.push({ tick: e.tick, kind: 'crash', label: `crash at ${(e.speed * 3.6).toFixed(0)} km/h` });
                grader.crash(e.tick);
            } else if (e.type === 'contact') grader.touch(e.regime === 'bounce');
        };
        // in pieces, so a long flight can say how far it is
        while (!player.done) {
            const to = Math.min(player.endTick, sim.tick + 20000);
            player.stepTo(to);
            onProgress?.(Math.min(1, (done + to - first) / total));
        }
        done += player.endTick - first;
        const hash = player.digest();
        lives.push({ startTick: first, endTick: player.endTick, traffic: trafficConfigFor(saved.header, levelSha), ok: saved.traceHash !== null && hash === saved.traceHash });
    });
    const tricks = grader.tricks;
    for (const t of tricks) marks.push({ tick: t.startTick, kind: 'trick', label: t.mark === null ? t.name : `${t.name} ${t.mark.toFixed(1)}` });
    const props = flight.props.slice().sort((a, b) => a[1] - b[1]);
    for (const [num, tick] of props) marks.push({ tick, kind: 'prop', label: `golden prop #${num}` });
    marks.sort((a, b) => a.tick - b.tick);
    return {
        startTick: ticks[0], endTick: ticks[n - 1], ticks: ticks.slice(0, n), data: data.slice(0, n * T.size),
        lives, marks, props, tricks, gradeVersion: GRADE_VERSION, ok: lives.every((l) => l.ok)
    };
}

/** The index of the last pose at or before `tick` (0 before the start). Of two poses on one tick, the later one. */
export function poseIndex(track: Track, tick: number): number {
    const t = track.ticks;
    let lo = 0, hi = t.length - 1;
    if (tick >= t[hi]) return hi;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (t[mid] <= tick) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/**
 * The pose at a (fractional) tick, into `out` (T.size floats): positions, velocity and sticks interpolated, the
 * rotation blended along the shorter way. Across a respawn it holds the pose before the jump.
 */
export function poseAt(track: Track, tick: number, out: Float32Array): Float32Array {
    const d = track.data;
    const i = poseIndex(track, tick);
    const a = i * T.size;
    const j = Math.min(i + 1, track.ticks.length - 1);
    const b = j * T.size;
    const span = track.ticks[j] - track.ticks[i];
    let f = span > 0 ? (tick - track.ticks[i]) / span : 0;
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    const dx = d[b + T.px] - d[a + T.px], dy = d[b + T.py] - d[a + T.py], dz = d[b + T.pz] - d[a + T.pz];
    if (dx * dx + dy * dy + dz * dz > JUMP_M * JUMP_M) f = 0;
    for (let k = 0; k < T.size; k++) out[k] = d[a + k] + (d[b + k] - d[a + k]) * f;
    // quaternions: q and -q are the same rotation; blend towards the nearer one, then normalise
    let dot = 0;
    for (let k = T.qx; k <= T.qw; k++) dot += d[a + k] * d[b + k];
    const sb = dot < 0 ? -1 : 1;
    let len = 0;
    for (let k = T.qx; k <= T.qw; k++) {
        out[k] = d[a + k] + (sb * d[b + k] - d[a + k]) * f;
        len += out[k] * out[k];
    }
    len = Math.sqrt(len) || 1;
    for (let k = T.qx; k <= T.qw; k++) out[k] /= len;
    out[T.armed] = d[(f < 0.5 ? a : b) + T.armed];
    out[T.crashed] = d[(f < 0.5 ? a : b) + T.crashed];
    return out;
}

/** The life flown at `tick` (its index in track.lives). */
export function lifeAt(track: Track, tick: number): number {
    const L = track.lives;
    for (let i = L.length - 1; i > 0; i--) if (tick >= L[i].startTick) return i;
    return 0;
}

/**
 * The path line: points every `every` poses, cut into pairs for line segments, skipping the jump of a respawn. `ticks`
 * holds each segment's first tick, so a trail can draw only the segments of the last few seconds. `speed` is each
 * point's speed, m/s, for its colour.
 */
export function pathSegments(track: Track, every = 5): { positions: Float32Array; speed: Float32Array; ticks: Int32Array } {
    const d = track.data;
    const n = track.ticks.length;
    const pos: number[] = [], spd: number[] = [], tk: number[] = [];
    const sp = (o: number): number => Math.sqrt(d[o + T.vx] * d[o + T.vx] + d[o + T.vy] * d[o + T.vy] + d[o + T.vz] * d[o + T.vz]);
    const jump = (i: number): boolean => {
        const a = (i - 1) * T.size, b = i * T.size;
        const dx = d[b] - d[a], dy = d[b + 1] - d[a + 1], dz = d[b + 2] - d[a + 2];
        return dx * dx + dy * dy + dz * dz > JUMP_M * JUMP_M;
    };
    // every `every`-th pose, the last, and both poses at each respawn's jump; a segment joins two of them unless the
    // jump lies between
    let prev = 0;
    for (let i = 1; i < n; i++) {
        const cut = jump(i);
        if (!cut && i % every !== 0 && i !== n - 1 && !(i + 1 < n && jump(i + 1))) continue;
        if (!cut) {
            const a = prev * T.size, b = i * T.size;
            pos.push(d[a], d[a + 1], d[a + 2], d[b], d[b + 1], d[b + 2]);
            spd.push(sp(a), sp(b));
            tk.push(track.ticks[prev]);
        }
        prev = i;
    }
    return { positions: new Float32Array(pos), speed: new Float32Array(spd), ticks: new Int32Array(tk) };
}

/**
 * Steering the replay with the radio (owner, 2026-10-18: an option that starts off, so stick jitter or a bumped stick
 * never moves the playback unless the pilot means it). Only big, deliberate moves count:
 * - roll past half way winds the replay (right forward, left back), faster the further it goes: 0.5 to 8 s a second;
 * - pitch pushed past 80 % either way plays or pauses, once; it counts again only after the stick came back under 30 %.
 * Throttle and yaw do nothing, so resting thumbs and a dropped throttle stick change nothing.
 */
export class RadioReplayControl {
    static readonly SHUTTLE_FROM = 0.5;
    static readonly TOGGLE_AT = 0.8;
    static readonly REARM_BELOW = 0.3;
    private armed = false;

    /** sim-core channels (roll ch[0], pitch ch[1], -1..1). `shuttle`: flight seconds per second (0: none). */
    update(ch: ArrayLike<number>): { toggle: boolean; shuttle: number } {
        const roll = ch[0], pitch = Math.abs(ch[1]);
        let toggle = false;
        // it starts unarmed: a stick already pushed when the option is turned on does nothing until it comes back
        if (pitch < RadioReplayControl.REARM_BELOW) this.armed = true;
        else if (pitch > RadioReplayControl.TOGGLE_AT && this.armed) {
            this.armed = false;
            toggle = true;
        }
        const a = Math.abs(roll);
        const from = RadioReplayControl.SHUTTLE_FROM;
        const shuttle = a > from ? Math.sign(roll) * (0.5 + 7.5 * ((a - from) / (1 - from)) ** 2) : 0;
        return { toggle, shuttle };
    }
}
