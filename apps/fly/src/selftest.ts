// Determinism check on the real map: a scripted flight (sticks from + - * / of the tick only, no
// Math functions, so every engine makes the same sticks) through the runner and the respawn
// director, hashing every tick's state. The Node test pins the hash; the page runs the same flight
// with ?selftest and shows its hash, so Node and each browser can be compared (docs/notes/foundation.md: the
// Node-vs-Chrome check with mesh collision).

import { FlightSession } from './session';
import { Sha256 } from '@owfpv/sim-core';
import type { ParamOverrides, PresetJson } from '@owfpv/sim-core';
import type { Level } from '@owfpv/maps';
import { Train, makeTraffic, newTrainPlace } from '@owfpv/traffic';
import type { Place } from '@owfpv/traffic';

export const SELFTEST_TICKS = 20000;
/** The hash Node computes (test/selftest.test.ts); the page shows whether its own run matches. */
export const SELFTEST_HASH = 'af127b885c55f08344cd1e7c036b7a30691a6bae56754111fa23ee1e48ac6d59';
/**
 * The same flight with classic physics (sim-core/0.6.0 classicPhysics): it must keep the hash every earlier
 * sim-core (0.5.0) gave, which proves the classic model is the old one bit for bit.
 */
export const CLASSIC_SELFTEST_HASH = 'cd45c59c63f9faf4f70770311685dd75b34b6dacde7379bf206de6f1c25ea8ef';

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

/**
 * ?demo=tricks (and the grader's replay test): arm, then every 6 s climb for 1 s, a back flip and a roll right at
 * low throttle (sticks from + - * / of the tick only), so a demo flight has tricks for the grader to find.
 */
export function demoTrickSticks(t: number, out: Float32Array): Float32Array {
    out.fill(0);
    out[4] = t >= 200 ? 1 : -1;
    out[5] = -1; // acro
    if (t < 400) { out[2] = -1; return out; }
    const p = (t - 400) % 6000;
    out[2] = p < 1000 ? 0 : -0.5;
    if (p >= 2600 && p < 3130) { out[1] = -1; out[2] = -0.9; }
    if (p >= 4600 && p < 5130) { out[0] = 1; out[2] = -0.6; }
    return out;
}

export interface SelftestResult {
    hash: string;
    crashes: number;
    contacts: number;
    respawns: number;
    end: [number, number, number];
}

export function runSelftest(preset: PresetJson, level: Level, overrides: ParamOverrides = {}): SelftestResult {
    const s = new FlightSession({ preset, level, runHash: true, overrides });
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

/** The hash Node computes for the traffic (test/selftest.test.ts); the page shows whether its own matches. */
export const TRAFFIC_HASH = '226587dba05f677c85a6fc2f8fdff902a45b48a56bafb7896b2221cdb32d60b4';

/**
 * Traffic determinism: every mover's place (x, y, z, heading) at a tick every 0.5 s for 2 min, for the loops
 * and for the signalled network (cars, people and lamps), and the network again after going back to 75 s (its
 * checkpoint restart), then the train's five vehicles (place and frame) at the same ticks, up its climb, and into the city station (from 200 s). The
 * flight above has no traffic; this checks the traffic engines' arithmetic.
 */
export function runTrafficSelftest(level: Level): string {
    const h = new Sha256();
    const p: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    const buf = new Float64Array(5);
    const bytes = new Uint8Array(buf.buffer);
    const lamp = new Uint8Array(1);
    const LAMPS = { red: 0, yellow: 1, green: 2, walk: 3, flash: 4, stop: 5 } as const;
    for (const signals of [false, true]) {
        const t = makeTraffic(level, { cars: true, people: true, signals })!;
        for (const tick of [...Array.from({ length: 240 }, (_, k) => k * 500 + 7), 75007, 75507]) {
            t.at(tick);
            for (let i = 0; i < t.movers.length; i++) {
                t.place(i, tick, p);
                buf[0] = p.x; buf[1] = p.y; buf[2] = p.z; buf[3] = p.hx; buf[4] = p.hz;
                h.update(bytes);
            }
            for (let k = 0; k < t.signals.length; k++) {
                lamp[0] = LAMPS[t.lamp(k, tick)];
                h.update(lamp);
            }
        }
    }
    const train = new Train(level);
    const tp = newTrainPlace();
    const tb = new Float64Array(4);
    const tbytes = new Uint8Array(tb.buffer);
    for (const tick of [...Array.from({ length: 240 }, (_, k) => k * 500 + 7), ...Array.from({ length: 100 }, (_, k) => 200000 + k * 97)]) {
        for (let i = 0; i < train.vehicles.length; i++) {
            train.place(i, tick, tp);
            buf[0] = tp.x; buf[1] = tp.y; buf[2] = tp.z; buf[3] = tp.hx; buf[4] = tp.hz;
            h.update(bytes);
            tb[0] = tp.fx; tb[1] = tp.fy; tb[2] = tp.fz; tb[3] = tp.uy;
            h.update(tbytes);
        }
    }
    return h.digestHex();
}
