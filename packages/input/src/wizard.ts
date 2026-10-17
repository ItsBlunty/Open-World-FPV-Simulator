// Calibration wizard (no DOM): walks the pilot through a standard FPV-sim radio setup and builds a
// RadioProfile (profile.ts). The UI shows `view()` and calls next / back / skip / redo for its
// buttons; frames go in through feed(). Every decision is made here, so tests can drive it.
//
// Steps: range (move every stick and switch to its ends) -> centre (sticks centred, throttle low,
// hold still) -> throttle, yaw, pitch, roll (push the stick the stick mode names, one at a time) ->
// arm switch -> flight-mode switch (optional) -> respawn switch (optional) -> turtle-mode switch (optional) -> check.
//
// Rules taken from upstream's wizard (ShramkoGSFPV packages/input/src/calib.ts, MIT, v3 of
// 2026-09-26), whose author found them on real radios: nothing advances unless the pilot presses
// Next (a wizard that moved on by itself left pilots behind); a push counts only at >= 70 % of the
// way from rest to the end, held 400 ms; a switch counts only as a real jump held still. The
// thresholds are upstream's or round numbers, not measured on the owner's radio: tune them if a
// step misreads.

import type { RawFrame } from './frame';
import type { FlightMode } from '@owfpv/sim-core';
import type { AxisCal, Fn, ModeSwitchMap, RadioProfile, StickAxis, StickMode, SwitchMap } from './profile';
import { nearestLevel, stickOf } from './profile';

export type StepId = 'range' | 'centre' | 'throttle' | 'yaw' | 'pitch' | 'roll' | 'arm' | 'mode' | 'reset' | 'turtle' | 'check';
export const STEPS: readonly StepId[] = ['range', 'centre', 'throttle', 'yaw', 'pitch', 'roll', 'arm', 'mode', 'reset', 'turtle', 'check'];
export type Stage = 'active' | 'done';

export const WIZARD_TUNING = {
    /** an axis counts as moved through its range at this span of -1..1 */
    SPAN_MIN: 1.0,
    /** still: every axis within this over the last STILL_MS */
    STILL_TOL: 0.04,
    STILL_MS: 500,
    /** a push: share of the reach from rest to the end */
    PUSH_ACCEPT: 0.7,
    /** another axis past this share at the same time: two axes moved, ambiguous */
    PUSH_OTHER: 0.3,
    HOLD_MS: 400,
    /** an axis whose reach from rest is under this cannot be a stick */
    REACH_MIN: 0.5,
    /** back at rest: under this share of the reach */
    RELEASE: 0.2,
    /** a switch: this far from its rest value, held SWITCH_MS */
    SWITCH_JUMP: 0.5,
    SWITCH_MS: 300,
    /** a mode switch moves less between neighbouring positions (3-position: half the range) */
    MODE_JUMP: 0.3,
    /** two mode-switch levels closer than this are the same position */
    LEVEL_TOL: 0.15
} as const;
const T = WIZARD_TUNING;

export type Hint = null | 'move-more' | 'hold-still' | 'two-axes' | 'release' | 'switch-off' | 'more-positions';

export interface AxisLive {
    v: number;
    min: number;
    max: number;
    rest: number | null;
    /** what this axis has been assigned to so far */
    use: Fn | 'arm' | 'mode' | 'reset' | 'turtle' | null;
}

export interface WizardView {
    step: StepId;
    stage: Stage;
    /** 1-based position and step count, for "Step 3 of 10" */
    index: number;
    count: number;
    stickMode: StickMode;
    /** stick steps: the function, the stick that drives it in this mode and the way to push */
    prompt: { fn: Fn; stick: StickAxis; dir: 'up' | 'right' } | null;
    /** 0..1 while a push or a switch is held long enough */
    progress: number;
    hint: Hint;
    can: { next: boolean; back: boolean; skip: boolean; redo: boolean };
    axes: AxisLive[];
    buttons: number;
    /** what the current step found (done stage), for "Throttle = channel 3" */
    found: { kind: 'axis'; index: number; invert: boolean } | { kind: 'button'; bit: number } | null;
    /** mode step: the levels found, the mode each selects, and the one the switch is at now */
    modeLevels: { level: number; mode: FlightMode }[];
    modeNow: number;
}

