// The graphics levels (graphics.ts, render/kit.ts): the address's ?lowspec, the old low spec switch carried over, and
// what each low spec mode draws (owner, 2026-10-19: three low spec modes).

import { afterEach, describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, applyPreset, cheaper, cheaperPreset, graphicsFromParam, graphicsName, isLowSpec, presetOf, trafficAllowed } from '../src/graphics';
import type { GraphicsChoice } from '../src/graphics';
import { kitFor } from '../src/render/kit';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings';

function withStorage(v: unknown): void {
    const m = new Map<string, string>([['owfpv.settings', JSON.stringify(v)]]);
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, s: string) => m.set(k, s) };
}

describe('graphics levels', () => {
    afterEach(() => {
        delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it('reads ?lowspec', () => {
        expect(graphicsFromParam(null)).toBe(null);
        expect(graphicsFromParam('')).toBe('low');
        expect(graphicsFromParam('1')).toBe('low');
        expect(graphicsFromParam('0')).toBe('full');
        expect(graphicsFromParam('extra')).toBe('extra');
        expect(graphicsFromParam('super')).toBe('super');
        expect(graphicsFromParam('ultra')).toBe(null);
    });

    it('carries the old low spec switch over, and keeps a saved level', () => {
        withStorage({ version: 1, lowSpec: true });
        expect(loadSettings().graphics).toBe('low');
        withStorage({ version: 1, lowSpec: false });
        expect(loadSettings().graphics).toBe('full');
        withStorage({ version: 1, graphics: 'super', lowSpec: true });
        expect(loadSettings().graphics).toBe('super');
        withStorage({ version: 1, graphics: 'bogus' });
        expect(loadSettings().graphics).toBe('full');
    });

    it('turns traffic off in extra and super low spec only', () => {
        expect([trafficAllowed('full'), trafficAllowed('low'), trafficAllowed('extra'), trafficAllowed('super')]).toEqual([true, true, false, false]);
        expect([isLowSpec('full'), isLowSpec('low'), isLowSpec('super')]).toEqual([false, true, true]);
    });

    it('points at the next cheaper level', () => {
        expect([cheaper('full'), cheaper('low'), cheaper('extra'), cheaper('super')]).toEqual(['low', 'extra', 'super', null]);
        expect(graphicsName('extra')).toBe('extra low spec');
    });

    it('draws extra low spec at half resolution to 300 m, super at a quarter to 200 m, neither with doors or signs', () => {
        const low = kitFor('low'), extra = kitFor('extra'), sup = kitFor('super');
        expect([low.resolution, low.details, low.fog.far]).toEqual([null, true, 650]);
        expect([extra.resolution, extra.details, extra.lowSpec]).toEqual([0.5, false, true]);
        expect(extra.fog.far).toBeLessThanOrEqual(300);
        expect([sup.resolution, sup.details]).toEqual([0.25, false]);
        expect(sup.fog.far).toBeLessThanOrEqual(200);
    });
});

describe('quality presets', () => {
    const base = (): GraphicsChoice => ({ graphics: 'full', shadows: true, shadowReach: 'near', renderScale: 1 });

    it('the default settings are Medium', () => {
        expect(presetOf(DEFAULT_SETTINGS)).toBe('medium');
    });

    it('each preset reads back as itself once applied, from any start', () => {
        for (const start of QUALITY_PRESETS) {
            for (const p of QUALITY_PRESETS) {
                const c = base();
                applyPreset(c, start);
                applyPreset(c, p);
                expect(presetOf(c)).toBe(p);
            }
        }
    });

    it('High is Medium with shadows to 250 m', () => {
        const c = base();
        expect(presetOf(c)).toBe('medium');
        c.shadowReach = 'far';
        expect(presetOf(c)).toBe('high');
    });

    it('Ultra (owner, 2026-10-24) is High with shadows to 1000 m, and suggests High when slow', () => {
        const c = base();
        c.shadowReach = 'ultra';
        expect(presetOf(c)).toBe('ultra');
        expect(cheaperPreset(c)).toBe('high');
        expect(QUALITY_PRESETS[0]).toBe('ultra');
    });

    it('changing a detail makes it custom; low spec presets ignore the shadow choice', () => {
        expect(presetOf({ ...base(), renderScale: 0.8 })).toBe('custom');
        expect(presetOf({ ...base(), shadows: false })).toBe('custom');
        expect(presetOf({ ...base(), graphics: 'low', shadows: false })).toBe('low');
        expect(presetOf({ ...base(), graphics: 'low', renderScale: 0.7 })).toBe('custom');
        expect(presetOf({ ...base(), graphics: 'super', renderScale: 0.5 })).toBe('super');
    });

    it('suggests the next cheaper preset, none past super low', () => {
        expect(cheaperPreset({ ...base(), shadowReach: 'far' })).toBe('medium');
        expect(cheaperPreset(base())).toBe('low');
        expect(cheaperPreset({ ...base(), graphics: 'super' })).toBeNull();
        // a custom full-graphics mix: the first low spec preset
        expect(cheaperPreset({ ...base(), renderScale: 0.6 })).toBe('low');
        expect(cheaperPreset({ ...base(), graphics: 'low', renderScale: 0.6 })).toBe('verylow');
    });
});
