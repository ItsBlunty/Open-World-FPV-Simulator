// Determinism check on the real map: a scripted flight (sticks from + - * / of the tick only, no
// Math functions, so every engine makes the same sticks) through the runner and the respawn
// director, hashing every tick's state. The Node test pins the hash; the page runs the same flight
// with ?selftest and shows its hash, so Node and each browser can be compared (HANDOFF.md: the
// Node-vs-Chrome check with mesh collision).

import { FlightSession } from './session';
import type { PresetJson } from '@owfpv/sim-core';
import type { Level } from '@owfpv/maps';

export const SELFTEST_TICKS = 20000;
/** The hash Node computes (test/selftest.test.ts); the page shows whether its own run matches. */
export const SELFTEST_HASH = '5115a73f6756f7a749a39887997f45ba2e62346866ee7e225159ab623d0fccda';

/** Sticks at tick t: arm, climb, fly north, dive into the ground, fly on after the respawn. */
export function selftestSticks(t: number, out: Float32Array): Float32Array {
    out.fill(0);
    const p = t % 8000; // the same 8 s pattern again after the respawn
    out[2] = -1;
    out[4] = t >= 200 ? 1 : -1;
    out[5] = -1; // acro
    if (t < 400) return out;
    if (p < 1400) out[2] = 0.3;
    else if (p < 3000) {
        out[2] = 0.05;
        out[1] = 0.12;
        out[0] = (p - 2200) / 4000; // a slow roll right and back
    } else if (p < 3600) {
        out[2] = -0.6;
        out[1] = 0.5; // nose down, into the ground
    } else {
        out[2] = -1;
    }
    return out;
}

export interface SelftestResult {
    hash: string;
    crashes: number;
    contacts: number;
    respawns: number;
    end: [number, number, number];
}

export function runSelftest(preset: PresetJson, level: Level): SelftestResult {
    const s = new FlightSession({ preset, level, runHash: true });
    const r = s.runner;
    const ch = new Float32Array(8);
    while (r.sim.tick < SELFTEST_TICKS) {
        const t = r.sim.tick;
        if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: selftestSticks(t, ch) });
        r.stepOnce();
    }
    let crashes = 0, contacts = 0, respawns = 0;
    for (const e of r.events) {
        if (e.type === 'crash') crashes++;
        else if (e.type === 'contact') contacts++;
        else if (e.type === 'respawn') respawns++;
    }
    const st = r.sim.s;
    return { hash: r.traceHash(), crashes, contacts, respawns, end: [st[0], st[1], st[2]] };
}
