// From ShramkoGSFPV apps/fly/src/devices/gamepad.ts, commit 8c90f535 (MIT, Copyright (c) 2026 Andrii Shramko;
// see ../../LICENSE-MIT and ../../NOTICE). Local changes are listed in ../../UPSTREAM.md.

// Gamepad API (compatibility path; many radios also appear as gamepads). Polled on a worker's ~1 ms
// clock, not in requestAnimationFrame, so input sampling is independent of the frame rate. The clock
// (owner, 2026-10-18): upstream spun a MessageChannel loop for ~500 Hz, which in Firefox 158 starves
// drawing (120 -> 25 fps with 6 ms of frame work; Chrome 155 kept 119). A worker posting each tick to
// the page leaves the frames alone. A plain setInterval(1) is clamped to ~4 ms (timers set from timers
// five deep, HTML timer nesting), which beats against Firefox's own ~4-5 ms gamepad updates and misses
// some (owner's Boxer, 500 Hz: ~140 Hz). So each 1 ms timeout is set from a message task instead, where
// the nesting level starts again: Firefox 158 ticks ~665/s, Chrome 155 ~544/s, gaps 1-2 ms, no spinning
// (docs/evidence/2026-10-18-render-worker/). The owner's Boxer (500 Hz) in Firefox 158: 219 Hz with the engine
// on the page, 225 Hz with it in a worker (was ~140). Each new sample keeps its Gamepad.timestamp (below).
// Chromium traps: an axis may read exactly 0.0 until it has once been near centre,
// and a pad only appears after a deflection > 0.5 — the arm gate's "passed centre" rule covers it.
// Some pads (e.g. a DJI controller) report only changes: Gamepad.timestamp stands still while the
// sticks do. Their held values are still true while the pad is connected, so they are sent again
// (arrival = this poll) before the arm gate's 100 ms stale rule would disarm them in flight. A pad
// that is gone sends nothing, so the gate still goes stale and disarms.
//
// Connecting (owner, 2026-10-18): a browser fires 'gamepadconnected' once per page, the first time
// the pad is touched. A pad touched before start() (Firefox: moved before "Use gamepad" was clicked)
// sends no second event, so the poll also adopts a pad it finds in getGamepads() and announces it.
//
// The stamp (v0.8, the owner's item 7): a new sample is stamped with Gamepad.timestamp, not the moment
// this loop got to it: while the main thread draws a heavy scan the loop waits, and the physics,
// which applies an input at its stamp (simclock.ts), would then start the move that much later.
// Measured on a release drawing a scan at the owner's 30 Hz with 25 ms of load per frame
// (tools/bench/scripts/input-latency-probe.mjs, evidence/2026-10-16/v08-b-latency.json).
// Firefox (source read 2026-10-18, dom/gamepad/Gamepad.cpp UpdateTimestamp): the timestamp is when the
// page's main thread applied the update, not when the gamepad thread read it, so there it is only as
// early as the main thread is free; another reason the engine left it.
// gamepadStamp has the rule: a repeat keeps its arrival, and stamps never go backwards.

import { FRAME_BUTTONS } from '@owfpv/input';
import type { RawFrame } from '@owfpv/input';

/** A connected pad with no new hardware sample repeats its last values this often (gate: 100 ms). */
const KEEPALIVE_MS = 20;
/** Gamepad.timestamp older than this (or ahead of now) is not this page clock's sample time: the poll time is used. */
const STAMP_MAX_AGE_MS = 100;

/**
 * The page time a polled sample is stamped with: a new sample (`fresh`) its Gamepad.timestamp when
 * that is a plausible time on this page's clock (not ahead of `now`, at most STAMP_MAX_AGE_MS old),
 * else `now`; never before the previous stamp `prev` (the physics takes samples in order).
 */
export function gamepadStamp(fresh: boolean, timestamp: number, now: number, prev: number): number {
    const t = fresh && Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= STAMP_MAX_AGE_MS ? timestamp : now;
    return t > prev ? t : prev;
}

export function gamepadKey(g: Gamepad): string {
    return `gp:${g.id}:${g.axes.length}:${g.buttons.length}:${g.mapping}`;
}

// each 1 ms timeout is set from a message task, so the timer nesting level never builds up to the 4 ms clamp
const CLOCK_SRC = 'const mc = new MessageChannel(); mc.port1.onmessage = () => setTimeout(tick, 1); function tick() { postMessage(0); mc.port2.postMessage(0); } tick();';
/** The clock the last GamepadSource ended up on (for checks from the console: __fly.padClock). */
export let padClock: 'worker' | 'interval' | 'none' = 'none';

