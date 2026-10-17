// A saved radio setup (made by the calibration wizard, wizard.ts) and the mapping it describes: raw
// device frames in, sim-core's eight channels out (sim.ts header: 0 roll right +, 1 pitch forward +,
// 2 throttle -1 low .. +1 full, 3 yaw right +, 4 arm > 0.5 on, 5 flight mode, 6..7 spare).
//
// The mapped channels are what the runner logs, so replays never need the profile: calibration can
// change at any time without touching determinism.

import { MODE_CHANNEL } from '@owfpv/sim-core';
import type { FlightMode } from '@owfpv/sim-core';
import type { RawFrame } from './frame';

export type Fn = 'roll' | 'pitch' | 'throttle' | 'yaw';
export const FNS: readonly Fn[] = ['throttle', 'yaw', 'pitch', 'roll'];

/**
 * Transmitter stick modes, as EdgeTX's Radio Setup defines them (manual.edgetx.org, color radios,
 * Radio Setup, "Mode"): which function each stick axis drives.
 */
export type StickMode = 1 | 2 | 3 | 4;
export type StickAxis = 'left-h' | 'left-v' | 'right-h' | 'right-v';
export const STICK_MODES: Readonly<Record<StickMode, Readonly<Record<StickAxis, Fn>>>> = {
    1: { 'left-h': 'yaw', 'left-v': 'pitch', 'right-h': 'roll', 'right-v': 'throttle' },
    2: { 'left-h': 'yaw', 'left-v': 'throttle', 'right-h': 'roll', 'right-v': 'pitch' },
    3: { 'left-h': 'roll', 'left-v': 'pitch', 'right-h': 'yaw', 'right-v': 'throttle' },
    4: { 'left-h': 'roll', 'left-v': 'throttle', 'right-h': 'yaw', 'right-v': 'pitch' }
};

/** The stick axis that drives `fn` in a stick mode. */
export function stickOf(mode: StickMode, fn: Fn): StickAxis {
    const m = STICK_MODES[mode];
    for (const k of Object.keys(m) as StickAxis[]) if (m[k] === fn) return k;
    throw new Error(`no stick drives ${fn} in mode ${mode}`);
}

/** One stick function: the device axis, and its end and rest values as the wizard measured them. */
export interface AxisCal {
    index: number;
    /** the axis reads lower when the stick moves the function's + way (right, forward, throttle up) */
    invert: boolean;
    min: number;
    /** where the stick rests (throttle: unused, its low end is min or max) */
    center: number;
    max: number;
}

/** An on/off control: an axis past a threshold (a switch on a channel), or a button bit. */
export type SwitchMap =
    | { kind: 'axis'; index: number; threshold: number; onAbove: boolean }
    | { kind: 'button'; bit: number };

/** A multi-position switch on an axis: the levels it rests at, and the flight mode of each. */
export interface ModeSwitchMap {
    index: number;
    levels: number[];
    modes: FlightMode[];
}

export interface RadioProfile {
    version: 1;
    deviceKey: string;
    deviceName: string;
    stickMode: StickMode;
    axes: Record<Fn, AxisCal>;
    /** null: no arm switch; the page arms with a key instead */
    arm: SwitchMap | null;
    /** null: the flight mode comes from the settings */
    mode: ModeSwitchMap | null;
    /** null: no respawn switch; the page's key still works */
    reset: SwitchMap | null;
    /** stick deadband around the centre, fraction of the half range (0 = none) */
    deadband: number;
    created: string;
}

function clamp1(v: number): number {
    return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** A centred stick axis to -1..1: each side scaled by its own reach, inverted if needed, deadband applied. */
export function mapCentred(a: AxisCal, raw: number, deadband: number): number {
    const d = raw - a.center;
    const reach = d >= 0 ? a.max - a.center : a.center - a.min;
    let v = reach > 0 ? clamp1(d / reach) : 0;
    if (a.invert) v = -v;
    return applyDeadband(v, deadband);
}

/** Throttle to -1 (low) .. +1 (full) over its measured range. */
export function mapThrottle(a: AxisCal, raw: number): number {
    const span = a.max - a.min;
    if (!(span > 0)) return -1;
    let u = (raw - a.min) / span;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    if (a.invert) u = 1 - u;
    return u * 2 - 1;
}

/** Zero inside the band, then rescaled so full stick is still full: no jump at the band's edge. */
export function applyDeadband(x: number, db: number): number {
    if (!(db > 0)) return x;
    const m = x < 0 ? -x : x;
    if (m <= db) return 0;
    return ((m - db) / (1 - db)) * (x < 0 ? -1 : 1);
}

export function switchOn(s: SwitchMap | null, f: RawFrame): boolean {
    if (!s) return false;
    if (s.kind === 'button') return ((f.buttons >>> s.bit) & 1) === 1;
    const v = f.axes[s.index];
    return s.onAbove ? v > s.threshold : v < s.threshold;
}

/** The index of the level nearest `v`. */
export function nearestLevel(levels: readonly number[], v: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < levels.length; i++) {
        const d = Math.abs(levels[i] - v);
        if (d < bd) {
            bd = d;
            best = i;
        }
    }
    return best;
}

/** The flight mode the profile's switch selects now, or `fallback` without a switch. */
export function profileMode(p: RadioProfile, f: RawFrame, fallback: FlightMode): FlightMode {
    const m = p.mode;
    if (!m || m.levels.length === 0) return fallback;
    return m.modes[nearestLevel(m.levels, f.axes[m.index])] ?? fallback;
}

/**
 * The eight sim-core channels for one frame. `arm` overrides the profile's arm switch when given
 * (a profile without one arms by key); `fallbackMode` is the mode without a mode switch.
 */
export function mapFrame(p: RadioProfile, f: RawFrame, out: Float32Array, o: { arm?: boolean; fallbackMode?: FlightMode } = {}): Float32Array {
    const ax = p.axes;
    out[0] = mapCentred(ax.roll, f.axes[ax.roll.index], p.deadband);
    out[1] = mapCentred(ax.pitch, f.axes[ax.pitch.index], p.deadband);
    out[2] = mapThrottle(ax.throttle, f.axes[ax.throttle.index]);
    out[3] = mapCentred(ax.yaw, f.axes[ax.yaw.index], p.deadband);
    const armed = o.arm ?? switchOn(p.arm, f);
    out[4] = armed ? 1 : -1;
    out[5] = MODE_CHANNEL[profileMode(p, f, o.fallbackMode ?? 'acro')];
    out[6] = 0;
    out[7] = 0;
    return out;
}

/** Problems that make a stored profile unusable (bad JSON, old shape, an axis past the device's count), or null. */
export function profileProblem(p: unknown, nAxes: number): string | null {
    if (!p || typeof p !== 'object') return 'not an object';
    const q = p as Partial<RadioProfile>;
    if (q.version !== 1) return `unknown profile version ${String(q.version)}`;
    if (![1, 2, 3, 4].includes(q.stickMode as number)) return 'no stick mode';
    for (const fn of FNS) {
        const a = q.axes?.[fn];
        if (!a || !Number.isInteger(a.index) || a.index < 0 || a.index >= nAxes) return `no axis for ${fn}`;
        if (![a.min, a.center, a.max].every(Number.isFinite)) return `bad range for ${fn}`;
    }
    return null;
}
