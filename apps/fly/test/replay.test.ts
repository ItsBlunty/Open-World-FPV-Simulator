// The replay viewer's track (owner, 2026-10-18): a saved flight flown again from its sticks gives exactly the poses
// the live flight had, so what the viewer shows is what was flown. Also the interpolation, the path line and the
// radio's replay controls (big deliberate moves only).

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { S } from '@owfpv/sim-core';
import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { FlightSession } from '../src/session';
import { demoTrickSticks, selftestSticks } from '../src/selftest';
import { captureFlight, flightFromJson, flightToJson } from '../src/flights';
import { RadioReplayControl, T, TRACK_STEP, buildTrack, lifeAt, pathSegments, poseAt, poseIndex } from '../src/replay';
import { Grader } from '../src/grade';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
const mesh = new MeshContactWorld(level.collision);

/** The self-test's sticks (a climb, a dive into the ground, a respawn) with a settings change at 6 s, and traffic; the live poses kept. */
function fly(ticks: number): { session: FlightSession; live: Map<number, number[]> } {
    const s = new FlightSession({ preset, level, world: mesh, traceHash: true, traffic: { cars: true, people: true, signals: true } });
    const r = s.runner;
    const ch = new Float32Array(8);
    const live = new Map<number, number[]>();
    while (r.sim.tick < ticks) {
        const t = r.sim.tick;
        if (t === 6000) s.setOverrides({ crashOn: true });
        if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: selftestSticks(t, ch) });
        r.stepOnce();
        const x = r.sim.s;
        if (r.sim.tick % 500 === 0) live.set(r.sim.tick, [x[S.px], x[S.py], x[S.pz], x[S.qx], x[S.qy], x[S.qz], x[S.qw]]);
    }
    return { session: s, live };
}

describe('replay track', () => {
    const { session, live } = fly(12000);
    const flight = captureFlight(session, 1, [[3, 500]]);
    let progress = 0;
    const track = buildTrack(flight, level, mesh, (p) => { progress = p; });

    it('covers the flight, every life, with rising ticks, and checks every life', () => {
        expect(track.ok).toBe(true);
        expect(track.startTick).toBe(flight.startTick);
        expect(track.endTick).toBe(12000);
        expect(track.lives.length).toBe(flight.lives.length);
        expect(track.lives.every((l) => l.ok && l.traffic.cars)).toBe(true);
        for (let i = 1; i < track.ticks.length; i++) expect(track.ticks[i]).toBeGreaterThanOrEqual(track.ticks[i - 1]);
        // a pose every TRACK_STEP ticks, plus each life's first
        expect(track.ticks.length).toBe((12000 - track.startTick) / TRACK_STEP + track.lives.length);
        expect(progress).toBe(1);
    });

    it('holds exactly the live flight\'s poses (as float32)', () => {
        const out = new Float32Array(T.size);
        expect(live.size).toBeGreaterThan(20);
        // a life's first tick holds two poses (the old life's last, the new one's first); the viewer shows the new one
        const starts = new Set(track.lives.map((l) => l.startTick));
        for (const [tick, p] of live) {
            if (starts.has(tick)) continue;
            const i = poseIndex(track, tick);
            expect(track.ticks[i]).toBe(tick);
            poseAt(track, tick, out);
            expect([out[T.px], out[T.py], out[T.pz]]).toEqual([Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])]);
            // the rotation is renormalised: equal to float precision
            for (let k = 0; k < 4; k++) expect(out[T.qx + k]).toBeCloseTo(p[3 + k], 6);
        }
    });

    it('marks every respawn and the golden prop, in order', () => {
        const respawns = track.marks.filter((m) => m.kind === 'respawn');
        expect(respawns.map((m) => m.tick)).toEqual(track.lives.slice(1).map((l) => l.startTick));
        expect(respawns.some((m) => m.label === 'settings changed')).toBe(true);
        expect(track.marks.some((m) => m.kind === 'prop' && m.tick === 500 && m.label === 'golden prop #3')).toBe(true);
        for (let i = 1; i < track.marks.length; i++) expect(track.marks[i].tick).toBeGreaterThanOrEqual(track.marks[i - 1].tick);
        expect(lifeAt(track, track.lives[1].startTick)).toBe(1);
        expect(lifeAt(track, track.lives[1].startTick - 1)).toBe(0);
    });

    it('interpolates between poses, and never across a respawn\'s jump', () => {
        const out = new Float32Array(T.size);
        const i = poseIndex(track, 3000);
        const a = track.data.subarray(i * T.size), b = track.data.subarray((i + 1) * T.size);
        poseAt(track, 3001, out);
        expect(out[T.px]).toBeCloseTo((a[T.px] + b[T.px]) / 2, 5);
        let q = 0;
        for (let k = T.qx; k <= T.qw; k++) q += out[k] * out[k];
        expect(q).toBeCloseTo(1, 6);
        // just before a life that starts somewhere else, the pose stays at the old life's last one
        for (const l of track.lives.slice(1)) {
            const j = poseIndex(track, l.startTick);
            const before = track.data.subarray((j - 1) * T.size), after = track.data.subarray(j * T.size);
            const d = Math.hypot(after[T.px] - before[T.px], after[T.py] - before[T.py], after[T.pz] - before[T.pz]);
            if (d < 5) continue;
            poseAt(track, l.startTick - 0.5, out);
            expect(Math.hypot(out[T.px] - before[T.px], out[T.py] - before[T.py], out[T.pz] - before[T.pz])).toBeLessThan(d / 2);
        }
    });

    it('draws a path with no segment across a respawn', () => {
        const p = pathSegments(track);
        const n = p.positions.length / 6;
        expect(n).toBeGreaterThan(500);
        expect(p.speed.length).toBe(2 * n);
        expect(p.ticks.length).toBe(n);
        for (let i = 0; i < n; i++) {
            const o = i * 6;
            expect(Math.hypot(p.positions[o + 3] - p.positions[o], p.positions[o + 4] - p.positions[o + 1], p.positions[o + 5] - p.positions[o + 2])).toBeLessThan(5);
        }
    });

    it('says so when a stick record was changed', () => {
        const bad = flightFromJson(flightToJson(flight));
        const recs = bad.lives[0].records;
        const at = Math.floor(recs.byteLength / 36 / 2) * 36;
        const v = new DataView(recs.buffer, recs.byteOffset);
        v.setFloat32(at + 4 + 2 * 4, v.getFloat32(at + 4 + 2 * 4, true) * 0.5, true);
        const t = buildTrack(bad, level, mesh);
        expect(t.ok).toBe(false);
        expect(t.lives[0].ok).toBe(false);
    });
});

