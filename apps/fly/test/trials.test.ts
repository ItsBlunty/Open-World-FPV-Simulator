// Time trials (owner, 2026-10-19): rest 3 s on the pad to be offered the race; accept and the quad is set down on the
// pad for a 3 s countdown, leaving it early is a false start; then the gates in order and the time, all on sim ticks,
// and the race changes nothing in the flight but the logged respawns onto the pad (so a saved flight still replays).

import { describe, expect, it } from 'vitest';
import { LevelBuilder } from '@owfpv/maps';
import type { Gate, Level, TimeTrial } from '@owfpv/maps';
import { S } from '@owfpv/sim-core';
import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { COUNTDOWN_TICKS, PAD_HOLD_TICKS, THROTTLE_DOWN, TrialRunner, crosses } from '../src/trials';
import type { Pose, TrialEvent } from '../src/trials';
import { FlightSession } from '../src/session';
import { selftestSticks } from '../src/selftest';
import { checkFlight, captureFlight } from '../src/flights';
import { courseKey, formatDelta, formatTime, parseTrialTimes, recordRun } from '../src/trial-times';
import { StickHold, stickAnswer, stickHint } from '../src/ui/trial-prompt';

const preset = nazgul as unknown as PresetJson;
const gate = (x: number, y: number, z: number, nx: number, ny: number, nz: number, hw = 1, hh = 1, name = `g${x},${y},${z}`): Gate => ({ x, y, z, nx, ny, nz, hw, hh, name });

describe('gate crossing', () => {
    const g = gate(0, 2, -10, 0, 0, 1, 1.5, 1);
    it('counts a step through the opening either way, not beside it or short of it', () => {
        expect(crosses(g, 0, 2, -9.9, 0, 2, -10.1)).toBe(true);
        expect(crosses(g, 0, 2, -10.1, 0, 2, -9.9)).toBe(true);
        expect(crosses(g, 1.4, 2.9, -9.9, 1.4, 2.9, -10.1)).toBe(true);
        expect(crosses(g, 1.6, 2, -9.9, 1.6, 2, -10.1)).toBe(false);
        expect(crosses(g, 0, 3.1, -9.9, 0, 3.1, -10.1)).toBe(false);
        expect(crosses(g, 0, 2, -9.8, 0, 2, -9.9)).toBe(false);
    });

    it('lays a flat gate out along x (width) and z (height)', () => {
        const f = gate(0, 11, 0, 0, 1, 0, 3, 0.5);
        expect(crosses(f, 2.9, 10.9, 0.4, 2.9, 11.1, 0.4)).toBe(true);
        expect(crosses(f, 0, 10.9, 0.6, 0, 11.1, 0.6)).toBe(false);
        expect(crosses(f, 3.1, 10.9, 0, 3.1, 11.1, 0)).toBe(false);
    });
});

/** A course on flat ground: its pad at the origin facing north, these gates. */
function course(gates: Gate[]): TimeTrial {
    return { id: 'test', name: 'Test run', area: 'Test', version: 1, pad: { x: 0, z: 0, y: 0, half: 1.2, yawDeg: 0 }, gates };
}

/** A state vector with the quad at (x, y, z), moving at v m/s along x. */
function at(x: number, y: number, z: number, v = 0): Float64Array {
    const s = new Float64Array(S.size);
    s[S.px] = x; s[S.py] = y; s[S.pz] = z; s[S.vx] = v;
    return s;
}

