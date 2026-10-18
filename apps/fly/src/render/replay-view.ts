// The replay viewer in the scene (owner, 2026-10-18): the flight's path as a line coloured by speed (off, the last
// few seconds, or the whole flight), and the spotter camera, standing still and turning to follow the quad. Drawing
// only: it reads a track (replay.ts) and never touches a sim.

import * as THREE from 'three/webgpu';
import { pathSegments } from '../replay';
import type { Track } from '../replay';
import type { PathMode } from '../engine/protocol';

/** the trail: this many seconds behind the quad */
export const TRAIL_S = 3;
/** the path's colour runs from blue (hovering) to red at this speed and above, m/s (108 km/h) */
const RED_AT = 30;
/** the spotter's eyes above the ground, m, and its (flat) lens: vertical field of view, deg */
const EYE_M = 1.7;
const SPOTTER_FOV = 50;

export class PathLine {
    readonly line: THREE.LineSegments;
    private readonly ticks: Int32Array;
    private mode: PathMode = 'whole';

    constructor(track: Track) {
        const seg = pathSegments(track);
        this.ticks = seg.ticks;
        const colors = new Float32Array(seg.speed.length * 3);
        const c = new THREE.Color();
        seg.speed.forEach((v, i) => {
            // hue 0.62 (blue) down to 0 (red)
            c.setHSL(0.62 * (1 - Math.min(1, v / RED_AT)), 0.9, 0.55);
            colors.set([c.r, c.g, c.b], i * 3);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(seg.positions, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.computeBoundingSphere();
        this.line = new THREE.LineSegments(g, new THREE.LineBasicNodeMaterial({ vertexColors: true }));
        this.line.name = 'replay-path';
        this.line.frustumCulled = false;
    }

    setMode(m: PathMode): void {
        this.mode = m;
        this.line.visible = m !== 'off';
    }

    /** Draw the segments the mode shows at `tick`. */
    update(tick: number): void {
        const g = this.line.geometry;
        if (this.mode !== 'trail') return g.setDrawRange(0, Infinity);
        const from = lowerBound(this.ticks, tick - TRAIL_S * 1000), to = lowerBound(this.ticks, tick);
        g.setDrawRange(from * 2, Math.max(0, to - from) * 2);
    }

    dispose(): void {
        this.line.geometry.dispose();
        (this.line.material as THREE.Material).dispose();
    }
}

/** The first index whose value is >= v. */
function lowerBound(a: Int32Array, v: number): number {
    let lo = 0, hi = a.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid] < v) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** A friend filming from the ground: stands where it is put and turns to keep the quad in view. */
export class Spotter {
    readonly pos = new THREE.Vector3();

    /**
     * Stand at a spot: `exact` keeps it (put there with the free camera, a roof or a balcony as well), otherwise it
     * stands on the first surface under `p`, at eye height.
     */
    place(p: THREE.Vector3, exact: boolean, ray: (x: number, y: number, z: number) => number | null): void {
        this.pos.copy(p);
        if (exact) return;
        const ground = ray(p.x, p.y, p.z);
        this.pos.y = (ground ?? 0) + EYE_M;
    }

    apply(cam: THREE.PerspectiveCamera, target: THREE.Vector3): void {
        cam.position.copy(this.pos);
        cam.up.set(0, 1, 0);
        cam.lookAt(target);
        if (cam.fov !== SPOTTER_FOV) {
            cam.fov = SPOTTER_FOV;
            cam.updateProjectionMatrix();
        }
    }
}
