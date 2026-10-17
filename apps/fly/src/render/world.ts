// The level in Three.js: one mesh per material, built from the same triangles the collision uses.
// Blockout surfaces get a world-aligned grid in the shader (1 m and 5 m lines): on flat colours an
// FPV pilot cannot read speed or height, on a grid they can. TSL compiles it for WebGPU and WebGL 2.

import * as THREE from 'three/webgpu';
import { abs, color, float, fract, fwidth, max, min, mix, normalWorld, positionWorld, smoothstep, vec3 } from 'three/tsl';
import type { Level, Material } from '@owfpv/maps';

type FloatNode = THREE.Node<'float'>;

/** Blockout colours, picked to tell surfaces apart at speed. */
const COLOURS: Record<Material, number> = {
    grass: 0x5f8f3e,
    asphalt: 0x45484d,
    sidewalk: 0x9c9b95,
    path: 0xb9a98a,
    concrete: 0xa9a59d,
    'concrete-dark': 0x6f6b66,
    brick: 0x9b5a43,
    plaster: 0xd8cfbf,
    glass: 0x7395aa,
    metal: 0x8a9096,
    rust: 0x8c5a3c,
    wood: 0x8a6a45,
    trunk: 0x5a4330,
    foliage: 0x3f6e33,
    rubble: 0x7c7468,
    water: 0x3f6f8f,
    marking: 0xe8e2c8,
    'container-a': 0xb0453a,
    'container-b': 0x2f6aa3,
    'container-c': 0xc9a227
};

/** No grid on these: it would read as tiles on a tree or on water. */
const PLAIN: ReadonlySet<Material> = new Set<Material>(['foliage', 'trunk', 'water']);

/** Anti-aliased lines every `spacing` m along one world axis coordinate; fades out where they get too dense to see. */
function lines(c: FloatNode, spacing: number): FloatNode {
    const u = c.div(spacing);
    const w = fwidth(u);
    const d = abs(fract(u.sub(0.5)).sub(0.5)).div(w.max(1e-6));
    const line = float(1).sub(min(d, 1));
    return line.mul(float(1).sub(smoothstep(0.2, 0.6, w)));
}

function gridMaterial(m: Material): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: m === 'glass' || m === 'water' ? 0.25 : 0.9, metalness: m === 'metal' ? 0.3 : 0 });
    const base = color(COLOURS[m]);
    if (PLAIN.has(m)) {
        mat.colorNode = base;
        return mat;
    }
    const p = positionWorld;
    const n = abs(normalWorld);
    // a line along an axis shows on faces that axis runs across (not on faces it points out of)
    const wx = float(1).sub(smoothstep(0.6, 0.9, n.x));
    const wy = float(1).sub(smoothstep(0.6, 0.9, n.y));
    const wz = float(1).sub(smoothstep(0.6, 0.9, n.z));
    const minor = max(max(lines(p.x, 1).mul(wx), lines(p.y, 1).mul(wy)), lines(p.z, 1).mul(wz));
    const major = max(max(lines(p.x, 5).mul(wx), lines(p.y, 5).mul(wy)), lines(p.z, 5).mul(wz));
    const shade = minor.mul(0.1).max(major.mul(0.28));
    mat.colorNode = mix(base, vec3(0.08, 0.08, 0.08), shade);
    return mat;
}

/** The level's meshes, one per material, in a group. */
export function levelGroup(level: Level): THREE.Group {
    const g = new THREE.Group();
    g.name = `level:${level.id}`;
    for (const [m, tris] of level.parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(tris, 3));
        geo.computeVertexNormals(); // non-indexed: flat normals per face
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, gridMaterial(m));
        mesh.name = m;
        mesh.matrixAutoUpdate = false;
        g.add(mesh);
    }
    return g;
}

/** Sky, sun, fill light and distance fog. */
export function environment(scene: THREE.Scene): THREE.DirectionalLight {
    const sky = new THREE.Color(0x9cc4e4);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 250, 1600);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(-300, 500, 200);
    scene.add(sun);
    return sun;
}
