// The engine's end of the radio: stick frames from the page go into the flight session on the engine's clock, and a
// radio that stopped sending (unplugged, asleep) must not keep the quad armed. No DOM and no Three.js, so Node tests
// drive it with any clock.

import { pageToEngineMs } from './protocol';

export interface InputSink {
    input(ch: ArrayLike<number>, tMs: number): void;
}

/** A radio silent this long while armed is disarmed (ms). */
export const STALE_MS = 150;

export class RadioLink {
    /** a radio profile is in use on the page */
    hasRadio = false;
    private readonly offset: number;
    private lastT = -Infinity;
    private armOn = false;
    private readonly last = new Float32Array(8);

    constructor(pageOrigin: number, engineOrigin: number) {
        this.offset = pageToEngineMs(pageOrigin, engineOrigin);
    }

    /** A mapped frame stamped in page time. */
    input(sink: InputSink, ch: ArrayLike<number>, tPage: number): void {
        const t = tPage + this.offset;
        for (let i = 0; i < 8; i++) this.last[i] = ch[i] ?? 0;
        sink.input(this.last, t);
        this.lastT = t;
        this.armOn = this.last[4] > 0;
    }

    /** Disarm (the last frame with the arm channel low, at `now`) when an armed radio has gone quiet. */
    checkStale(sink: InputSink, now: number): void {
        if (!this.hasRadio || !this.armOn || now - this.lastT <= STALE_MS) return;
        this.last[4] = -1;
        sink.input(this.last, now);
        this.armOn = false;
    }
}
