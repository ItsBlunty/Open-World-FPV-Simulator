// Clouds (owner, 2026-10-24: "Make lower stylized clouds, that players can go up and fly through. Make them cloud the
// vision like flying in a cloud would really do"). Stylised cumulus of soft white puffs (cloud-puffs.ts) 180-280 m up,
// one instanced mesh, lit by the sun and the sky like the rest of the map and fogged with it, drifting with the wind at the
// sim's time (update). Not solid, as clouds aren't.
// Flying into one, the view fogs over: the scene's fog closes in to a few metres and turns cloud-white, from a few metres
// before the puff's edge to fully white some way inside, so there is no edge to see through as the camera crosses it.
//
// Their shadows (owner, 2026-10-24: "they should cast shadows like real clouds"): each frame the clouds are drawn as seen
// from the sun, low-poly and white on black, into a map covering the whole field (CloudShadow below); every lit surface
// looks along the sun's rays into it and the sun's light on it is cut where a cloud is in the way (the sun light's
// colour node: the sky's light still reaches the shade, as under a real cloud). Not through the sun's shadow map: that
// reaches 110-1000 m round the camera, and cloud shadows lie across the whole map.
// Full graphics only. Drawn only: nothing here reaches the sim.

import * as THREE from 'three/webgpu';
import { color, float, max, mix, normalWorld, positionWorld, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { BASE_MAX, CLOUD_FIELD, cloudPuffs, drift, insideDepth } from './cloud-puffs';
import type { Puff } from './cloud-puffs';
import { SUN_DIR } from './world';

/** the fog inside a cloud: its colour (a lit cloud's grey-white) and how far one sees once fully inside, m */
export const IN_CLOUD_COLOUR = 0xdfe5ec;
export const IN_CLOUD_SIGHT = 14;
/** the whiteout starts this far outside a puff and is full this deep inside, m */
const FADE_OUT = 4;
const FADE_IN = 12;
/**
 * The cloud shadow map's side, texels, and how much of the sun a cloud takes away [estimate: under a fair-weather cumulus
 * the direct sun is mostly gone; the sky's light is left]. The map covers the field seen from the sun: ~19 m texels.
 */
const SHADOW_TEX = 1024;
const SHADOW_DARK = 0.8;
/** half the side of the square the shadow map covers across the sun's view, m: the field's square seen at any angle */
const SHADOW_HALF = CLOUD_FIELD * Math.SQRT2 + 300;

type Drawer = { setRenderTarget(t: THREE.RenderTarget | null): void; render(s: THREE.Object3D, c: THREE.Camera): unknown };

export class CloudsView {
    readonly group = new THREE.Group();
    /** the puffs as placed, and where they are now (update) */
    readonly placed: readonly Puff[];
    readonly puffs: Puff[];
    private readonly mesh: THREE.InstancedMesh;
    /** the clouds as the sun sees them, for their shadows */
    private readonly shadowScene = new THREE.Scene();
    private readonly shadowCam = new THREE.OrthographicCamera(-SHADOW_HALF, SHADOW_HALF, SHADOW_HALF, -SHADOW_HALF, 1, 40000);
    private readonly shadowTarget = new THREE.RenderTarget(SHADOW_TEX, SHADOW_TEX, { depthBuffer: false });
    /** world to the shadow map's clip space, and how strong the shadows are (0 with the clouds off) */
    private readonly shadowMatrix = uniform(new THREE.Matrix4());
    private readonly shadowStrength = uniform(SHADOW_DARK);
    private readonly m = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly p = new THREE.Vector3();
    private readonly s = new THREE.Vector3();

    constructor() {
        this.group.name = 'clouds';
        this.placed = cloudPuffs();
        this.puffs = this.placed.map((f) => ({ ...f }));
        // a smooth ball, enough segments to read as round at a few metres
        const ball = new THREE.SphereGeometry(1, 32, 20);
        // shaded by their own light, not the scene's: the sun's light is cut by the clouds' shadow map (shade), and every
        // cloud lies in its own shadow there. White where the sun falls, blue-grey on the far side, as the lit map
        // material looked with a blue-grey glow
        const mat = new THREE.MeshBasicNodeMaterial();
        const lit = smoothstep(float(-0.35), float(0.9), normalWorld.dot(vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z)));
        mat.colorNode = mix(color(0xa4afc0), color(0xffffff), lit);
        const mesh = new THREE.InstancedMesh(ball, mat, this.puffs.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // they move round the whole square: always drawn (one draw)
        mesh.frustumCulled = false;
        mesh.name = 'clouds:puffs';
        this.mesh = mesh;
        this.group.add(mesh);
        // the shadow pass: the same puffs (sharing their matrices) as coarse white balls on black, from the sun
        const coarse = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), this.puffs.length);
        coarse.instanceMatrix = mesh.instanceMatrix;
        coarse.frustumCulled = false;
        this.shadowScene.add(coarse);
        this.shadowScene.background = new THREE.Color(0x000000);
        const mid = new THREE.Vector3(300, BASE_MAX, 0);
        this.shadowCam.position.copy(mid).addScaledVector(SUN_DIR, 20000);
        this.shadowCam.lookAt(mid);
        this.shadowCam.updateMatrixWorld();
        this.shadowMatrix.value.multiplyMatrices(this.shadowCam.projectionMatrix, this.shadowCam.matrixWorldInverse);
        this.update(0);
    }

    /**
     * Have `sun` cut its light where the clouds' shadows fall. Its colour and intensity are read now: the light's colour
     * node replaces both (Three.js AnalyticLightNode).
     */
    shade(sun: THREE.DirectionalLight): void {
        const lp = this.shadowMatrix.mul(vec4(positionWorld, 1));
        // the shadow map's texture is upside down to clip space's y
        const uv = vec2(lp.x.mul(0.5).add(0.5), lp.y.mul(-0.5).add(0.5));
        const t = this.shadowTarget.texture;
        // five taps a texel and a half apart: soft edges
        const d = 1.5 / SHADOW_TEX;
        const cover = texture(t, uv).r.mul(2)
            .add(texture(t, uv.add(vec2(d, 0))).r).add(texture(t, uv.sub(vec2(d, 0))).r)
            .add(texture(t, uv.add(vec2(0, d))).r).add(texture(t, uv.sub(vec2(0, d))).r).div(6);
        // nothing above the clouds is in their shadow; nothing off the map's square either
        const below = float(1).sub(smoothstep(float(BASE_MAX), float(BASE_MAX + 150), positionWorld.y));
        const inside = float(1).sub(smoothstep(float(0.98), float(1), max(lp.x.abs(), lp.y.abs())));
        const shade = float(1).sub(cover.mul(this.shadowStrength).mul(below).mul(inside));
        const colour = sun.color.clone().multiplyScalar(sun.intensity);
        (sun as THREE.DirectionalLight & { colorNode?: THREE.Node }).colorNode = uniform(colour).mul(shade);
    }

    /** Draw the clouds into their shadow map, as the sun sees them now (each frame, after update). */
    drawShadow(renderer: Drawer): void {
        this.shadowStrength.value = this.group.visible ? SHADOW_DARK : 0;
        if (!this.group.visible) return;
        renderer.setRenderTarget(this.shadowTarget);
        renderer.render(this.shadowScene, this.shadowCam);
        renderer.setRenderTarget(null);
    }

    /** Move the clouds to where the wind has carried them at sim time `t` s. */
    update(t: number): void {
        drift(this.placed, t, this.puffs);
        this.puffs.forEach((f, i) => {
            this.mesh.setMatrixAt(i, this.m.compose(this.p.set(f.x, f.y, f.z), this.q, this.s.set(f.r, f.r * f.sy, f.r)));
        });
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    /** How far into the whiteout a camera at `cam` is: 0 clear of every cloud, 1 deep inside one. */
    whiteout(cam: THREE.Vector3): number {
        if (!this.group.visible) return 0;
        const d = insideDepth(this.puffs, cam.x, cam.y, cam.z);
        const t = Math.min(1, Math.max(0, (d + FADE_OUT) / (FADE_OUT + FADE_IN)));
        return t * t * (3 - 2 * t);
    }
}

/**
 * The fog for a whiteout `w` (0-1) over the fog the view distance sets, `near`/`far`: towards IN_CLOUD_SIGHT, its
 * distances blended in proportion (a straight blend from 3 km would keep most of the view until nearly inside).
 */
export function cloudFog(w: number, near: number, far: number): { near: number; far: number } {
    return { near: near * (1 - w), far: far ** (1 - w) * IN_CLOUD_SIGHT ** w };
}
