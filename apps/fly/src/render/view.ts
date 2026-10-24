// Cameras that follow the craft. Rendering only reads sim state; nothing here feeds back into it.
//
// sim-core's frames match Three.js (sim.ts header): world Y up, right-handed; body nose along -Z,
// up +Y. A Three.js camera looks along its -Z with +Y up, so the FPV camera is the body's rotation
// followed by the uptilt, a rotation about the body's +X (positive tilts the view up).

import * as THREE from 'three/webgpu';
import { S } from '@owfpv/sim-core';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

const X = new THREE.Vector3(1, 0, 0);
/**
 * Near clipping distance, m. The FPV camera sits at the body's centre, and the body sphere keeps that 45 mm (Nazgul)
 * from any surface; the near plane's corners at 120 deg FOV reach about 2.1 x this from the lens, so 1 cm never cuts
 * into a surface the quad rests against. At 5 cm it did: a quad lying on a wall or the ground showed the sky through
 * it (owner, 2026-10-17). Depth precision out to the far plane comes from the reversed depth buffer (main.ts).
 */
export const CAMERA_NEAR = 0.01;

/** Full graphics' far plane, m: past the longest view's fog (graphics.ts VIEW_DISTANCES, 6 km) and the clouds' field */
export const FULL_FAR = 12000;

/** Vertical FOV for a horizontal FOV at an aspect ratio (Three.js cameras take the vertical one). */
export function verticalFov(hDeg: number, aspect: number): number {
    const h = (hDeg * Math.PI) / 180;
    return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}

export class CraftView {
    readonly camera: THREE.PerspectiveCamera;
    readonly craft: THREE.Group;
    mode: 'fpv' | 'chase' = 'fpv';
    uptiltDeg = 20;
    fovDeg = 120;
    private readonly q = new THREE.Quaternion();
    private readonly tilt = new THREE.Quaternion();
    private readonly chasePos = new THREE.Vector3();
    private chaseInit = false;

    constructor(kit: Kit = FULL_KIT) {
        this.camera = new THREE.PerspectiveCamera(90, 16 / 9, CAMERA_NEAR, kit.lowSpec ? kit.fog.far + 10 : FULL_FAR);
        this.craft = craftModel(kit);
    }

    resize(w: number, h: number): void {
        this.camera.aspect = w / h;
        this.updateFov();
    }

    updateFov(): void {
        // the chase camera is a normal lens; the FPV one is the pilot's camera
        this.camera.fov = this.mode === 'fpv' ? verticalFov(this.fovDeg, this.camera.aspect) : 60;
        this.camera.updateProjectionMatrix();
    }

    setMode(m: 'fpv' | 'chase'): void {
        this.mode = m;
        this.chaseInit = false;
        this.updateFov();
    }

    /** Place the craft model and the camera from the sim state (Float64Array laid out as sim-core's S). */
    update(s: Float64Array, dtS: number): void {
        this.q.set(s[S.qx], s[S.qy], s[S.qz], s[S.qw]);
        this.craft.position.set(s[S.px], s[S.py], s[S.pz]);
        this.craft.quaternion.copy(this.q);
        this.craft.visible = this.mode === 'chase';
        const cam = this.camera;
        if (this.mode === 'fpv') {
            this.tilt.setFromAxisAngle(X, (this.uptiltDeg * Math.PI) / 180);
            cam.position.copy(this.craft.position);
            cam.quaternion.copy(this.q).multiply(this.tilt);
            return;
        }
        // chase: behind and above along the heading, smoothed so flips do not whip the camera round
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
        fwd.normalize();
        const want = this.craft.position.clone().addScaledVector(fwd, -3.5).add(new THREE.Vector3(0, 1.3, 0));
        if (!this.chaseInit) {
            this.chasePos.copy(want);
            this.chaseInit = true;
        } else this.chasePos.lerp(want, 1 - Math.exp(-dtS * 6));
        cam.position.copy(this.chasePos);
        cam.lookAt(this.craft.position);
    }
}

/** A blockout 5-inch quad: a body, four arms and prop discs (for the chase view). */
function craftModel(kit: Kit): THREE.Group {
    const g = new THREE.Group();
    const dark = kit.lit({ color: 0x222428, roughness: 0.6 });
    const accent = kit.lit({ color: 0xe0582a, roughness: 0.5 });
    const prop = kit.lit({ color: 0x9ab, transparent: true, opacity: 0.35 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.14), accent));
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.12), dark);
        arm.position.set(x * 0.042, -0.01, z * 0.042);
        arm.rotation.y = Math.atan2(x, z);
        g.add(arm);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.0645, 0.0645, 0.004, 24), prop);
        disc.position.set(x * 0.0845, 0.012, z * 0.0845);
        g.add(disc);
    }
    return g;
}
