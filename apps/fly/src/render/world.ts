// The level in Three.js: one mesh per material, built from the same triangles the collision uses.
// Blockout surfaces get a world-aligned grid in the shader (1 m and 5 m lines): on flat colours an
// FPV pilot cannot read speed or height, on a grid they can. City windows are geometry (the glass set
// back in the walls, maps first-map.ts windowedBlock); the glass towers' ribbon glass gets its mullions
// painted. TSL compiles it for WebGPU and WebGL 2. The sun casts shadows in a square that follows the camera (its size is a setting).
// Low spec mode (kit.ts) draws the same grid in a few lines of GLSL added to a matte material, no mullions, in tiles.

import * as THREE from 'three/webgpu';
import { abs, color, float, fract, fwidth, max, min, mix, normalWorld, positionWorld, smoothstep, step, vec3 } from 'three/tsl';
import type { Level, Material } from '@owfpv/maps';
import { SHADOW_REACHES, shadowDepth, shadowNeedsRecentre } from './shadow-follow';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

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
    'window-ribbon': 0x2a3a48,
    // tower crane steelwork: the yellow most tower cranes are painted
    crane: 0xf2b705,
    // a bus shelter's frosted panels (drawn see-through: FROSTED_OPACITY), a dark green dumpster, billboard faces
    frosted: 0xdfe7ec,
    dumpster: 0x2f5a3c,
    billboard: 0xf1ead8,
    // the railway: grey ballast, dark steel rails, creosoted sleepers, the tunnel's stonework, brown goods wagons
    ballast: 0x80796f,
    rail: 0x4a4542,
    sleeper: 0x4a3a2d,
    stone: 0x8e8577,
    wagon: 0x74472f,
    // map v10: a green and a white container, dark conifer needles, a lighter broadleaf green
    'container-d': 0x3d6b4a,
    'container-e': 0xd6d3cb,
    'foliage-dark': 0x2c5230,
    'foliage-light': 0x5e8a36,
    // map v15: street vendors' stainless carts and their umbrellas
    cart: 0xc7cdd3,
    'awning-red': 0xd8322a,
    'awning-yellow': 0xf3c623,
    'awning-blue': 0x2f6fd0,
    'awning-green': 0x2f9b57,
    // map v17: the Duga radar (photos: rusted legs, grey-painted bracing and stand-off arms, cages painted pale grey)
    'duga-rust': 0x7a4a33,
    'duga-grey': 0x9a9e9f,
    'duga-cage': 0xd0d3d0,
    // map v19: its feed pipes (owner's photos: rusted to an ochre brown)
    'duga-pipe': 0x9a6a42,
    // map v21: the airport's taxiway yellow, the hospital pad's red H, hangar cladding (pale grey-blue), the windsock's orange-red
    'marking-yellow': 0xe8b923,
    'marking-red': 0xc8202a,
    hangar: 0xb9c0c6,
    windsock: 0xff5a1f
};

/**
 * How much a frosted panel hides what is behind it (0 clear, 1 solid). Real frosted glass scatters light, so a thing
 * behind shows as a pale blur; drawn without a blur, a panel this opaque leaves a prop behind it just about visible to
 * someone looking for it (owner, 2026-10-18).
 */
const FROSTED_OPACITY = 0.65;

/** A glass tower's mullions: a thin frame every 1.5 m along its ribbon windows. */
const MULLION = 0x3c4248;
const MULLION_BAY = 1.5;
const MULLION_W = 0.08;

