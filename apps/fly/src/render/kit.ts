// The materials and detail the scene is built with, for the renderer that draws it. The full kit: Three.js's
// WebGPURenderer (WebGPU, or WebGL 2) with node materials lit physically. The low spec kit (Settings > Graphics > Low spec
// mode, or ?lowspec): Three.js's classic WebGLRenderer with matte (Lambert) materials and fewer segments on round
// parts, for laptops with barely a GPU. Extra and super low spec (graphics.ts) draw that at a fixed lower resolution,
// with a nearer fog and without the buildings' doors and signs, for no GPU at all (docs/notes/low-spec.md). Rendering
// only: nothing here reaches the sim.

import * as THREE from 'three/webgpu';
import type { GraphicsLevel } from '../graphics';

/** Fog from `near` to `far`, m; in low spec the camera sees no further than `far` (view.ts), so what lies past it is not drawn. */
export interface Fog {
    near: number;
    far: number;
}

export const FULL_FOG: Fog = { near: 250, far: 1600 };
/** Low spec mode's fog, m: nearer than the full kit's */
export const LOW_SPEC_FOG: Fog = { near: 160, far: 650 };
/** Extra low spec: the city out to 300 m (owner, 2026-10-19) */
export const EXTRA_LOW_FOG: Fog = { near: 120, far: 290 };
/** Super low spec: out to 200 m, the nearest that held 60 fps with no GPU on 2 cores (docs/notes/low-spec.md) */
export const SUPER_LOW_FOG: Fog = { near: 80, far: 195 };

export interface MatOptions {
    color?: number;
    roughness?: number;
    metalness?: number;
    map?: THREE.Texture | null;
    emissive?: number;
    transparent?: boolean;
    opacity?: number;
    side?: THREE.Side;
    depthWrite?: boolean;
}

export interface Kit {
    readonly graphics: GraphicsLevel;
    readonly lowSpec: boolean;
    readonly fog: Fog;
    /** the drawing's resolution per CSS pixel, fixed by the level (the resolution slider then does not apply); null: the slider's */
    readonly resolution: number | null;
    /** the buildings' doors and name signs (not solid: drawn only) */
    readonly details: boolean;
    /** a lit surface (the full kit's physically lit material, the low spec kit's matte one) */
    lit(o?: MatOptions): THREE.Material;
    /** an unlit colour (lamps, pupils) */
    flat(o?: { color?: number }): THREE.Material;
    /** lines coloured per vertex (the replay's path) */
    lines(): THREE.Material;
    /** segments for a round part: `full` in the full kit, `low` in low spec */
    seg(full: number, low: number): number;
}

export const FULL_KIT: Kit = {
    graphics: 'full',
    lowSpec: false,
    fog: FULL_FOG,
    resolution: null,
    details: true,
    lit: (o = {}) => new THREE.MeshStandardNodeMaterial(o),
    flat: (o = {}) => new THREE.MeshBasicNodeMaterial(o),
    lines: () => new THREE.LineBasicNodeMaterial({ vertexColors: true }),
    seg: (full) => full
};

export const LOW_SPEC_KIT: Kit = {
    graphics: 'low',
    lowSpec: true,
    fog: LOW_SPEC_FOG,
    resolution: null,
    details: true,
    // Lambert has no roughness or metalness: the light is spread evenly, the way a rough surface looks
    lit: ({ roughness: _r, metalness: _m, ...o } = {}) => new THREE.MeshLambertMaterial(o),
    flat: (o = {}) => new THREE.MeshBasicMaterial(o),
    lines: () => new THREE.LineBasicMaterial({ vertexColors: true }),
    seg: (_full, low) => low
};

/** Extra low spec: low spec at half resolution, 300 m view, no doors or signs (owner, 2026-10-19). */
export const EXTRA_LOW_KIT: Kit = { ...LOW_SPEC_KIT, graphics: 'extra', fog: EXTRA_LOW_FOG, resolution: 0.5, details: false };

/** Super low spec: a quarter resolution and a 200 m view, for no GPU and an old CPU (owner, 2026-10-19). */
export const SUPER_LOW_KIT: Kit = { ...EXTRA_LOW_KIT, graphics: 'super', fog: SUPER_LOW_FOG, resolution: 0.25 };

export function kitFor(g: GraphicsLevel): Kit {
    return g === 'full' ? FULL_KIT : g === 'low' ? LOW_SPEC_KIT : g === 'extra' ? EXTRA_LOW_KIT : SUPER_LOW_KIT;
}
