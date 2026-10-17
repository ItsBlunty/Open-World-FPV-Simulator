// The pilot's settings, kept in this browser (localStorage). None of them can break a replay: the
// sticks the runner logs are already mapped through the radio profile, and the rates go into each
// life's header as overrides. Every read and write is guarded: private windows and blocked storage
// just mean the defaults.

import { profileProblem } from '@owfpv/input';
import type { RadioProfile, StickMode } from '@owfpv/input';
import { copyRates } from '@owfpv/sim-core';
import type { FlightMode, RatesConfig } from '@owfpv/sim-core';

export interface Settings {
    version: 1;
    /** FPV camera tilt up from the frame, deg (owner's default 20, 2026-10-17) */
    uptiltDeg: number;
    /** horizontal field of view, deg (owner's default 120, 2026-10-17) */
    fovDeg: number;
    /** the pilot's own rates; null flies the preset's */
    rates: RatesConfig | null;
    /** flight mode when the radio has no mode switch */
    mode: FlightMode;
    /** stick mode last chosen in the radio setup */
    stickMode: StickMode;
    spawn: string;
    /** the device last flown with, so the page reconnects to it */
    lastDevice: string | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
    version: 1,
    uptiltDeg: 20,
    fovDeg: 120,
    rates: null,
    mode: 'acro',
    stickMode: 2,
    spawn: 'park',
    lastDevice: null
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
    if (s.rates && typeof s.rates === 'object') out.rates = copyRates(s.rates);
    if (s.mode === 'acro' || s.mode === 'angle' || s.mode === 'horizon') out.mode = s.mode;
    if (s.stickMode === 1 || s.stickMode === 2 || s.stickMode === 3 || s.stickMode === 4) out.stickMode = s.stickMode;
    if (typeof s.spawn === 'string') out.spawn = s.spawn;
    if (typeof s.lastDevice === 'string') out.lastDevice = s.lastDevice;
    return out;
}

export function saveSettings(s: Settings): void {
    write(KEY, s);
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
