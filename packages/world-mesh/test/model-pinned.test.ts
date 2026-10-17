// Ported from ShramkoGSFPV packages/sim-core/test/model-pinned.test.ts (MIT, Andrii Shramko;
// see packages/sim-core/UPSTREAM.md). Upstream flew it on the 39e63ce9 voxel scan; here it flies in
// the mesh test room (room.ts), through MeshContactWorld. Changes from upstream are marked "port:".
//
// Upstream's description: a craft pinned in a corner (sim.ts pinnedContacts). Root cause of
// accept-fly B12's negative control failing since wave 1: the bot's slow dash (0.5 x v_bounce =
// 0.75 m/s) into a wall on scene 39e63ce9 slid down the wall into a corner, where one duct grazing a
// slanted face won the sweep at t = 1e-12 every tick. The whole tick's motion was undone, but only
// that duct got an impulse, so the thrust driving two other ducts into the wall was never resolved:
// the pose froze while the speed grew to 8 m/s and the spin to 97 rad/s, and a "crash" at 6.1 m/s
// ended a touch that never moved faster than 0.75 m/s. Upstream's control, the single-impulse rule
// (Sim.pinnedPass false), was removed with that rule: sim-core/0.3.0 solves every contact of a tick
// together (sim.ts contactsAt), so there is no pinned pass to switch off.

import { describe, expect, it } from 'vitest';
import { InputLog, Runner, S, Sim, compileParams, hoverSolve } from '@owfpv/sim-core';
import type { SimEvent } from '@owfpv/sim-core';
import { Scenario, makePlan } from '@owfpv/sim-core/bot';
// test-only import of sim-core's test kit (the preset)
import { PRESET } from '../../sim-core/test/log-kit';
import { SPAWN, TARGET, room } from './room';

interface Run {
    crashes: Extract<SimEvent, { type: 'crash' }>[];
    contacts: number;
    /** longest run of ticks with the position moving under 1 um per tick while flying, and the speed at its end */
    frozenTicks: number;
    frozenSpeed: number;
    /** largest speed while not crashed, m/s */
    maxSpeed: number;
    minUpY: number;
}

/** accept-fly B12's control flight: the session's spawn, makePlan, respawn at the plan spawn, Scenario with a 0.75 m/s dash. */
function slowDash(): Run {
    const p = compileParams(PRESET, {});
    // port: the mesh room; its spawn is free, so upstream's findSphereSpawn fallback is not needed
    const world = room();
    const pos = [...SPAWN];
    const sim = new Sim(p, world);
    sim.reset(pos[0], pos[1], pos[2], 0);
    sim.hoverThr = hoverSolve(p, 1).motor;
    const runner = new Runner(sim, new InputLog({ format: 'gsfpv-input-log/1', simCore: 'test', preset: PRESET.id, configHash: '', collisionSha256: null, spawn: [pos[0], pos[1], pos[2], 0], seed: 0 }));
    const plan = makePlan(world, p.boundRadius, pos, TARGET, 0.5 * p.vBounce);
    runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    const sc = new Scenario(runner, plan);
    // the dash reference of wave 1 (it ran on with the clock and pressed the craft ever harder into
    // the wall): the flight that found the pinned corner. The bot now restarts a held-back dash
    // (b12-rewind.test.ts), which no longer drives the craft into that corner.
    sc.bot.dashLeadS = Infinity;
    const run: Run = { crashes: [], contacts: 0, frozenTicks: 0, frozenSpeed: 0, maxSpeed: 0, minUpY: 1 };
    let last = [NaN, NaN, NaN];
    let frozen = 0;
    const prev = runner.onStep;
    runner.onStep = (x) => {
        prev?.(x);
        const s = x.s;
        if (s[S.crashed] > 0 || s[S.armed] === 0) { frozen = 0; return; }
        const v = Math.hypot(s[S.vx], s[S.vy], s[S.vz]);
        run.maxSpeed = Math.max(run.maxSpeed, v);
        run.minUpY = Math.min(run.minUpY, 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]));
        // a pinned tick still moves the pose by t = 1e-12 of its path: under a micrometre is frozen
        if (Math.hypot(s[S.px] - last[0], s[S.py] - last[1], s[S.pz] - last[2]) < 1e-6) {
            frozen++;
            if (frozen > run.frozenTicks) { run.frozenTicks = frozen; run.frozenSpeed = v; }
        } else frozen = 0;
        last = [s[S.px], s[S.py], s[S.pz]];
    };
    let seen = 0;
    for (let t = 16667; !sc.finished && sim.tick < 40000; t += 16667) {
        runner.advanceTo(t);
        for (; seen < runner.events.length; seen++) {
            const e = runner.events[seen];
            if (e.type === 'crash') run.crashes.push(e);
            else if (e.type === 'contact') run.contacts++;
        }
    }
    return run;
}

describe('a craft pinned in a corner (B12 control, root cause)', () => {
    it('the slow dash touches the wall, tumbles against it like v0.2 and never crashes; no frozen pose gathers speed', () => {
        const r = slowDash();
        // it touches (upstream counted > 100 contact events; since sim-core/0.3.0 a contact pressed by the thrust is no
        // impact, so only the touches themselves are events)
        expect(r.contacts).toBeGreaterThan(0);
        expect(r.crashes).toHaveLength(0);
        // it presses on into the wall like v0.2's craft (up-vector y -0.38 there): the control below is not a gentler flight
        expect(r.minUpY).toBeLessThan(0);
        // it may sit wedged, but a pose that does not move does not gather speed
        expect(r.frozenTicks === 0 || r.frozenSpeed < 1).toBe(true);
        expect(r.maxSpeed).toBeLessThan(2);
    });
});
