// When the sun's shadow square moves (owner, 2026-10-18; HANDOFF.md §0l). Moving it re-writes the shadow data of every
// object that receives shadows; in Firefox those GPU writes allocate memory, and moving it every frame (as the camera
// crosses a 6 cm texel) made ~180 writes a frame instead of ~69, and the frames Firefox's garbage collector landed on
// stuttered. So the square stays put until the camera is RECENTRE_M from its centre across the sun's view, or
// RECENTRE_DEPTH_M along it. No Three.js here, so Node tests check it.

/** Across the sun's view: the 240 m square still covers at least 120 - 16 = 104 m round the camera (fog from 250 m). */
export const RECENTRE_M = 16;
/** Along the sun's view: the shadow camera's depth range (1200 m from 600 m up-sun) has room for this either way. */
export const RECENTRE_DEPTH_M = 100;

/** Whether the square centred at `centre` must move for a camera at `cam`; both in the light's frame (x, y across, z along). */
export function shadowNeedsRecentre(centre: { x: number; y: number; z: number } | null, cam: { x: number; y: number; z: number }): boolean {
    if (!centre) return true;
    const dx = cam.x - centre.x, dy = cam.y - centre.y;
    return dx * dx + dy * dy > RECENTRE_M * RECENTRE_M || Math.abs(cam.z - centre.z) > RECENTRE_DEPTH_M;
}
