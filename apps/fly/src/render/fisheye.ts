// The FPV camera through a calibrated fisheye lens (lens.ts): the scene is drawn by cube-face cameras, each cropped to
// what the lens sees on its face, into render targets; then one full-screen pass turns every screen pixel into the
// lens's ray and reads it from its face. A wide flat render warped afterwards cannot reach these lenses' 140-160 deg
// corners without blurring the centre (it stretches without bound towards 180 deg); the faces stretch at most to 45 deg sideways
// and 63 deg up or down.
// Low spec (owner, 2026-10-22: a fisheye that runs on a cheap laptop) draws the front face alone, cropped as wide as the
// picture reaches (up to ~80 deg off the axis), with the classic WebGLRenderer: each extra face is a whole scene pass
// (every city tile it touches is drawn whole), which cost far more than the wide face's extra pixels; the centre is a
// little softer and the edges are read from mipmaps, as the face is squeezed there (docs/notes/low-spec.md).
// The fast lens of full graphics (owner, 2026-10-25: "a cheaper fisheye lens for Firefox") draws that one wide face with
// the WebGPURenderer: one scene pass instead of three to five, which is where Firefox's frame time went (each pass
// writes every object's data again; docs/notes/browsers-input-performance.md §2p). The face is 2-6x the screen's
// pixels, so it has no multisampling (4x would take 200-600 MB): the squeezed edges are smoothed by the mipmaps and
// anisotropic reads, the centre at one texel per pixel has no anti-aliasing.
// Rendering only: it reads the camera's pose and never touches sim state.

