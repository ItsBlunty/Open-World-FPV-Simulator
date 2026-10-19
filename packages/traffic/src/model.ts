// What the collision and the renderer need from any traffic model: the movers, where each is at a
// sim tick, and the fixed traffic hardware (signal poles, arms and lamps).
//
// Two models implement it: loops.ts (cars round each block, people round its sidewalk, no signals)
// and network.ts (signalled junctions, cars that follow and queue, people who wait at crossings).
// Either way a mover's place is a function of the sim tick alone, so replays stay exact.

import type { Place } from './route';

/** One 1 ms sim tick, s (sim-core's fixed step) */
export const DT = 0.001;

/** Bumped with any change that moves a mover or changes a shape: part of the world hash (replays). */
/** 7: people take the train at the city station, and people out of sight are not solid (map v9) */
export const TRAFFIC_VERSION = 7;

export interface TrafficConfig {
    cars: boolean;
    people: boolean;
    /** signalled junctions and the network model (cars queue, people cross at the lights); off: simple loops */
    signals: boolean;
    /** the steam train on the railway loop (train.ts; owner, 2026-10-19: its own toggle). Absent: no train */
    train?: boolean;
}

/** Toy car body and cabin, m: half length (along travel), half width, bottom and top, and the cabin's offset back [estimates]. */
export const CAR = {
    bodyHalfL: 2.0, bodyHalfW: 0.95, bodyY0: 0.12, bodyY1: 1.0,
    cabHalfL: 1.1, cabHalfW: 0.8, cabY0: 1.0, cabY1: 1.55, cabBack: 0.25
} as const;
/** A person: a vertical capsule, radius and the ends of its axis above the ground, m (1.75 m tall) [estimates]. */
export const PERSON = { r: 0.3, y0: 0.3, y1: 1.45 } as const;

export type MoverKind = 'car' | 'person';

export interface Mover {
    kind: MoverKind;
    /** top speed, m/s */
    v: number;
    /** a number for its looks (colour, hat): the renderer's, never the physics' */
    look: number;
}

/** A fixed solid box of the traffic hardware, axis-aligned, m. */
export interface StaticBox {
    x0: number;
    y0: number;
    z0: number;
    x1: number;
    y1: number;
    z1: number;
}

/** A signal head for the renderer: where its lamps are and which way they face ('arrow': a left-turn arrow head). */
export interface SignalHead {
    kind: 'car' | 'arrow' | 'walk';
    x: number;
    y: number;
    z: number;
    /** unit direction the lamps face (towards whom they signal) */
    fx: number;
    fz: number;
}

/** What a head shows: car and arrow heads 'red' | 'yellow' | 'green'; walk heads 'walk' | 'flash' | 'stop' (flash: blinking). */
export type Lamp = 'red' | 'yellow' | 'green' | 'walk' | 'flash' | 'stop';

export interface TrafficModel {
    readonly config: TrafficConfig;
    readonly movers: readonly Mover[];
    /** the fastest a mover goes, m/s */
    readonly maxSpeed: number;
    readonly signals: readonly SignalHead[];
    /** Bring the model to this tick: every place() call until the next at() is for this tick or the next one. */
    at(tick: number): void;
    /** Where mover i is at `tick` (this tick or the next, after at(); the renderer may pass fractions between). */
    place(i: number, tick: number, out: Place): Place;
    /** Every fixed box (signal poles, arms, heads), for the renderer. */
    allStatics(): readonly StaticBox[];
    /** The fixed boxes that may be within `reach` of (x, z). */
    staticsNear(x: number, z: number, reach: number): readonly StaticBox[];
    /** What signal head h shows at `tick`. */
    lamp(h: number, tick: number): Lamp;
    /** Car i is braking (the renderer's brake lights). */
    braking(i: number): boolean;
    /** Person i is out of sight inside a building (the renderer hides it; it stays solid where it is). */
    hidden?(i: number): boolean;
    /** The door (Level.doors index) person i is walking in or out through, else -1 (the renderer opens it). */
    doorUse?(i: number): number;
}
