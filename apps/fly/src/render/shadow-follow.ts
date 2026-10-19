// When the sun's shadow square moves (owner, 2026-10-18; docs/notes/browsers-input-performance.md §0l). Moving it re-writes the shadow data of every
// object that receives shadows; in Firefox those GPU writes allocate memory, and moving it every frame (as the camera
// crosses a 6 cm texel) made ~180 writes a frame instead of ~69, and the frames Firefox's garbage collector landed on
// stuttered. So the square stays put until the camera is RECENTRE_M from its centre across the sun's view, or
// RECENTRE_DEPTH_M along it. No Three.js here, so Node tests check it.

/** Across the sun's view: the square (SHADOW_REACHES) still covers at least its half side - 16 m round the camera (fog from 250 m). */
export const RECENTRE_M = 16;
/** Along the sun's view: the shadow camera's depth range (1200 m from 600 m up-sun) has room for this either way. */
export const RECENTRE_DEPTH_M = 100;

/** Whether the square centred at `centre` must move for a camera at `cam`; both in the light's frame (x, y across, z along). */
export function shadowNeedsRecentre(centre: { x: number; y: number; z: number } | null, cam: { x: number; y: number; z: number }): boolean {
    if (!centre) return true;
    const dx = cam.x - centre.x, dy = cam.y - centre.y;
    return dx * dx + dy * dy > RECENTRE_M * RECENTRE_M || Math.abs(cam.z - centre.z) > RECENTRE_DEPTH_M;
}

/**
 * How far the sun's shadows reach (owner, 2026-10-19: a setting, the pop-in at ~110 m was bad). `half` is half the
 * side of the shadowed square round the camera, m; `map` the shadow map's side, texels. Far keeps near's sharpness
 * (6 cm texels) with 4x the shadow memory (8192² depth, ~256 MB); farthest reaches twice as far again, softer (12 cm).
 * Shadows end at `half - RECENTRE_M` at the nearest.
 */
export const SHADOW_REACHES = {
    near: { half: 120, map: 4096 },
    far: { half: 250, map: 8192 },
    farthest: { half: 500, map: 8192 }
} as const;
export type ShadowReach = keyof typeof SHADOW_REACHES;
export const SHADOW_REACH_IDS = Object.keys(SHADOW_REACHES) as ShadowReach[];

export function isShadowReach(v: unknown): v is ShadowReach {
    return typeof v === 'string' && Object.hasOwn(SHADOW_REACHES, v);
}

/** The square and map for `reach`, with the map no bigger than the GPU's largest texture (`maxTexture`, texels). */
export function shadowReach(reach: ShadowReach, maxTexture: number): { half: number; map: number } {
    const r = SHADOW_REACHES[reach];
    return { half: r.half, map: Math.min(r.map, Math.max(1024, maxTexture)) };
}

/** How far each reach draws shadows, round metres, as the settings name it (the square's half side less up to 16 m). */
export const SHADOW_REACH_M: Record<ShadowReach, number> = { near: 110, far: 250, farthest: 500 };
