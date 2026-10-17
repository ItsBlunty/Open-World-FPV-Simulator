// The calibration wizard driven by a simulated radio: an EdgeTX radio in USB joystick mode whose eight
// channels arrive as eight axes in -1..1. Each test scripts what a pilot does (move sticks, flip
// switches, press Next) and checks the profile the wizard builds, then maps frames through it.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL } from '@owfpv/sim-core';
import { CalibrationWizard, STEPS, mapFrame } from '../src/index';
import type { Fn, RadioProfile, RawFrame, StickMode } from '../src/index';

/** Which radio channel (0-based axis) carries each function, and whether it reads reversed. */
interface Wiring {
    fn: Record<Fn, number>;
    reversed: Partial<Record<Fn, boolean>>;
    arm: number;
    mode: number;
    reset: number;
}

const AETR: Wiring = { fn: { roll: 0, pitch: 1, throttle: 2, yaw: 3 }, reversed: {}, arm: 4, mode: 5, reset: 6 };
/** TAER with pitch and yaw reversed, like a radio set up for another sim */
const TAER_REV: Wiring = { fn: { throttle: 0, roll: 1, pitch: 2, yaw: 3 }, reversed: { pitch: true, yaw: true }, arm: 5, mode: 6, reset: 7 };

/** A pilot's hands on the radio: function values in -1..1 (throttle -1 low), switches as their channel values. */
class Radio {
    t = 0;
    fn: Record<Fn, number> = { roll: 0, pitch: 0, throttle: -1, yaw: 0 };
    arm = -1;
    mode = -1;
    reset = -1;
    constructor(readonly w: Wiring, readonly wiz: CalibrationWizard) {}

    frame(): RawFrame {
        const axes = new Float32Array(8);
        for (const f of Object.keys(this.fn) as Fn[]) axes[this.w.fn[f]] = this.w.reversed[f] ? -this.fn[f] : this.fn[f];
        axes[this.w.arm] = this.arm;
        axes[this.w.mode] = this.mode;
        axes[this.w.reset] = this.reset;
        return { t: this.t, axes, buttons: 0 };
    }

    /** Hold everything for ms, a report every 2 ms (a 500 Hz radio). */
    wait(ms: number): this {
        for (let k = 0; k < ms; k += 2) {
            this.t += 2;
            this.wiz.feed(this.frame());
        }
        return this;
    }

    /** Move one function to v over ms, then hold it holdMs. */
    move(f: Fn, v: number, ms = 150, holdMs = 0): this {
        const from = this.fn[f];
        for (let k = 2; k <= ms; k += 2) {
            this.fn[f] = from + ((v - from) * k) / ms;
            this.t += 2;
            this.wiz.feed(this.frame());
        }
        this.fn[f] = v;
        return this.wait(holdMs);
    }

    /** Every stick to both ends and every switch through its positions. */
    stir(): this {
        for (const f of ['roll', 'pitch', 'yaw'] as Fn[]) this.move(f, 1).move(f, -1).move(f, 0);
        this.move('throttle', 1).move('throttle', -1);
        for (const v of [1, -1]) { this.arm = v; this.wait(50); }
        for (const v of [0, 1, -1]) { this.mode = v; this.wait(50); }
        for (const v of [1, -1]) { this.reset = v; this.wait(50); }
        return this;
    }
}

function fullRun(w: Wiring, stickMode: StickMode): { wiz: CalibrationWizard; radio: Radio; profile: RadioProfile } {
    const wiz = new CalibrationWizard(8, stickMode);
    const r = new Radio(w, wiz);
    r.wait(100);
    expect(wiz.view().step).toBe('range');
    expect(wiz.next()).toBe(false); // nothing moved yet
    r.stir();
    expect(wiz.next()).toBe(true);
    expect(wiz.view().step).toBe('centre');
    r.wait(600);
    expect(wiz.next()).toBe(true);
    for (const f of ['throttle', 'yaw', 'pitch', 'roll'] as Fn[]) {
        const v = wiz.view();
        expect(v.step).toBe(f);
        expect(v.prompt?.fn).toBe(f);
        r.move(f, 1, 150, 450);
        expect(wiz.view().stage).toBe('done');
        expect(wiz.next()).toBe(false); // still pushed
        r.move(f, f === 'throttle' ? -1 : 0, 150, 50);
        expect(wiz.next()).toBe(true);
    }
    expect(wiz.view().step).toBe('arm');
    r.arm = 1;
    r.wait(600);
    expect(wiz.view().stage).toBe('done');
    expect(wiz.next()).toBe(false); // switch still on
    r.arm = -1;
    r.wait(50);
    expect(wiz.next()).toBe(true);
    expect(wiz.view().step).toBe('mode');
    r.mode = 0;
    r.wait(600);
    r.mode = 1;
    r.wait(600);
    expect(wiz.view().modeLevels.map((l) => l.mode)).toEqual(['acro', 'horizon', 'angle']);
    r.mode = -1;
    r.wait(50);
    expect(wiz.next()).toBe(true);
    expect(wiz.view().step).toBe('reset');
    r.reset = 1;
    r.wait(600);
    r.reset = -1;
    r.wait(50);
    expect(wiz.next()).toBe(true);
    expect(wiz.view().step).toBe('check');
    return { wiz, radio: r, profile: wiz.profile('test', 'Test radio', '2026-10-17') };
}

