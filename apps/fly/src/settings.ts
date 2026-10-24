// The pilot's settings, kept in this browser (localStorage). None of them can break a replay: the
// sticks the runner logs are already mapped through the radio profile, and the rates go into each
// life's header as overrides. Every read and write is guarded: private windows and blocked storage
// just mean the defaults.

import { profileProblem } from '@owfpv/input';
import type { RadioProfile, StickMode } from '@owfpv/input';
import { DYN_IDLE_DEFAULTS, copyRates } from '@owfpv/sim-core';
import type { FlightMode, RatesConfig } from '@owfpv/sim-core';
import { DEFAULT_LENS, NO_LENS, lensById } from './render/lenses';
import { isGraphicsLevel } from './graphics';
import type { GraphicsLevel } from './graphics';
import { isShadowReach } from './render/shadow-follow';
import type { ShadowReach } from './render/shadow-follow';

export interface Settings {
    version: 1;
    /** FPV camera tilt up from the frame, deg (owner's default 20, 2026-10-17) */
    uptiltDeg: number;
    /** horizontal field of view, deg (owner's default 120, 2026-10-17) */
    fovDeg: number;
    /**
     * FPV camera lens: a Gyroflow calibration's id (render/lenses), or 'none' for the flat camera with the FOV slider.
     * Default the Caddx Ratel 2 (owner, 2026-10-18).
     */
    lens: string;
    /** the pilot's own rates; null flies the preset's */
    rates: RatesConfig | null;
    /** flight mode when the radio has no mode switch */
    mode: FlightMode;
    /** stick mode last chosen in the radio setup */
    stickMode: StickMode;
    spawn: string;
    /** the device last flown with, so the page reconnects to it */
    lastDevice: string | null;
    /**
     * damage and crashes (sim-core's crashOn). Off by default (owner, 2026-10-17: shelved for now, every hit is a
     * bounce and the quad keeps flying); the toggle brings the damage model back.
     */
    damage: boolean;
    /**
     * classic physics: sim-core/0.5.0's flight model (thrust from rotor speed alone) instead of the rotor inflow model
     * of sim-core/0.6.0, to go back and compare (owner, 2026-10-18). Off by default.
     */
    classicPhysics: boolean;
    /**
     * battery simulation: the pack drains as you fly and its voltage falls with it. Off by default (owner, 2026-10-19):
     * the pack stays full (sim-core's batteryDrain false; it still sags under load as a fresh pack does).
     */
    battery: boolean;
    /**
     * arming angle, degrees: arming needs the quad within this tilt of level (Betaflight's small_angle, sim-core's
     * smallAngleDeg). 180 by default (owner, 2026-10-20): arms at any tilt; 25 is Betaflight's default.
     */
    armAngle: number;
    /**
     * motor idle, tenths of a percent of full output (Betaflight's dshot_idle_value / 10, motor_idle / 10): 55 = 5.5 %,
     * Betaflight's default and the Nazgul's. Not used while dynamic idle is on (Betaflight 4.3+ ignores it then).
     */
    motorIdle: number;
    /**
     * Betaflight's dynamic idle (off by default, as in Betaflight). On: the slowest motor is held above a minimum rpm the
     * game picks from the quad's props (sim-core autoDynIdleMinRpm); the rest are Betaflight's dyn_idle_* in its units.
     */
    dynIdle: boolean;
    /** dyn_idle_max_increase (0.1 % steps, 10-255, default 150) and dyn_idle_start_increase (10-255, default 50) */
    dynIdleMaxIncrease: number;
    dynIdleStartIncrease: number;
    /** dyn_idle_p_gain, dyn_idle_i_gain (1-250), dyn_idle_d_gain (0-250), default 50 each */
    dynIdleP: number;
    dynIdleI: number;
    dynIdleD: number;
    /** solid cars on the city roads (owner, 2026-10-17: a toggle in the graphics and performance settings) */
    cars: boolean;
    /** solid people on the sidewalks */
    people: boolean;
    /** traffic lights, cars that queue and turn, people who wait at the crossings; off: simple loops round each block */
    signals: boolean;
    /** the steam train on the railway (owner, 2026-10-19: its own toggle); solid, like the cars */
    train: boolean;
    /** the airport's planes, tugs, air ambulance and people (owner, 2026-10-20); solid, like the trains */
    air: boolean;
    /** the sun's shadows (switching them takes a reload: toggling them live crashed Three.js) */
    shadows: boolean;
    /** how far the sun's shadows reach (render/shadow-follow.ts SHADOW_REACHES; owner, 2026-10-19). Applies live. */
    shadowReach: ShadowReach;
    /** render resolution as a share of the screen's (capped at 2 device pixels per CSS pixel, 1 in low spec mode) */
    renderScale: number;
    /**
     * full graphics or one of the three low spec modes (graphics.ts), for old laptops with a weak GPU or none. The physics
     * is the same in all of them. Applies on reload (docs/notes/low-spec.md). Was `lowSpec: boolean` before 2026-10-19.
     */
    graphics: GraphicsLevel;
    /**
     * the graphics level before the game dropped to super low spec by itself because the browser had no GPU (graphics.ts
     * noGpuSwitch; owner, 2026-10-24), null when it has not
     */
    noGpuFrom: GraphicsLevel | null;
    /** sound on or off (audio/audio.ts; the M key too) */
    sound: boolean;
    /**
     * volumes, 0-100: everything, the quad (motors, hits), the world (the trains), the ambience (the city, the park), the
     * game's beeps and chimes
     */
    volume: number;
    quadVolume: number;
    worldVolume: number;
    ambienceVolume: number;
    effectsVolume: number;
    /** the sound card's smallest buffer: sounds about 45 ms sooner; turns itself off if it crackles (audio/audio.ts) */
    soundLowLatency: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
    version: 1,
    uptiltDeg: 20,
    fovDeg: 120,
    lens: DEFAULT_LENS,
    rates: null,
    mode: 'acro',
    stickMode: 2,
    spawn: 'park',
    lastDevice: null,
    damage: false,
    classicPhysics: false,
    battery: false,
    armAngle: 180,
    motorIdle: 55,
    dynIdle: false,
    dynIdleMaxIncrease: DYN_IDLE_DEFAULTS.maxIncrease,
    dynIdleStartIncrease: DYN_IDLE_DEFAULTS.startIncrease,
    dynIdleP: DYN_IDLE_DEFAULTS.p,
    dynIdleI: DYN_IDLE_DEFAULTS.i,
    dynIdleD: DYN_IDLE_DEFAULTS.d,
    cars: true,
    people: true,
    signals: true,
    train: true,
    air: true,
    shadows: true,
    shadowReach: 'near',
    renderScale: 1,
    graphics: 'full',
    noGpuFrom: null,
    sound: true,
    volume: 80,
    quadVolume: 100,
    worldVolume: 80,
    // low by default, with room above (owner, 2026-10-19): 50 is 12 dB under the trains
    ambienceVolume: 50,
    effectsVolume: 80,
    soundLowLatency: true
};

