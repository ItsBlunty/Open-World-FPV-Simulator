// The engine left the page's main thread (owner, 2026-10-18; docs/notes/browsers-input-performance.md §0h). A worker's performance.now() counts
// from its own timeOrigin, so every stick frame from the page is shifted onto the engine's clock before the sim
// clock sees it, and a radio that goes quiet while armed is still disarmed after 150 ms of the engine's time.

import { describe, expect, it } from 'vitest';
import { pageToEngineMs } from '../src/engine/protocol';
import { RadioLink, STALE_MS } from '../src/engine/radio-link';

class Sink {
    got: { ch: number[]; t: number }[] = [];
    input(ch: ArrayLike<number>, t: number): void {
        this.got.push({ ch: Array.from(ch), t });
    }
}

const armed = [0, 0, -1, 0, 1, -1, 0, 0];

describe('page -> engine clock', () => {
    it('shifts by the difference of the time origins', () => {
        // the worker started 250.5 ms after the page: page time 1000 is worker time 749.5
        expect(pageToEngineMs(1_700_000_000_000, 1_700_000_000_250.5)).toBe(-250.5);
        const sink = new Sink();
        const link = new RadioLink(1_700_000_000_000, 1_700_000_000_250.5);
        link.input(sink, armed, 1000);
        expect(sink.got[0].t).toBe(749.5);
        expect(sink.got[0].ch).toEqual(armed);
    });

    it('is no shift on the same thread', () => {
        const sink = new Sink();
        const link = new RadioLink(123.25, 123.25);
        link.input(sink, armed, 42);
        expect(sink.got[0].t).toBe(42);
    });
});

describe('stale radio', () => {
    it('disarms an armed radio silent for more than STALE_MS, once', () => {
        const sink = new Sink();
        const link = new RadioLink(0, 0);
        link.hasRadio = true;
        link.input(sink, armed, 100);
        link.checkStale(sink, 100 + STALE_MS);
        expect(sink.got.length).toBe(1);
        link.checkStale(sink, 101 + STALE_MS);
        expect(sink.got.length).toBe(2);
        expect(sink.got[1].ch[4]).toBe(-1);
        expect(sink.got[1].ch[2]).toBe(-1); // the rest of the last frame is kept
        expect(sink.got[1].t).toBe(101 + STALE_MS);
        link.checkStale(sink, 500);
        expect(sink.got.length).toBe(2);
    });

    it('leaves a disarmed radio and a page without a radio alone', () => {
        const sink = new Sink();
        const link = new RadioLink(0, 0);
        link.hasRadio = true;
        link.input(sink, [0, 0, -1, 0, -1, -1, 0, 0], 0);
        link.checkStale(sink, 1000);
        const none = new RadioLink(0, 0);
        none.input(sink, armed, 0);
        none.checkStale(sink, 1000);
        expect(sink.got.length).toBe(2);
    });
});
