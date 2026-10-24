// What the page and the engine say to each other (owner, 2026-10-18: so the renderer and the sim can run off the page's
// main thread). The page keeps the DOM and every input; the engine owns the flight session, the Three.js scene and
// the frame loop. It runs on the page through these messages (the default), or with ?render=worker in a worker drawing
// to an OffscreenCanvas (docs/notes/browsers-input-performance.md §0i; the owner felt stutters there). §0h has why: Firefox applies gamepad updates on the
// page's main thread, so a page busy drawing sees them late and merged.
//
// Clocks: a worker's performance.now() counts from its own timeOrigin, not the page's. Input stamps are page time;
// the engine shifts them by `pageToEngineMs` before the sim clock sees them.

import type { ParamOverrides } from '@owfpv/sim-core';
import type { CourseFile } from '@owfpv/maps';
import type { EditorOp } from '../course-editor';
import type { TrafficConfig } from '@owfpv/traffic';
import type { Flight } from '../flights';
import type { GraphicsLevel, ViewDistance } from '../graphics';
import type { Track } from '../replay';
import type { ShadowReach } from '../render/shadow-follow';
import type { TrialEvent, TrialStatus } from '../trials';

/** The replay viewer's cameras (owner, 2026-10-18): the pilot's FPV, chase, a free camera, a spotter standing still. */
export type ReplayCam = 'fpv' | 'chase' | 'free' | 'spotter';
/** The flight path: none, the last few seconds, or the whole flight (the default). */
export type PathMode = 'off' | 'trail' | 'whole';

export interface EngineSettings {
    uptiltDeg: number;
    fovDeg: number;
    /** FPV lens id (render/lenses), or 'none' for the flat camera */
    lens: string;
    renderScale: number;
    /** how far the sun's shadows reach (render/shadow-follow.ts) */
    shadowReach: ShadowReach;
    /** how far full graphics sees (graphics.ts VIEW_DISTANCES) */
    viewDistance: ViewDistance;
    /** the volumetric clouds on (full graphics only) */
    clouds: boolean;
    overrides: ParamOverrides;
    traffic: TrafficConfig;
    spawn: string;
}

export interface InitMsg {
    type: 'init';
    /** the page's performance.timeOrigin */
    timeOrigin: number;
    /** CSS pixels and the page's devicePixelRatio */
    width: number;
    height: number;
    dpr: number;
    /** location.search: ?webgl, ?spawn, ?cam, ?noshadows, ?lowspec, ?demo */
    search: string;
    shadows: boolean;
    /** full graphics or a low spec mode (graphics.ts, render/kit.ts) */
    graphics: GraphicsLevel;
    settings: EngineSettings;
    /** the golden props this pilot has taken already, by map id, by number (the page keeps them) */
    collection: Record<string, number[]>;
    /** this visit's saved flight: its id (the page's start time, ms) */
    flightId: number;
    /** the courses made in the time trial creator, by map id (the page keeps them: course-store.ts) */
    courses: Record<string, CourseFile[]>;
}

/** A golden prop as the page lists it (maps Collectible, without its position). */
export interface PropInfo {
    n: number;
    area: string;
    spot: string;
}

/** A time trial course as the page lists it (maps TimeTrial, without the geometry). */
export interface TrialInfo {
    id: string;
    name: string;
    area: string;
    version: number;
    /** its gates' names, in order (the last is the start arch) */
    gates: string[];
    /** its gates' centres, m, in the same order (the HUD's distance to the next one) */
    at: [number, number, number][];
    /** made in the creator (kept in this browser), not one of the map's own */
    custom: boolean;
}

export type PageMsg =
    | InitMsg
    /** one mapped stick frame (sim-core channels) with its page time */
    | { type: 'input'; ch: Float32Array; t: number }
    /** a radio profile is in use (the stale-radio disarm and the free-fly camera depend on it) */
    | { type: 'radio'; on: boolean }
    | { type: 'pause'; on: boolean }
    | { type: 'reset' }
    | { type: 'settings'; what: 'camera' | 'flight' | 'traffic' | 'graphics' | 'spawn'; settings: EngineSettings }
    | { type: 'resize'; width: number; height: number; dpr: number }
    | { type: 'view'; mode: 'toggle' }
    /** the golden props taken, by number: the saved collection, or none after a reset */
    | { type: 'collection'; taken: number[] }
    /** the time trial offer answered (race or decline), or the race left (quit: the pause menu) */
    | { type: 'trial'; act: 'race' | 'decline' | 'quit' }
    /** which courses (by index) the pilot has a time on: their pads lose the arrow and LAND HERE TO START */
    | { type: 'trial-flown'; flown: boolean[] }

    /**
     * the custom courses changed (saved, opened, deleted): the quad is set down where it is now, or on course `pad`'s pad
     * (its id), for a new life on the new collision
     */
    | { type: 'courses'; files: CourseFile[]; pad: string | null }
    /** the time trial creator: open a course to make or change (hasPad: its pad is placed), or close, or an edit */
    | { type: 'editor-open'; course: CourseFile; hasPad: boolean }
    | { type: 'editor-close' }
    /** the creator's camera: the free camera with the sim paused, or flying the quad (the flown line grows) */
    | { type: 'editor-mode'; mode: EditorMode }
    | { type: 'editor-op'; op: EditorOp }
    | { type: 'editor-clear-line' }
    /** free-fly camera: held keys, mouse movement since the last message, back to the quad */
    | { type: 'freecam'; keys: string[]; dx: number; dy: number; enter: boolean }
    /** debugging from the page's console: `code` runs in the engine with `fly` (session, view, ...) in scope */
    | { type: 'ask'; id: number; code: string }
    /** the flight's state for a bug report (report.ts) */
    | { type: 'report'; id: number }
    /** watch a saved flight (replay.ts): the sim stays paused while the track plays */
    | { type: 'replay'; track: Track; cam: ReplayCam; path: PathMode }
    /**
     * the replay's controls; seek: go to a tick; shuttle: wind at this many flight seconds a second while not 0 (the
     * radio's roll stick), whether playing or not
     */
    | { type: 'replay-ctl'; playing?: boolean; speed?: number; seek?: number; cam?: ReplayCam; path?: PathMode; shuttle?: number }
    | { type: 'replay-exit' };

