// The materials and detail the scene is built with, for the renderer that draws it. The full kit: Three.js's
// WebGPURenderer (WebGPU, or WebGL 2) with node materials lit physically. The low spec kit (Settings > Graphics > Low spec
// mode, or ?lowspec): Three.js's classic WebGLRenderer with matte (Lambert) materials and fewer segments on round
// parts, for laptops with barely a GPU (docs/notes/low-spec.md). Rendering only: nothing here reaches the sim.

import * as THREE from 'three/webgpu';

/**
 * Low spec mode's fog, m: nearer than the full kit's (250-1600 m), and the camera sees no further than its end (view.ts),
 * so what lies past it is not drawn at all.
 */
export const LOW_SPEC_FOG = { near: 160, far: 650 };

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
    readonly lowSpec: boolean;
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
    lowSpec: false,
    lit: (o = {}) => new THREE.MeshStandardNodeMaterial(o),
    flat: (o = {}) => new THREE.MeshBasicNodeMaterial(o),
    lines: () => new THREE.LineBasicNodeMaterial({ vertexColors: true }),
    seg: (full) => full
};

export const LOW_SPEC_KIT: Kit = {
    lowSpec: true,
    // Lambert has no roughness or metalness: the light is spread evenly, the way a rough surface looks
    lit: ({ roughness: _r, metalness: _m, ...o } = {}) => new THREE.MeshLambertMaterial(o),
    flat: (o = {}) => new THREE.MeshBasicMaterial(o),
    lines: () => new THREE.LineBasicMaterial({ vertexColors: true }),
    seg: (_full, low) => low
};
