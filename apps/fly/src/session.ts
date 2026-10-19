// One flight in one level: sim-core's lives runner, the respawn director and the page clock. No DOM,
// so the Node tests fly exactly what the page flies.
//
// Determinism (CLAUDE.md): the page only hands in stick channels with their page timestamps and asks
// for respawns; the runner applies both at tick boundaries and logs them. Rendering reads the state.

import {
    DEFAULT_RESPAWN_POLICY, RespawnDirector, Runner, S, SIM_CORE_VERSION, StateHistory,
    compileParams, hoverStickOf, lifeSim, makeLifeHeader
} from '@owfpv/sim-core';
import type { ContactWorld, ParamOverrides, PresetJson, RespawnPolicy, Sim } from '@owfpv/sim-core';
import { levelSha256, spawnPose } from '@owfpv/maps';
import type { Level, SpawnPoint } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { TrafficWorld, TrainWorld, makeTraffic, makeTrains, worldSha256 } from '@owfpv/traffic';
import type { TrafficConfig, TrafficModel, Train } from '@owfpv/traffic';
import { SimClock } from './simclock';
import { Collector } from './collect';
import { TrialRunner } from './trials';
import type { Pose } from './trials';

/**
 * SPEC.md 4.2, to prototype: after a crash, respawn quickly where you were. 1 s after the crash the
 * craft goes 2 s back along the path it flew (sim-core's rewind), on its invisible platform, still
 * armed if the arm switch is on. Upstream's defaults are 2 s and 5 s; the shorter values are a first
 * guess at "quick, where you are", to be settled by playtesting (M3). No automatic rewind of a craft lying on its
 * back (flipped: false): turtle mode or R gets it going (owner, 2026-10-17).
 */
export const QUICK_RESPAWN: RespawnPolicy = { ...DEFAULT_RESPAWN_POLICY, delayTicks: 1000, rewindTicks: 2000, flipped: false };

/**
 * Room a rewind spot needs beyond the craft's bounding radius, m. sim-core's default (0.05) suits open
 * scans; in the bando it put a 5-inch quad 25 cm under a slab, where any throttle hits the ceiling
 * again (owner's flight, 2026-10-17). 0.5 m (0.69 m from the centre for the Nazgul) leaves room to
 * climb off the platform; spots in tight gaps are skipped for older, roomier ones.
 */
export const REWIND_MARGIN_M = 0.5;

export interface SessionOptions {
    preset: PresetJson;
    overrides?: ParamOverrides;
    level: Level;
    /** the level's collision, built once and shared (it is stateless) */
    world?: MeshContactWorld;
    spawn?: SpawnPoint;
    policy?: RespawnPolicy;
    /** hash every tick's state (determinism checks) */
    runHash?: boolean;
    /** hash every tick's state per life, so a saved flight can be checked by replaying it (flights.ts) */
    traceHash?: boolean;
    /** solid cars and people, whether junctions have signals, and the train (default none) */
    traffic?: TrafficConfig;
}

const NO_TRAFFIC: TrafficConfig = { cars: false, people: false, signals: false };

/** The collision the sim flies in: the level's mesh, with the cars and people (or null) and the trains moving in it. */
export function worldWith(mesh: ContactWorld, traffic: TrafficModel | null, trains: readonly Train[]): ContactWorld {
    let w = traffic ? new TrafficWorld(mesh, traffic) : mesh;
    for (const t of trains) w = new TrainWorld(w, t);
    return w;
}

export class FlightSession {
    readonly level: Level;
    /** the level's static collision (rays for spawn heights) */
    readonly world: MeshContactWorld;
    readonly preset: PresetJson;
    readonly runner: Runner;
    readonly director: RespawnDirector;
    readonly clock = new SimClock();
    readonly levelSha256: string;
    /** the golden props: checked after every sim step, so a replay takes them on the same ticks */
    readonly collector: Collector;
    /** the time trials: checked after every sim step, like the props */
    readonly trials: TrialRunner;
    /** per prop, the hardest blade strike since takeStrikes (brake share x rotor speed share): read by the sound only */
    private readonly strikes = new Float64Array(4);
    private overrides: ParamOverrides;
    private trafficCfg: TrafficConfig;
    /** the cars and people of the current life (null: none), and the collision the sim flies in */
    private trafficNow: TrafficModel | null = null;
    private trainsNow: Train[] = [];
    private contactWorld: ContactWorld;
    private spawnPt: SpawnPoint;
    private pose: [number, number, number, number];
    /** a time trial's pad while one is being raced: where a respawn to the start goes then (null: the start point) */
    private padPose: Pose | null = null;

