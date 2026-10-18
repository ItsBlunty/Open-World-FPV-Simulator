// The level in Three.js: one mesh per material, built from the same triangles the collision uses.
// Blockout surfaces get a world-aligned grid in the shader (1 m and 5 m lines): on flat colours an
// FPV pilot cannot read speed or height, on a grid they can. City windows are geometry (the glass set
// back in the walls, maps first-map.ts windowedBlock); the glass towers' ribbon glass gets its mullions
// painted. TSL compiles it for WebGPU and WebGL 2. The sun casts shadows in a square that follows the camera.

import * as THREE from 'three/webgpu';
import { abs, color, float, fract, fwidth, max, min, mix, normalWorld, positionWorld, smoothstep, step, vec3 } from 'three/tsl';
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
    'container-c': 0xc9a227,
    'facade-concrete': 0xa9a59d,
    'facade-brick': 0x9b5a43,
    'facade-plaster': 0xd8cfbf,
    'facade-glass': 0x6f8ea3,
    'facade-dark': 0x6f6b66,
    // window glass: dark, with a little blue from the sky
    window: 0x26323d,
    'window-ribbon': 0x2a3a48
};

/** A glass tower's mullions: a thin frame every 1.5 m along its ribbon windows. */
const MULLION = 0x3c4248;
const MULLION_BAY = 1.5;
const MULLION_W = 0.08;

/** No grid on these: it would read as tiles on a tree or on water, or as frames on glass. */
const PLAIN: ReadonlySet<Material> = new Set<Material>(['foliage', 'trunk', 'water', 'window', 'window-ribbon']);

/** Anti-aliased lines every `spacing` m along one world axis coordinate; fades out where they get too dense to see. */
function lines(c: FloatNode, spacing: number): FloatNode {
    const u = c.div(spacing);
    const w = fwidth(u);
    const d = abs(fract(u.sub(0.5)).sub(0.5)).div(w.max(1e-6));
    const line = float(1).sub(min(d, 1));
    return line.mul(float(1).sub(smoothstep(0.2, 0.6, w)));
}

/** 1 inside [lo, hi], 0 outside, with edges softened over w (anti-aliasing). */
function band(a: FloatNode, lo: number, hi: number, w: FloatNode): FloatNode {
    return smoothstep(w.negate().add(lo), w.add(lo), a).mul(float(1).sub(smoothstep(w.negate().add(hi), w.add(hi), a)));
}

/** How much of a ribbon window's glass is mullion, 0-1: a line every MULLION_BAY m along the wall, fading to its average far off. */
function mullions(): FloatNode {
    const n = abs(normalWorld);
    const u = mix(positionWorld.x, positionWorld.z, step(0.5, n.x));
    const w = fwidth(u).max(1e-4);
    const line = band(fract(u.div(MULLION_BAY)).mul(MULLION_BAY), 0, MULLION_W, w);
    return mix(line, float(MULLION_W / MULLION_BAY), smoothstep(0.15, 0.5, w.div(MULLION_BAY)));
}

function gridMaterial(m: Material): THREE.MeshStandardNodeMaterial {
    const glassy = m === 'glass' || m === 'water' || m === 'window' || m === 'window-ribbon';
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: glassy ? (m.startsWith('window') ? 0.12 : 0.25) : 0.9, metalness: m === 'metal' ? 0.3 : 0 });
    const base = color(COLOURS[m]);
    if (m === 'window-ribbon') {
        const f = mullions();
        mat.colorNode = mix(base, color(MULLION), f);
        mat.roughnessNode = mix(float(0.12), float(0.5), f);
        return mat;
    }
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
        mesh.castShadow = m !== 'marking' && m !== 'water';
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        g.add(mesh);
    }
    return g;
}

/** Where the sun is: from the south-west, high (a direction; the light itself follows the camera). */
const SUN_DIR = new THREE.Vector3(-300, 500, 200).normalize();
/** Half the side of the shadowed square around the camera, m, and the shadow map's size, texels (5.9 cm each). */
const SHADOW_HALF = 120;
const SHADOW_MAP = 4096;

/** The sun with its shadow; call follow() each frame with the camera's position. */
export class Sun {
    readonly light: THREE.DirectionalLight;
    private readonly toLight = new THREE.Matrix4();
    private readonly fromLight = new THREE.Matrix4();
    private readonly c = new THREE.Vector3();

    constructor(scene: THREE.Scene) {
        const l = new THREE.DirectionalLight(0xfff4e0, 2.2);
        l.castShadow = true;
        l.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
        const cam = l.shadow.camera;
        cam.left = -SHADOW_HALF;
        cam.right = SHADOW_HALF;
        cam.top = SHADOW_HALF;
        cam.bottom = -SHADOW_HALF;
        cam.near = 1;
        cam.far = 1200; // from 600 m up-sun to well below the ground under the camera
        cam.updateProjectionMatrix();
        l.shadow.bias = -0.0002;
        l.shadow.normalBias = 0.04;
        scene.add(l, l.target);
        this.light = l;
        // a rotation into the light's view, to snap the shadow square to whole texels
        this.fromLight.lookAt(SUN_DIR, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
        this.toLight.copy(this.fromLight).invert();
    }

    /** Centre the shadow square on p, moved in whole shadow texels so its edges do not crawl as the camera moves. */
    follow(p: THREE.Vector3): void {
        const texel = (2 * SHADOW_HALF) / SHADOW_MAP;
        this.c.copy(p).applyMatrix4(this.toLight);
        this.c.x = Math.round(this.c.x / texel) * texel;
        this.c.y = Math.round(this.c.y / texel) * texel;
        this.c.applyMatrix4(this.fromLight);
        this.light.target.position.copy(this.c);
        this.light.position.copy(this.c).addScaledVector(SUN_DIR, 600);
    }
}

/** Sky, sun, fill light and distance fog. */
export function environment(scene: THREE.Scene): Sun {
    const sky = new THREE.Color(0x9cc4e4);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 250, 1600);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.4));
    return new Sun(scene);
}
