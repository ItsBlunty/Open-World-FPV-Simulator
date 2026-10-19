// The chase camera's see-through circle (owner, 2026-10-19): when a wall stands between the chase camera and the quad,
// a soft-edged circle around the quad shows it through the wall. The scene is drawn a second time, for the circle's
// square only, with the near plane moved up to just in front of the quad, so everything between the camera and the
// quad is cut away; that drawing is laid over the frame through a mask that fades to nothing at the circle's edge.
// Rendering only: it reads the camera and the collision mesh (a ray, which changes nothing) and never touches sim state.

import * as THREE from 'three/webgpu';
import { CAMERA_NEAR } from './view';
import type { Kit } from './kit';

/** The circle's radius as a fraction of the screen height: about two thirds of the screen high (owner, 2026-10-19: "a bit larger" than half) */
export const RADIUS = 0.32;
/** The mask is fully see-through out to this fraction of the radius, then fades to the edge */
export const INNER = 0.55;
/** What stays in front of the quad in the circle, m: past its prop tips (13 cm from the centre) */
export const CUT_M = 0.25;
/** A hit this close to the quad does not count as blocking (the quad resting against a wall behind it), m */
export const CLEAR_M = 0.3;
/** The circle fades in and out over this long, s */
export const FADE_S = 0.15;

const MASK_N = 128;

/** Is the quad hidden from the camera? `rayT` is the collision mesh's ray (world-mesh MeshContactWorld.rayT). */
export function blocked(
    cam: THREE.Vector3,
    quad: THREE.Vector3,
    rayT: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => number
): boolean {
    const dx = quad.x - cam.x, dy = quad.y - cam.y, dz = quad.z - cam.z;
    const d = Math.hypot(dx, dy, dz);
    if (d <= CLEAR_M) return false;
    return rayT(cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d - CLEAR_M) >= 0;
}

/** The mask's alpha at `r`, the distance from the centre in radii: 1 inside INNER, smoothly down to 0 at the edge. */
export function maskAt(r: number): number {
    const t = Math.min(1, Math.max(0, (r - INNER) / (1 - INNER)));
    return 1 - t * t * (3 - 2 * t);
}

/** Either renderer: Three.js's WebGPURenderer, or the classic WebGLRenderer of the low spec modes */
interface Drawer {
    autoClear: boolean;
    setRenderTarget(t: any): void;
    render(scene: THREE.Object3D, cam: THREE.Camera): unknown;
    getDrawingBufferSize(v: THREE.Vector2): THREE.Vector2;
}

export class SeeThrough {
    /** 0: no circle, 1: fully shown */
    amount = 0;
    private readonly target: THREE.RenderTarget;
    private readonly cam = new THREE.PerspectiveCamera();
    private readonly overlay = new THREE.Scene();
    private readonly overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private readonly quad: THREE.Mesh;
    private readonly material: THREE.Material;
    private readonly size = new THREE.Vector2();
    private readonly v = new THREE.Vector3();

    /** `makeTarget`: a render target for the renderer in use (the classic WebGL one needs its own kind) */
    constructor(kit: Kit, makeTarget: () => THREE.RenderTarget) {
        this.target = makeTarget();
        const data = new Uint8Array(MASK_N * MASK_N * 4);
        for (let j = 0; j < MASK_N; j++) for (let i = 0; i < MASK_N; i++) {
            const x = ((i + 0.5) / MASK_N) * 2 - 1, y = ((j + 0.5) / MASK_N) * 2 - 1;
            data.fill(Math.round(255 * maskAt(Math.hypot(x, y))), (j * MASK_N + i) * 4, (j * MASK_N + i) * 4 + 4);
        }
        const mask = new THREE.DataTexture(data, MASK_N, MASK_N);
        mask.magFilter = mask.minFilter = THREE.LinearFilter;
        mask.needsUpdate = true;
        const o = { map: this.target.texture, alphaMap: mask, transparent: true, depthTest: false, depthWrite: false, fog: false };
        this.material = kit.lowSpec ? new THREE.MeshBasicMaterial(o) : new THREE.MeshBasicNodeMaterial(o);
        const plane = new THREE.PlaneGeometry(1, 1);
        // the node renderer (WebGPU, and its WebGL fallback likewise) reads a render target with v = 0 at the image's
        // top, the plane has v = 0 at its bottom: flip the plane's v, or the circle shows the scene upside down
        // (owner, 2026-10-19). The classic WebGLRenderer reads v = 0 at the bottom, as the plane does.
        if (!kit.lowSpec) {
            const uv = plane.getAttribute('uv');
            for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
        }
        this.quad = new THREE.Mesh(plane, this.material);
        this.quad.frustumCulled = false;
        this.overlay.add(this.quad);
    }

    /** Fade towards shown (`on`, the quad is hidden) or hidden; `off` (not the chase camera) hides it at once. */
    update(on: boolean, dtS: number, off = false): void {
        if (off) this.amount = 0;
        else this.amount = Math.min(1, Math.max(0, this.amount + (on ? 1 : -1) * (dtS / FADE_S)));
    }

    /**
     * After the frame is drawn from `cam`: draw the scene again past the quad at `quadPos`, into the circle's square,
     * and lay it over the frame through the mask. The sun's shadow map is not redrawn (it is the frame's).
     */
    render(renderer: Drawer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, quadPos: THREE.Vector3, shadow: THREE.LightShadow | null): void {
        if (this.amount <= 0) return;
        cam.updateMatrixWorld();
        const depth = -this.v.copy(quadPos).applyMatrix4(cam.matrixWorldInverse).z;
        if (depth <= CUT_M) return;
        const { x: W, y: H } = renderer.getDrawingBufferSize(this.size);
        // the quad on the screen, device pixels from the top left
        this.v.copy(quadPos).project(cam);
        const cx = ((this.v.x + 1) / 2) * W, cy = ((1 - this.v.y) / 2) * H;
        const side = Math.max(2, Math.ceil(2 * RADIUS * H));
        const c = this.cam;
        c.fov = cam.fov;
        c.aspect = cam.aspect;
        c.near = Math.max(CAMERA_NEAR, depth - CUT_M);
        c.far = cam.far;
        c.setViewOffset(W, H, cx - side / 2, cy - side / 2, side, side);
        c.position.copy(cam.position);
        c.quaternion.copy(cam.quaternion);
        c.updateMatrixWorld();
        if (this.target.width !== side) this.target.setSize(side, side);
        const auto = shadow?.autoUpdate ?? false;
        if (shadow) shadow.autoUpdate = false;
        renderer.setRenderTarget(this.target);
        renderer.render(scene, c);
        renderer.setRenderTarget(null);
        if (shadow) shadow.autoUpdate = auto;
        // the square in normalised device coordinates
        this.quad.position.set((cx / W) * 2 - 1, 1 - (cy / H) * 2, 0);
        this.quad.scale.set((side / W) * 2, (side / H) * 2, 1);
        this.material.opacity = this.amount;
        const clear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render(this.overlay, this.overlayCam);
        renderer.autoClear = clear;
    }

    /** Build the circle's pipelines before the first frame (engine.ts warmUp). */
    warmUp(renderer: Drawer, scene: THREE.Scene, cam: THREE.PerspectiveCamera): void {
        renderer.setRenderTarget(this.target);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        this.quad.scale.set(0.01, 0.01, 1);
        const clear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render(this.overlay, this.overlayCam);
        renderer.autoClear = clear;
    }
}