describe('calibration wizard', () => {
    for (const [name, w] of [['AETR', AETR], ['TAER reversed', TAER_REV]] as const) {
        it(`maps a radio wired ${name}`, () => {
            const { profile: p, radio: r } = fullRun(w, 2);
            for (const f of ['roll', 'pitch', 'throttle', 'yaw'] as Fn[]) {
                expect(p.axes[f].index).toBe(w.fn[f]);
                expect(p.axes[f].invert).toBe(w.reversed[f] === true);
            }
            expect(p.arm).toMatchObject({ kind: 'axis', index: w.arm, onAbove: true });
            expect(p.mode?.index).toBe(w.mode);
            expect(p.reset).toMatchObject({ kind: 'axis', index: w.reset });
            // the mapping undoes the wiring: functions come out as sim-core's channels
            r.fn = { roll: 0.5, pitch: -0.25, throttle: 0, yaw: 1 };
            r.arm = 1;
            r.mode = 1;
            const ch = mapFrame(p, r.frame(), new Float32Array(8));
            expect(Array.from(ch.slice(0, 4))).toEqual([0.5, -0.25, 0, 1]);
            expect(ch[4]).toBe(1);
            expect(ch[5]).toBe(MODE_CHANNEL.angle);
            r.arm = -1;
            r.mode = -1;
            r.fn.throttle = -1;
            const off = mapFrame(p, r.frame(), new Float32Array(8));
            expect(off[2]).toBe(-1);
            expect(off[4]).toBe(-1);
            expect(off[5]).toBe(MODE_CHANNEL.acro);
        });
    }

    it('prompts the stick each mode puts the function on (EdgeTX Radio Setup table)', () => {
        const expectSticks: Record<StickMode, Record<Fn, string>> = {
            1: { throttle: 'right-v', yaw: 'left-h', pitch: 'left-v', roll: 'right-h' },
            2: { throttle: 'left-v', yaw: 'left-h', pitch: 'right-v', roll: 'right-h' },
            3: { throttle: 'right-v', yaw: 'right-h', pitch: 'left-v', roll: 'left-h' },
            4: { throttle: 'left-v', yaw: 'right-h', pitch: 'right-v', roll: 'left-h' }
        };
        for (const m of [1, 2, 3, 4] as StickMode[]) {
            const w2 = new CalibrationWizard(8, m);
            const r = new Radio(AETR, w2);
            r.stir();
            w2.next();
            r.wait(600);
            w2.next();
            for (const f of ['throttle', 'yaw', 'pitch', 'roll'] as Fn[]) {
                expect(w2.view().prompt?.stick).toBe(expectSticks[m][f]);
                r.move(f, 1, 150, 450).move(f, f === 'throttle' ? -1 : 0, 150, 50);
                w2.next();
            }
        }
    });

    it('waits for Next: a finished push never moves on by itself', () => {
        const wiz = new CalibrationWizard(8, 2);
        const r = new Radio(AETR, wiz);
        r.stir();
        wiz.next();
        r.wait(600);
        wiz.next();
        r.move('throttle', 1, 150, 450).move('throttle', -1, 150, 2000);
        expect(wiz.view().step).toBe('throttle');
        expect(wiz.view().stage).toBe('done');
    });

    it('refuses a push held too short, a half push, and two sticks at once', () => {
        const wiz = new CalibrationWizard(8, 2);
        const r = new Radio(AETR, wiz);
        r.stir();
        wiz.next();
        r.wait(600);
        wiz.next();
        r.move('throttle', 1, 100, 200).move('throttle', -1, 100);
        expect(wiz.view().stage).toBe('active');
        r.move('throttle', 0.0, 100, 600).move('throttle', -1, 100); // halfway: 50 % of the reach
        expect(wiz.view().stage).toBe('active');
        r.fn.yaw = 1;
        r.move('throttle', 1, 100, 600);
        expect(wiz.view().stage).toBe('active');
        expect(wiz.view().hint).toBe('two-axes');
    });

    it('does not take the centre while sticks move', () => {
        const wiz = new CalibrationWizard(8, 2);
        const r = new Radio(AETR, wiz);
        r.stir();
        wiz.next();
        r.move('roll', 0.3, 300);
        expect(wiz.next()).toBe(false);
        expect(wiz.view().hint).toBe('hold-still');
    });

    it('skips the optional switches; back clears what a step found', () => {
        const wiz = new CalibrationWizard(8, 2);
        const r = new Radio(AETR, wiz);
        r.stir();
        wiz.next();
        r.wait(600);
        wiz.next();
        for (const f of ['throttle', 'yaw', 'pitch', 'roll'] as Fn[]) {
            r.move(f, 1, 150, 450).move(f, f === 'throttle' ? -1 : 0, 150, 50);
            wiz.next();
        }
        expect(wiz.skip()).toBe(true);
        expect(wiz.skip()).toBe(true);
        expect(wiz.skip()).toBe(true);
        expect(wiz.view().step).toBe('check');
        const p = wiz.profile('k', 'n', 'd');
        expect(p.arm).toBeNull();
        expect(p.mode).toBeNull();
        expect(p.reset).toBeNull();
        // back from check to reset, then to mode: the roll stick step stays assigned
        wiz.back();
        wiz.back();
        expect(wiz.view().step).toBe('mode');
        expect(wiz.view().axes[AETR.fn.roll].use).toBe('roll');
        expect(STEPS.length).toBe(wiz.view().count);
    });
});
