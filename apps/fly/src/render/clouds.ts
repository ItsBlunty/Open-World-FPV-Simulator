// Clouds (owner, 2026-10-24: "Make lower stylized clouds, that players can go up and fly through. Make them cloud the
// vision like flying in a cloud would really do"). Stylised cumulus of soft white puffs (cloud-puffs.ts) 180-280 m up,
// one instanced mesh, lit by the sun and the sky like the rest of the map and fogged with it. Not solid, as clouds aren't.
// Flying into one, the view fogs over: the scene's fog closes in to a few metres and turns cloud-white, from a few metres
// before the puff's edge to fully white some way inside, so there is no edge to see through as the camera crosses it.
// Full graphics only. Drawn only: nothing here reaches the sim.

import * as THREE from 'three/webgpu';
import { cloudPuffs, insideDepth } from './cloud-puffs';
import type { Puff } from './cloud-puffs';

/** the fog inside a cloud: its colour (a lit cloud's grey-white) and how far one sees once fully inside, m */
export const IN_CLOUD_COLOUR = 0xdfe5ec;
export const IN_CLOUD_SIGHT = 14;
/** the whiteout starts this far outside a puff and is full this deep inside, m */
const FADE_OUT = 4;
const FADE_IN = 12;

export class CloudsView {
    readonly group = new THREE.Group();
    readonly puffs: readonly Puff[];

    constructor() {
        this.group.name = 'clouds';
        this.puffs = cloudPuffs();
        // a smooth ball, enough segments to read as round at a few metres
        const ball = new THREE.SphereGeometry(1, 32, 20);
        const mat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0x9aa8ba, emissiveIntensity: 0.45 });
        const mesh = new THREE.InstancedMesh(ball, mat, this.puffs.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
        this.puffs.forEach((f, i) => {
            mesh.setMatrixAt(i, m.compose(p.set(f.x, f.y, f.z), q, s.set(f.r, f.r * f.sy, f.r)));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.name = 'clouds:puffs';
        this.group.add(mesh);
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
