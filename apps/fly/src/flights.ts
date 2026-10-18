// Saved flights (owner, 2026-10-18: "save flights first", before the freestyle grader, so every graded attempt can be
// replayed and re-scored later). A flight is what sim-core's runner keeps of one visit to the page: its lives (each a
// header and the stick records it applied) and each life's trace hash. No DOM, so the Node tests check exactly this.
//
// Determinism (CLAUDE.md, R5): a flight replays from its sticks alone. The header of each life names the preset, the
// flight-model settings, the collision (the map, and the traffic folded in) and where the life started; the replay
// rebuilds all of that from the header, never from the page's current settings, and must give the same trace hash.

import { LOG_FORMATS, presetSha256, replayLives } from '@owfpv/sim-core';
import type { ContactWorld, Life, LifeHeader, LifeSnapshot, PresetJson, ReplayDeps } from '@owfpv/sim-core';
import { levelSha256 } from '@owfpv/maps';
import type { Level } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { TrafficWorld, makeTraffic, worldSha256 } from '@owfpv/traffic';
import type { TrafficConfig } from '@owfpv/traffic';
import type { FlightSession } from './session';

/** The format of a saved flight; bump it when a field changes meaning. */
export const FLIGHT_FORMAT = 'owfpv-flight/1';

/** One life as saved: plain data, so IndexedDB, postMessage and JSON (with the records as base64) all carry it. */
export interface SavedLife {
    header: LifeHeader;
    /** the life's records (sim-core format /2 or /3: Int32 tick * 4 + kind, 8 Float32 each) */
    records: Uint8Array;
    endTick: number;
    /** sha256 of every state after hashFrom up to endTick: what a replay must give */
    traceHash: string | null;
    hashFrom: number | null;
    snapshot: LifeSnapshot | null;
}

export interface Flight {
    format: typeof FLIGHT_FORMAT;
    /** the page's visit: when it started, ms since 1970 (a name for the flight; nothing in the sim reads it) */
    id: number;
    /** the map flown, its version and the sim-core that flew it */
    mapId: string;
    mapVersion: number;
    simCore: string;
    /** the presets the lives used, by sha256 (a later edit of a preset must not change an old flight) */
    presets: Record<string, PresetJson>;
    /** the kept lives, oldest first (the runner keeps the last 30, 32 MiB at most) */
    lives: SavedLife[];
    /** the tick the first kept life starts at, and the last tick flown */
    startTick: number;
    endTick: number;
    /** golden props taken during this flight: [number, tick] */
    props: [number, number][];
}

/** What a list of flights shows, without the records. */
export interface FlightSummary {
    id: number;
    mapId: string;
    mapVersion: number;
    simCore: string;
    lives: number;
    seconds: number;
    bytes: number;
    props: number;
}

export function summary(f: Flight): FlightSummary {
    return {
        id: f.id, mapId: f.mapId, mapVersion: f.mapVersion, simCore: f.simCore, lives: f.lives.length,
        seconds: (f.endTick - f.startTick) / 1000, bytes: f.lives.reduce((a, l) => a + l.records.byteLength, 0), props: f.props.length
    };
}

/**
 * The session's run so far, as a flight. The current life is cut at the current tick with its hash so far; its
 * records are copied (the runner keeps writing into its own buffer). Needs a session built with traceHash on.
 */
export function captureFlight(session: FlightSession, id: number, props: [number, number][]): Flight {
    const r = session.runner;
    const lives = r.lives();
    const now = r.sim.tick;
    const live = r.liveLifeHash();
    const saved = lives.map((l, i): SavedLife => {
        const current = i === lives.length - 1;
        return {
            header: JSON.parse(JSON.stringify(l.header)) as LifeHeader,
            records: l.bytes().slice(),
            endTick: current ? now : l.endTick,
            traceHash: (current ? live?.hash : l.traceHash) ?? null,
            hashFrom: (current ? live?.from : l.hashFrom) ?? null,
            snapshot: l.snapshot ? (JSON.parse(JSON.stringify(l.snapshot)) as LifeSnapshot) : null
        };
    });
    const presets: Record<string, PresetJson> = { [presetSha256(session.preset)]: session.preset };
    return {
        format: FLIGHT_FORMAT, id, mapId: session.level.id, mapVersion: session.level.version, simCore: lives[0].header.simCore,
        presets, lives: saved, startTick: saved[0].snapshot?.tick ?? saved[0].header.life.startTick, endTick: now, props: props.slice()
    };
}

