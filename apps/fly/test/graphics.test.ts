// The graphics levels (graphics.ts, render/kit.ts): the address's ?lowspec, the old low spec switch carried over, and
// what each low spec mode draws (owner, 2026-10-19: three low spec modes).

import { afterEach, describe, expect, it } from 'vitest';
import { cheaper, graphicsFromParam, graphicsName, isLowSpec, trafficAllowed } from '../src/graphics';
import { kitFor } from '../src/render/kit';
import { loadSettings } from '../src/settings';

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
