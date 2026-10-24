// The graphics levels (graphics.ts, render/kit.ts): the address's ?lowspec, the old low spec switch carried over, and
// what each low spec mode draws (owner, 2026-10-19: three low spec modes).

import { afterEach, describe, expect, it } from 'vitest';
import { PRESETS, QUALITY_PRESETS, VIEW_DISTANCES, VIEW_DISTANCE_IDS, applyPreset, cheaper, cheaperPreset, drawsInSoftware, graphicsFromParam, noGpuSwitch, graphicsName, isLowSpec, presetOf, trafficAllowed } from '../src/graphics';
import type { GraphicsChoice, QualityPreset } from '../src/graphics';
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

    it('keeps a saved Ultra or High preset itself when the view distance came in', () => {
        withStorage({ version: 1, graphics: 'full', shadows: true, shadowReach: 'ultra', renderScale: 1 });
        expect(presetOf(loadSettings())).toBe('ultra');
        withStorage({ version: 1, graphics: 'full', shadows: true, shadowReach: 'far', renderScale: 1 });
        expect(presetOf(loadSettings())).toBe('high');
        withStorage({ version: 1, graphics: 'full', shadows: true, shadowReach: 'near', renderScale: 1 });
        expect(presetOf(loadSettings())).toBe('medium');
        withStorage({ version: 1, shadowReach: 'ultra', viewDistance: 'near', clouds: false });
        expect([loadSettings().viewDistance, loadSettings().clouds]).toEqual(['near', false]);
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
    const base = (): GraphicsChoice => ({ graphics: 'full', shadows: true, shadowReach: 'near', viewDistance: 'near', clouds: false, renderScale: 1 });

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

    it('High is Medium with shadows to 250 m, a 3 km view and clouds', () => {
        const c = base();
        expect(presetOf(c)).toBe('medium');
        c.shadowReach = 'far';
        expect(presetOf(c)).toBe('custom');
        c.viewDistance = 'far';
        expect(presetOf(c)).toBe('custom');
        c.clouds = true;
        expect(presetOf(c)).toBe('high');
    });

    it('Ultra (owner, 2026-10-24) is High with shadows to 1000 m and a 6 km view, and suggests High when slow', () => {
        const c = base();
        c.shadowReach = 'ultra';
        c.viewDistance = 'farthest';
        c.clouds = true;
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
        expect(presetOf({ ...base(), graphics: 'low', viewDistance: 'farthest' })).toBe('low');
        expect(presetOf({ ...base(), viewDistance: 'far' })).toBe('custom');
    });

    it('sees further at High and Ultra (owner, 2026-10-24: "longer view distance at ultra and high")', () => {
        const fog = (p: QualityPreset): number => VIEW_DISTANCES[PRESETS[p].viewDistance!].far;
        expect([fog('medium'), fog('high'), fog('ultra')]).toEqual([1600, 3000, 6000]);
        // Medium keeps the view full graphics always had
        expect(kitFor('full').fog).toEqual(VIEW_DISTANCES.near);
        for (const v of VIEW_DISTANCE_IDS) expect(VIEW_DISTANCES[v].near).toBeLessThan(VIEW_DISTANCES[v].far);
    });

    it('suggests the next cheaper preset, none past super low', () => {
        expect(cheaperPreset({ ...base(), shadowReach: 'far', viewDistance: 'far', clouds: true })).toBe('medium');
        expect(cheaperPreset(base())).toBe('low');
        expect(cheaperPreset({ ...base(), graphics: 'super' })).toBeNull();
        // a custom full-graphics mix: the first low spec preset
        expect(cheaperPreset({ ...base(), renderScale: 0.6 })).toBe('low');
        expect(cheaperPreset({ ...base(), graphics: 'low', renderScale: 0.6 })).toBe('verylow');
    });
});

describe('no GPU: super low spec by itself (owner, 2026-10-24)', () => {
    it('tells software drawing from a GPU', () => {
        // measured on this PC (headless Chrome 155): with a GPU, and with --disable-gpu (hardware acceleration off)
        expect(drawsInSoftware('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11)', true)).toBe(false);
        expect(drawsInSoftware('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', false)).toBe(true);
        expect(drawsInSoftware('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', true)).toBe(true);
        expect(drawsInSoftware('llvmpipe (LLVM 15.0.7, 256 bits)', true)).toBe(true);
        // the browser refusing a fast-only context is enough, whatever it names
        expect(drawsInSoftware('ANGLE (Intel, Intel(R) HD Graphics 3000)', false)).toBe(true);
        // no WebGL at all: nothing to switch to
        expect(drawsInSoftware(null, false)).toBe(false);
    });

    it('drops to super once, remembers the level, and puts it back when a GPU is found', () => {
        expect(noGpuSwitch('full', null, true)).toEqual({ graphics: 'super', from: 'full', changed: 'down' });
        // still no GPU: stays, and a level the pilot picks since stands
        expect(noGpuSwitch('super', 'full', true)).toEqual({ graphics: 'super', from: 'full', changed: null });
        expect(noGpuSwitch('low', 'full', true)).toEqual({ graphics: 'low', from: 'full', changed: null });
        // a GPU again: back to full; or the pilot's own pick kept
        expect(noGpuSwitch('super', 'full', false)).toEqual({ graphics: 'full', from: null, changed: 'back' });
        expect(noGpuSwitch('low', 'full', false)).toEqual({ graphics: 'low', from: null, changed: null });
        // super chosen by the pilot: nothing to do either way
        expect(noGpuSwitch('super', null, true)).toEqual({ graphics: 'super', from: null, changed: null });
        expect(noGpuSwitch('full', null, false)).toEqual({ graphics: 'full', from: null, changed: null });
    });
});
