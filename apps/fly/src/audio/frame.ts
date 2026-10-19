// What the sound needs from the engine each frame (docs/notes/sound.md): where the listener (the camera) is and faces,
// the quad's place, speed and rotor speeds, blade strikes and hits since the last frame, the trains, the time trial
// countdown. The engine fills one Float32Array (fillAudioFrame) and posts it every frame; the page's AudioEngine
// (audio/audio.ts) reads it. No DOM and no Web Audio here, so the Node tests check it.
//
// Nothing here feeds back into the simulation: the sound only reads the state (CLAUDE.md, determinism).

import { S } from '@owfpv/sim-core';
import type { SimEvent } from '@owfpv/sim-core';
import type { Block } from '@owfpv/maps';
import { BEATS_PER_TURN, CHIMNEY, DRIVER_D, newTrainPlace } from '@owfpv/traffic';
import type { Train, TrainState } from '@owfpv/traffic';

/** Floats per train in the frame, from A.trains on. */
export const TF = {
    /** the chimney (exhaust, whistle, safety valve), m */
    x: 0, y: 1, z: 2,
    /** the train's middle (the wheels on the rail joints), m */
    mx: 3, my: 4, mz: 5,
    /** speed, m/s; the regulator's share of the tractive effort (0-1); distance run since tick 0, m */
    v: 6, effort: 7, run: 8,
    size: 9
} as const;

/** The most trains the frame carries (packages/traffic TRAINS is 2). */
export const MAX_TRAINS = 2;

/** The frame's layout. */
export const A = {
    /** 1 while the sim runs or a replay plays (the world moves), 0 while paused */
    on: 0,
    /** 1: the listener is off the quad (chase, free, spotter camera); 0: the FPV camera, the quad's own microphone */
    external: 1,
    /** the camera: position, m, and rotation (quaternion x, y, z, w) */
    lx: 2, ly: 3, lz: 4, lqx: 5, lqy: 6, lqz: 7, lqw: 8,
    /** the quad: position, m; velocity, m/s; its body's up axis in the world */
    px: 9, py: 10, pz: 11, vx: 12, vy: 13, vz: 14, ux: 15, uy: 16, uz: 17,
    /** each rotor's speed, rad/s (signed: below 0 it spins backwards, turtle mode) */
    w0: 18,
    /** each prop's hardest blade strike since the last frame: brake share x rotor speed share (0-1) */
    k0: 22,
    /** the fastest hit (sim-core contact or crash event) since the last frame, m/s; 0: none */
    hit: 26,
    /** 1 if that hit was a crash (damage on) */
    crash: 27,
    /** a time trial's countdown: ms to GO, or -1 */
    toGo: 28,
    /** how much the listener is in the city (0 out in the country, 1 among the blocks), and height above ground, m */
    city: 29, agl: 30,
    /** the rotors' top speed on a full pack, rad/s: what the loudness is measured against */
    wRef: 31,
    /** trains in the frame (0 when they are off) */
    nTrains: 32,
    trains: 33,
    size: 33 + MAX_TRAINS * TF.size
} as const;

/** The distance a train runs per exhaust beat, m: four beats per turn of the coupled wheels (traffic train.ts). */
export const BEAT_M = (Math.PI * DRIVER_D) / BEATS_PER_TURN;

/** The city's sound fades out over this distance from the nearest block, m [estimate: traffic noise heard a street or two away]. */
export const CITY_FADE_M = 150;

/** How much a point is in the city: 1 on or among the blocks, falling to 0 at CITY_FADE_M from the nearest. */
export function cityWeight(blocks: readonly Block[], x: number, z: number): number {
    let best = Infinity;
    for (const b of blocks) {
        const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
        const dz = z < b.z0 ? b.z0 - z : z > b.z1 ? z - b.z1 : 0;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < best) best = d;
    }
    if (best === Infinity) return 0;
    // blocks are separated by streets: anywhere within a street's width of one counts as in the city
    const w = 1 - Math.max(0, best - 20) / CITY_FADE_M;
    return w < 0 ? 0 : w;
}