interface Hold {
    key: string;
    since: number;
}

const DEFAULT_MODES: Readonly<Record<number, FlightMode[]>> = {
    2: ['acro', 'angle'],
    3: ['acro', 'horizon', 'angle']
};

export class CalibrationWizard {
    readonly stickMode: StickMode;
    private readonly n: number;
    private stepI = 0;
    private stage: Stage = 'active';
    private t = 0;
    private v: Float64Array;
    private min: Float64Array;
    private max: Float64Array;
    private rest: Float64Array | null = null;
    private restButtons = 0;
    private buttons = 0;
    /** samples of the last STILL_MS, per frame: time and every axis */
    private win: { t: number; v: Float64Array }[] = [];
    private hold: Hold | null = null;
    private progress = 0;
    private hint: Hint = null;
    private found: WizardView['found'] = null;
    private axes: Partial<Record<Fn, AxisCal>> = {};
    private arm: SwitchMap | null = null;
    private reset: SwitchMap | null = null;
    private turtle: SwitchMap | null = null;
    private mode: { index: number; levels: number[]; modes: FlightMode[] } | null = null;
    private modeHold: { level: number; since: number } | null = null;

    constructor(nAxes: number, stickMode: StickMode) {
        this.n = nAxes;
        this.stickMode = stickMode;
        this.v = new Float64Array(nAxes);
        this.min = new Float64Array(nAxes).fill(Infinity);
        this.max = new Float64Array(nAxes).fill(-Infinity);
    }

    get step(): StepId {
        return STEPS[this.stepI];
    }

    feed(f: RawFrame): void {
        this.t = f.t;
        for (let i = 0; i < this.n; i++) {
            const x = f.axes[i] ?? 0;
            this.v[i] = x;
            if (x < this.min[i]) this.min[i] = x;
            if (x > this.max[i]) this.max[i] = x;
        }
        this.buttons = f.buttons;
        this.win.push({ t: f.t, v: Float64Array.from(this.v) });
        while (this.win.length > 2 && this.win[1].t <= f.t - T.STILL_MS) this.win.shift();
        this.update();
    }

    // ------------------------------------------------------------ commands

    next(): boolean {
        if (!this.can().next) return false;
        const s = this.step;
        if (s === 'centre') {
            this.rest = Float64Array.from(this.v);
            this.restButtons = this.buttons;
        }
        this.go(this.stepI + 1);
        return true;
    }

    back(): boolean {
        if (!this.can().back) return false;
        this.go(this.stepI - 1);
        this.clearFrom(this.stepI);
        return true;
    }

    /** Optional steps (arm, mode, reset, turtle) only: go on without one. */
    skip(): boolean {
        if (!this.can().skip) return false;
        this.clearFrom(this.stepI);
        this.go(this.stepI + 1);
        return true;
    }

    /** Measure the current step again. */
    redo(): boolean {
        if (!this.can().redo) return false;
        this.clearFrom(this.stepI);
        this.stage = 'active';
        this.found = null;
        this.hold = null;
        this.progress = 0;
        return true;
    }

    /** Mode step: which flight mode a found level selects. */
    setLevelMode(i: number, m: FlightMode): void {
        if (this.mode && i >= 0 && i < this.mode.modes.length) this.mode.modes[i] = m;
    }

