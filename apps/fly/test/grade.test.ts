// The trick grader (owner, 2026-10-18; docs/notes/freestyle-grading.md): real sim flights flown by a scripted pilot
// (clean and sloppy versions of each trick) must be found, named and marked in the right order, and moves that are
// not the trick must say why ("teardrop").

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sim, compileParams, hoverSolve } from '@owfpv/sim-core';
import type { ContactWorld, PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { Grader } from '../src/grade';
import type { GradedTrick } from '../src/grade';

const params = compileParams(nazgul as unknown as PresetJson, {});
const HOVER = hoverSolve(params, 1).stick;
const DEG = 180 / Math.PI;

/** What the scripted pilot knows: the tick, the sim, the rotation summed since `mark()`, deg (pilot axes). */
interface Pilot {
    t: number;
    sim: Sim;
    /** summed roll, pitch, yaw since the last mark, deg */
    roll: number; pitch: number; yaw: number;
    mark(): void;
    /** the stick channels to set: roll, pitch, throttle (0..1), yaw */
    stick(roll: number, pitch: number, thr: number, yaw?: number): void;
    /** the script's own step counter, free to use */
    phase: number;
    since: number;
    /** steer one axis to a rate, deg/s (pilot sign), the others centred, with this throttle */
    rate(axis: 'roll' | 'pitch', degPerS: number, thr: number): void;
}

/**
 * Arm in acro at (0, 50, 0) facing -z, then hand the sticks to `script` every tick for `ms`. A grader watches
 * (with `gradeWorld` for its "something inside the loop" check: the sim itself flies in open air).
 */
function fly(script: (p: Pilot) => void, ms: number, gradeWorld: ContactWorld | null = null, touchAt?: { ms: number; hit: boolean }): { tricks: GradedTrick[]; sim: Sim; trickMid: number[] } {
    const sim = new Sim(params, null);
    sim.reset(0, 50, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    const g = new Grader(gradeWorld);
    // the middle of the path while the script flies its trick (where a loop's centre is)
    const sum = [0, 0, 0, 0];
    const p: Pilot = {
        t: 0, sim, roll: 0, pitch: 0, yaw: 0, phase: 0, since: 0,
        mark() { p.roll = p.pitch = p.yaw = 0; p.since = p.t; },
        stick(r, pi, thr, y = 0) { ch[0] = r; ch[1] = pi; ch[2] = thr * 2 - 1; ch[3] = y; },
        rate(axis, degPerS, thr) {
            const i = axis === 'roll' ? 0 : 1;
            const now = (axis === 'roll' ? -sim.s[S.wz] : -sim.s[S.wx]) * DEG;
            const v = ch[i] + 0.0003 * (degPerS - now);
            ch[i] = v > 1 ? 1 : v < -1 ? -1 : v;
            ch[1 - i] = 0; ch[3] = 0; ch[2] = thr * 2 - 1;
        }
    };
    p.stick(0, 0, HOVER);
    for (let t = 0; t < ms; t++) {
        p.t = t;
        script(p);
        sim.setChannels(ch);
        sim.step();
        const s = sim.s;
        p.roll += -s[S.wz] * DEG * 0.001; p.pitch += -s[S.wx] * DEG * 0.001; p.yaw += -s[S.wy] * DEG * 0.001;
        if (touchAt && t === touchAt.ms) g.touch(touchAt.hit);
        g.step(sim.tick, s, sim.ch);
        if (p.phase === 1) { sum[0] += s[S.px]; sum[1] += s[S.py]; sum[2] += s[S.pz]; sum[3]++; }
    }
    return { tricks: g.tricks, sim, trickMid: [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] };
}

/** Level out (the script's own little angle hold): stick toward level from the body's tilt. */
function holdLevel(p: Pilot, thr: number, pitchTarget = 0): void {
    const s = p.sim.s;
    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
    const r10 = 2 * (qx * qy + qw * qz), r12 = 2 * (qy * qz - qw * qx);
    // r10 > 0: right side up -> roll right; r12 > 0: nose down -> pitch back
    const k = 3;
    const cl = (x: number) => (x > 1 ? 1 : x < -1 ? -1 : x);
    p.stick(cl(k * r10 - 0.05 * -s[S.wz]), cl(-k * (r12 - pitchTarget) - 0.05 * -s[S.wx]), thr);
}

/** 2 s of level flight speeding up forward (nose 20° down), then the trick; after it, level again. */
function forwardThen(trick: (p: Pilot) => boolean, cruise = 0.34): (p: Pilot) => void {
    return (p) => {
        if (p.phase === 0) {
            // level flight needs more thrust the further the nose is down: hover / cos(tilt), with cos from r12 = sin
            holdLevel(p, HOVER / Math.sqrt(1 - cruise * cruise) + 0.01, cruise);
            if (p.t >= 3500) { p.phase = 1; p.mark(); }
        } else if (p.phase === 1) {
            if (trick(p)) { p.phase = 2; p.mark(); }
        } else holdLevel(p, p.t - p.since < 600 ? HOVER + 0.25 : HOVER, 0);
    };
}

const show = (ts: GradedTrick[]): string => ts.map((t) => `${t.name} ${t.mark ?? '-'} [${t.deductions.map((d) => `${d.why} -${d.minus}`).join('; ')}] {${t.facts.join('; ')}} ${t.miss ?? ''}`).join('\n');

/** A power loop: pitch back at the rate that keeps a path of radius R, punching to `cutAt`°, floating over the top, catching from 270°. */
const loopScript = (R: number, climb: number, cutAt: number, katch: number) => (p: Pilot): boolean => {
    const v = p.sim.s;
    const sp = Math.sqrt(v[S.vx] * v[S.vx] + v[S.vy] * v[S.vy] + v[S.vz] * v[S.vz]);
    const rate = Math.min(400, Math.max(80, (sp / R) * DEG));
    const thr = p.pitch > -cutAt ? climb : p.pitch > -270 ? 0.06 : 0.06 + (katch - 0.06) * ((-p.pitch - 270) / 80);
    p.rate('pitch', -rate, thr);
    return p.pitch <= -350;
};

/** A split-S: half roll right at low throttle, then pull back along a path of radius R. */
const splitScript = (R: number, thr: number, rollTo = 180) => (p: Pilot): boolean => {
    if (p.roll < rollTo - 6 && p.pitch > -20) { p.rate('roll', 600, 0.1); return false; }
    const v = p.sim.s;
    const sp = Math.sqrt(v[S.vx] * v[S.vx] + v[S.vy] * v[S.vy] + v[S.vz] * v[S.vz]);
    p.rate('pitch', -Math.min(400, Math.max(80, (sp / R) * DEG)), thr);
    return p.pitch <= -170;
};

/** Climb, coast to the top, pitch nose down, fall at zero throttle for `holdMs`, pull out. */
const diveScript = (holdMs: number, thr = 0, wobble = 0) => (p: Pilot): void => {
    const s = p.sim.s;
    if (p.phase === 0) { holdLevel(p, HOVER + 0.3, 0); if (p.t > 1500) { p.phase = 1; p.mark(); } }
    else if (p.phase === 1) { holdLevel(p, 0.05, 0); if (s[S.vy] < 0) { p.phase = 2; p.mark(); } }
    else if (p.phase === 2) { p.stick(0, 0.5, 0); if (p.pitch >= 85) { p.phase = 3; p.mark(); } }
    else if (p.phase === 3) { p.stick(wobble * Math.sin(p.t / 60), wobble * Math.sin(p.t / 80), thr); if (p.t - p.since > holdMs) { p.phase = 4; p.mark(); } }
    else holdLevel(p, 0.9, 0);
};

/** A solid ball (for the grader's "something inside the loop" check only). */
function ball(cx: number, cy: number, cz: number, r: number): ContactWorld {
    return {
        sweep: () => -1,
        pushOut: () => false,
        contacts(x, y, z, rr, out) {
            const dx = x - cx, dy = y - cy, dz = z - cz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
            if (d >= rr) return 0;
            out[0] = dx; out[1] = dy; out[2] = dz; out[3] = d;
            return 1;
        }
    };
}

const one = (ts: GradedTrick[]): GradedTrick => {
    expect(ts.length, show(ts)).toBe(1);
    return ts[0];
};

describe('grader on scripted flights', () => {
    it('finds clean flips, names their direction and marks them high', () => {
        const back = one(fly(forwardThen((p) => { p.stick(0, -1, 0.05); return p.pitch <= -330; }), 6000).tricks);
        expect(back.name).toBe('Back flip');
        expect(back.mark).toBeGreaterThanOrEqual(8.5);
        const front = one(fly(forwardThen((p) => { p.stick(0, 1, 0.05); return p.pitch >= 330; }), 6000).tricks);
        expect(front.name).toBe('Front flip');
        expect(front.mark).toBeGreaterThanOrEqual(8.5);
        // the stop: a front flip released at 330° under-rotates, and says so
        expect(front.deductions.some((d) => d.why.includes('under-rotated'))).toBe(true);
    });

    it('marks a sloppy flip (roll and yaw mixed in) lower, and says why', () => {
        const clean = one(fly(forwardThen((p) => { p.stick(0, -1, 0.05); return p.pitch <= -330; }), 6000).tricks);
        const sloppy = one(fly(forwardThen((p) => { p.stick(0.12, -1, 0.05, 0.1); return p.pitch <= -330; }), 6000).tricks);
        expect(sloppy.name).toBe('Back flip');
        expect(sloppy.mark!).toBeLessThan(clean.mark!);
        expect(sloppy.deductions.map((d) => d.why).join()).toMatch(/roll wobble.*yaw wobble/);
    });

    it('a brush costs 2 points; a hit voids the trick', () => {
        const flip = (touch?: { ms: number; hit: boolean }) => one(fly(forwardThen((p) => { p.stick(0, -1, 0.05); return p.pitch <= -330; }), 6000, null, touch).tricks);
        const clean = flip();
        // the flip starts at 3.5 s and takes about 0.6 s
        const brushed = flip({ ms: 3800, hit: false });
        expect(brushed.name).toBe('Back flip');
        expect(brushed.mark).toBeCloseTo(clean.mark! - 2, 6);
        const hit = flip({ ms: 3800, hit: true });
        expect(hit.mark).toBeNull();
        expect(hit.miss).toBe('hit something during it');
    });

    it('tells an axial roll from a barrel roll', () => {
        const axial = one(fly(forwardThen((p) => { p.stick(1, 0, 0.2); return p.roll >= 330; }), 6000).tricks);
        expect(axial.name).toBe('Roll right');
        const left = one(fly(forwardThen((p) => { p.stick(-1, 0, 0.2); return p.roll <= -330; }), 6000).tricks);
        expect(left.name).toBe('Roll left');
        const barrel = one(fly(forwardThen((p) => { p.rate('roll', 300, 0.6); return p.roll >= 350; }, 0.5), 7000).tricks);
        expect(barrel.name).toBe('Barrel roll right');
    });

    it('finds a power loop, open air or around something, and grades it', () => {
        const open = one(fly(forwardThen(loopScript(2.5, 0.5, 130, 0.5), 0.5), 9000).tricks);
        expect(open.name).toBe('Power loop (open air)');
        expect(open.mark).not.toBeNull();
        // roundness counts only in the open air (owner, 2026-10-18)
        expect(open.deductions.some((d) => d.why.startsWith('not round'))).toBe(true);
        // the same flight with a ball where the loop was: now it went around something, and roundness is not graded
        const loopAt = (t: GradedTrick) => t.facts.join();
        expect(loopAt(open)).toContain('nothing inside the loop');
        const [cx, cy, cz] = fly(forwardThen(loopScript(2.5, 0.5, 130, 0.5), 0.5), 9000).trickMid;
        const around = one(fly(forwardThen(loopScript(2.5, 0.5, 130, 0.5), 0.5), 9000, ball(cx, cy, cz, 0.5)).tricks);
        expect(around.name).toBe('Power loop');
        expect(around.deductions.some((d) => d.why.startsWith('not round'))).toBe(false);
        expect(around.mark!).toBeGreaterThan(open.mark!);
    });

    it('turns down a teardrop and says why', () => {
        // a held stick (about 260 deg/s), the throttle cut once vertical. sim-core/0.8.0: the script's rate-chasing stick
        // rang against the motor model's slower motors (20-23 ms, from the rotor inertia), and the motors swinging between
        // idle and full made enough thrust to carry the path round a loop
        const t = one(fly(forwardThen((p) => { p.stick(0, -0.6, p.pitch > -90 ? 0.6 : 0.0); return p.pitch <= -350; }, 0.5), 9000).tricks);
        expect(t.name).toBe('Nearly a power loop');
        expect(t.mark).toBeNull();
        expect(t.miss).toMatch(/^teardrop/);
    });

    it('finds a split-S: half roll, pull through, heading reversed and lower', () => {
        const a = one(fly(forwardThen(splitScript(4, 0.6), 0.5), 8000).tricks);
        expect(a.name).toBe('Split-S');
        expect(a.mark).toBeGreaterThanOrEqual(8.5);
        const b = one(fly(forwardThen(splitScript(2, 0.5), 0.5), 8000).tricks);
        expect(b.name).toBe('Split-S');
        // a tighter pull that reverses the heading less well marks lower
        expect(b.mark!).toBeLessThan(a.mark!);
        // pitching back before the half roll is done is not a split-S
        const early = fly(forwardThen((p) => {
            if (p.roll < 120) { p.stick(1, -0.4, 0.1); return false; }
            return splitScript(3, 0.6)(p);
        }, 0.5), 8000).tricks;
        expect(early.every((t) => t.name !== 'Split-S'), show(early)).toBe(true);
    });

    it('finds a dive of a second or more with a pull-out, and nothing shorter', () => {
        expect(fly(diveScript(800), 9000).tricks).toEqual([]);
        const d = one(fly(diveScript(1500), 9000).tricks);
        expect(d.name).toBe('Dive');
        expect(d.mark).not.toBeNull();
        // a nose that swings about in the dive marks lower
        const wobbly = one(fly(diveScript(1500, 0, 0.25), 9000).tricks);
        expect(wobbly.name).toBe('Dive');
        expect(wobbly.mark!, show([d, wobbly])).toBeLessThan(d.mark!);
    });

    it('steady flight, hovering and gentle turns give no tricks', () => {
        const tricks = fly((p) => {
            const s = p.sim.s;
            const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
            const r10 = 2 * (qx * qy + qw * qz), r12 = 2 * (qy * qz - qw * qx);
            // fly forward and turn slowly right and left with yaw
            p.stick(Math.max(-1, Math.min(1, 3 * r10)), Math.max(-1, Math.min(1, -3 * (r12 - 0.3))), HOVER + 0.04, p.t % 4000 < 2000 ? 0.3 : -0.3);
        }, 12000).tricks;
        expect(tricks).toEqual([]);
    });

    it('a jump in ticks (a new life) forgets the history', () => {
        const g = new Grader();
        const s = new Float64Array(S.size);
        s[S.qw] = 1; s[S.armed] = 1;
        const ch = [0, 0, 0, 0, 1, 0, 0, 0];
        // spinning fast in pitch for 0.5 s, then a respawn 10 s later: the half flip is never reported
        for (let t = 0; t < 500; t++) { s[S.wx] = -6; g.step(t, s, ch); }
        s[S.wx] = 0;
        for (let t = 10000; t < 11000; t++) g.step(t, s, ch);
        expect(g.tricks).toEqual([]);
    });
});
