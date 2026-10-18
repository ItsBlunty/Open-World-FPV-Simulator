// The golden props (owner, 2026-10-18: "kinda like Tony Hawk pickups, but FPV themed, like golden props"): a gold
// tri-blade prop, 0.8 m across, standing on edge and turning slowly so it shows from every side, bobbing a little. A
// taken one swells and is gone. Drawn only: the props are not solid, and drawing never feeds back into the sim (what
// is taken is decided on the sim tick: collect.ts).

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Collectible } from '@owfpv/maps';

/** the prop's radius, m (maps test golden-props: kept 5 cm clear of everything) */
const RADIUS = 0.4;
/** a turn every this many s, about the vertical; the blades' own slow turn about the hub */
const TURN_S = 2.4;
const SPIN_S = 4;
const BOB_M = 0.06;
const BOB_S = 1.8;
/** a taken prop swells to this size over POP_S, then is gone */
const POP = 1.7;
const POP_S = 0.3;

/** One blade along +x from the hub: a rounded outline, wide in the middle, a little pitch, 2 cm thick. */
function blade(): THREE.BufferGeometry {
    const L = RADIUS, W = 0.09;
    const s = new THREE.Shape();
    s.moveTo(0.04, -W * 0.35);
    s.bezierCurveTo(L * 0.4, -W * 0.75, L * 0.85, -W * 0.7, L, -W * 0.15);
    s.bezierCurveTo(L * 1.01, W * 0.15, L * 0.9, W * 0.5, L * 0.7, W * 0.55);
    s.bezierCurveTo(L * 0.4, W * 0.6, L * 0.15, W * 0.4, 0.04, W * 0.35);
    s.lineTo(0.04, -W * 0.35);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -0.01);
    g.rotateX(0.35); // pitch
    return g;
}

/** Three blades and the hub, in the x-y plane (the hub's axis along z): the disc faces +z. */
function propGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
        const b = blade();
        b.rotateZ((k * 2 * Math.PI) / 3);
        parts.push(b);
    }
    const hub = new THREE.CylinderGeometry(0.065, 0.065, 0.1, 16);
    hub.rotateX(Math.PI / 2);
    parts.push(hub);
    const nut = new THREE.CylinderGeometry(0.03, 0.04, 0.06, 8);
    nut.rotateX(Math.PI / 2);
    nut.translate(0, 0, 0.075);
    parts.push(nut);
    // ExtrudeGeometry has uvs and groups the cylinders do not need: keep position and normal only
    const clean = parts.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', n.getAttribute('position'));
        out.setAttribute('normal', n.getAttribute('normal'));
        return out;
    });
    const merged = mergeGeometries(clean);
    merged.computeBoundingSphere();
    return merged;
}

export class CollectiblesView {
    readonly group = new THREE.Group();
    private readonly mesh: THREE.InstancedMesh;
    private readonly items: readonly Collectible[];
    /** per prop: still to find (1) or taken (0) */
    private readonly shown: Uint8Array;
    /** per prop: when it was taken (s), while it pops; NaN otherwise */
    private readonly popAt: Float64Array;
    private readonly m = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly p = new THREE.Vector3();
    private readonly sc = new THREE.Vector3();

    constructor(items: readonly Collectible[]) {
        this.items = items;
        this.shown = new Uint8Array(items.length).fill(1);
        this.popAt = new Float64Array(items.length).fill(NaN);
        // not fully metallic: with no environment to reflect, a metal draws dark brown, not gold; the glow keeps it
        // gold in the shade too
        const mat = new THREE.MeshStandardNodeMaterial({ color: 0xffcc33, metalness: 0.35, roughness: 0.3, emissive: 0xb07800 });
        this.mesh = new THREE.InstancedMesh(propGeometry(), mat, Math.max(items.length, 1));
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.name = 'golden-props';
        this.group.add(this.mesh);
        this.group.name = 'collectibles';
        this.update(0);
    }

    /** Which are taken already (the saved collection): those are not drawn at all. */
    setTaken(isTaken: (n: number) => boolean): void {
        this.items.forEach((c, i) => {
            this.shown[i] = isTaken(c.n) ? 0 : 1;
            this.popAt[i] = NaN;
        });
    }

    /** Just taken (by number), at time `t` (s, the page's clock): they pop. */
    take(ns: readonly number[], t: number): void {
        for (const n of ns) {
            if (!this.shown[n - 1]) continue;
            this.shown[n - 1] = 0;
            this.popAt[n - 1] = t;
        }
    }

    /** Draw the props at time `t` (s): turning, bobbing, popping. */
    update(t: number): void {
        const turn = (t / TURN_S) * 2 * Math.PI, spin = (t / SPIN_S) * 2 * Math.PI;
        this.items.forEach((c, i) => {
            let s = this.shown[i];
            if (!s && !Number.isNaN(this.popAt[i])) {
                const a = (t - this.popAt[i]) / POP_S;
                if (a >= 1) this.popAt[i] = NaN;
                else s = 1 + (POP - 1) * a;
            }
            // each its own phase, from its number, so they do not all move together
            const ph = c.n * 0.7;
            this.e.set(0, turn + ph, spin + ph);
            this.q.setFromEuler(this.e);
            this.p.set(c.x, c.y + Math.sin((t / BOB_S) * 2 * Math.PI + ph) * BOB_M, c.z);
            this.sc.setScalar(s);
            this.m.compose(this.p, this.q, this.sc);
            this.mesh.setMatrixAt(i, this.m);
        });
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}