const KEY = 'owfpv.settings';
const PROFILES = 'owfpv.radioProfiles';

function read(key: string): unknown {
    try {
        const s = localStorage.getItem(key);
        return s ? (JSON.parse(s) as unknown) : null;
    } catch {
        return null;
    }
}

function write(key: string, v: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(v));
    } catch {
        // storage blocked or full: the settings last for this visit only
    }
}

export function loadSettings(): Settings {
    const s = read(KEY) as Partial<Settings> | null;
    const out: Settings = { ...DEFAULT_SETTINGS };
    if (!s || s.version !== 1) return out;
    if (typeof s.uptiltDeg === 'number' && s.uptiltDeg >= 0 && s.uptiltDeg <= 80) out.uptiltDeg = s.uptiltDeg;
    if (typeof s.fovDeg === 'number' && s.fovDeg >= 60 && s.fovDeg <= 160) out.fovDeg = s.fovDeg;
    if (s.lens === NO_LENS || (typeof s.lens === 'string' && lensById(s.lens))) out.lens = s.lens;
    if (s.rates && typeof s.rates === 'object') out.rates = copyRates(s.rates);
    if (s.mode === 'acro' || s.mode === 'angle' || s.mode === 'horizon') out.mode = s.mode;
    if (s.stickMode === 1 || s.stickMode === 2 || s.stickMode === 3 || s.stickMode === 4) out.stickMode = s.stickMode;
    if (typeof s.spawn === 'string') out.spawn = s.spawn;
    if (typeof s.lastDevice === 'string') out.lastDevice = s.lastDevice;
    if (typeof s.damage === 'boolean') out.damage = s.damage;
    if (typeof s.classicPhysics === 'boolean') out.classicPhysics = s.classicPhysics;
    if (typeof s.battery === 'boolean') out.battery = s.battery;
    if (typeof s.armAngle === 'number' && s.armAngle >= 0 && s.armAngle <= 180) out.armAngle = Math.round(s.armAngle);
    // Betaflight's ranges (cli/settings.c): idle 0-2000 (here tenths of a percent, 0-200), dyn_idle_* as noted above
    const whole = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && v >= lo && v <= hi ? Math.round(v) : null);
    out.motorIdle = whole(s.motorIdle, 0, 200) ?? out.motorIdle;
    if (typeof s.dynIdle === 'boolean') out.dynIdle = s.dynIdle;
    out.dynIdleMaxIncrease = whole(s.dynIdleMaxIncrease, 10, 255) ?? out.dynIdleMaxIncrease;
    out.dynIdleStartIncrease = whole(s.dynIdleStartIncrease, 10, 255) ?? out.dynIdleStartIncrease;
    out.dynIdleP = whole(s.dynIdleP, 1, 250) ?? out.dynIdleP;
    out.dynIdleI = whole(s.dynIdleI, 1, 250) ?? out.dynIdleI;
    out.dynIdleD = whole(s.dynIdleD, 0, 250) ?? out.dynIdleD;
    if (typeof s.cars === 'boolean') out.cars = s.cars;
    if (typeof s.people === 'boolean') out.people = s.people;
    if (typeof s.signals === 'boolean') out.signals = s.signals;
    if (typeof s.train === 'boolean') out.train = s.train;
    if (typeof s.air === 'boolean') out.air = s.air;
    if (typeof s.shadows === 'boolean') out.shadows = s.shadows;
    if (isShadowReach(s.shadowReach)) out.shadowReach = s.shadowReach;
    if (typeof s.renderScale === 'number' && s.renderScale >= 0.5 && s.renderScale <= 1) out.renderScale = s.renderScale;
    if (typeof s.sound === 'boolean') out.sound = s.sound;
    if (typeof s.soundLowLatency === 'boolean') out.soundLowLatency = s.soundLowLatency;
    for (const k of ['volume', 'quadVolume', 'worldVolume', 'ambienceVolume', 'effectsVolume'] as const) {
        const v = s[k];
        if (typeof v === 'number' && v >= 0 && v <= 100) out[k] = Math.round(v);
    }
    if (isGraphicsLevel(s.noGpuFrom)) out.noGpuFrom = s.noGpuFrom;
    if (isGraphicsLevel(s.graphics)) out.graphics = s.graphics;
    // the old low spec switch (2026-10-18): on means low spec
    else if ((s as { lowSpec?: unknown }).lowSpec === true) out.graphics = 'low';
    return out;
}