/** No grid on these: it would read as tiles on a tree or on water, or as frames on glass. */
const PLAIN: ReadonlySet<Material> = new Set<Material>(['foliage', 'foliage-dark', 'foliage-light', 'trunk', 'water', 'window', 'window-ribbon', 'crane', 'frosted', 'dumpster', 'billboard', 'rail', 'sleeper', 'cart', 'awning-red', 'awning-yellow', 'awning-blue', 'awning-green', 'duga-rust', 'duga-grey', 'duga-cage', 'duga-pipe', 'marking-yellow', 'marking-red', 'windsock']);

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
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: glassy ? (m.startsWith('window') ? 0.12 : 0.25) : 0.9, metalness: m === 'metal' || m === 'crane' ? 0.3 : 0 });
    const base = color(COLOURS[m]);
    if (m === 'window-ribbon') {
        const f = mullions();
        mat.colorNode = mix(base, color(MULLION), f);
        mat.roughnessNode = mix(float(0.12), float(0.5), f);
        return mat;
    }
    if (m === 'frosted') {
        // both sides, no depth write: the panels behind and beside it still draw through it
        mat.transparent = true;
        mat.opacity = FROSTED_OPACITY;
        mat.depthWrite = false;
        mat.side = THREE.DoubleSide;
        mat.roughness = 0.6;
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

/**
 * Low spec mode's level: the same grid as gridMaterial's nodes, as GLSL in Three.js's classic Lambert shader (its
 * `color_fragment` chunk sets the surface colour; the grid darkens it there, before the lighting). Every opaque
 * material shares one mesh per LOW_SPEC_TILE square, coloured per vertex with a 0/1 `grid` attribute (PLAIN surfaces
 * get none), so a tile is one draw and the tiles out of view or past the fog (the kit's) are not drawn at all.
 */
const LOW_SPEC_TILE = 80;
const LOW_SPEC_GRID_VERT = /* glsl */ `
attribute float grid;
varying vec3 vGridPos;
varying vec3 vGridN;
varying float vGrid;`;
const LOW_SPEC_GRID_FRAG = /* glsl */ `
varying vec3 vGridPos;
varying vec3 vGridN;
varying float vGrid;
float gridLines(float c, float spacing) {
    float u = c / spacing;
    float w = fwidth(u);
    float d = abs(fract(u - 0.5) - 0.5) / max(w, 1e-6);
    return (1.0 - min(d, 1.0)) * (1.0 - smoothstep(0.2, 0.6, w));
}`;
const LOW_SPEC_GRID_SHADE = /* glsl */ `
if (vGrid > 0.5) {
    vec3 n = abs(normalize(vGridN));
    vec3 across = 1.0 - smoothstep(0.6, 0.9, n);
    float minor = max(max(gridLines(vGridPos.x, 1.0) * across.x, gridLines(vGridPos.y, 1.0) * across.y), gridLines(vGridPos.z, 1.0) * across.z);
    float major = max(max(gridLines(vGridPos.x, 5.0) * across.x, gridLines(vGridPos.y, 5.0) * across.y), gridLines(vGridPos.z, 5.0) * across.z);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08), max(minor * 0.1, major * 0.28));
}`;

function lowSpecGridMaterial(kit: Kit): THREE.Material {
    const mat = kit.lit();
    mat.vertexColors = true;
    mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>${LOW_SPEC_GRID_VERT}`)
            // the world position and normal, as gridMaterial's positionWorld and normalWorld
            .replace('#include <project_vertex>', `#include <project_vertex>
    vGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vGridN = mat3(modelMatrix) * objectNormal;
    vGrid = grid;`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>${LOW_SPEC_GRID_FRAG}`)
            .replace('#include <color_fragment>', `#include <color_fragment>${LOW_SPEC_GRID_SHADE}`);
    };
    return mat;
}

function lowSpecLevel(level: Level, kit: Kit, g: THREE.Group): void {
    const tileOf = (t: Float32Array, i: number): string => {
        const x = (t[i] + t[i + 3] + t[i + 6]) / 3, z = (t[i + 2] + t[i + 5] + t[i + 8]) / 3;
        return `${Math.floor(x / LOW_SPEC_TILE)},${Math.floor(z / LOW_SPEC_TILE)}`;
    };
    // count each tile's triangles, then fill its arrays
    const count = new Map<string, number>();
    for (const [m, t] of level.parts) {
        if (m === 'frosted') continue;
        for (let i = 0; i < t.length; i += 9) {
            const k = tileOf(t, i);
            count.set(k, (count.get(k) ?? 0) + 1);
        }
    }
    const tiles = new Map<string, { pos: Float32Array; col: Float32Array; grid: Float32Array; n: number }>();
    for (const [k, n] of count) tiles.set(k, { pos: new Float32Array(n * 9), col: new Float32Array(n * 9), grid: new Float32Array(n * 3), n: 0 });
    const c = new THREE.Color();
    for (const [m, t] of level.parts) {
        if (m === 'frosted') continue;
        // the glass towers' ribbon glass a little lighter: no mullions break it up
        c.setHex(m === 'window-ribbon' ? 0x34434f : COLOURS[m]);
        const grid = PLAIN.has(m) ? 0 : 1;
        for (let i = 0; i < t.length; i += 9) {
            const tile = tiles.get(tileOf(t, i))!;
            const o = tile.n * 9;
            tile.pos.set(t.subarray(i, i + 9), o);
            for (let v = 0; v < 3; v++) {
                tile.col[o + 3 * v] = c.r;
                tile.col[o + 3 * v + 1] = c.g;
                tile.col[o + 3 * v + 2] = c.b;
                tile.grid[tile.n * 3 + v] = grid;
            }
            tile.n++;
        }
    }
    const mat = lowSpecGridMaterial(kit);
    for (const [k, tile] of tiles) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(tile.pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(tile.col, 3));
        geo.setAttribute('grid', new THREE.BufferAttribute(tile.grid, 1));
        geo.computeVertexNormals(); // non-indexed: flat normals per face
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `tile:${k}`;
        mesh.matrixAutoUpdate = false;
        g.add(mesh);
    }
    const frosted = level.parts.get('frosted');
    if (frosted) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(frosted, 3));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, kit.lit({ color: COLOURS.frosted, transparent: true, opacity: FROSTED_OPACITY, depthWrite: false, side: THREE.DoubleSide }));
        mesh.name = 'frosted';
        mesh.matrixAutoUpdate = false;
        g.add(mesh);
    }
}

