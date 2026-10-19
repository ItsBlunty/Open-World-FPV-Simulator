// Saved flights (owner, 2026-10-18): a flight captured from the live runner, carried as plain data or a JSON file,
// replays from its sticks alone to the same trace hash, life by life (R5). Traffic, a settings change and a crash
// respawn are in the flight, since each starts a new life or changes the collision.

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { FlightSession } from '../src/session';
import { selftestSticks } from '../src/selftest';
import { captureFlight, checkFlight, flightFromJson, flightToJson, summary } from '../src/flights';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
const mesh = new MeshContactWorld(level.collision);

/** The self-test's sticks (a climb, a dive into the ground, a respawn) with a rates change at 6 s, and traffic. */
function fly(ticks: number): FlightSession {
    const s = new FlightSession({ preset, level, world: mesh, traceHash: true, traffic: { cars: true, people: true, signals: true } });
    const r = s.runner;
    const ch = new Float32Array(8);
    while (r.sim.tick < ticks) {
        const t = r.sim.tick;
        if (t === 6000) s.setOverrides({ crashOn: true });
        if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: selftestSticks(t, ch) });
        r.stepOnce();
    }
    return s;
}

describe('saved flights', () => {
    const session = fly(12000);
    const flight = captureFlight(session, 1, [[3, 500]]);

    it('captures every life with its hash, the current one cut at the current tick', () => {
        expect(flight.lives.length).toBeGreaterThanOrEqual(2);
        expect(flight.lives.every((l) => l.traceHash !== null)).toBe(true);
        expect(flight.endTick).toBe(12000);
        expect(flight.lives[flight.lives.length - 1].endTick).toBe(12000);
        const s = summary(flight);
        expect(s.seconds).toBe(12);
        expect(s.props).toBe(1);
    });

    it('replays to the same hash, life by life, also after a JSON round trip', () => {
        const a = checkFlight(flight, level, mesh);
        expect(a.problem).toBeNull();
        expect(a.ok).toBe(true);
        expect(a.lives.length).toBe(flight.lives.length);
        const b = checkFlight(flightFromJson(flightToJson(flight)), level, mesh);
        expect(b.ok).toBe(true);
    });

    it('notices a changed stick record', () => {
        const bad = flightFromJson(flightToJson(flight));
        const recs = bad.lives[0].records;
        // the throttle (channel 2) of a record half-way through the first life, armed and climbing (records: an Int32
        // code, then 8 Float32)
        const at = Math.floor(recs.byteLength / 36 / 2) * 36;
        new DataView(recs.buffer, recs.byteOffset).setFloat32(at + 4 + 4 * 2, 0.9, true);
        expect(checkFlight(bad, level, mesh).ok).toBe(false);
    });

    it('refuses a file that is not a saved flight, saying why', () => {
        expect(() => flightFromJson('hello')).toThrow(/not JSON/);
        expect(() => flightFromJson('null')).toThrow(/not a saved flight/);
        expect(() => flightFromJson('{"format":"owfpv-report/1"}')).toThrow(/not a saved flight/);
        const cut = JSON.parse(flightToJson(flight)) as { lives: unknown };
        cut.lives = {};
        expect(() => flightFromJson(JSON.stringify(cut))).toThrow(/damaged/);
    });

    it('refuses a flight from another map version, saying why', () => {
        const other = flightFromJson(flightToJson(flight));
        for (const l of other.lives) if (l.header.scene) l.header.scene.version = 999;
        const r = checkFlight(other, level, mesh);
        expect(r.ok).toBe(false);
        expect(r.problem).toMatch(/v999/);
    });
});
