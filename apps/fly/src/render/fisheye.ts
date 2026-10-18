// The FPV camera through a calibrated fisheye lens (lens.ts): the scene is drawn by cube-face cameras, each cropped to
// what the lens sees on its face, into render targets; then one full-screen pass turns every screen pixel into the
// lens's ray and reads it from its face. A wide flat render warped afterwards cannot reach these lenses' 140-160 deg
// corners without blurring the centre (it stretches without bound towards 180 deg); the faces stretch at most to 45 deg sideways
// and 63 deg up or down.
// Rendering only: it reads the camera's pose and never touches sim state.

import * as THREE from 'three/webgpu';
import { Fn, If, abs, cos, float, floor, int, ivec2, max, min, mix, screenUV, sin, sqrt, texture, textureLoad, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { CAMERA_NEAR } from './view';
import { FACES, LUT_N, SIDE_REACH, lensLayout } from './lens';
import type { LensLayout, LensProfile } from './lens';

type FloatNode = THREE.Node<'float'>;

/** MSAA samples per face, as the canvas has (the renderer is made with antialias) */
const SAMPLES = 4;

export class FisheyeView {
    private readonly targets: THREE.RenderTarget[];
    private readonly cams: THREE.PerspectiveCamera[];
    private readonly faceQ: THREE.Quaternion[];
    private readonly rects = FACES.map(() => uniform(new THREE.Vector4(0, 1, 0, 1)));
    private readonly lut = new THREE.DataTexture(new Float32Array(LUT_N), LUT_N, 1, THREE.RedFormat, THREE.FloatType);
    private readonly scale = uniform(new THREE.Vector2(1, 1));
    private readonly half = uniform(new THREE.Vector2(0, 0));
    private readonly rMax = uniform(1);
    private readonly quad: THREE.QuadMesh;
    /** a face-sized target for the warm-up: same format and samples as the faces, so the same pipelines */
    private readonly warmTarget: THREE.RenderTarget;
    private lens: LensProfile | null = null;
    private width = 0;
    private height = 0;
    /** the last layout, for the console (__fly.ask) */
    layout: LensLayout | null = null;

    constructor() {
        const opts = { type: THREE.HalfFloatType, samples: SAMPLES, depthBuffer: true };
        this.targets = FACES.map(() => new THREE.RenderTarget(1, 1, opts));
        this.warmTarget = new THREE.RenderTarget(64, 64, opts);
        this.cams = FACES.map(() => new THREE.PerspectiveCamera(90, 1, CAMERA_NEAR, 5000));
        this.faceQ = FACES.map((F) => {
            const v = (a: readonly number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
            const m = new THREE.Matrix4().makeBasis(v(F.right), v(F.up), v(F.fwd).negate());
            return new THREE.Quaternion().setFromRotationMatrix(m);
        });
        this.lut.needsUpdate = true;
        const mat = new THREE.MeshBasicNodeMaterial();
        mat.colorNode = this.shader();
        this.quad = new THREE.QuadMesh(mat);
    }

    /** true when a lens is set: the FPV view goes through render() */
    get active(): boolean {
        return this.lens !== null;
    }

    setLens(lens: LensProfile | null): void {
        this.lens = lens;
        this.relayout();
    }

    /** the canvas's drawing buffer, device pixels */
    setSize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.relayout();
    }

    private relayout(): void {
        if (!this.lens || this.width < 1 || this.height < 1) {
            this.layout = null;
            return;
        }
        const L = lensLayout(this.lens, this.width, this.height);
        this.layout = L;
        this.scale.value.set(L.scaleX, L.scaleY);
        this.half.value.set(L.halfX, L.halfY);
        this.rMax.value = L.rMax;
        (this.lut.image.data as Float32Array).set(L.lut);
        this.lut.needsUpdate = true;
        L.faces.forEach((F, i) => {
            const used = F.width > 0;
            this.targets[i].setSize(used ? F.width : 1, used ? F.height : 1);
            this.rects[i].value.set(F.x0, F.x1, F.y0, F.y1);
            if (!used) return;
            // a square frustum reaching the crop's furthest edge, cut down to the crop
            const c = this.cams[i];
            const t = Math.max(Math.abs(F.x0), Math.abs(F.x1), Math.abs(F.y0), Math.abs(F.y1));
            c.fov = (2 * Math.atan(t) * 180) / Math.PI;
            c.aspect = 1;
            c.setViewOffset(2 * t, 2 * t, F.x0 + t, t - F.y1, F.x1 - F.x0, F.y1 - F.y0);
            c.updateProjectionMatrix();
        });
    }

    /**
     * Draw the scene from `cam` (the FPV camera's pose) through the lens onto the canvas. The sun's shadow map is drawn
     * for the first face only: Three.js redraws it once per camera per frame, and every face sees the same shadows.
     */
    render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, cam: THREE.Camera, shadow: THREE.LightShadow | null): void {
        const L = this.layout;
        if (!L) return;
        const auto = shadow?.autoUpdate ?? false;
        let first = true;
        for (let i = 0; i < FACES.length; i++) {
            if (L.faces[i].width === 0) continue;
            const c = this.cams[i];
            c.position.copy(cam.position);
            c.quaternion.copy(cam.quaternion).multiply(this.faceQ[i]);
            c.updateMatrixWorld();
            renderer.setRenderTarget(this.targets[i]);
            renderer.render(scene, c);
            if (first && shadow) shadow.autoUpdate = false;
            first = false;
        }
        if (shadow) shadow.autoUpdate = auto;
        renderer.setRenderTarget(null);
        this.quad.render(renderer);
    }

    /** Build the face and lens-pass pipelines before the first frame (engine.ts warmUp), lens or not. */
    warmUp(renderer: THREE.WebGPURenderer, scene: THREE.Scene, cam: THREE.Camera): void {
        renderer.setRenderTarget(this.warmTarget);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        this.quad.render(renderer);
    }

    /** Screen pixel -> lens ray -> its face (lens.ts faceOf / onFace, the same rules) -> that face's colour. */
    private shader(): THREE.Node<'vec4'> {
        const tex = this.targets.map((t) => t.texture);
        const rects = this.rects;
        return Fn(() => {
            const x = screenUV.x.sub(0.5).mul(this.scale.x);
            const y = float(0.5).sub(screenUV.y).mul(this.scale.y);
            const out = vec4(0, 0, 0, 1).toVar();
            If(abs(x).lessThanEqual(this.half.x).and(abs(y).lessThanEqual(this.half.y)), () => {
                // image radius -> ray angle: the lookup table, read exactly and blended (float textures need not filter)
                const r = sqrt(x.mul(x).add(y.mul(y)));
                const fi = min(r.div(this.rMax).mul(LUT_N - 1), LUT_N - 1);
                const i0 = floor(fi);
                const i1 = min(i0.add(1), LUT_N - 1);
                const t0 = textureLoad(this.lut, ivec2(int(i0), int(0))).x;
                const t1 = textureLoad(this.lut, ivec2(int(i1), int(0))).x;
                const theta = mix(t0, t1, fi.sub(i0));
                const s = sin(theta).div(max(r, 1e-9));
                const d = vec3(x.mul(s), y.mul(s), cos(theta).negate()).toVar();
                const ax = abs(d.x), ay = abs(d.y), az = abs(d.z);
                // a face's colour at (a, b), tangent units on its image plane; level 0: sampled inside a branch
                const read = (i: number, a: FloatNode, b: FloatNode): void => {
                    const R = rects[i];
                    // a render target's v runs down from its top row (checked in Chrome on WebGPU)
                    const uv = vec2(a.sub(R.x).div(R.y.sub(R.x)), R.w.sub(b).div(R.w.sub(R.z)));
                    out.assign(texture(tex[i], uv).level(float(0)));
                };
                If(ay.greaterThan(max(ax, az).mul(SIDE_REACH)), () => {
                    If(d.y.greaterThan(0), () => read(4, d.x.div(d.y), d.z.div(d.y)))
                        .Else(() => read(5, d.x.div(d.y.negate()), d.z.div(d.y)));
                }).ElseIf(az.greaterThanEqual(ax), () => {
                    If(d.z.lessThan(0), () => read(0, d.x.div(d.z.negate()), d.y.div(d.z.negate())))
                        .Else(() => read(1, d.x.negate().div(d.z), d.y.div(d.z)));
                }).Else(() => {
                    If(d.x.greaterThan(0), () => read(2, d.z.div(d.x), d.y.div(d.x)))
                        .Else(() => read(3, d.z.div(d.x), d.y.div(d.x.negate())));
                });
            });
            return out;
        })();
    }
}
