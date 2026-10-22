// SPDX-License-Identifier: GPL-3.0-or-later
//
// The FPV camera's lens: a calibrated fisheye from Gyroflow's lens profiles (lenses/README.md), and the layout that
// draws it. Pure maths, no Three.js, so tests can run it in Node. Rendering only: nothing here feeds the sim.
//
// distort(), undistort() and foldAngle() are ported from Gyroflow (https://github.com/gyroflow/gyroflow, commit
// 5fa0309a17ecd682d87746cf37d8dde333915f1a), src/core/stabilization/distortion_models/opencv_fisheye.rs and mod.rs
// (radial_distortion_limit, distortion_derivative):
//     Copyright © 2022 Adrian <adrian.eddy at gmail>, GPL-3.0-or-later
//     "Adapted from OpenCV: https://github.com/opencv/opencv/blob/2b60166e5c65f1caccac11964ad760d847c536e4/modules/calib3d/src/fisheye.cpp#L257-L460"
// Changes: TypeScript, doubles instead of f32 (Newton runs to 1e-12 and up to 50 steps), no uncalibrated pinhole branch.
//
// How the picture is made (fisheye.ts): the scene is drawn by up to six square-on cameras, one per cube face, each
// cropped to the part of its face the lens sees (faceOf() sorts the rays). Then each screen
// pixel is turned into the lens's ray (picture -> normalised radius -> angle θ via the lookup table) and reads its face.

/** A calibrated lens in the units the shader needs. The principal point is put at the picture's centre (see below). */
export interface LensProfile {
    id: string;
    label: string;
    /** calibration size, px */
    w: number;
    h: number;
    /** focal lengths, px (they differ when the recording's pixels are not square, e.g. analog captures) */
    fx: number;
    fy: number;
    /** OpenCV fisheye coefficients k1..k4 */
    k: readonly [number, number, number, number];
}

/** Image radius (normalised, i.e. px / f) of a ray `theta` rad off the lens axis. */
export function distort(theta: number, k: readonly number[]): number {
    const t2 = theta * theta, t4 = t2 * t2, t6 = t4 * t2, t8 = t4 * t4;
    return theta * (1 + k[0] * t2 + k[1] * t4 + k[2] * t6 + k[3] * t8);
}

/** d(image radius)/dθ: <= 0 where the calibrated curve folds back. */
function derivative(theta: number, k: readonly number[]): number {
    const t2 = theta * theta, t4 = t2 * t2, t6 = t4 * t2, t8 = t6 * t2;
    return 1 + 3 * k[0] * t2 + 5 * k[1] * t4 + 7 * k[2] * t6 + 9 * k[3] * t8;
}

/** The ray angle, rad, that lands at normalised image radius `rd`; null where Newton does not converge or flips. */
export function undistort(rd: number, k: readonly number[]): number | null {
    const EPS = 1e-12;
    // the model is only valid up to 180 deg (Gyroflow's clip)
    const thetaD = Math.min(Math.max(rd, -Math.PI), Math.PI);
    if (Math.abs(thetaD) <= EPS) return thetaD;
    let theta = 0;
    let converged = false;
    for (let i = 0; i < 50; i++) {
        let fix = (distort(theta, k) - thetaD) / derivative(theta, k);
        fix = Math.min(Math.max(fix, -0.9), 0.9);
        theta -= fix;
        if (Math.abs(fix) < EPS) {
            converged = true;
            break;
        }
    }
    const flipped = (thetaD < 0 && theta > 0) || (thetaD > 0 && theta < 0);
    if (Math.abs(theta) >= Math.PI || !converged || flipped) return null;
    return theta;
}

/** Largest ray angle, rad, before the curve folds back (Gyroflow's radial_distortion_limit); null when it never does. */
export function foldAngle(k: readonly number[]): number | null {
    const STEPS = 256;
    let low = 0, high = Math.PI, found = false;
    for (let i = 1; i <= STEPS; i++) {
        const theta = (i / STEPS) * Math.PI;
        if (derivative(theta, k) <= 0) {
            high = theta;
            found = true;
            break;
        }
        low = theta;
    }
    if (!found) return null;
    while (high - low > 1e-6) {
        const mid = (low + high) / 2;
        if (derivative(mid, k) > 0) low = mid;
        else high = mid;
    }
    const max = (low + high) / 2;
    return Math.abs(max - Math.PI) > 0.001 ? max : null;
}

/** Half the picture's width and height in normalised image units (px / f). */
export function pictureHalf(p: LensProfile): { x: number; y: number } {
    return { x: p.w / 2 / p.fx, y: p.h / 2 / p.fy };
}