describe('trial runner', () => {
    const pads: (Pose | null)[] = [];
    const mk = (gates: Gate[]): TrialRunner => {
        pads.length = 0;
        return new TrialRunner([course(gates)], (p) => pads.push(p), 0.03);
    };
    /** the pilot lets the sticks go after answering (the page's filter hands them back) */
    const letGo = (r: TrialRunner): void => void r.filter(new Float32Array([0, 0, -1, 0, 1, -1, 0, 0]), new Float32Array(8));
    /** n ticks at this state (and throttle channel), from tick t; the events */
    const hold = (r: TrialRunner, s: Float64Array, t: number, n: number, thr = -1): TrialEvent[] => {
        const e: TrialEvent[] = [];
        for (let k = 0; k < n; k++) {
            r.step(s, t + k, thr);
            e.push(...r.drain());
        }
        return e;
    };

    it('offers the race after 3 s resting on the pad, not while moving or off it, and not again until it is left', () => {
        const r = mk([gate(0, 2, -10, 0, 0, 1)]);
        expect(hold(r, at(0, 0.05, 0, 1), 0, 4000)).toEqual([]);
        expect(hold(r, at(3, 0.05, 0), 0, 4000)).toEqual([]);
        expect(hold(r, at(0, 0.8, 0), 0, 4000)).toEqual([]);
        expect(hold(r, at(0.5, 0.05, -0.5), 0, PAD_HOLD_TICKS)).toEqual([]);
        expect(r.status().hold).toBeCloseTo((PAD_HOLD_TICKS - 1) / PAD_HOLD_TICKS, 6);
        expect(hold(r, at(0.5, 0.05, -0.5), PAD_HOLD_TICKS, 1)).toEqual([{ type: 'ask', course: 0 }]);
        expect(r.phase).toBe('asking');
        r.answer(false);
        expect(r.phase).toBe('free');
        expect(hold(r, at(0, 0.05, 0), 0, 5000)).toEqual([]);
        hold(r, at(5, 0.05, 0), 0, 1);
        expect(hold(r, at(0, 0.05, 0), 0, PAD_HOLD_TICKS + 1)).toEqual([{ type: 'ask', course: 0 }]);
    });

    it('sets the quad down on the pad, counts 3 s down, calls a false start, then times the gates in order', () => {
        const r = mk([gate(0, 2, -10, 0, 0, 1), gate(0, 2, -20, 0, 0, 1, 1, 1, 'finish')]);
        hold(r, at(0, 0.05, 0), 0, PAD_HOLD_TICKS + 1);
        r.answer(true);
        letGo(r);
        expect(pads).toEqual([[0, 0.04, 0, 0]]);
        // the respawn has not landed yet: the quad is still where it was (off the pose by under the limits)
        let t = 4000;
        expect(hold(r, at(0, 0.04, 0), t, 1)).toEqual([{ type: 'ready', course: 0 }]);
        expect(hold(r, at(0, 0.04, 0), t + 1, 1000)).toEqual([]);
        expect(r.status().toGo).toBe(COUNTDOWN_TICKS - 1000);
        // up off the pad before GO
        expect(hold(r, at(0, 0.5, 0), t + 1001, 1)).toEqual([{ type: 'false-start', course: 0 }]);
        expect(pads.length).toBe(2);
        t = 6000;
        expect(hold(r, at(0, 0.04, 0), t, 1)).toEqual([{ type: 'ready', course: 0 }]);
        expect(hold(r, at(0, 0.04, 0), t + 1, COUNTDOWN_TICKS - 1)).toEqual([]);
        expect(hold(r, at(0, 0.04, 0), t + COUNTDOWN_TICKS, 1)).toEqual([{ type: 'go', course: 0 }]);
        const go = t + COUNTDOWN_TICKS;
        // the finish first does not count: the gates go in order
        hold(r, at(0, 2, -19.9), go + 100, 1);
        expect(hold(r, at(0, 2, -20.1), go + 101, 1)).toEqual([]);
        hold(r, at(0, 2, -9.95), go + 500, 1);
        expect(hold(r, at(0, 2, -10.05), go + 501, 1)).toEqual([{ type: 'gate', course: 0, gate: 0, ms: 501 }]);
        expect(r.status()).toMatchObject({ phase: 'racing', gate: 1, gates: 2, ms: 501 });
        // a respawn across a gate (a jump of more than 1 m in a tick) passes nothing
        hold(r, at(0, 2, -15), go + 600, 1);
        expect(hold(r, at(0, 2, -25), go + 601, 1)).toEqual([]);
        hold(r, at(0, 2, -19.95), go + 1234, 1);
        expect(hold(r, at(0, 2, -20.05), go + 1235, 1)).toEqual([
            { type: 'gate', course: 0, gate: 1, ms: 1235 }, { type: 'finish', course: 0, ms: 1235 }]);
        expect(r.phase).toBe('free');
        expect(pads[pads.length - 1]).toBeNull();
    });

    it('waits for the throttle to come down (and the sticks to be let go) before 3-2-1', () => {
        const r = mk([gate(0, 2, -10, 0, 0, 1)]);
        hold(r, at(0, 0.05, 0), 0, PAD_HOLD_TICKS + 1);
        r.answer(true);
        // set down, throttle held for the offer: not yet the pilot's sticks
        expect(hold(r, at(0, 0.04, 0), 4000, 500)).toEqual([]);
        letGo(r);
        // throttle up (just over Betaflight's min_check): no countdown, THROTTLE DOWN on the HUD
        expect(hold(r, at(0, 0.04, 0), 4500, 2000, THROTTLE_DOWN + 0.01)).toEqual([]);
        expect(r.status()).toMatchObject({ phase: 'countdown', toGo: null, throttleUp: true });
        // flown off the pad meanwhile: no false start, and back on the pad once the throttle is down
        expect(hold(r, at(0, 3, 0), 6500, 10, 0.5)).toEqual([]);
        expect(pads.length).toBe(1);
        expect(hold(r, at(0, 3, 0), 6510, 1, -1)).toEqual([]);
        expect(pads.length).toBe(2);
        expect(hold(r, at(0, 0.04, 0), 6600, 1, -1)).toEqual([{ type: 'ready', course: 0 }]);
        expect(r.status()).toMatchObject({ toGo: COUNTDOWN_TICKS, throttleUp: false });
        // once counting, the throttle may come up: only leaving the pad is a false start
        expect(hold(r, at(0, 0.04, 0), 6601, COUNTDOWN_TICKS - 1, -0.5)).toEqual([]);
        expect(hold(r, at(0, 0.04, 0), 6600 + COUNTDOWN_TICKS, 1, -0.5)).toEqual([{ type: 'go', course: 0 }]);
    });

    it('starts the countdown again on R, and leaves the race on quit', () => {
        const r = mk([gate(0, 2, -10, 0, 0, 1)]);
        hold(r, at(0, 0.05, 0), 0, PAD_HOLD_TICKS + 1);
        expect(r.restart()).toBe(false);
        r.answer(true);
        letGo(r);
        hold(r, at(0, 0.04, 0), 4000, COUNTDOWN_TICKS + 1);
        expect(r.phase).toBe('racing');
        expect(r.restart()).toBe(true);
        expect(r.phase).toBe('countdown');
        r.quit();
        expect(r.drain()).toEqual([{ type: 'quit', course: 0 }]);
        expect(r.phase).toBe('free');
        expect(pads[pads.length - 1]).toBeNull();
    });

    it('holds the sticks centred, throttle down, while asking and until roll and yaw are let go', () => {
        const r = mk([gate(0, 2, -10, 0, 0, 1)]);
        const out = new Float32Array(8);
        const ch = Float32Array.from([-0.9, 0.3, 0.2, 0.9, 1, -1, 0, 0]);
        expect(r.filter(ch, out)).toBe(ch);
        hold(r, at(0, 0.05, 0), 0, PAD_HOLD_TICKS + 1);
        expect(Array.from(r.filter(ch, out))).toEqual([0, 0, -1, 0, 1, -1, 0, 0]);
        r.answer(true);
        expect(Array.from(r.filter(ch, out))).toEqual([0, 0, -1, 0, 1, -1, 0, 0]);
        const free = Float32Array.from([0.1, 0.3, 0.2, -0.1, 1, -1, 0, 0]);
        expect(r.filter(free, out)).toBe(free);
        expect(r.filter(ch, out)).toBe(ch);
    });
});