/** The level's meshes, one per material (low spec: one per tile), in a group. */
export function levelGroup(level: Level, kit: Kit = FULL_KIT): THREE.Group {
    const g = new THREE.Group();
    g.name = `level:${level.id}`;
    if (kit.lowSpec) {
        lowSpecLevel(level, kit, g);
        return g;
    }
    for (const [m, tris] of level.parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(tris, 3));
        geo.computeVertexNormals(); // non-indexed: flat normals per face
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, gridMaterial(m));
        mesh.name = m;
        mesh.castShadow = m !== 'marking' && m !== 'marking-yellow' && m !== 'marking-red' && m !== 'water' && m !== 'frosted';
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        g.add(mesh);
    }
    return g;
}

/** Where the sun is: from the south-west, high (a direction; the light itself follows the camera). */
export const SUN_DIR = new THREE.Vector3(-300, 500, 200).normalize();
/** The sun with its shadow; call follow() each frame with the camera's position (it moves only now and then: shadow-follow.ts). */
export class Sun {
    readonly light: THREE.DirectionalLight;
    private readonly toLight = new THREE.Matrix4();
    private readonly fromLight = new THREE.Matrix4();
    private readonly c = new THREE.Vector3();
    /** the square's centre in the light's frame, null before the first follow() and after a change of reach */
    private centre: THREE.Vector3 | null = null;
    /** half the side of the shadowed square round the camera, m (setReach) */
    private half: number = SHADOW_REACHES.near.half;
    /** how far up-sun the shadow camera stands, m (shadowDepth) */
    private depth = 600;

    constructor(scene: THREE.Scene) {
        const l = new THREE.DirectionalLight(0xfff4e0, 2.2);
        l.castShadow = true;
        const cam = l.shadow.camera;
        cam.near = 1;
        scene.add(l, l.target);
        this.light = l;
        this.setReach(SHADOW_REACHES.near);
        // a rotation into the light's view, to snap the shadow square to whole texels
        this.fromLight.lookAt(SUN_DIR, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
        this.toLight.copy(this.fromLight).invert();
    }

    /**
     * How far the shadows reach (shadow-follow.ts shadowReach): the square's half side, m, and the shadow map's side,
     * texels. Takes effect live: Three.js's shadow node resizes its map to mapSize when it next draws it.
     */
    setReach(r: { half: number; map: number }): void {
        const l = this.light, cam = l.shadow.camera;
        l.shadow.mapSize.set(r.map, r.map);
        // the sampling point moved off the surface by most of a shadow texel (6 cm near and far, 12 cm farthest), enough to
        // keep sloped faces free of acne and little enough that a shadow still starts where its object stands
        l.shadow.normalBias = 0.7 * (2 * r.half) / r.map;
        // from `depth` m up-sun to as far below the square's centre (shadow-follow.ts shadowDepth)
        this.depth = shadowDepth(r.half);
        cam.near = 1;
        cam.far = 2 * this.depth;
        // The bias is in the shadow camera's depth, which spans its whole range: -0.0002 of 1199 m moved every shadow about
        // 24 cm towards the sun, so a lit ring showed round the foot of anything standing on the ground before its shadow
        // began (owner, 2026-10-19). Now 1.2 cm at any range; the normal bias (above, scaled to the texel) keeps off acne.
        l.shadow.bias = -0.012 / (cam.far - cam.near);
        cam.left = -r.half;
        cam.right = r.half;
        cam.top = r.half;
        cam.bottom = -r.half;
        cam.updateProjectionMatrix();
        this.half = r.half;
        this.centre = null;
    }

    /**
     * Centre the shadow square on p when p has moved far enough from its centre (shadowNeedsRecentre), in whole shadow
     * texels so the shadows of things that stand still land on the same texels after the move. Along the sun's view the
     * square is centred on the ground p looks down on along the sun's rays (the same square across the view), so the
     * ground stays inside the shadow camera's depth range however high p is: centred on p, ground past the range drew as
     * shadow, a huge dark block from 600 m up (owner, 2026-10-24).
     */
    follow(p: THREE.Vector3): void {
        const texel = (2 * this.half) / this.light.shadow.mapSize.x;
        this.c.copy(p).addScaledVector(SUN_DIR, -Math.max(0, p.y) / SUN_DIR.y).applyMatrix4(this.toLight);
        if (!shadowNeedsRecentre(this.centre, this.c)) return;
        (this.centre ??= new THREE.Vector3()).copy(this.c);
        this.c.x = Math.round(this.c.x / texel) * texel;
        this.c.y = Math.round(this.c.y / texel) * texel;
        this.c.applyMatrix4(this.fromLight);
        this.light.target.position.copy(this.c);
        this.light.position.copy(this.c).addScaledVector(SUN_DIR, this.depth);
    }
}

/** Sky, sun, fill light and distance fog. */
export function environment(scene: THREE.Scene, kit: Kit = FULL_KIT): Sun {
    const sky = new THREE.Color(0x9cc4e4);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, kit.fog.near, kit.fog.far);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.4));
    return new Sun(scene);
}
