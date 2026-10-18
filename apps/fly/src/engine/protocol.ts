// What the page and the engine say to each other (owner, 2026-10-18: so the renderer and the sim can run off the page's
// main thread). The page keeps the DOM and every input; the engine owns the flight session, the Three.js scene and
// the frame loop. It runs on the page through these messages (the default), or with ?render=worker in a worker drawing
// to an OffscreenCanvas (docs/notes/browsers-input-performance.md §0i; the owner felt stutters there). §0h has why: Firefox applies gamepad updates on the
// page's main thread, so a page busy drawing sees them late and merged.
//
// Clocks: a worker's performance.now() counts from its own timeOrigin, not the page's. Input stamps are page time;
// the engine shifts them by `pageToEngineMs` before the sim clock sees them.

import type { ParamOverrides } from '@owfpv/sim-core';
import type { TrafficConfig } from '@owfpv/traffic';

export interface EngineSettings {
    uptiltDeg: number;
    fovDeg: number;
    /** FPV lens id (render/lenses), or 'none' for the flat camera */
    lens: string;
    renderScale: number;
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
    /** location.search: ?webgl, ?spawn, ?cam, ?noshadows, ?demo */
    search: string;
    shadows: boolean;
    settings: EngineSettings;
    /** the golden props this pilot has taken already, by map id, by number (the page keeps them) */
    collection: Record<string, number[]>;
}

/** A golden prop as the page lists it (maps Collectible, without its position). */
export interface PropInfo {
    n: number;
    area: string;
    spot: string;
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
    /** free-fly camera: held keys, mouse movement since the last message, back to the quad */
    | { type: 'freecam'; keys: string[]; dx: number; dy: number; enter: boolean }
    /** debugging from the page's console: `code` runs in the engine with `fly` (session, view, ...) in scope */
    | { type: 'ask'; id: number; code: string };

export interface HudSnapshot {
    /** sim-core's state vector and channels, copied */
    s: Float64Array;
    ch: Float32Array;
    p: { cells: number; crashOn: boolean };
    respawnIn: number | null;
    fps: number;
    mode: 'fpv' | 'chase';
    freeCam: boolean;
}

export type EngineMsg =
    | { type: 'ready'; backend: string; spawns: { id: string; name: string }[]; spawn: string; mapId: string; props: PropInfo[] }
    /** golden props just taken, by number */
    | { type: 'collect'; n: number[] }
    | { type: 'hud'; hud: HudSnapshot }
    | { type: 'error'; message: string }
    | { type: 'answer'; id: number; ok: boolean; value: unknown };

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