/** A flat test level, spawn on the course's pad at the origin. */
function level(gates: Gate[]): Level {
    const b = new LevelBuilder().floor('grass', -200, -200, 200, 200);
    b.spawn({ id: 's', name: 'S', x: 0, z: 0, yawDeg: 0 });
    b.trials.push(course(gates));
    return b.build('test', 1, 'test', 200);
}

interface Run {
    events: [TrialEvent, number][];
    path: number[][];
    hash: string;
    session: FlightSession;
}

/**
 * The real sim: rest on the pad until asked, race, (optionally) arm and climb off the pad 1 s into the countdown, then
 * from GO the self-test's scripted sticks (arm, climb, fly north) for `fly` ticks. The quad's path after GO, every tick.
 */
function run(gates: Gate[], fly: number, falseStart = false): Run {
    const session = new FlightSession({ preset, level: level(gates), runHash: true, traceHash: true });
    const r = session.runner, tr = session.trials;
    const ch = new Float32Array(8), held = new Float32Array(8);
    const events: [TrialEvent, number][] = [];
    const path: number[][] = [];
    let ready = -1, go = -1, jumped = false;
    while (go < 0 || r.sim.tick < go + fly) {
        const t = r.sim.tick;
        ch.fill(0);
        ch[2] = -1;
        ch[4] = -1;
        ch[5] = -1;
        if (falseStart && !jumped && ready >= 0 && t >= ready + 1000) {
            // arm, then full throttle
            ch[4] = 1;
            if (t >= ready + 1200) ch[2] = 1;
        }
        if (go >= 0) selftestSticks(t - go, ch);
        if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: tr.filter(ch, held) as Float32Array });
        r.stepOnce();
        for (const e of tr.drain()) {
            events.push([e, r.sim.tick]);
            if (e.type === 'ask') tr.answer(true);
            if (e.type === 'ready') ready = r.sim.tick;
            if (e.type === 'false-start') jumped = true;
            if (e.type === 'go') go = r.sim.tick;
        }
        if (go >= 0) path.push([r.sim.s[S.px], r.sim.s[S.py], r.sim.s[S.pz], r.sim.s[S.vx], r.sim.s[S.vy], r.sim.s[S.vz]]);
        if (t > 60000) throw new Error('no GO within 60 s');
    }
    return { events, path, hash: r.traceHash(), session };
}