/** Field of view across the picture, deg: horizontal, vertical, diagonal. */
export function lensFov(p: LensProfile): { h: number; v: number; d: number } {
    const half = pictureHalf(p);
    const deg = (r: number): number => ((undistort(r, p.k) ?? NaN) * 360) / Math.PI;
    return { h: deg(half.x), v: deg(half.y), d: deg(Math.hypot(half.x, half.y)) };
}

/**
 * A lens from a Gyroflow lens profile (JSON). Only the opencv_fisheye model is read (every FPV camera's profile uses
 * it). Throws when the profile cannot be drawn: missing numbers, another model, or a curve that folds back inside the
 * picture (the corners would show the scene twice).
 *
 * The profile's principal point (cx, cy) is not used: the picture is centred on the lens axis. The offset in a
 * calibration (up to 5 % of the height in these files) is that one camera's sensor mounting, not the model's; the
 * horizon's place is the uptilt's job.
 */
export function lensFromGyroflow(id: string, label: string, json: unknown): LensProfile {
    const j = json as {
        distortion_model?: string;
        calib_dimension?: { w?: number; h?: number };
        fisheye_params?: { camera_matrix?: number[][]; distortion_coeffs?: number[] };
    };
    if (j.distortion_model !== undefined && j.distortion_model !== null && j.distortion_model !== 'opencv_fisheye') {
        throw new Error(`${id}: distortion model ${j.distortion_model} is not supported`);
    }
    const w = j.calib_dimension?.w, h = j.calib_dimension?.h;
    const m = j.fisheye_params?.camera_matrix, c = j.fisheye_params?.distortion_coeffs;
    if (!w || !h || !m || m.length < 2 || !c || c.length < 4) throw new Error(`${id}: incomplete lens profile`);
    const p: LensProfile = { id, label, w, h, fx: m[0][0], fy: m[1][1], k: [c[0], c[1], c[2], c[3]] };
    if (!(p.fx > 0 && p.fy > 0) || !p.k.every(Number.isFinite)) throw new Error(`${id}: bad camera matrix`);
    const fold = foldAngle(p.k);
    const half = pictureHalf(p);
    if (fold !== null && distort(fold, p.k) <= Math.hypot(half.x, half.y)) throw new Error(`${id}: the lens curve folds inside the picture`);
    return p;
}

/**
 * The six cube-face cameras, in the FPV camera's frame (Three.js: looks along -Z, +Y up, +X right). `right x up = -fwd`
 * for each (right-handed). The fisheye shader (fisheye.ts) picks faces with the same rule as faceOf().
 */