    profile(deviceKey: string, deviceName: string, created: string): RadioProfile {
        if (this.step !== 'check') throw new Error('the profile is ready on the check step');
        const a = this.axes as Record<Fn, AxisCal>;
        const axes = {} as Record<Fn, AxisCal>;
        // the ends as measured by the end of the wizard: pushes during the stick steps widen them
        for (const fn of ['roll', 'pitch', 'throttle', 'yaw'] as Fn[]) axes[fn] = { ...a[fn], min: this.min[a[fn].index], max: this.max[a[fn].index] };
        const mode: ModeSwitchMap | null = this.mode && this.mode.levels.length >= 2 ? { index: this.mode.index, levels: this.mode.levels.slice(), modes: this.mode.modes.slice() } : null;
        return { version: 1, deviceKey, deviceName, stickMode: this.stickMode, axes, arm: this.arm, mode, reset: this.reset, turtle: this.turtle, deadband: 0, created };
    }

    view(): WizardView {
        const s = this.step;
        const fn = isFn(s) ? s : null;
        const axes: AxisLive[] = [];
        for (let i = 0; i < this.n; i++) {
            axes.push({ v: this.v[i], min: this.min[i], max: this.max[i], rest: this.rest ? this.rest[i] : null, use: this.useOf(i) });
        }
        const levels = this.mode ? this.mode.levels.map((level, i) => ({ level, mode: this.mode!.modes[i] })) : [];
        return {
            step: s,
            stage: this.stage,
            index: this.stepI + 1,
            count: STEPS.length,
            stickMode: this.stickMode,
            prompt: fn ? { fn, stick: stickOf(this.stickMode, fn), dir: fn === 'throttle' || fn === 'pitch' ? 'up' : 'right' } : null,
            progress: this.progress,
            hint: this.hint,
            can: this.can(),
            axes,
            buttons: this.buttons,
            found: this.found,
            modeLevels: levels,
            modeNow: this.mode ? nearestLevel(this.mode.levels, this.v[this.mode.index]) : -1
        };
    }

    // ------------------------------------------------------------ internals

    private go(i: number): void {
        this.stepI = Math.max(0, Math.min(STEPS.length - 1, i));
        this.stage = 'active';
        this.found = null;
        this.hold = null;
        this.progress = 0;
        this.hint = null;
        this.modeHold = null;
        this.update();
    }

    /** Forget what step i and every later step found. */
    private clearFrom(i: number): void {
        for (let k = i; k < STEPS.length; k++) {
            const s = STEPS[k];
            if (isFn(s)) delete this.axes[s];
            else if (s === 'arm') this.arm = null;
            else if (s === 'mode') this.mode = null;
            else if (s === 'reset') this.reset = null;
            else if (s === 'turtle') this.turtle = null;
            else if (s === 'centre') this.rest = null;
        }
    }

    private useOf(i: number): AxisLive['use'] {
        for (const fn of ['roll', 'pitch', 'throttle', 'yaw'] as Fn[]) if (this.axes[fn]?.index === i) return fn;
        if (this.arm?.kind === 'axis' && this.arm.index === i) return 'arm';
        if (this.mode?.index === i) return 'mode';
        if (this.reset?.kind === 'axis' && this.reset.index === i) return 'reset';
        if (this.turtle?.kind === 'axis' && this.turtle.index === i) return 'turtle';
        return null;
    }

    private usedBit(bit: number): boolean {
        return [this.arm, this.reset, this.turtle].some((m) => m?.kind === 'button' && m.bit === bit);
    }

    private can(): WizardView['can'] {
        const s = this.step;
        const optional = s === 'arm' || s === 'mode' || s === 'reset' || s === 'turtle';
        const c = { next: false, back: this.stepI > 0, skip: optional, redo: this.stage === 'done' };
        if (s === 'range') c.next = this.spanCount() >= 4;
        else if (s === 'centre') c.next = this.still();
        else if (isFn(s)) c.next = this.stage === 'done' && this.released(s);
        else if (s === 'arm' || s === 'reset' || s === 'turtle') c.next = this.stage === 'done' && !this.switchStillOn();
        else if (s === 'mode') c.next = this.stage === 'done' && (this.mode?.levels.length ?? 0) >= 2;
        return c;
    }

