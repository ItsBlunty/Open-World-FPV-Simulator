// Old logs replay (lane E, log format /3): fixtures/v2-log.json was written by the format /2 writer
// (commit cbc41e8, fixtures/v2-log-maker.ts) before wind and the collision ceiling existed. Up to
// sim-core/0.2.0 every life replayed to the hash it was saved with and the run ended in the saved
// state. sim-core/0.3.0 changed the flight model (the contact solver and a health slot in the state,
// CHANGELOG.md), so a log recorded by 0.2.0 no longer gives 0.2.0's trace: the header's simCore says
// which model recorded it. What the format guarantees still holds: the /2 log is read, its headers
// validate, each life replays the same every time, and a tampered record (the control) changes it.
// The fixture cannot be regenerated (the writer now writes /3), so it is kept as recorded.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_FORMAT_V2, lifeHeaderProblem, replayLife, replayLives } from '../src/index';
import type { Life, LifeHeader, ReplayDeps } from '../src/index';
import { deps } from './log-kit';
import { v2Room } from './fixtures/v2-log-maker';

interface SavedLife { header: LifeHeader; b64: string; endTick: number; traceHash: string; hashFrom: number }
const FIX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'v2-log.json'), 'utf8')) as { format: string; lives: SavedLife[]; final: number[] };

function lifeOf(l: SavedLife, bytes = new Uint8Array(Buffer.from(l.b64, 'base64'))): Life {
    return { header: l.header, bytes: () => bytes, endTick: l.endTick, traceHash: l.traceHash, hashFrom: l.hashFrom };
}

/** The room moves with the scene scale: the header's transform, or the world record's. */
const roomDeps: ReplayDeps = {
    preset: deps(null).preset,
    world: (scene, ev) => v2Room(ev ? ev.s : scene ? scene.transform[0] : 1)
};

describe('logs written by format /2 replay unchanged', () => {
    it('the fixture is a real /2 log: three lives, a world record, a crash rewind and a settings life', () => {
        expect(FIX.format).toBe(LOG_FORMAT_V2);
        expect(FIX.lives.map((l) => l.header.life.reason)).toEqual(['start', 'crash', 'settings']);
        for (const l of FIX.lives) expect(lifeHeaderProblem(l.header)).toBeNull();
    });

    it('every life replays alone, the same every time; the saved hashes are sim-core/0.2.0 traces, which 0.3.0 no longer gives', () => {
        const lives = FIX.lives.map((l) => lifeOf(l));
        for (let i = 0; i < lives.length; i++) {
            expect(FIX.lives[i].header.simCore, `life ${i}`).toBe('sim-core/0.2.0');
            const a = replayLife(lives[i], roomDeps).hash;
            expect(replayLife(lifeOf(FIX.lives[i]), roomDeps).hash, `life ${i}`).toBe(a);
            expect(a, `life ${i}`).not.toBe(FIX.lives[i].traceHash);
        }
        const once = Array.from(replayLives(lives, roomDeps).sim.s);
        expect(Array.from(replayLives(FIX.lives.map((l) => lifeOf(l)), roomDeps).sim.s)).toEqual(once);
        expect(once).toHaveLength(FIX.final.length + 2); // the health slot (0.3.0) and the turtle-mode slot (0.4.0)
    });

    it('control: one input bit flipped in the first life changes its replay hash', () => {
        const l = FIX.lives[0];
        const bytes = new Uint8Array(Buffer.from(l.b64, 'base64'));
        // record 40: its first channel's lowest mantissa byte
        bytes[40 * 36 + 4] ^= 1;
        expect(replayLife(lifeOf(l, bytes), roomDeps).hash).not.toBe(replayLife(lifeOf(l), roomDeps).hash);
    });
});