describe('a time trial in the real sim', () => {
    it('asks, sets the quad down, counts down, and times gates placed on the path it flies', () => {
        const away = [gate(150, 50, 150, 0, 0, 1, 0.5, 0.5, 'away')];
        const a = run(away, 3500);
        const kinds = a.events.map(([e]) => e.type);
        expect(kinds).toEqual(['ask', 'ready', 'go']);
        const [[, asked], [, ready], [, go]] = a.events;
        expect(asked).toBeGreaterThanOrEqual(PAD_HOLD_TICKS);
        expect(asked).toBeLessThan(PAD_HOLD_TICKS + 10);
        expect(go - ready).toBe(COUNTDOWN_TICKS);
        // two gates on the path it flew, square to it: 1.5 s and 3 s after GO
        const on = (k: number, name: string): Gate => {
            const [x, y, z, vx, vy, vz] = a.path[k];
            const l = Math.hypot(vx, vy, vz);
            return gate(x, y, z, vx / l, vy / l, vz / l, 1, 1, name);
        };
        const b = run([on(1500, 'one'), on(3000, 'two')], 3500);
        expect(b.hash, 'gates are not solid: the same flight').toBe(a.hash);
        const passed = b.events.filter(([e]) => e.type === 'gate' || e.type === 'finish').map(([e]) => e);
        expect(passed.map((e) => e.type)).toEqual(['gate', 'gate', 'finish']);
        const ms = passed.map((e) => (e as { ms: number }).ms);
        // the gate's plane is at the quad's centre on that tick: it is crossed on the tick after, or on it
        expect(ms[0]).toBeGreaterThanOrEqual(1500);
        expect(ms[0]).toBeLessThanOrEqual(1502);
        expect(ms[1]).toBeGreaterThanOrEqual(3000);
        expect(ms[1]).toBeLessThanOrEqual(3002);
        expect(ms[2]).toBe(ms[1]);
        // the flight saved with the race in it replays exactly (the respawns onto the pad are in its log)
        const check = checkFlight(captureFlight(b.session, 1, []), b.session.level);
        expect(check.problem).toBeNull();
        expect(check.ok).toBe(true);
    });

    it('calls a false start when the quad leaves the pad before GO, and puts it back on the pad', () => {
        const c = run([gate(150, 50, 150, 0, 0, 1)], 10, true);
        expect(c.events.map(([e]) => e.type)).toEqual(['ask', 'ready', 'false-start', 'ready', 'go']);
        const [, , [, falseAt], [, readyAgain], [, go]] = c.events;
        expect(readyAgain - falseAt).toBeLessThan(5);
        expect(go - readyAgain).toBe(COUNTDOWN_TICKS);
        const check = checkFlight(captureFlight(c.session, 1, []), c.session.level);
        expect(check.ok).toBe(true);
    });
});

