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
import { TrafficWorld, makeTraffic, worldSha256 } from '@owfpv/traffic';
import type { TrafficConfig, TrafficModel } from '@owfpv/traffic';
import { SimClock } from './simclock';
import { Collector } from './collect';

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
    /** solid cars and people, and whether junctions have signals (default none) */
    traffic?: TrafficConfig;
}

const NO_TRAFFIC: TrafficConfig = { cars: false, people: false, signals: false };

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
    private overrides: ParamOverrides;
    private trafficCfg: TrafficConfig;
    /** the cars and people of the current life (null: none), and the collision the sim flies in */
    private trafficNow: TrafficModel | null = null;
    private contactWorld: ContactWorld;
    private spawnPt: SpawnPoint;
    private pose: [number, number, number, number];

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
        this.runner = new Runner(sim, this.header('start'), { runHash: o.runHash === true, traceHash: false });
        const p = sim.p;
        this.director = new RespawnDirector(o.policy ?? QUICK_RESPAWN, () => this.pose, new StateHistory({ margin: REWIND_MARGIN_M }), () => this.runner.sim.contactWorld, p.boundRadius, hoverStickOf(p));
        this.runner.director = this.director;
        this.collector = new Collector(o.level.collectibles);
        const c = this.collector;
        this.runner.onStep = (s) => c.check(s.s[S.px], s.s[S.py], s.s[S.pz]);
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

    get trafficConfig(): TrafficConfig {
        return { ...this.trafficCfg };
    }

    private buildWorld(): ContactWorld {
        const c = this.trafficCfg;
        this.trafficNow = makeTraffic(this.level, c);
        return this.trafficNow ? new TrafficWorld(this.world, this.trafficNow) : this.world;
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

    /** A new spawn point: it becomes the start, and the craft goes there now. */
    setSpawn(s: SpawnPoint): void {
        this.spawnPt = s;
        this.pose = this.poseOf(s, this.sim);
        this.director.request('start');
    }

    /** New flight-model settings (rates, ...): a new life on a model built from them, in place. */
    setOverrides(o: ParamOverrides): void {
        this.overrides = JSON.parse(JSON.stringify(o)) as ParamOverrides;
        const sim = lifeSim(compileParams(this.preset, this.overrides), this.contactWorld);
        // the new model starts at the spawn point: settings change in the menu, between flights
        this.runner.newLife(sim, this.header('settings'));
    }

    /**
     * Cars, people or signals on or off: they are solid, so the collision changes, and with it the life
     * header's collision hash. A new life at the spawn point, as for the flight settings.
     */
    setTraffic(c: TrafficConfig): void {
        const o = this.trafficCfg;
        if (c.cars === o.cars && c.people === o.people && c.signals === o.signals) return;
        this.trafficCfg = { cars: c.cars, people: c.people, signals: c.signals };
        this.contactWorld = this.buildWorld();
        const sim = lifeSim(compileParams(this.preset, this.overrides), this.contactWorld);
        this.runner.newLife(sim, this.header('settings'));
    }
}
