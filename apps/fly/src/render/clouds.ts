// Clouds (owner, 2026-10-24: "add clouds"): a sheet of fair-weather cumulus at CLOUD_BASE, its picture from
// cloud-texture.ts, tiling every CLOUD_TILE. The sheet is a disc round the camera that fades out towards its rim, so the
// clouds meet the sky at the horizon; the picture on it stays put on the ground's map (moving with the wind), so flying
// under a cloud passes it. Not fogged: clouds stand out above the haze. Drawn only, at the sim's tick: nothing here
// reaches the sim. The low spec kits see no further than their fog (view.ts), far short of the clouds: none there.

import * as THREE from 'three/webgpu';
import { CLOUD_TEX, cloudPixels } from './cloud-texture';

/** the clouds' base above the ground, m: a fair-weather cumulus base (they form at 1000-2000 m on a summer day) */
export const CLOUD_BASE = 1500;
/** how much ground one picture covers, m: its base cells 1 km across, so clouds of a few hundred metres to 2 km */
export const CLOUD_TILE = 8000;
/** the disc's radius, m, and where it starts to fade (the camera's far plane reaches past it: view.ts) */
export const CLOUD_R = 14000;
const FADE_FROM = 4000;
/** the wind at the clouds' height, m/s along +x (west to east) and +z [estimate: a light breeze aloft] */
const WIND = { x: 6, z: 2 };

export class CloudsView {
    readonly group = new THREE.Group();
    private readonly mesh: THREE.Mesh;
    private readonly uv: THREE.BufferAttribute;
    /** the disc's own x, z per vertex (the uv is these plus the camera's place, over the tile) */
    private readonly local: Float32Array;

    constructor() {
        this.group.name = 'clouds';
        const tex = new THREE.DataTexture(cloudPixels(), CLOUD_TEX, CLOUD_TEX, THREE.RGBAFormat);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 8;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        // rings close together near the rim, where the fade is
        const geo = new THREE.RingGeometry(0, CLOUD_R, 64, 24);
        geo.rotateX(Math.PI / 2); // facing down, seen from below
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const n = pos.count;
        this.local = new Float32Array(2 * n);
        const colour = new Float32Array(4 * n);
        for (let i = 0; i < n; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            this.local[2 * i] = x;
            this.local[2 * i + 1] = z;
            const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - FADE_FROM) / (CLOUD_R - FADE_FROM)));
            colour.set([1, 1, 1, 1 - t * t * (3 - 2 * t)], 4 * i);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colour, 4));
        this.uv = geo.attributes.uv as THREE.BufferAttribute;
        this.uv.setUsage(THREE.DynamicDrawUsage);
        const mat = new THREE.MeshBasicNodeMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        mat.fog = false;
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        // behind everything else that is see-through (glass, the see-through circle)
        this.mesh.renderOrder = -1;
        this.group.add(this.mesh);
    }

    /** Centre the disc under the camera and slide the picture to where the wind has blown it by `t` s. */
    update(cam: THREE.Vector3, t: number): void {
        this.mesh.position.set(cam.x, CLOUD_BASE, cam.z);
        // only the fraction of a tile matters, so the uv stays small (float precision) however far the wind has gone
        const ox = (((cam.x - WIND.x * t) / CLOUD_TILE) % 1 + 1) % 1, oz = (((cam.z - WIND.z * t) / CLOUD_TILE) % 1 + 1) % 1;
        const l = this.local, uv = this.uv.array as Float32Array;
        for (let i = 0; i < uv.length / 2; i++) {
            uv[2 * i] = ox + l[2 * i] / CLOUD_TILE;
            uv[2 * i + 1] = oz + l[2 * i + 1] / CLOUD_TILE;
        }
        this.uv.needsUpdate = true;
    }
}
