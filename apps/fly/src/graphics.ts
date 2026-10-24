// The graphics levels (owner, 2026-10-19: "three low spec modes"): full graphics, and three low spec modes for weaker
// machines, each cheaper to draw than the last. All of them fly the same physics; only what is drawn changes, and in
// extra and super low spec the traffic is off (docs/notes/low-spec.md). No DOM: the page and the engine both read it.

import type { ShadowReach } from './render/shadow-follow';

/**
 * - full: WebGPURenderer, lit physically, shadows, fisheye lenses
 * - low: Three.js's classic WebGL 2 renderer, matte materials, no shadows, a cheaper lens (render/fisheye.ts), 650 m view
 * - extra: low, plus half resolution, 300 m view, no cars, people or traffic lights, no doors or signs
 * - super: extra, at a quarter resolution and a 200 m view, for no GPU at all and an old CPU
 */
export type GraphicsLevel = 'full' | 'low' | 'extra' | 'super';

export const GRAPHICS_LEVELS: readonly GraphicsLevel[] = ['full', 'low', 'extra', 'super'];

export function isGraphicsLevel(v: unknown): v is GraphicsLevel {
    return typeof v === 'string' && (GRAPHICS_LEVELS as readonly string[]).includes(v);
}

/** Its name on screen ("low spec", "extra low spec", ...). */
export function graphicsName(g: GraphicsLevel): string {
    return g === 'full' ? 'full graphics' : g === 'low' ? 'low spec' : `${g} low spec`;
}

/** Drawn by the classic WebGL renderer with matte materials (every low spec mode). */
export function isLowSpec(g: GraphicsLevel): boolean {
    return g !== 'full';
}

/** Cars, people and traffic lights can be on (off in extra and super low spec: they cost a quarter of the frame rate). */
export function trafficAllowed(g: GraphicsLevel): boolean {
    return g === 'full' || g === 'low';
}

/** The next cheaper level, or null from the cheapest. */
export function cheaper(g: GraphicsLevel): GraphicsLevel | null {
    return GRAPHICS_LEVELS[GRAPHICS_LEVELS.indexOf(g) + 1] ?? null;
}

/**
 * The address's ?lowspec, if it says a level for this visit: `?lowspec` low spec, `?lowspec=extra`, `?lowspec=super`,
 * `?lowspec=0` full graphics. Null when the address says nothing (or something unknown): the setting applies.
 */
export function graphicsFromParam(v: string | null): GraphicsLevel | null {
    if (v === null) return null;
    if (v === '' || v === '1' || v === 'low') return 'low';
    if (v === '0' || v === 'full') return 'full';
    if (v === 'extra' || v === 'super') return v;
    return null;
}

/**
 * Whether the browser draws in software, with no graphics card (owner, 2026-10-24: "drop to super low spec by itself").
 * `caveatOk`: a WebGL context asked with failIfMajorPerformanceCaveat was given, which the browser refuses when it would
 * draw slowly; `name` the renderer it names (WEBGL_debug_renderer_info). Chrome with hardware acceleration off on Windows
 * names "Microsoft Basic Render Driver" (WARP) and refuses the context (measured 2026-10-24, docs/notes/low-spec.md §2k);
 * SwiftShader and Mesa's llvmpipe / softpipe are the software drawers elsewhere. No WebGL at all: false (nothing to switch to).
 */
export function drawsInSoftware(name: string | null, caveatOk: boolean): boolean {
    if (name === null) return false;
    return !caveatOk || /swiftshader|basic render driver|llvmpipe|softpipe|software (rasterizer|renderer)/i.test(name);
}

/**
 * The graphics level to run this visit, and the setting's new values, from the saved level, what it was before a
 * switch for no GPU (null: no switch), and whether the browser draws in software now. The first visit with no GPU
 * drops to super low spec and remembers the level it had; a later visit with a GPU puts that level back unless the
 * pilot has chosen another since. While still with no GPU, the pilot's own choice stands.
 */
export function noGpuSwitch(saved: GraphicsLevel, from: GraphicsLevel | null, software: boolean): { graphics: GraphicsLevel; from: GraphicsLevel | null; changed: 'down' | 'back' | null } {
    if (software) {
        if (from === null && saved !== 'super') return { graphics: 'super', from: saved, changed: 'down' };
        return { graphics: saved, from, changed: null };
    }
    if (from === null) return { graphics: saved, from, changed: null };
    return saved === 'super' ? { graphics: from, from: null, changed: 'back' } : { graphics: saved, from: null, changed: null };
}

