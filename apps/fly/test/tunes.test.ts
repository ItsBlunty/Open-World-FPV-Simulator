// The flight controller's tunes (tunes.ts, owner 2026-10-21): SupaflyFPV's 5-inch preset by default with its idle,
// settings saved before the tunes get it too, a chosen tune is kept, and each tune's overrides compile in sim-core.

import { afterEach, describe, expect, it } from 'vitest';
import { compileParams } from '@owfpv/sim-core';
import type { ParamOverrides, PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings';
import { DEFAULT_TUNE, TUNES, tuneOverrides } from '../src/tunes';
import type { TuneId } from '../src/tunes';

function withStorage(v: unknown): void {
    const m = new Map<string, string>([['owfpv.settings', JSON.stringify(v)]]);
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, s: string) => m.set(k, s) };
}

describe('tunes', () => {
    afterEach(() => {
        delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it('defaults to SupaflyFPV 5" with its dynamic idle at 3000 rpm', () => {
        expect(DEFAULT_TUNE).toBe('supafly5');
        expect(DEFAULT_SETTINGS.tune).toBe('supafly5');
        expect(DEFAULT_SETTINGS.dynIdle).toBe(true);
        expect(DEFAULT_SETTINGS.dynIdleMinRpm).toBe(30);
    });

    it('settings saved before the tunes get the default tune and its idle; a chosen tune and idle are kept', () => {
        withStorage({ version: 1, dynIdle: false, motorIdle: 55 });
        const old = loadSettings();
        expect(old.tune).toBe('supafly5');
        expect(old.dynIdle).toBe(true);
        expect(old.dynIdleMinRpm).toBe(30);
        withStorage({ version: 1, tune: 'original', dynIdle: false, dynIdleMinRpm: 40 });
        const chosen = loadSettings();
        expect(chosen.tune).toBe('original');
        expect(chosen.dynIdle).toBe(false);
        expect(chosen.dynIdleMinRpm).toBe(40);
        withStorage({ version: 1, tune: 'nonsense' });
        expect(loadSettings().tune).toBe('supafly5');
    });

    it('SupaFly: the gains Betaflight 4.5.1 simplified_tuning.c makes of the preset\'s sliders, and its TPA, thrust linear, relax, anti-gravity', () => {
        const o: ParamOverrides = {};
        tuneOverrides('supafly5', o);
        // P = 45 x 1.15 x 1.10 = 56.9, I = 80 x 1.15 x 1.10 x 0.85 = 86.0, D = 30 x 1.15 x 1.05 = 36.2, F = 120 x 1.15 x 0.85 = 117.3
        expect(o.pid?.roll).toEqual([56, 86, 36, 117]);
        // pitch PI x 1.20, pitch D x 1.20: P 71.3, I 108.4, D 49.3, F 146.6
        expect(o.pid?.pitch).toEqual([71, 108, 49, 146]);
        expect(o.tpa).toEqual({ mode: 'PD', rate: 50, breakpoint: 1250, lowRate: 20, lowBreakpoint: 1100, lowAlways: true });
        expect(o.thrustLinear).toBe(30);
        expect(o.itermRelaxCutoff).toBe(10);
        expect(o.antiGravityGain).toBe(120);
    });

    it('gyro / PID loop at 4 kHz by default (owner 2026-10-21), 8 kHz kept when chosen, anything else back to 4 kHz', () => {
        expect(DEFAULT_SETTINGS.loopHz).toBe(4000);
        withStorage({ version: 1, loopHz: 8000 });
        expect(loadSettings().loopHz).toBe(8000);
        withStorage({ version: 1, loopHz: 1000 });
        expect(loadSettings().loopHz).toBe(4000);
    });

    it('every tune compiles; the original tune adds nothing (the simulator as before)', () => {
        for (const id of Object.keys(TUNES) as TuneId[]) {
            const o: ParamOverrides = {};
            tuneOverrides(id, o);
            expect(() => compileParams(nazgul as unknown as PresetJson, o), id).not.toThrow();
        }
        const o: ParamOverrides = {};
        tuneOverrides('original', o);
        expect(o).toEqual({});
    });
});
