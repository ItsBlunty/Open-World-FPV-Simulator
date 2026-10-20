// Log format /4 (2026-10-20): a solid layer the world switches on and off mid-life (world records ch[7] behind flag 2
// in ch[6]), carried into the next life's header (scene.layer). The game's time trial gates are solid only while their
// race runs (owner, 2026-10-20). A flight that flies into a wall that is there only while the layer is on replays to
// the live hash at every frame split, alone and as a chain of lives; /2 and /3 headers with a layer are refused.

import { describe, expect, it } from 'vitest';
import {
    LOG_FORMAT_V3, LOG_FORMAT_V4, REC_WORLD, Runner, WORLD_FLAG_CEILING, WORLD_FLAG_LAYER, compileParams, forEachRecord,
    lifeHeaderProblem, lifeSim, readWorld, replayLife, replayLives, writeWorld
} from '../src/index';
import type { ContactWorld, LifeHeader, ReplayDeps, WorldEvent } from '../src/index';
import { PRESET, PlaneWorld, Pilot, SPLITS, deps, header, runFrames } from './log-kit';

const SCENE = { id: 'synthetic-v4', version: 1, transform: [1, 0, 0, 0] as [number, number, number, number], floaterMinBlocks: 0 };
/** layer 0: a floor; layer 1: the floor and a wall at x = 1.5 across the path */
const ROOM = PlaneWorld.room();
const WALLED = PlaneWorld.room({ wallX: 1.5 });
const worldOf = (layer: number | undefined): ContactWorld => (layer === 1 ? WALLED : ROOM);
const layerDeps: ReplayDeps = { ...deps(ROOM), world: (scene, ev) => worldOf(ev ? ev.layer : scene?.layer) };
const at = (layer: number): WorldEvent => ({ s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: null, layer });

/** The bot flies a box path through x = 3; the wall's layer is on from 1 s to 4 s, 6 s in all. */
function fly(frameHz: number, o: { layers?: boolean } = {}): Runner {
    const sim = lifeSim(compileParams(PRESET), ROOM);
    const r = new Runner(sim, header({ at: [0, 0.05, 0, 0], scene: SCENE, opts: { platform: true } }), { traceHash: true, runHash: true });
    r.onWorld = (ev) => { r.sim.world = worldOf(ev.layer); };
    const p = new Pilot(r);
    p.plan = (pp, s) => {
        if (pp.phase === '') { pp.bot.setTask({ kind: 'path', points: [[0, 2, 0], [3, 2, 0], [3, 2, 3], [0, 2, 3]], speed: 3, yawDeg: 0 }, s); pp.phase = 'fly'; }
    };
    runFrames(r, frameHz, 1_000_000);
    if (o.layers !== false) r.world(at(1));
    runFrames(r, frameHz, 4_000_000, { phaseUs: 1_000_000 });
    if (o.layers !== false) r.world(at(0));
    runFrames(r, frameHz, 6_000_000, { phaseUs: 4_000_000 });
    return r;
}

describe('format /4 headers and records', () => {
    it('a world record keeps the layer behind its own flag, with or without a ceiling; none reads as no layer field', () => {
        const ch = new Float32Array(8);
        writeWorld(ch, { s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: null, layer: 7 });
        expect(ch[6]).toBe(WORLD_FLAG_LAYER);
        expect(readWorld(ch)).toEqual({ s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: null, layer: 7 });
        writeWorld(ch, { s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: 3, layer: 2 });
        expect(ch[6]).toBe(WORLD_FLAG_CEILING | WORLD_FLAG_LAYER);
        expect(readWorld(ch)).toMatchObject({ ceilingM: 3, layer: 2 });
        writeWorld(ch, { s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: null, layer: 0 });
        expect('layer' in readWorld(ch)).toBe(false);
        for (const bad of [-1, 1.5, Number.NaN]) expect(() => writeWorld(ch, { ...at(0), layer: bad })).toThrow(RangeError);
    });

    it('new headers are /4; a /3 header with a layer is refused, a /4 one is read', () => {
        const h = header({ at: [0, 0, 0, 0], scene: { ...SCENE, layer: 3 } });
        expect(h.format).toBe(LOG_FORMAT_V4);
        expect(lifeHeaderProblem(h)).toBeNull();
        expect(lifeHeaderProblem({ ...h, format: LOG_FORMAT_V3 } as LifeHeader)).toMatch(/cannot carry a solid layer/);
        expect(lifeHeaderProblem(header({ at: [0, 0, 0, 0], scene: { ...SCENE, layer: 0.5 } }))).toMatch(/not a whole number/);
    });
});

describe('a flight through a layer that comes and goes replays exactly', () => {
    it('every frame split gives the same run hash, and the life replays alone to its live hash and state', () => {
        const runs = SPLITS.map((hz) => fly(hz));
        expect(new Set(runs.map((r) => r.traceHash())).size).toBe(1);
        const r = runs[1];
        const life = r.current();
        const worlds: WorldEvent[] = [];
        forEachRecord(life.bytes(), (kind, _slot, ch) => { if (kind === REC_WORLD) worlds.push(readWorld(ch)); });
        expect(worlds.map((w) => w.layer ?? 0)).toEqual([1, 0]);
        const rep = replayLife(life, layerDeps);
        expect(rep.hash).toBe(r.liveLifeHash()!.hash);
        expect(Array.from(rep.sim.s)).toEqual(Array.from(r.sim.s));
        expect(Array.from(replayLives(r.lives(), layerDeps).sim.s)).toEqual(Array.from(r.sim.s));
    }, 60000);

    it('control: the wall is in the way, so the same flight without the layer flies differently', () => {
        expect(fly(60, { layers: false }).traceHash()).not.toBe(fly(60).traceHash());
    }, 60000);

    it('a respawn while the layer is on carries it in the next life\'s header; one after it is off does not', () => {
        const sim = lifeSim(compileParams(PRESET), ROOM);
        const r = new Runner(sim, header({ at: [0, 0.05, 0, 0], scene: SCENE, opts: { platform: true } }), { traceHash: true });
        r.onWorld = (ev) => { r.sim.world = worldOf(ev.layer); };
        runFrames(r, 60, 200_000);
        r.world(at(1));
        r.respawn(0, 0.05, 0, 0, { platform: true }, 'manual-start');
        expect(r.current().header.scene?.layer).toBe(1);
        // the life replays alone from its header: the wall is there from its first tick
        runFrames(r, 60, 400_000, { phaseUs: 200_000 });
        expect(replayLife(r.current(), layerDeps).hash).toBe(r.liveLifeHash()!.hash);
        r.world(at(0));
        r.respawn(0, 0.05, 0, 0, { platform: true }, 'manual-start');
        expect(r.current().header.scene?.layer).toBeUndefined();
    }, 60000);
});