    constructor(o: SessionOptions) {
        this.level = o.level;
        this.world = o.world ?? new MeshContactWorld(o.level.collision);
        this.preset = o.preset;
        this.overrides = o.overrides ?? {};
        this.levelSha256 = levelSha256(o.level);
        this.spawnPt = o.spawn ?? o.level.spawns[0];
        this.trafficCfg = { ...(o.traffic ?? NO_TRAFFIC) };
        this.contactWorld = this.buildWorld();
        const sim = lifeSim(compileParams(this.preset, this.overrides), this.contactWorld);
        this.pose = this.poseOf(this.spawnPt, sim);
        this.runner = new Runner(sim, this.header('start'), { runHash: o.runHash === true, traceHash: o.traceHash === true });
        const p = sim.p;
        this.director = new RespawnDirector(o.policy ?? QUICK_RESPAWN, () => this.padPose ?? this.pose, new StateHistory({ margin: REWIND_MARGIN_M }), () => this.runner.sim.contactWorld, p.boundRadius, hoverStickOf(p));
        this.runner.director = this.director;
        this.collector = new Collector(o.level.collectibles);
        this.trials = new TrialRunner(o.level.trials, (pose) => this.onPad(pose), p.bodyBottom);
        const c = this.collector, t = this.trials, k = this.strikes;
        this.runner.onStep = (s) => {
            c.check(s.s[S.px], s.s[S.py], s.s[S.pz], s.tick);
            t.step(s.s, s.tick);
            // the hardest blade strike on each prop since the sound last asked (audio/frame.ts): brake x rotor speed
            for (let i = 0; i < 4; i++) {
                const b = s.bladeBrake(i);
                if (b === 0) continue;
                const m = s.s[S.m0 + i], v = b * (m < 0 ? -m : m);
                if (v > k[i]) k[i] = v;
            }
        };
    }

    /** The hardest blade strike on each prop since the last call (0 none, up to 1: full brake at full speed), into out. */
    takeStrikes(out: Float32Array, at = 0): void {
        const k = this.strikes;
        for (let i = 0; i < 4; i++) {
            out[at + i] = k[i];
            k[i] = 0;
        }
    }

    get sim(): Sim {
        return this.runner.sim;
    }

    /** What the collision hash in each life header is: the level's, with the traffic folded in. */
    get collisionSha256(): string {
        return worldSha256(this.levelSha256, this.trafficCfg);
    }

    /** The cars and people moving in the current life, null when there are none. */
    get traffic(): TrafficModel | null {
        return this.trafficNow;
    }

    /** The trains running in the current life (none when they are off). */
    get trains(): readonly Train[] {
        return this.trainsNow;
    }

    /** The first train, null when they are off. */
    get train(): Train | null {
        return this.trainsNow[0] ?? null;
    }

    get trafficConfig(): TrafficConfig {
        return { ...this.trafficCfg };
    }

    private buildWorld(): ContactWorld {
        const c = this.trafficCfg;
        this.trafficNow = makeTraffic(this.level, c);
        this.trainsNow = makeTrains(this.level, c.train);
        return worldWith(this.world, this.trafficNow, this.trainsNow);
    }

    get spawn(): SpawnPoint {
        return this.spawnPt;
    }

    /** Height of the first surface straight down at x, z (the ground when nothing is there). */
    groundY(x: number, z: number): number {
        const hit = this.world.queryRay(x, 1000, z, 0, -1, 0, 2000);
        return hit ? hit.y : 0;
    }

    private poseOf(s: SpawnPoint, sim: Sim): [number, number, number, number] {
        return spawnPose(s, (x, z) => this.groundY(x, z), sim.p.bodyBottom);
    }

    private header(reason: 'start' | 'settings') {
        return makeLifeHeader({
            simCore: SIM_CORE_VERSION,
            preset: this.preset,
            overrides: this.overrides,
            collisionSha256: this.collisionSha256,
            scene: { id: this.level.id, version: this.level.version, transform: [1, 0, 0, 0], floaterMinBlocks: 0 },
            at: this.pose,
            opts: { platform: true },
            reason
        });
    }

    /** A stick frame (sim-core channels) with its page time, ms. */
    input(ch: ArrayLike<number>, tMs: number): void {
        this.clock.push(ch, tMs);
    }

    /** Step the physics up to page time `nowMs`. */
    advance(nowMs: number): void {
        this.clock.advance(this.runner, nowMs);
    }

    pause(on: boolean, nowMs: number): void {
        this.clock.pause(on, nowMs);
    }

    get paused(): boolean {
        return this.clock.paused;
    }

    /** Back to the spawn point at the next tick (the radio's reset switch, the R key). */
    resetToSpawn(): void {
        this.director.request('start');
    }

    /** A time trial sets the quad down on its pad (a respawn to the start, logged as any other), or is over (null). */
    private onPad(pose: Pose | null): void {
        this.padPose = pose;
        if (pose) this.director.request('start');
    }

    /** A new spawn point: it becomes the start, and the craft goes there now. */
    setSpawn(s: SpawnPoint): void {
        this.trials.quit();
        this.spawnPt = s;
        this.pose = this.poseOf(s, this.sim);
        this.director.request('start');
    }

    /** New flight-model settings (rates, ...): a new life on a model built from them, in place. */
    setOverrides(o: ParamOverrides): void {
        this.trials.quit();
        this.overrides = JSON.parse(JSON.stringify(o)) as ParamOverrides;
        const sim = lifeSim(compileParams(this.preset, this.overrides), this.contactWorld);
        // the new model starts at the spawn point: settings change in the menu, between flights
        this.runner.newLife(sim, this.header('settings'));
    }

    /**
     * Cars, people, signals or the train on or off: they are solid, so the collision changes, and with it the life
     * header's collision hash. A new life at the spawn point, as for the flight settings.
     */
    setTraffic(c: TrafficConfig): void {
        const o = this.trafficCfg;
        if (c.cars === o.cars && c.people === o.people && c.signals === o.signals && !c.train === !o.train) return;
        this.trials.quit();
        this.trafficCfg = { cars: c.cars, people: c.people, signals: c.signals, train: c.train === true };

        this.contactWorld = this.buildWorld();
        const sim = lifeSim(compileParams(this.preset, this.overrides), this.contactWorld);
        this.runner.newLife(sim, this.header('settings'));
    }
}