/**
 * Calls `tick` every ~1-2 ms from a worker (a page interval where there are no workers, as in Node tests); returns
 * its stop. scheduler.postTask with a 1 ms delay was tried (owner, 2026-10-18): ~650 ticks/s on an idle Firefox page,
 * but ~230/s while flying (clamped like setInterval), catching 69 % of an imitated 4 ms gamepad update stream
 * against the worker's 100 % (docs/evidence/2026-10-18-render-worker/).
 */
function startClock(tick: () => void): () => void {
    if (typeof Worker === 'undefined') {
        padClock = 'interval';
        const id = setInterval(tick, 1);
        return () => clearInterval(id);
    }
    return startWorkerClock(tick);
}

function startWorkerClock(tick: () => void): () => void {
    padClock = 'worker';
    const url = URL.createObjectURL(new Blob([CLOCK_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => {
        URL.revokeObjectURL(url); // the worker has its script once it ticks
        w.onmessage = tick;
        tick();
    };
    return () => w.terminate();
}

export class GamepadSource {
    index = -1;
    id = '';
    frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    onFrame: ((f: RawFrame) => void) | null = null;
    onConnect: ((g: Gamepad) => void) | null = null;
    /** new hardware samples per second (repeats of held values are not counted) */
    rateHz = 0;
    private stopClock: (() => void) | null = null;
    private running = false;
    private last = 0;
    private lastTs = -1; // a pad whose timestamp is 0 still sends its first frame
    private lastEmit = -1e9;
    private rateN = 0;
    private rateT0 = 0;

    start(): void {
        if (this.running) return;
        this.running = true;
        this.stopClock = startClock(() => this.loop());
        addEventListener('gamepadconnected', this.onConn);
    }

    stop(): void {
        this.running = false;
        this.stopClock?.();
        this.stopClock = null;
        removeEventListener('gamepadconnected', this.onConn);
    }

    private onConn = (e: GamepadEvent): void => {
        if (this.index >= 0) return; // the poll adopted it first, or another pad came along
        this.adopt(e.gamepad);
    };

    private adopt(g: Gamepad): void {
        this.index = g.index;
        this.id = g.id;
        this.onConnect?.(g);
    }

    private loop(): void {
        if (!this.running) return;
        const now = performance.now();
        // ticks that arrive in one bunch (the page was busy) can see no new value: poll once
        if (document.visibilityState === 'visible' && now - this.last >= 0.5) {
            this.last = now;
            this.poll(now);
        }
    }

    /** This source's pad if it is connected: at its slot, or the same pad back at another slot. */
    private pad(): Gamepad | null {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const mine = (p: Gamepad | null | undefined): p is Gamepad => !!p && p.connected !== false && (!this.id || p.id === this.id);
        const at = this.index >= 0 ? pads[this.index] : null;
        if (mine(at)) return at;
        // never another pad once one is chosen: its axes through this pad's profile could arm
        for (const p of pads) {
            if (!mine(p)) continue;
            if (this.index < 0) this.adopt(p);
            else this.index = p.index;
            return p;
        }
        return null;
    }

    private poll(now: number): void {
        const g = this.pad();
        if (!g) return; // gone: no frames, so the arm gate's stale rule disarms
        const fresh = g.timestamp !== this.lastTs;
        if (!fresh && now - this.lastEmit < KEEPALIVE_MS) return;
        this.lastTs = g.timestamp;
        const f = this.frame;
        f.t = gamepadStamp(fresh, g.timestamp, now, f.t);
        for (let i = 0; i < 8; i++) f.axes[i] = i < g.axes.length ? g.axes[i] : 0;
        let b = 0;
        for (let i = 0; i < Math.min(FRAME_BUTTONS, g.buttons.length); i++) if (g.buttons[i].pressed) b |= 1 << i;
        f.buttons = b;
        if (fresh) {
            this.rateN++;
            if (now - this.rateT0 >= 1000) {
                this.rateHz = (this.rateN * 1000) / (now - this.rateT0);
                this.rateN = 0;
                this.rateT0 = now;
            }
        }
        this.lastEmit = now;
        this.onFrame?.(f);
    }

    /** What the known-controller table needs of this source's pad (its id string and its counts), or null when none is connected. */
    info(): { id: string; axes: { length: number }; buttons: { length: number } } | null {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const g = this.index >= 0 ? pads[this.index] : null;
        return g ? { id: g.id, axes: { length: g.axes.length }, buttons: { length: g.buttons.length } } : null;
    }

    get key(): string {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const g = this.index >= 0 ? pads[this.index] : null;
        return g ? gamepadKey(g) : '';
    }
}
