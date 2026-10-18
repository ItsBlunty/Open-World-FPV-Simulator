// Checks a saved flight by replaying it (flights.ts checkFlight), and builds a flight's track for the replay viewer
// (replay.ts buildTrack), off the page's main thread: a 10 minute flight is 600 000 sim steps, a few seconds of work.
// The map is built once, on the first request.

import { buildFirstMap } from '@owfpv/maps';
import type { Level } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { checkFlight } from './flights';
import type { CheckResult, Flight } from './flights';
import { buildTrack } from './replay';
import type { Track } from './replay';

export type CheckRequest = { id: number; want: 'check' | 'track'; flight: Flight };
export type CheckReply =
    | { id: number; result: CheckResult }
    | { id: number; progress: number }
    | { id: number; track: Track }
    | { id: number; error: string };

let map: { level: Level; mesh: MeshContactWorld } | null = null;

self.onmessage = (e: MessageEvent<CheckRequest>) => {
    const { id, flight, want } = e.data;
    const post = (m: CheckReply, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer);
    try {
        if (!map) {
            const level = buildFirstMap();
            map = { level, mesh: new MeshContactWorld(level.collision) };
        }
        if (want === 'track') {
            let last = 0;
            const track = buildTrack(flight, map.level, map.mesh, (p) => {
                if (p - last < 0.02) return;
                last = p;
                post({ id, progress: p });
            });
            return post({ id, track }, [track.ticks.buffer, track.data.buffer]);
        }
        post({ id, result: checkFlight(flight, map.level, map.mesh) });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        post(want === 'track' ? { id, error: message } : { id, result: { ok: false, lives: [], problem: message } });
    }
};
