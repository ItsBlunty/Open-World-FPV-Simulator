// The FPV lens model (render/lens.ts, ported from Gyroflow's opencv_fisheye) and the cube-face layout that draws it.

import { describe, expect, it } from 'vitest';
import { FACES, distort, faceOf, foldAngle, lensFov, lensFromGyroflow, lensLayout, onFace, rayAt, undistort } from '../src/render/lens';
import type { Vec3 } from '../src/render/lens';
import { DEFAULT_LENS, LENSES, lensById } from '../src/render/lenses';

const ratel2 = lensById(DEFAULT_LENS)!;

describe('opencv fisheye lens model', () => {
    it('undistort inverts distort across every offered lens', () => {
        for (const l of LENSES) {
            for (let t = 0.01; t < 1.4; t += 0.01) expect(undistort(distort(t, l.k), l.k)).toBeCloseTo(t, 10);
        }
    });

    it('gives the Ratel 2 calibration its field of view (Python check of the same file: H128 V103 D156)', () => {
        const f = lensFov(ratel2);
        expect(Math.round(f.h)).toBe(128);
        expect(Math.round(f.v)).toBe(103);
        expect(Math.round(f.d)).toBe(156);
    });

    it('rejects a calibration that folds inside its picture (the original Ratel, Nazgul5 V1 stock camera)', () => {
        const k = [0.00576520627195178, 0.08742408848332676, -0.05370296068168609, 0.0036477532015699128];
        expect(foldAngle(k)).not.toBeNull();
        const json = { calib_dimension: { w: 720, h: 480 }, fisheye_params: { camera_matrix: [[307.877, 0, 360], [0, 272.59, 240], [0, 0, 1]], distortion_coeffs: k } };
        expect(() => lensFromGyroflow('ratel-1', 'Ratel', json)).toThrow(/folds/);
    });

    it('offers only lenses that do not fold inside the picture', () => {
        expect(LENSES.length).toBe(15);
        for (const l of LENSES) {
            const f = lensFov(l);
            expect(f.d).toBeGreaterThan(120);
            expect(f.d).toBeLessThan(170);
        }
    });
});

describe('cube-face layout', () => {
    for (const [w, h] of [[2560, 1440], [1920, 1200], [1024, 1024]]) {
        it(`puts every ray of the Ratel 2 picture inside its face's crop at ${w}x${h}`, () => {
            const L = lensLayout(ratel2, w, h);
            for (let j = 0; j <= 60; j++) {
                for (let i = 0; i <= 60; i++) {
                    const d = rayAt(-L.halfX + (2 * L.halfX * i) / 60, -L.halfY + (2 * L.halfY * j) / 60, ratel2.k)!;
                    const f = faceOf(d);
                    const [a, b] = onFace(f, d);
                    const F = L.faces[f];
                    expect(F.width).toBeGreaterThan(0);
                    expect(a).toBeGreaterThanOrEqual(F.x0);
                    expect(a).toBeLessThanOrEqual(F.x1);
                    expect(b).toBeGreaterThanOrEqual(F.y0);
                    expect(b).toBeLessThanOrEqual(F.y1);
                }
            }
        });
    }

    it('fits the picture with black bars and keeps the centre at screen resolution', () => {
        const L = lensLayout(ratel2, 2560, 1440);
        // the Ratel 2 picture is about 4:3, narrower than the screen: full height, bars left and right
        expect(L.scaleY).toBeCloseTo(2 * L.halfY, 10);
        expect(L.scaleX).toBeGreaterThan(2 * L.halfX);
        // the front face's texels per tangent unit near the axis ~ screen pixels per normalised unit (1440 px over 2 halfY)
        const front = L.faces[0];
        const density = front.width / (front.x1 - front.x0);
        expect(density / (1440 / (2 * L.halfY))).toBeGreaterThan(0.99);
        expect(density / (1440 / (2 * L.halfY))).toBeLessThan(1.1);
        // a ~156 deg diagonal lens never looks backwards
        expect(L.faces[1].width).toBe(0);
    });

    it('draws every offered lens with 3 faces (front, right, left: each face is a scene pass)', () => {
        for (const l of LENSES) {
            const used = lensLayout(l, 2560, 1440).faces.map((F, i) => (F.width > 0 ? i : -1)).filter((i) => i >= 0);
            expect(used, l.id).toEqual([0, 2, 3]);
        }
    });

    it('builds right-handed faces whose crops agree with their rule', () => {
        for (const F of FACES) {
            const c: Vec3 = [F.right[1] * F.up[2] - F.right[2] * F.up[1], F.right[2] * F.up[0] - F.right[0] * F.up[2], F.right[0] * F.up[1] - F.right[1] * F.up[0]];
            for (let i = 0; i < 3; i++) expect(c[i] + F.fwd[i]).toBe(0);
        }
        expect(faceOf([0.1, 0.2, -1])).toBe(0);
        expect(onFace(0, [0.1, 0.2, -1])).toEqual([0.1, 0.2]);
    });

    it('fills the lookup table with the lens angles', () => {
        const L = lensLayout(ratel2, 1920, 1080);
        expect(L.lut[0]).toBe(0);
        expect(L.lut[L.lut.length - 1]).toBeCloseTo(undistort(L.rMax, ratel2.k)!, 6);
    });
});