export const FACES: readonly { name: string; fwd: Vec3; right: Vec3; up: Vec3 }[] = [
    { name: 'front', fwd: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
    { name: 'back', fwd: [0, 0, 1], right: [-1, 0, 0], up: [0, 1, 0] },
    { name: 'right', fwd: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
    { name: 'left', fwd: [-1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
    { name: 'up', fwd: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] },
    { name: 'down', fwd: [0, -1, 0], right: [1, 0, 0], up: [0, 0, -1] }
];
export type Vec3 = [number, number, number];

/**
 * How far up or down (tangent units) the front, back and side faces reach before the up / down faces take over: 2,
 * i.e. 63 deg. Each face drawn costs a whole scene pass on the CPU (~0.4 ms in Chrome: the map's big meshes are in
 * every face), while a taller face only costs pixels; with this every lens offered needs 3 faces (4:3 lenses needed 5
 * with plain cube faces: measured 2.2 ms CPU vs 0.4 flat, 2026-10-18).
 */
export const SIDE_REACH = 2;

/** The face a ray direction is drawn from: by its heading, unless it is steeper than SIDE_REACH (as the shader does). */
export function faceOf(d: Vec3): number {
    const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
    if (ay > SIDE_REACH * Math.max(ax, az)) return d[1] > 0 ? 4 : 5;
    if (az >= ax) return d[2] < 0 ? 0 : 1;
    return d[0] > 0 ? 2 : 3;
}

/** A ray's place on a face's image plane, in tangent units (right, up). */
export function onFace(f: number, d: Vec3): [number, number] {
    const F = FACES[f];
    const z = dot(d, F.fwd);
    return [dot(d, F.right) / z, dot(d, F.up) / z];
}

function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The ray through normalised image point (x right, y up), in the FPV camera's frame. */
export function rayAt(x: number, y: number, k: readonly number[]): Vec3 | null {
    const r = Math.hypot(x, y);
    if (r < 1e-12) return [0, 0, -1];
    const theta = undistort(r, k);
    if (theta === null) return null;
    const s = Math.sin(theta) / r;
    return [x * s, y * s, -Math.cos(theta)];
}

/** Entries in the radius -> angle lookup table (linear between entries: error ~1e-7 rad on these lenses). */
export const LUT_N = 1024;

export interface FaceLayout {
    /** the part of the face drawn, tangent units: x0..x1 right, y0..y1 up; empty (size 0) when the lens never sees it */
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    /** render target size, px */
    width: number;
    height: number;
}

export interface LensLayout {
    /** screen uv (0..1, v down) -> normalised image point: x = (u - 0.5) scaleX, y = (0.5 - v) scaleY */
    scaleX: number;
    scaleY: number;
    /** the picture's half extents, normalised (outside: the black bars) */
    halfX: number;
    halfY: number;
    /** the lookup table spans image radius 0..rMax */
    rMax: number;
    /** θ, rad, at radius i / (LUT_N - 1) rMax */
    lut: Float32Array;
    faces: FaceLayout[];
}

/** Largest render target side, px (WebGPU guarantees 8192). */
const MAX_SIZE = 4096;
/** Spare texels round each face's crop, so the bilinear reads at its edges stay inside what was drawn. */
const PAD_TEXELS = 2;

/**
 * Where everything goes for a lens on a screen of `width` x `height` device pixels: the picture fitted inside it with
 * black bars (owner, 2026-10-18), and each face's crop and resolution. A face gets enough pixels that one screen pixel
 * never spans less than one face texel (`oversample` times more), measured over a grid of the picture.
 * `single`: the front face alone draws the whole picture, however far its crop must reach (low spec: fisheye.ts).
 */
export function lensLayout(p: LensProfile, width: number, height: number, oversample = 1, single = false): LensLayout {
    const half = pictureHalf(p);
    const aspect = half.x / half.y;
    const picW = width / height > aspect ? height * aspect : width;
    const picH = picW / aspect;
    const scaleX = (width / picW) * 2 * half.x;
    const scaleY = (height / picH) * 2 * half.y;
    // normalised units per screen pixel
    const px = (2 * half.x) / picW;

    const rMax = Math.hypot(half.x, half.y);
    const lut = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) lut[i] = undistort((i / (LUT_N - 1)) * rMax, p.k) ?? Math.PI;

    const box = FACES.map(() => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, density: 0 }));
    // ~256 samples across the picture plus every edge, where the crops reach furthest
    const nx = 256, ny = Math.max(2, Math.round(nx / aspect));
    // a ray behind the camera has no place on the front face (every lens offered stays under 80 deg off the axis)
    const faceFor = (d: Vec3): number => (single ? (d[2] < 0 ? 0 : -1) : faceOf(d));
    const sample = (x: number, y: number): void => {
        const d = rayAt(x, y, p.k);
        if (!d) return;
        const f = faceFor(d);
        if (f < 0) return;
        const [a, b] = onFace(f, d);
        const B = box[f];
        B.x0 = Math.min(B.x0, a);
        B.x1 = Math.max(B.x1, a);
        B.y0 = Math.min(B.y0, b);
        B.y1 = Math.max(B.y1, b);
        // one screen pixel right and one up, on the same face: the face texels per tangent unit that pixel needs
        const dx = rayAt(x + px, y, p.k), dy = rayAt(x, y + px, p.k);
        if (!dx || !dy || faceFor(dx) !== f || faceFor(dy) !== f) return;
        const [ax, bx] = onFace(f, dx), [ay, by] = onFace(f, dy);
        const step = Math.max(Math.abs(ax - a), Math.abs(bx - b), Math.abs(ay - a), Math.abs(by - b));
        if (step > 0) B.density = Math.max(B.density, 1 / step);
    };
    for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) sample(-half.x + (2 * half.x * i) / nx, -half.y + (2 * half.y * j) / ny);
    }
    const edge = 2048;
    for (let i = 0; i <= edge; i++) {
        const s = -1 + (2 * i) / edge;
        sample(s * half.x, half.y);
        sample(s * half.x, -half.y);
        sample(half.x, s * half.y);
        sample(-half.x, s * half.y);
    }

    const faces = box.map((B): FaceLayout => {
        if (!(B.x1 >= B.x0) || B.density === 0) return { x0: 0, x1: 0, y0: 0, y1: 0, width: 0, height: 0 };
        let density = B.density * oversample;
        const longest = Math.max(B.x1 - B.x0, B.y1 - B.y0) + (2 * PAD_TEXELS) / density;
        density = Math.min(density, MAX_SIZE / longest);
        const pad = PAD_TEXELS / density;
        const x0 = B.x0 - pad, x1 = B.x1 + pad, y0 = B.y0 - pad, y1 = B.y1 + pad;
        return { x0, x1, y0, y1, width: Math.max(1, Math.ceil((x1 - x0) * density)), height: Math.max(1, Math.ceil((y1 - y0) * density)) };
    });
    return { scaleX, scaleY, halfX: half.x, halfY: half.y, rMax, lut, faces };
}