/**
 * How far full graphics sees (owner, 2026-10-24: "longer view distance at ultra and high"): the distance fog's start and
 * where it hides everything, m. Near is the view full graphics always had; the map's grass reaches 10 km (packages/maps
 * first-map.ts FAR_GROUND), past farthest's haze from anywhere on the map. The low spec levels keep their own (render/kit.ts).
 */
export const VIEW_DISTANCES = {
    near: { near: 250, far: 1600 },
    far: { near: 400, far: 3000 },
    farthest: { near: 600, far: 6000 }
} as const;
export type ViewDistance = keyof typeof VIEW_DISTANCES;
export const VIEW_DISTANCE_IDS = Object.keys(VIEW_DISTANCES) as ViewDistance[];

export function isViewDistance(v: unknown): v is ViewDistance {
    return typeof v === 'string' && Object.hasOwn(VIEW_DISTANCES, v);
}

/**
 * The quality presets at the top of Settings > Graphics, as games have them (owner, 2026-10-19): Ultra (2026-10-24), High
 * and Medium draw with the full renderer and differ in how far the shadows reach; Low, Very low and Super low are the three low spec
 * levels. Any other mix of the details under them is "custom".
 */
export type QualityPreset = 'ultra' | 'high' | 'medium' | 'low' | 'verylow' | 'super';

export const QUALITY_PRESETS: readonly QualityPreset[] = ['ultra', 'high', 'medium', 'low', 'verylow', 'super'];

/** The settings a preset sets (a subset of Settings, so this file needs no DOM or storage). */
export interface GraphicsChoice {
    graphics: GraphicsLevel;
    shadows: boolean;
    shadowReach: ShadowReach;
    viewDistance: ViewDistance;
    /** the clouds (render/clouds.ts), full graphics only */
    clouds: boolean;
    renderScale: number;
}

/**
 * What each preset sets. The low spec levels draw no shadows and keep their own view, so their presets leave the shadow
 * and view choices as they were.
 */
export const PRESETS: Readonly<Record<QualityPreset, Readonly<Partial<GraphicsChoice>> & { graphics: GraphicsLevel }>> = {
    // (owner, 2026-10-24) for GPUs with more memory: shadows to 1000 m (render/shadow-follow.ts); the view to 6 km, High's
    // to 3 km (owner, 2026-10-24); clouds in all three (cheap stylised puffs, owner 2026-10-24)
    ultra: { graphics: 'full', shadows: true, shadowReach: 'ultra', viewDistance: 'farthest', clouds: true, renderScale: 1 },
    high: { graphics: 'full', shadows: true, shadowReach: 'far', viewDistance: 'far', clouds: true, renderScale: 1 },
    medium: { graphics: 'full', shadows: true, shadowReach: 'near', viewDistance: 'near', clouds: true, renderScale: 1 },
    low: { graphics: 'low', renderScale: 1 },
    // extra and super low spec fix their own resolution (render/kit.ts), so the slider's value does not matter there
    verylow: { graphics: 'extra' },
    super: { graphics: 'super' }
};

export const PRESET_NAMES: Record<QualityPreset | 'custom', string> = {
    ultra: 'Ultra', high: 'High', medium: 'Medium', low: 'Low', verylow: 'Very low', super: 'Super low', custom: 'Custom'
};

/** The preset these settings are, or 'custom'. */
export function presetOf(c: GraphicsChoice): QualityPreset | 'custom' {
    for (const p of QUALITY_PRESETS) {
        const want = PRESETS[p];
        if (Object.entries(want).every(([k, v]) => c[k as keyof GraphicsChoice] === v)) return p;
    }
    return 'custom';
}

/** Set the settings `c` to preset `p` (the fields it does not name stay). */
export function applyPreset(c: GraphicsChoice, p: QualityPreset): void {
    Object.assign(c, PRESETS[p]);
}

/**
 * The next cheaper preset to suggest when the game runs slowly, or null from super low. From a custom mix: the first
 * preset on a cheaper level than its own (from full graphics, Low).
 */
export function cheaperPreset(c: GraphicsChoice): QualityPreset | null {
    const p = presetOf(c);
    if (p !== 'custom') return QUALITY_PRESETS[QUALITY_PRESETS.indexOf(p) + 1] ?? null;
    const next = cheaper(c.graphics);
    return next ? QUALITY_PRESETS.find((q) => PRESETS[q].graphics === next) ?? null : null;
}