/** A rotor's speed in rad/s: sim-core's motor state (a share of the top speed at this voltage) x omegaMaxPerVolt x volts. */
export function rotorRadS(motor: number, omegaMaxPerVolt: number, volt: number): number {
    return motor * omegaMaxPerVolt * volt;
}

/** Reads sim-core events from index `from` on: the fastest contact or crash, m/s, and whether a crash was among them. */
export function fastestHit(events: readonly SimEvent[], from: number): { speed: number; crash: boolean } {
    let speed = 0, crash = false;
    for (let i = from; i < events.length; i++) {
        const e = events[i];
        if (e.type === 'contact' || e.type === 'crash') {
            if (e.speed > speed) speed = e.speed;
            if (e.type === 'crash') crash = true;
        }
    }
    return { speed, crash };
}

/** Writes the quad's part of the frame from a sim-core state (rotor speeds from its motors and pack voltage). */
export function putQuad(a: Float32Array, s: ArrayLike<number>, omegaMaxPerVolt: number): void {
    a[A.px] = s[S.px]; a[A.py] = s[S.py]; a[A.pz] = s[S.pz];
    a[A.vx] = s[S.vx]; a[A.vy] = s[S.vy]; a[A.vz] = s[S.vz];
    // the body's up axis: the rotation's second column (y up), from the quaternion
    const qx = s[S.qx], qy = s[S.qy], qz = s[S.qz], qw = s[S.qw];
    a[A.ux] = 2 * (qx * qy - qw * qz);
    a[A.uy] = 1 - 2 * (qx * qx + qz * qz);
    a[A.uz] = 2 * (qy * qz + qw * qx);
    for (let i = 0; i < 4; i++) a[A.w0 + i] = rotorRadS(s[S.m0 + i], omegaMaxPerVolt, s[S.volt]);
}

/**
 * Rail length, m: the British standard 60 ft rail of the engine's era [estimate for this railway]; each wheel set knocks
 * once on every joint, the "clickety-clack".
 */
export const RAIL_M = 18.288;
/** A coach bogie's wheelbase, m [estimate]: its two wheel sets knock on a joint this far apart */
export const BOGIE_M = 2.4;

/** Where the train's wheel sets are, m back from its front: each vehicle's two pivots, a bogie's two axles about each. */
export function trainAxles(t: Train): number[] {
    const out: number[] = [];
    for (const v of t.vehicles) {
        for (const pv of [v.offset - v.pivot, v.offset + v.pivot]) {
            if (v.kind === 'coach') out.push(pv - BOGIE_M / 2, pv + BOGIE_M / 2);
            else out.push(pv);
        }
    }
    return out.sort((x, y) => x - y);
}

const place = newTrainPlace();
const state: TrainState = { run: 0, s: 0, v: 0, effort: 0, brake: 0 };

/** Writes the trains' part of the frame at (fractional) tick `tick`. */
export function putTrains(a: Float32Array, trains: readonly Train[], tick: number): void {
    const n = Math.min(MAX_TRAINS, trains.length);
    a[A.nTrains] = n;
    for (let k = 0; k < n; k++) {
        const t = trains[k], o = A.trains + k * TF.size;
        const st = t.state(tick, state);
        const p = t.placeAtS(0, st.s, place);
        a[o + TF.x] = p.x + p.fx * CHIMNEY.f + p.ux * CHIMNEY.y;
        a[o + TF.y] = p.y + p.fy * CHIMNEY.f + p.uy * CHIMNEY.y;
        a[o + TF.z] = p.z + p.fz * CHIMNEY.f + p.uz * CHIMNEY.y;
        const m = t.placeAtS(Math.floor(t.vehicles.length / 2), st.s, place);
        a[o + TF.mx] = m.x;
        a[o + TF.my] = m.y + 0.5;
        a[o + TF.mz] = m.z;
        a[o + TF.v] = st.v;
        a[o + TF.effort] = st.effort;
        a[o + TF.run] = st.run;
    }
}