    private spanCount(): number {
        let n = 0;
        for (let i = 0; i < this.n; i++) if (this.max[i] - this.min[i] >= T.SPAN_MIN) n++;
        return n;
    }

    /** Every axis within STILL_TOL over a window of at least STILL_MS. */
    private still(): boolean {
        const w = this.win;
        if (w.length < 2 || this.t - w[0].t < T.STILL_MS) return false;
        for (let i = 0; i < this.n; i++) {
            let lo = Infinity;
            let hi = -Infinity;
            for (const s of w) {
                if (s.v[i] < lo) lo = s.v[i];
                if (s.v[i] > hi) hi = s.v[i];
            }
            if (hi - lo > T.STILL_TOL) return false;
        }
        return true;
    }

    /** How far axis i is from rest, as a share of its reach that way (0 when it has no reach). */
    private frac(i: number): { frac: number; d: number } {
        const rest = this.rest ? this.rest[i] : 0;
        const d = this.v[i] - rest;
        const reach = d >= 0 ? this.max[i] - rest : rest - this.min[i];
        return { frac: reach >= T.REACH_MIN ? Math.abs(d) / reach : 0, d };
    }

    private released(fn: Fn): boolean {
        const a = this.axes[fn];
        return !!a && this.frac(a.index).frac < T.RELEASE;
    }

    private switchStillOn(): boolean {
        const f = this.found;
        if (!f || !this.rest) return false;
        if (f.kind === 'button') return ((this.buttons >>> f.bit) & 1) !== ((this.restButtons >>> f.bit) & 1);
        return Math.abs(this.v[f.index] - this.rest[f.index]) > T.SWITCH_JUMP;
    }

    /** True once `key` has been held for `ms`; sets the progress ring. */
    private held(key: string | null, ms: number): boolean {
        if (key === null) {
            this.hold = null;
            this.progress = 0;
            return false;
        }
        if (!this.hold || this.hold.key !== key) this.hold = { key, since: this.t };
        const p = (this.t - this.hold.since) / ms;
        this.progress = p > 1 ? 1 : p;
        return p >= 1;
    }

    private update(): void {
        const s = this.step;
        this.hint = null;
        if (s === 'range') {
            if (this.spanCount() < 4) this.hint = 'move-more';
        } else if (s === 'centre') {
            if (!this.still()) this.hint = 'hold-still';
        } else if (isFn(s)) {
            this.stickStep(s);
        } else if (s === 'arm' || s === 'reset' || s === 'turtle') {
            this.switchStep(s);
        } else if (s === 'mode') {
            this.modeStep();
        }
    }

    private stickStep(fn: Fn): void {
        if (this.stage === 'done') {
            if (!this.released(fn)) this.hint = 'release';
            return;
        }
        let best = -1;
        let bestFrac = 0;
        let second = 0;
        for (let i = 0; i < this.n; i++) {
            if (this.useOf(i) !== null) continue;
            const { frac } = this.frac(i);
            if (frac > bestFrac) {
                second = bestFrac;
                bestFrac = frac;
                best = i;
            } else if (frac > second) second = frac;
        }
        if (best < 0 || bestFrac < T.PUSH_ACCEPT) {
            this.held(null, T.HOLD_MS);
            return;
        }
        if (second >= T.PUSH_OTHER) {
            this.hint = 'two-axes';
            this.held(null, T.HOLD_MS);
            return;
        }
        const { d } = this.frac(best);
        if (!this.held(`${best}:${d > 0 ? '+' : '-'}`, T.HOLD_MS)) return;
        const rest = this.rest ? this.rest[best] : 0;
        this.axes[fn] = { index: best, invert: d < 0, min: this.min[best], center: rest, max: this.max[best] };
        this.found = { kind: 'axis', index: best, invert: d < 0 };
        this.stage = 'done';
        this.hint = 'release';
    }