export type EditorMode = 'camera' | 'fly';

/** The creator's state, sent after each change. */
export interface EditorState {
    course: CourseFile;
    hasPad: boolean;
    selected: number;
    mode: EditorMode;
    reach: number;
    /** what keeps it from being saved (null: it can be) */
    problem: string | null;
    /** points in the flown line */
    line: number;
}

export interface HudSnapshot {
    /** sim-core's state vector and channels, copied */
    s: Float64Array;
    ch: Float32Array;
    p: { cells: number; crashOn: boolean; smallAngleDeg: number };
    respawnIn: number | null;
    fps: number;
    mode: 'fpv' | 'chase';
    freeCam: boolean;
    /** the time trials: the pad being rested on, the countdown, the race */
    trial: TrialStatus;
}

/** What the engine knows for a bug report (report.ts): where the flight is and how it is drawn. Read only. */
export interface EngineReport {
    simCore: string;
    mapId: string;
    mapVersion: number;
    trafficVersion: number;
    spawn: string;
    traffic: TrafficConfig;
    overrides: ParamOverrides;
    /** sim ticks (1 ms) of the run, the lives it has had, steps skipped after a stall */
    tick: number;
    lives: number;
    hitches: number;
    paused: boolean;
    /** world frame, m and m/s (y up); attitude in degrees */
    pos: [number, number, number];
    vel: [number, number, number];
    roll: number;
    pitch: number;
    yaw: number;
    armed: boolean;
    crashed: boolean;
    view: 'fpv' | 'chase';
    freeCam: boolean;
    /** the replay viewer's playhead when it is open */
    replayTick: number | null;
    renderer: string;
    lowSpec: boolean;
    drawCalls: number;
    triangles: number;
}

export type EngineMsg =
    | { type: 'ready'; backend: string; spawns: { id: string; name: string }[]; spawn: string; mapId: string; props: PropInfo[]; trials: TrialInfo[]; axles: number[] }
    /** what the sound needs this frame (audio/frame.ts A), every frame */
    | { type: 'audio'; a: Float32Array }
    /** the courses the engine has now (after a 'courses' message) */
    | { type: 'courses'; trials: TrialInfo[] }
    | { type: 'editor'; state: EditorState }
    /** something happened in a time trial (trials.ts TrialEvent) */
    | { type: 'trial'; e: TrialEvent }

    /** golden props just taken, by number */
    | { type: 'collect'; n: number[] }
    /** the run so far, to save (sent when the sim pauses, and every minute of flying) */
    | { type: 'flight'; flight: Flight }
    | { type: 'hud'; hud: HudSnapshot }
    | { type: 'error'; message: string }
    | { type: 'answer'; id: number; ok: boolean; value: unknown }
    | { type: 'report'; id: number; state: EngineReport }
    /** where the replay is, every frame it plays (the page draws the sticks and numbers from its own copy of the track) */
    | { type: 'replay-at'; tick: number; playing: boolean };

/** Something both a worker and a MessagePort are. */
export interface Port {
    postMessage(msg: unknown, transfer?: Transferable[]): void;
    onmessage: ((e: MessageEvent) => void) | null;
}

/** ms to add to a page time to get the engine's performance.now() time for the same moment. */
export function pageToEngineMs(pageOrigin: number, engineOrigin: number): number {
    return pageOrigin - engineOrigin;
}

/** HUD snapshots per second the engine sends (DOM work on the page is kept off its main thread's budget). */
export const HUD_HZ = 30;

/**
 * Two ports on one thread that hand each message straight to the other side's handler: no copy. A MessageChannel
 * copies every message (structured clone) and the copies fill memory that Firefox frees with a major GC about every
 * 30 s, which stuttered (owner, 2026-10-18; docs/notes/browsers-input-performance.md §0k). Delivery is synchronous, so a sender may reuse what it
 * sent as soon as postMessage returns. Messages to a side with no handler yet wait until one is set.
 */
export function localPorts(): [Port, Port] {
    const make = (): Port & { peer: { deliver(m: unknown): void } | null; deliver(m: unknown): void } => {
        let handler: ((e: MessageEvent) => void) | null = null;
        const waiting: unknown[] = [];
        const port = {
            peer: null as { deliver(m: unknown): void } | null,
            deliver(m: unknown): void {
                if (handler) handler({ data: m } as MessageEvent);
                else waiting.push(m);
            },
            postMessage(m: unknown): void {
                port.peer!.deliver(m);
            },
            get onmessage(): ((e: MessageEvent) => void) | null {
                return handler;
            },
            set onmessage(h: ((e: MessageEvent) => void) | null) {
                handler = h;
                while (handler && waiting.length) handler({ data: waiting.shift() } as MessageEvent);
            }
        };
        return port;
    };
    const a = make(), b = make();
    a.peer = b;
    b.peer = a;
    return [a, b];
}