export function saveSettings(s: Settings): void {
    write(KEY, s);
}

/**
 * Settings > Help and about > Default settings (owner, 2026-10-19): every setting back to its default. The radio
 * stays as it was: the device to reconnect to and the stick mode come from the radio setup, not from the Settings screen.
 */
export function defaultSettings(now: Settings): Settings {
    return { ...DEFAULT_SETTINGS, lastDevice: now.lastDevice, stickMode: now.stickMode };
}

/** Settings > Help and about > Clear all data: everything this game keeps in localStorage (its keys start "owfpv."). */
export function clearStoredSettings(): void {
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith('owfpv.')) keys.push(k);
        }
        for (const k of keys) localStorage.removeItem(k);
    } catch {
        // storage blocked: there is nothing kept to clear
    }
}

/** The golden props each map's pilot has taken, by map id, by number (owner, 2026-10-18). */
const COLLECTION = 'owfpv.goldenProps';

export function loadCollection(): Record<string, number[]> {
    const c = read(COLLECTION);
    const out: Record<string, number[]> = {};
    if (!c || typeof c !== 'object') return out;
    for (const [map, ns] of Object.entries(c as Record<string, unknown>)) {
        if (Array.isArray(ns)) out[map] = ns.filter((n): n is number => Number.isInteger(n) && n >= 1);
    }
    return out;
}

export function saveCollection(c: Record<string, number[]>): void {
    write(COLLECTION, c);
}

/** The time trial times (owner, 2026-10-19), as trial-times.ts keeps them: by map id, by course id and version. */
const TRIAL_TIMES = 'owfpv.timeTrials';

export function loadTrialTimesRaw(): unknown {
    return read(TRIAL_TIMES);
}

export function saveTrialTimesRaw(t: unknown): void {
    write(TRIAL_TIMES, t);
}

/** The courses made in the time trial creator (owner, 2026-10-20), as course-store.ts keeps them: by map id. */
const COURSES = 'owfpv.courses';

export function loadCoursesRaw(): unknown {
    return read(COURSES);
}

/** false: the browser would not keep them (storage blocked or full) */
export function saveCoursesRaw(c: unknown): boolean {
    try {
        localStorage.setItem(COURSES, JSON.stringify(c));
        return true;
    } catch {
        return false;
    }
}


function allProfiles(): Record<string, RadioProfile> {
    const p = read(PROFILES);
    return p && typeof p === 'object' ? (p as Record<string, RadioProfile>) : {};
}

/** The saved profile for a device key, if it is still usable. */
export function loadProfile(key: string, nAxes = 8): RadioProfile | null {
    const p = allProfiles()[key];
    return p && profileProblem(p, nAxes) === null ? p : null;
}

export function saveProfile(p: RadioProfile): void {
    const all = allProfiles();
    all[p.deviceKey] = p;
    write(PROFILES, all);
}