/** A saved life as sim-core's Life again. */
export function asLife(s: SavedLife): Life {
    const records = s.records;
    return {
        header: s.header, endTick: s.endTick, bytes: () => records,
        traceHash: s.traceHash ?? undefined, hashFrom: s.hashFrom ?? undefined, snapshot: s.snapshot ?? undefined
    };
}

/** Every combination of the traffic toggles, to find the one a header's collision hash was made with. */
const TRAFFIC_CONFIGS: TrafficConfig[] = [];
for (const cars of [false, true]) for (const people of [false, true]) for (const signals of [false, true]) TRAFFIC_CONFIGS.push({ cars, people, signals });

/** The collision for a life's header: the map's mesh, with its traffic rebuilt from the toggles its hash names. */
function worldFor(h: LifeHeader, level: Level, levelSha: string, mesh: MeshContactWorld): ContactWorld {
    const sha = h.collisionSha256;
    for (const c of TRAFFIC_CONFIGS) {
        if (worldSha256(levelSha, c) !== sha) continue;
        const t = makeTraffic(level, c);
        return t ? new TrafficWorld(mesh, t) : mesh;
    }
    throw new Error(`no collision of this build matches the flight's (${String(sha).slice(0, 12)}…): the map or traffic changed since`);
}

export interface CheckResult {
    ok: boolean;
    /** per life: replayed hash equals the saved one */
    lives: { index: number; ok: boolean; ticks: number }[];
    /** why it could not be replayed at all */
    problem: string | null;
}

/**
 * Replays each life on its own from its header and records, and compares its trace hash with the saved one. This is
 * the R5 check: if it passes, any grading run on the replay sees exactly the flight that was flown.
 */
export function checkFlight(flight: Flight, level: Level, mesh: MeshContactWorld = new MeshContactWorld(level.collision)): CheckResult {
    if (flight.format !== FLIGHT_FORMAT) return { ok: false, lives: [], problem: `unknown flight format ${String(flight.format)}` };
    const levelSha = levelSha256(level);
    const out: CheckResult = { ok: true, lives: [], problem: null };
    try {
        flight.lives.forEach((s, i) => {
            if (!LOG_FORMATS.includes(s.header.format)) throw new Error(`life ${i}: log format ${s.header.format} is not one this sim-core reads`);
            const world = worldFor(s.header, level, levelSha, mesh);
            const deps: ReplayDeps = {
                preset: (sha) => flight.presets[sha] ?? null,
                world: (scene) => {
                    if (!scene || scene.id !== level.id || scene.version !== level.version) {
                        throw new Error(`flown on ${scene ? `${scene.id} v${scene.version}` : 'no map'}; this build has ${level.id} v${level.version}`);
                    }
                    return world;
                }
            };
            const { hash } = replayLives([asLife(s)], deps);
            const ok = s.traceHash !== null && hash === s.traceHash;
            out.lives.push({ index: i, ok, ticks: s.endTick - (s.hashFrom ?? s.header.life.startTick) });
            if (!ok) out.ok = false;
        });
    } catch (e) {
        out.ok = false;
        out.problem = e instanceof Error ? e.message : String(e);
    }
    return out;
}

// ---------------------------------------------------------------- a flight as a file

/** A flight as JSON text, its records as base64, for a download or a bug report. */
export function flightToJson(f: Flight): string {
    return JSON.stringify({ ...f, lives: f.lives.map((l) => ({ ...l, records: toBase64(l.records) })) });
}

export function flightFromJson(text: string): Flight {
    const f = JSON.parse(text) as Omit<Flight, 'lives'> & { lives: (Omit<SavedLife, 'records'> & { records: string })[] };
    if (f.format !== FLIGHT_FORMAT) throw new Error(`not a saved flight (${String(f.format)})`);
    return { ...f, lives: f.lives.map((l) => ({ ...l, records: fromBase64(l.records) })) };
}

function toBase64(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
}

function fromBase64(s: string): Uint8Array {
    const t = atob(s);
    const b = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
    return b;
}
