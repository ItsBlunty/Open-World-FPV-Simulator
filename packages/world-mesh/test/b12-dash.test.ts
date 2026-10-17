// Ported from ShramkoGSFPV packages/sim-core/test/b12-rewind.test.ts (MIT, Andrii Shramko; see
// packages/sim-core/UPSTREAM.md). Upstream flew it on the 39e63ce9 voxel scan; here it flies in the
// mesh test room (room.ts), through MeshContactWorld. Changes from upstream are marked "port:".
//
// port: upstream's first two tests replay a flight log recorded in Chrome on the scan
// (fixtures/b12-control-chrome-life.json) and fly its last life again tick for tick. A recording
// replays only on the world it was flown in, so the replay is not ported and the fixture is removed.
// Its starting state is: the rewind (REWIND below, copied from the recording) is flown again here
// closed loop, with and without the bot's fix. The room's wall is where the scan's was (x = -5.2).
// The whole flight is ported too, but in the mesh room it never reaches that rewind (see there).
//
// Upstream's description:
// accept-fly B12's negative control in the browser (wave 2, after model-pinned.test.ts): the bot's
// 0.75 m/s dash into a wall on scene 39e63ce9 still ended in a crash in system Chrome. The page's
// own flight log (fixtures/b12-control-chrome-life.json, its last life) replays here bit for bit
// and shows why. The flight model is not at fault:
//  1. the slow touch (0.75 m/s, tick 16770 of that flight) did not crash; the craft tumbled
//     against the wall and slid down it on its side for 6 s, as v0.2's craft did (up-vector y -0.38);
//  2. the page's respawn director (set.respawn.auto=0 turns off the crash respawn only; unstuck
//     stays on) saw it flipped and still for 1.5 s and rewound it 5 s along its path: level, at
//     rest, armed, 0.41 m before the same wall (tick 22810);
//  3. the bot's dash reference ran on with the clock: 10 m past the wall by then. kp x 10 m hit the
//     acceleration cap, so it sent full throttle and full forward pitch, tilted the craft 75 deg and
//     flew it into the wall at 3.2 m/s; the bounce spun it to 68 rad/s and a duct hit at 5.2 m/s:
//     a crash (tick 23092).
// The Node model of B12 (v03-respawn-model.ts, model-pinned.test.ts) runs without the director,
// so it never saw step 2. Fix in the bot (input/src/sim/bot.ts): a dash reference never leads the
// craft by more than max(0.5 m, 0.5 s x speed); a craft held back restarts the dash from where it
// is. Control: bot.dashLeadS = Infinity, the reference before the fix.

import { describe, expect, it } from 'vitest';
import { InputLog, Runner, S, Sim, compileParams, hoverSolve, lifeSim, normalizeRespawnOpts } from '@owfpv/sim-core';
import type { BotTask } from '@owfpv/sim-core/bot';
import type { SimEvent } from '@owfpv/sim-core';
import { BotPilot, Scenario, makePlan } from '@owfpv/sim-core/bot';
// test-only import of sim-core's test kit (the preset, the page's director wiring)
import { PRESET, attachDirector } from '../../sim-core/test/log-kit';
import { SPAWN, TARGET, room } from './room';

type Crash = Extract<SimEvent, { type: 'crash' }>;

/** B12's flight as the page flies it: makePlan + Scenario, and the page's director with respawn.auto off. */
function b12(dash: 'control' | 'crash', leadS: number): { crashes: Crash[]; contacts: number; rewinds: string[]; restarts: number } {
    const p = compileParams(PRESET, {});
    // port: the mesh room; its spawn is free, so upstream's findSphereSpawn fallback is not needed
    const world = room();
    const pos = [...SPAWN];
    const sim = new Sim(p, world);
    sim.reset(pos[0], pos[1], pos[2], 0);
    sim.hoverThr = hoverSolve(p, 1).motor;
    const runner = new Runner(sim, new InputLog({ format: 'gsfpv-input-log/1', simCore: 'test', preset: PRESET.id, configHash: '', collisionSha256: null, spawn: [pos[0], pos[1], pos[2], 0], seed: 0 }));
    const plan = makePlan(world, p.boundRadius, pos, TARGET, dash === 'control' ? 0.5 * p.vBounce : 2 * p.vCrash);
    runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    const d = attachDirector(runner, [plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg], { auto: false });
    const sc = new Scenario(runner, plan);
    sc.bot.dashLeadS = leadS;
    const out = { crashes: [] as Crash[], contacts: 0, rewinds: [] as string[], restarts: 0 };
    let seen = 0;
    let lastDecision: unknown = null;
    for (let t = 16667; !sc.finished && sim.tick < 40000; t += 16667) {
        runner.advanceTo(t);
        if (d.last && d.last !== lastDecision) { lastDecision = d.last; out.rewinds.push(d.last.reason); }
        for (; seen < runner.events.length; seen++) {
            const e = runner.events[seen];
            if (e.type === 'crash') out.crashes.push(e);
            else if (e.type === 'contact') out.contacts++;
        }
    }
    out.restarts = sc.bot.dashRestarts;
    return out;
}

/**
 * port: the state the recorded life started from (fixtures/b12-control-chrome-life.json, its life 2):
 * the director's stuck-flipped rewind at tick 22810, at rest 0.41 m before the wall, armed on the
 * platform, and the bot's 0.75 m/s dash task, begun at tick 8860.
 */
