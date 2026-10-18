// Checks a saved flight by replaying it (flights.ts checkFlight) off the page's main thread: a 10 minute flight is
// 600 000 sim steps, a few seconds of work. The map is built once, on the first check.

import { buildFirstMap } from '@owfpv/maps';
import type { Level } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { checkFlight } from './flights';
import type { CheckResult, Flight } from './flights';

let map: { level: Level; mesh: MeshContactWorld } | null = null;

self.onmessage = (e: MessageEvent<{ id: number; flight: Flight }>) => {
    const { id, flight } = e.data;
    let r: CheckResult;
    try {
        if (!map) {
            const level = buildFirstMap();
            map = { level, mesh: new MeshContactWorld(level.collision) };
        }
        r = checkFlight(flight, map.level, map.mesh);
    } catch (err) {
        r = { ok: false, lives: [], problem: err instanceof Error ? err.message : String(err) };
    }
    (self as unknown as Worker).postMessage({ id, result: r });
};