import * as THREE from 'three/webgpu';
import { SRGBColorSpace, ShaderMaterial, WebGLRenderTarget } from 'three';
import { Fn, If, abs, cos, float, floor, int, ivec2, max, min, mix, screenUV, select, sin, sqrt, tan, texture, textureLoad, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { CAMERA_NEAR } from './view';
import { FACES, LUT_N, SIDE_REACH, lensLayout } from './lens';
import type { LensLayout, LensProfile } from './lens';

type FloatNode = THREE.Node<'float'>;

/** MSAA samples per face, as the canvas has (the renderer is made with antialias) */
const SAMPLES = 4;
/**
 * Low spec: the front face's texels per screen pixel at the picture's centre, against 1 in full graphics. Extra and
 * super low spec (no GPU: the CPU draws every pixel) take fewer; the face still holds ~1.5-4x the screen's pixels,
 * as it reaches ~80 deg out (measured 2026-10-22, docs/notes/low-spec.md).
 */
export const LOW_SPEC_OVERSAMPLE = 0.7;
export const NO_GPU_OVERSAMPLE = 0.5;

/** Either renderer: Three.js's WebGPURenderer, or the classic WebGLRenderer of the low spec modes */
interface Drawer {
    setRenderTarget(t: any): void;
    render(scene: THREE.Object3D, cam: THREE.Camera): unknown;
}

export interface FisheyeOptions {
    /** the classic WebGLRenderer draws it, from the front face alone (low spec modes) */
    lowSpec: boolean;
    /** full graphics draws the front face alone, wide (the fast lens, graphics.ts LensDrawing); low spec always does */
    wide?: boolean;
    /** the face cameras' far plane, m: the FPV camera's, so the faces cull as it does */
    far: number;
    /** face texels per screen pixel (default 1) */
    oversample?: number;
}

export class FisheyeView {
    private readonly single: boolean;
    private readonly targets: THREE.RenderTarget[];
    private readonly cams: THREE.PerspectiveCamera[];
    private readonly faceQ: THREE.Quaternion[];
    private readonly rects = FACES.map(() => uniform(new THREE.Vector4(0, 1, 0, 1)));
    private readonly lut = new THREE.DataTexture(new Float32Array(LUT_N), LUT_N, 1, THREE.RedFormat, THREE.FloatType);
    private readonly scale = uniform(new THREE.Vector2(1, 1));
    private readonly half = uniform(new THREE.Vector2(0, 0));
    private readonly rMax = uniform(1);
    /** full graphics: the lens pass */
    private readonly quad: THREE.QuadMesh | null = null;
    /** low spec: the lens pass, a screen-filling plane drawn by `passCam` */
    private readonly pass: THREE.Scene | null = null;
    private readonly passMat: ShaderMaterial | null = null;
    private readonly passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    /** a face-sized target for the warm-up: same format and samples as the faces, so the same pipelines */
    private readonly warmTarget: THREE.RenderTarget;
    private lens: LensProfile | null = null;
    private width = 0;
    private height = 0;
    /** face texels per screen pixel (settable from the console, then setSize again) */
    oversample: number;
    /** the last layout, for the console (__fly.ask) */
    layout: LensLayout | null = null;

    constructor(opts: FisheyeOptions) {
        this.single = opts.lowSpec || opts.wide === true;
        this.oversample = opts.oversample ?? 1;
        const make = (size: number): THREE.RenderTarget => {
            if (opts.lowSpec) {
                return new WebGLRenderTarget(size, size, {
                    colorSpace: SRGBColorSpace, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter
                }) as unknown as THREE.RenderTarget;
            }
            if (!opts.wide) return new THREE.RenderTarget(size, size, { type: THREE.HalfFloatType, samples: SAMPLES, depthBuffer: true });
            const t = new THREE.RenderTarget(size, size, {
                type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter
            });
            // the face is squeezed along the radius far more than across it towards the edges
            t.texture.anisotropy = 16;
            return t;
        };
        this.targets = FACES.map(() => make(1));
        this.warmTarget = make(64);
        this.cams = FACES.map(() => new THREE.PerspectiveCamera(90, 1, CAMERA_NEAR, opts.far));
        this.faceQ = FACES.map((F) => {
            const v = (a: readonly number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
            const m = new THREE.Matrix4().makeBasis(v(F.right), v(F.up), v(F.fwd).negate());
            return new THREE.Quaternion().setFromRotationMatrix(m);
        });
        this.lut.needsUpdate = true;
        if (opts.lowSpec) {
            this.passMat = this.glsl();
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.passMat);
            plane.frustumCulled = false;
            this.pass = new THREE.Scene();
            this.pass.add(plane);
        } else {
            const mat = new THREE.MeshBasicNodeMaterial();
            mat.colorNode = this.single ? this.wideShader() : this.shader();
            this.quad = new THREE.QuadMesh(mat);
        }
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
        const L = lensLayout(this.lens, this.width, this.height, this.oversample, this.single);
        this.layout = L;
        this.scale.value.set(L.scaleX, L.scaleY);
        this.half.value.set(L.halfX, L.halfY);
        this.rMax.value = L.rMax;
        if (this.passMat) this.passMat.uniforms.rMax.value = L.rMax;
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
            // the near plane cuts at CAMERA_NEAR along the axis but nearer along a slanted ray: brought in so nothing
            // CAMERA_NEAR from the lens is cut, even in the crop's furthest corner (~80 deg off the axis in low spec)
            c.near = CAMERA_NEAR / Math.hypot(1, Math.max(Math.abs(F.x0), Math.abs(F.x1)), Math.max(Math.abs(F.y0), Math.abs(F.y1)));
            c.setViewOffset(2 * t, 2 * t, F.x0 + t, t - F.y1, F.x1 - F.x0, F.y1 - F.y0);
            c.updateProjectionMatrix();
        });
    }

    /**
     * Draw the scene from `cam` (the FPV camera's pose) through the lens onto the canvas. The sun's shadow map is drawn
     * for the first face only: Three.js redraws it once per camera per frame, and every face sees the same shadows.
     */
    render(renderer: Drawer, scene: THREE.Scene, cam: THREE.Camera, shadow: THREE.LightShadow | null): void {
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
        this.drawPass(renderer);
    }

    /** Free the GPU memory (the faces, the lookup table, the pass's material) when the engine builds another view */
    dispose(): void {
        for (const t of this.targets) t.dispose();
        this.warmTarget.dispose();
        this.lut.dispose();
        (this.quad?.material as THREE.Material | undefined)?.dispose();
        this.passMat?.dispose();
    }

    /** Build the face and lens-pass pipelines before the first frame (engine.ts warmUp), lens or not. */
    warmUp(renderer: Drawer, scene: THREE.Scene, cam: THREE.Camera): void {
        renderer.setRenderTarget(this.warmTarget);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        this.drawPass(renderer);
    }

    private drawPass(renderer: Drawer): void {
        if (this.pass) renderer.render(this.pass, this.passCam);
        else this.quad!.render(renderer as THREE.WebGPURenderer);
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

    /**
     * The fast lens's pass: screen pixel -> lens ray as shader() above, read from the front face alone, as the low spec
     * GLSL below. The read is outside any branch, so the GPU picks the mipmap level from neighbouring pixels.
     */
    private wideShader(): THREE.Node<'vec4'> {
        const face = this.targets[0].texture;
        const R = this.rects[0];
        return Fn(() => {
            const x = screenUV.x.sub(0.5).mul(this.scale.x);
            const y = float(0.5).sub(screenUV.y).mul(this.scale.y);
            const r = sqrt(x.mul(x).add(y.mul(y)));
            const fi = min(r.div(this.rMax).mul(LUT_N - 1), LUT_N - 1);
            const i0 = floor(fi);
            const i1 = min(i0.add(1), LUT_N - 1);
            const t0 = textureLoad(this.lut, ivec2(int(i0), int(0))).x;
            const t1 = textureLoad(this.lut, ivec2(int(i1), int(0))).x;
            // past the picture (the bars) the angle may reach 90 deg: kept just short of it
            const theta = min(mix(t0, t1, fi.sub(i0)), 1.55);
            // the ray's place on the front face: tan(theta) along the radius
            const k = tan(theta).div(max(r, 1e-9));
            const a = x.mul(k), b = y.mul(k);
            // a render target's v runs down from its top row (as shader())
            const c = texture(face, vec2(a.sub(R.x).div(R.y.sub(R.x)), R.w.sub(b).div(R.w.sub(R.z))));
            return select(abs(x).lessThanEqual(this.half.x).and(abs(y).lessThanEqual(this.half.y)), c, vec4(0, 0, 0, 1));
        })();
    }

    /**
     * The low spec pass in GLSL for the classic WebGLRenderer: screen pixel -> lens ray as shader() above, read from the
     * front face alone. No branch round the read, so the GPU picks the mipmap level from neighbouring pixels (the bars
     * are painted after). The classic renderer's targets read with v = 0 at the bottom row. The face holds linear colour
     * (sRGB-encoded 8-bit, as the see-through circle's target); colorspace_fragment converts it for the canvas.
     */
    private glsl(): ShaderMaterial {
        return new ShaderMaterial({
            uniforms: {
                lut: { value: this.lut },
                face: { value: this.targets[0].texture },
                rect: { value: this.rects[0].value },
                scale: { value: this.scale.value },
                halfExt: { value: this.half.value },
                rMax: { value: 1 }
            },
            defines: { LUT_N },
            depthTest: false,
            depthWrite: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform sampler2D lut;
                uniform sampler2D face;
                uniform vec4 rect;
                uniform vec2 scale, halfExt;
                uniform float rMax;
                varying vec2 vUv;
                void main() {
                    float x = (vUv.x - 0.5) * scale.x;
                    float y = (vUv.y - 0.5) * scale.y;
                    float r = sqrt(x * x + y * y);
                    float fi = min(r / rMax * float(LUT_N - 1), float(LUT_N - 1));
                    float i0 = floor(fi);
                    float i1 = min(i0 + 1.0, float(LUT_N - 1));
                    float t0 = texelFetch(lut, ivec2(int(i0), 0), 0).x;
                    float t1 = texelFetch(lut, ivec2(int(i1), 0), 0).x;
                    // past the picture (the bars) the angle may reach 90 deg: kept just short of it
                    float theta = min(mix(t0, t1, fi - i0), 1.55);
                    // the ray's place on the front face: tan(theta) along the radius
                    vec2 t = vec2(x, y) * (tan(theta) / max(r, 1e-9));
                    vec4 c = texture(face, (t - rect.xz) / (rect.yw - rect.xz));
                    if (abs(x) > halfExt.x || abs(y) > halfExt.y) c = vec4(0.0, 0.0, 0.0, 1.0);
                    gl_FragColor = c;
                    #include <colorspace_fragment>
                }`
        });
    }
}