const REWIND = {
    startTick: 22810,
    at: [-4.7917399406433105, 1.5853253602981567, 0.70076584815979, -90] as [number, number, number, number],
    opts: { platform: true, keepArmed: true },
    soc: 0.9192576515543869,
    ch: [0.4286045730113983, -0.7230724692344666, 0.5514329671859741, 0.2844143211841583, 1, -1, 0, 0],
    dash: { kind: 'dash', from: [0.6900143756212824, 1.5819922606740981, 0.7007658693042722], dir: [-1, 0, 1.8369701987210297e-16], speed: 0.75, yawDeg: 270 } as BotTask,
    dashT0: 8860
};

/**
 * Upstream's flyRecordedLife, from REWIND instead of the recording: the bot on the same dash task
 * and clock, its sticks every 4 ticks as the Scenario sends them (float32, as the runner applies
 * them), for 3 s or until a crash comes to rest.
 */
function flyRewind(leadS: number): { crashes: Crash[]; contacts: number; restarts: number } {
    const sim = lifeSim(compileParams(PRESET, {}), room());
    sim.tick = REWIND.startTick;
    sim.setChannels(REWIND.ch);
    sim.respawn(REWIND.at[0], REWIND.at[1], REWIND.at[2], REWIND.at[3], { ...normalizeRespawnOpts(REWIND.opts), soc: REWIND.soc });
    const bot = new BotPilot(sim.p);
    bot.setTask(REWIND.dash, sim);
    // the dash began 14 s before this life (scenario phase 'dash'); the bot's clock runs from there
    (bot as unknown as { dashT0: number }).dashT0 = REWIND.dashT0;
    bot.dashLeadS = leadS;
    const out = { crashes: [] as Crash[], contacts: 0, restarts: 0 };
    while (sim.tick < REWIND.startTick + 3000) {
        const n = sim.events.length;
        sim.step();
        for (let i = n; i < sim.events.length; i++) {
            const e = sim.events[i];
            if (e.type === 'crash') out.crashes.push(e);
            else if (e.type === 'contact') out.contacts++;
        }
        if (sim.tick % 4 === 0 && sim.s[S.crashed] < 2) sim.setChannels(Float32Array.from(bot.update(sim)));
    }
    out.restarts = bot.dashRestarts;
    return out;
}

describe("B12 in the mesh room: the bot's dash-lead fix", () => {
    it('from the rewind 0.41 m before the wall: the old reference flies full throttle into the wall and crashes; the fixed bot restarts its dash and touches it without a crash', () => {
        const vCrash = compileParams(PRESET, {}).vCrash;
        const fixed = flyRewind(0.5);
        expect(fixed.crashes).toHaveLength(0);
        expect(fixed.contacts).toBeGreaterThan(0);
        expect(fixed.restarts).toBeGreaterThan(0);

        const old = flyRewind(Infinity);
        expect(old.restarts).toBe(0);
        expect(old.crashes).toHaveLength(1);
        expect(old.crashes[0].speed).toBeGreaterThan(vCrash);
        console.log(`from the rewind: fixed ${fixed.contacts} contacts, ${fixed.restarts} restarts, no crash; old reference crashes at ${old.crashes[0].speed.toFixed(2)} m/s (recorded on the scan: 5.21 m/s)`);
    });

    // port: in the mesh room the slow dash never reaches the rewind. Upstream's craft slid down the
    // scan's wall on its side for 6 s and then lay still, flipped, for 1.5 s: a stuck-flipped rewind,
    // after which the old reference crashed. Here the bot holds the craft against the flat wall while it
    // slides down for about 8.5 s, rocking (tilt rate 0.2-2.5 rad/s, never still for 1.5 s), and the
    // Scenario ends the dash after 16 s, as it reaches the floor. So both bots touch without a crash
    // here; the rewind itself is flown from its recorded state in the test above.
    it("the whole control flight with the page's director: the slow dash touches the wall and slides down it without a crash, with either bot (port: no rewind in the mesh room)", () => {
        const fixed = b12('control', 0.5);
        console.log(`whole slow dash: fixed ${fixed.contacts} contacts, rewinds [${fixed.rewinds}], ${fixed.restarts} restarts`);
        expect(fixed.contacts).toBeGreaterThan(100);
        expect(fixed.crashes).toHaveLength(0);
        expect(fixed.rewinds).toEqual([]);

        const old = b12('control', Infinity);
        console.log(`whole slow dash: old ${old.contacts} contacts, rewinds [${old.rewinds}], crashes ${old.crashes.map((c) => c.speed.toFixed(2))}`);
        expect(old.contacts).toBeGreaterThan(100);
        expect(old.crashes).toHaveLength(0);
        expect(old.rewinds).toEqual([]);
    });

    it("B12's first half is untouched: the 8 m/s dash never restarts and crashes exactly as before, at >= 1.9 v_crash", () => {
        const vCrash = compileParams(PRESET, {}).vCrash;
        const fixed = b12('crash', 0.5);
        const old = b12('crash', Infinity);
        expect(fixed.restarts).toBe(0);
        expect(fixed.crashes).toHaveLength(1);
        expect(fixed.crashes[0].speed).toBeGreaterThanOrEqual(1.9 * vCrash);
        expect(fixed.crashes[0]).toEqual(old.crashes[0]);
    });
});