describe('the pack on a time trial', () => {
    it('is full when the quad is set down on the pad, with battery simulation on', () => {
        const session = new FlightSession({ preset, level: level([gate(150, 50, 150, 0, 0, 1)]) });
        const r = session.runner, tr = session.trials;
        const ch = new Float32Array(8), held = new Float32Array(8);
        // a half-flown pack (as after a flight), resting on the pad: rest, accept
        r.sim.s[S.soc] = 0.5;
        let socBefore = -1, socOnPad = -1;
        for (let t = 0; t < 10000 && socOnPad < 0; t++) {
            ch.fill(0);
            ch[2] = -1;
            ch[4] = -1;
            ch[5] = -1;
            if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: tr.filter(ch, held) as Float32Array });
            r.stepOnce();
            for (const e of tr.drain()) {
                if (e.type === 'ask') {
                    socBefore = r.sim.s[S.soc];
                    tr.answer(true);
                }
                if (e.type === 'ready') socOnPad = r.sim.s[S.soc];
            }
        }
        expect(socBefore).toBe(0.5);
        expect(socOnPad).toBe(1);
    });
});

describe('time trial times', () => {
    it('keeps the best, the last, the runs and the ten most recent, per map and course version', () => {
        const t = parseTrialTimes(null);
        const k = courseKey('park', 1);
        expect(recordRun(t, 'm', k, 42315, 1000)).toEqual({ ms: 42315, previous: null, best: true });
        expect(recordRun(t, 'm', k, 43000, 2000)).toEqual({ ms: 43000, previous: 42315, best: false });
        expect(recordRun(t, 'm', k, 41000, 3000)).toEqual({ ms: 41000, previous: 42315, best: true });
        expect(t.m[k]).toEqual({ best: 41000, bestAt: 3000, last: 41000, runs: 3, recent: [41000, 43000, 42315] });
        for (let i = 0; i < 12; i++) recordRun(t, 'm', k, 50000 + i, 4000);
        expect(t.m[k].recent.length).toBe(10);
        expect(t.m[courseKey('park', 2)]).toBeUndefined();
        // read back from storage: the same; anything malformed dropped
        expect(parseTrialTimes(JSON.parse(JSON.stringify(t)))).toEqual(t);
        expect(parseTrialTimes({ m: { a: { best: 'x' }, b: null }, n: 3 })).toEqual({});
    });

    it('shows times as a stopwatch does', () => {
        expect(formatTime(42315)).toBe('42.315');
        expect(formatTime(62315)).toBe('1:02.315');
        expect(formatTime(5)).toBe('0.005');
        expect(formatDelta(1204)).toBe('+1.204 s');
        expect(formatDelta(-317)).toBe('-0.317 s');
    });
});

describe('the offer\'s stick answers', () => {
    it('reads yaw right and roll left as race, yaw left and roll right as decline', () => {
        expect(stickAnswer([-0.9, 0, -1, 0.9])).toBe('race');
        expect(stickAnswer([0.9, 0, -1, -0.9])).toBe('decline');
        expect(stickAnswer([-0.9, 0, -1, -0.9])).toBeNull();
        expect(stickAnswer([-0.5, 0, -1, 0.9])).toBeNull();
    });

    it('answers once held a full second, only after the sticks were let go when it came up', () => {
        const h = new StickHold();
        const race = [-0.9, 0, -1, 0.9], centre = [0, 0, -1, 0];
        // already held when the offer came up: does not count until let go
        expect(h.feed(race, 0)).toBeNull();
        expect(h.feed(race, 2000)).toBeNull();
        expect(h.feed(centre, 2100)).toBeNull();
        expect(h.feed(race, 2200)).toBeNull();
        expect(h.progress(2700)).toEqual({ choice: 'race', k: 0.5 });
        expect(h.feed(race, 3199)).toBeNull();
        expect(h.feed(race, 3200)).toBe('race');
        // let go part way: starts over
        const d = new StickHold();
        d.feed(centre, 0);
        d.feed([0.9, 0, -1, -0.9], 100);
        d.feed(centre, 900);
        expect(d.feed([0.9, 0, -1, -0.9], 1000)).toBeNull();
        expect(d.feed([0.9, 0, -1, -0.9], 2000)).toBe('decline');
    });

    it('says which way the sticks go in each stick mode', () => {
        expect(stickHint(2).race).toBe('both sticks in');
        expect(stickHint(1).race).toBe('both sticks in');
        expect(stickHint(3).race).toBe('both sticks out');
        expect(stickHint(4).decline).toBe('both sticks in');
    });
});
