// What the collision and the renderer need from any traffic model: the movers, where each is at a
// sim tick, and the fixed traffic hardware (signal poles, arms and lamps).
//
// Two models implement it: loops.ts (cars round each block, people round its sidewalk, no signals)
// and network.ts (signalled junctions, cars that follow and queue, people who wait at crossings).
// Either way a mover's place is a function of the sim tick alone, so replays stay exact.

import type { Place } from './route';
import type { VehicleShape } from './vehicles';

/** One 1 ms sim tick, s (sim-core's fixed step) */
export const DT = 0.001;

/** Bumped with any change that moves a mover or changes a shape: part of the world hash (replays). */
/** 7: people take the train at the city station, and people out of sight are not solid (map v9) */
/** 8: people keep apart (follow, wait for each other at meeting paths), a spot each at the kerb when waiting to cross */
/** 9: cars, saloons, SUVs, vans, pickups with loads and semis with trailers, each its own shape (vehicles.ts); vendors (owner 2026-10-20) */
/** 10: a vehicle's boxes are one solid: a point inside it is pushed out of the whole vehicle (traffic.md §1z) */
export const TRAFFIC_VERSION = 10;

export interface TrafficConfig {
    cars: boolean;
    people: boolean;
    /** signalled junctions and the network model (cars queue, people cross at the lights); off: simple loops */
    signals: boolean;
    /** the steam train on the railway loop (train.ts; owner, 2026-10-19: its own toggle). Absent: no train */
    train?: boolean;
}

/** The toy car's body and cabin (vehicles.ts has every kind of vehicle). */
export { CAR } from './vehicles';
/** A person: a vertical capsule, radius and the ends of its axis above the ground, m (1.75 m tall) [estimates]. */
export const PERSON = { r: 0.3, y0: 0.3, y1: 1.45 } as const;

export type MoverKind = 'car' | 'person';

export interface Mover {
    kind: MoverKind;
    /** top speed, m/s */
    v: number;
    /** a number for its looks (colour, hat): the renderer's, never the physics' */
    look: number;
    /** a vehicle's shape (cars only): its solid boxes, length, trailer */
    shape?: VehicleShape;
    /** a person who stands at a street vendor's cart and sells (never walks) */
    vendor?: boolean;
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
    /** Where semi i's trailer is at `tick` (its frame: at the kingpin, heading towards the tractor), as place(). */
    trailer?(i: number, tick: number, out: Place): Place;
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
