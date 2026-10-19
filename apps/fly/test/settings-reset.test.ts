// Settings > Help and about (owner, 2026-10-19): Default settings keeps the radio, Clear all data forgets only this
// game's keys.

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, clearStoredSettings, defaultSettings } from '../src/settings';

describe('resetting what the browser keeps', () => {
    afterEach(() => {
        delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it('default settings put every setting back but keep the radio', () => {
        const now = { ...DEFAULT_SETTINGS, fovDeg: 99, spawn: 'yard', damage: true, graphics: 'super' as const, lastDevice: 'hid:1234', stickMode: 1 as const };
        expect(defaultSettings(now)).toEqual({ ...DEFAULT_SETTINGS, lastDevice: 'hid:1234', stickMode: 1 });
    });

    it('clear all data removes the owfpv keys and nothing else', () => {
        const m = new Map([['owfpv.settings', '{}'], ['owfpv.goldenProps', '{}'], ['owfpv.timeTrials', '{}'], ['owfpv.radioProfiles', '{}'], ['other', 'x']]);
        (globalThis as { localStorage?: unknown }).localStorage = {
            get length() { return m.size; },
            key: (i: number) => [...m.keys()][i] ?? null,
            removeItem: (k: string) => m.delete(k)
        };
        clearStoredSettings();
        expect([...m.keys()]).toEqual(['other']);
    });
});