    private switchStep(which: 'arm' | 'reset' | 'turtle'): void {
        if (this.stage === 'done') {
            if (this.switchStillOn()) this.hint = 'switch-off';
            return;
        }
        const rest = this.rest;
        if (!rest) return;
        let key: string | null = null;
        let pick: SwitchMap | null = null;
        for (let i = 0; i < this.n && !pick; i++) {
            if (this.useOf(i) !== null) continue;
            const d = this.v[i] - rest[i];
            if (Math.abs(d) > T.SWITCH_JUMP) {
                key = `a${i}:${d > 0 ? '+' : '-'}`;
                pick = { kind: 'axis', index: i, threshold: (this.v[i] + rest[i]) / 2, onAbove: d > 0 };
            }
        }
        const changed = (this.buttons ^ this.restButtons) & ~this.restButtons;
        for (let b = 0; b < 32 && !pick; b++) {
            if (((changed >>> b) & 1) === 1 && !this.usedBit(b)) {
                key = `b${b}`;
                pick = { kind: 'button', bit: b };
            }
        }
        // a switch rests still at its new position: a stick swept through would not hold its level
        if (pick?.kind === 'axis' && !this.axisStill(pick.index)) key = null;
        if (!this.held(key, T.SWITCH_MS) || !pick) return;
        if (which === 'arm') this.arm = pick;
        else if (which === 'reset') this.reset = pick;
        else this.turtle = pick;
        this.found = pick.kind === 'axis' ? { kind: 'axis', index: pick.index, invert: !pick.onAbove } : { kind: 'button', bit: pick.bit };
        this.stage = 'done';
        this.hint = 'switch-off';
    }

    private axisStill(i: number): boolean {
        const w = this.win;
        const since = this.t - T.SWITCH_MS / 2;
        let lo = Infinity;
        let hi = -Infinity;
        for (const s of w) {
            if (s.t < since) continue;
            if (s.v[i] < lo) lo = s.v[i];
            if (s.v[i] > hi) hi = s.v[i];
        }
        return hi - lo <= T.STILL_TOL;
    }

    private modeStep(): void {
        const rest = this.rest;
        if (!rest) return;
        if (!this.mode) {
            let key: string | null = null;
            let idx = -1;
            for (let i = 0; i < this.n; i++) {
                if (this.useOf(i) !== null) continue;
                if (Math.abs(this.v[i] - rest[i]) > T.MODE_JUMP && this.axisStill(i)) {
                    key = `m${i}`;
                    idx = i;
                    break;
                }
            }
            if (!this.held(key, T.SWITCH_MS) || idx < 0) return;
            this.mode = { index: idx, levels: [rest[idx], this.v[idx]], modes: [] };
            this.sortLevels();
            this.stage = 'done';
            this.found = { kind: 'axis', index: idx, invert: false };
            this.hold = null;
            this.progress = 0;
        }
        // go on collecting positions while the pilot flips through them (a 3-position switch)
        const m = this.mode;
        const v = this.v[m.index];
        const near = m.levels.some((l) => Math.abs(l - v) < T.LEVEL_TOL);
        if (!near && this.axisStill(m.index)) {
            if (!this.modeHold || Math.abs(this.modeHold.level - v) >= T.LEVEL_TOL) this.modeHold = { level: v, since: this.t };
            else if (this.t - this.modeHold.since >= T.SWITCH_MS) {
                m.levels.push(v);
                this.sortLevels();
                this.modeHold = null;
            }
        } else this.modeHold = null;
        if (m.levels.length < 3) this.hint = 'more-positions';
    }

    private sortLevels(): void {
        const m = this.mode!;
        m.levels.sort((a, b) => a - b);
        m.modes = (DEFAULT_MODES[m.levels.length] ?? m.levels.map((_, i) => (i === 0 ? 'acro' : 'angle'))).slice();
    }
}

function isFn(s: StepId): s is Fn {
    return s === 'roll' || s === 'pitch' || s === 'throttle' || s === 'yaw';
}
