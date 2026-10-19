// The graphics levels (owner, 2026-10-19: "three low spec modes"): full graphics, and three low spec modes for weaker
// machines, each cheaper to draw than the last. All of them fly the same physics; only what is drawn changes, and in
// extra and super low spec the traffic is off (docs/notes/low-spec.md). No DOM: the page and the engine both read it.

/**
 * - full: WebGPURenderer, lit physically, shadows, fisheye lenses
 * - low: Three.js's classic WebGL 2 renderer, matte materials, no shadows or lens, 650 m view
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