describe('tricks in the replay', () => {
    // the live flight, graded as it flies
    const s = new FlightSession({ preset, level, world: mesh, traceHash: true });
    const r = s.runner;
    const live = new Grader(mesh);
    const ch = new Float32Array(8);
    let seen = 0;
    while (r.sim.tick < 8000) {
        const t = r.sim.tick;
        if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: demoTrickSticks(t, ch) });
        r.stepOnce();
        for (; seen < r.events.length; seen++) {
            const e = r.events[seen];
            if (e.type === 'contact') live.touch(e.regime === 'bounce');
        }
        live.step(r.sim.tick, r.sim.s, r.sim.ch);
    }
    const track = buildTrack(captureFlight(s, 1, []), level, mesh);

    it('grades the replay exactly as the live flight was graded', () => {
        expect(track.ok).toBe(true);
        expect(live.tricks.map((k) => k.name)).toEqual(['Back flip', 'Roll right']);
        expect(track.tricks).toEqual(live.tricks);
    });

    it('puts each trick on the timeline with its mark', () => {
        const marks = track.marks.filter((m) => m.kind === 'trick');
        expect(marks.map((m) => m.tick)).toEqual(track.tricks.map((k) => k.startTick));
        expect(marks[0].label).toMatch(/^Back flip \d+\.\d$/);
    });
});

describe('radio replay control', () => {
    const ch = (roll: number, pitch: number, thr = -1, yaw = 0): number[] => [roll, pitch, thr, yaw];

    it('ignores jitter, resting thumbs, throttle and yaw', () => {
        const c = new RadioReplayControl();
        for (const x of [ch(0, 0), ch(0.45, -0.25), ch(-0.49, 0.29), ch(0, 0, 1, 1), ch(0.02, 0.79, -1, -1)]) {
            const r = c.update(x);
            expect(r).toEqual({ toggle: false, shuttle: 0 });
        }
    });

    it('plays or pauses once per push, only after the stick came back to the centre', () => {
        const c = new RadioReplayControl();
        // already pushed when the option is turned on: nothing until it comes back
        expect(c.update(ch(0, 0.9)).toggle).toBe(false);
        expect(c.update(ch(0, 0.1)).toggle).toBe(false);
        expect(c.update(ch(0, 0.85)).toggle).toBe(true);
        expect(c.update(ch(0, 0.95)).toggle).toBe(false);
        expect(c.update(ch(0, 0.5)).toggle).toBe(false);
        expect(c.update(ch(0, 0.9)).toggle).toBe(false);
        expect(c.update(ch(0, 0.2)).toggle).toBe(false);
        expect(c.update(ch(0, -0.9)).toggle).toBe(true);
    });

    it('winds forward on right roll and back on left, faster further out', () => {
        const c = new RadioReplayControl();
        expect(c.update(ch(0.5, 0)).shuttle).toBe(0);
        expect(c.update(ch(0.51, 0)).shuttle).toBeCloseTo(0.5, 2);
        expect(c.update(ch(1, 0)).shuttle).toBe(8);
        expect(c.update(ch(-1, 0)).shuttle).toBe(-8);
        expect(c.update(ch(0.75, 0)).shuttle).toBeCloseTo(0.5 + 7.5 * 0.25, 6);
    });
});
