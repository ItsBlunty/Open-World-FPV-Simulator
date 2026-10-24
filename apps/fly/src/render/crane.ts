// The tower crane at work drawn (owner, 2026-10-24; packages/traffic crane.ts): each mover from its own collision parts,
// so what is drawn is what the quad hits: the turning part (slewing platform, glazed cab with its operator, jib,
// counter-jib and ballast), the trolley with its two falls of rope stretched to the hook, the hook with its slings while a
// crate hangs on them, and the crates. Drawn at the sim's tick; drawing never feeds back into the sim.

import * as THREE from 'three/webgpu';
import { newAirPlace } from '@owfpv/traffic';
import type { APart, AirPlace, Role, TowerCrane } from '@owfpv/traffic';
import { merge, paint, partGeometry } from './air';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

/** the map's crane yellow (render/world.ts), steel greys, the ballast's concrete, a timber crate, the operator's shirt */
const COLOURS: Record<Role, number> = {
    crane: 0xf2b705, trim: 0x6b6f75, ballast: 0x9a9a94, crate: 0xb08654, rope: 0x2b2b2b, person: 0x2f6fb5,
    body: 0xf2b705, wing: 0xf2b705, tail: 0xf2b705, engine: 0x6b6f75, gear: 0x2b2b2b, glass: 0x9fc4d8, strut: 0x6b6f75,
    skid: 0x6b6f75, mast: 0x6b6f75, stretcher: 0xffffff, tug: 0xf2b705
};

interface MoverView {
    group: THREE.Group;
    /** parts solid only while a crate hangs on the hook (the slings) */
    gear: THREE.Mesh | null;
    /** each rope: its mesh, a unit length hanging down from its top, scaled to the place's length */
    ropes: THREE.Mesh[];
}

export class CraneView {
    readonly group = new THREE.Group();
    private readonly views: MoverView[] = [];
    private readonly p: AirPlace = newAirPlace();
    private readonly frame = new THREE.Matrix4();

    constructor(private readonly crane: TowerCrane | null, kit: Kit = FULL_KIT) {
        this.group.name = 'crane';
        if (!crane) return;
        const seg = kit.seg, shadow = !kit.lowSpec;
        const mat = kit.lit({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
        const glassMat = kit.lit({ color: COLOURS.glass, transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false });
        const ropeMat = kit.lit({ color: COLOURS.rope, roughness: 0.6, metalness: 0.4 });
        for (const m of crane.movers) {
            const g = new THREE.Group();
            g.matrixAutoUpdate = false;
            const body: THREE.BufferGeometry[] = [], gear: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
            const ropes: THREE.Mesh[] = [];
            for (const p of m.shape.parts) {
                if (p.rope) {
                    const rope = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 1, seg(6, 4)).translate(0, -0.5, 0), ropeMat);
                    rope.position.set(...p.a);
                    rope.castShadow = shadow;
                    ropes.push(rope);
                    g.add(rope);
                    continue;
                }
                if (p.role === 'glass') { glass.push(partGeometry(p, seg)); continue; }
                (p.gear ? gear : body).push(paint(partGeometry(p, seg), COLOURS[p.role]));
                if (p.role === 'person') body.push(...eyes(p, seg));
            }
            const mesh = new THREE.Mesh(merge(body), mat);
            mesh.castShadow = shadow;
            mesh.receiveShadow = true;
            g.add(mesh);
            if (glass.length) g.add(new THREE.Mesh(merge(glass), glassMat));
            let gearMesh: THREE.Mesh | null = null;
            if (gear.length) {
                gearMesh = new THREE.Mesh(merge(gear), mat);
                gearMesh.castShadow = shadow;
                g.add(gearMesh);
            }
            this.group.add(g);
            this.views.push({ group: g, gear: gearMesh, ropes });
        }
    }

    /** Draw the crane at `tick` (fractions too). */
    update(tick: number): void {
        const crane = this.crane;
        if (!crane) return;
        const p = this.p;
        for (let i = 0; i < this.views.length; i++) {
            const v = this.views[i];
            crane.place(i, tick, p);
            v.group.matrix.copy(this.frame.set(
                p.f[0], p.u[0], p.s[0], p.x,
                p.f[1], p.u[1], p.s[1], p.y,
                p.f[2], p.u[2], p.s[2], p.z,
                0, 0, 0, 1));
            v.group.matrixWorldNeedsUpdate = true;
            if (v.gear) v.gear.visible = p.g >= 0.5;
            for (const r of v.ropes) r.scale.y = Math.max(0.01, p.len);
        }
    }
}

/** The operator's eyes, looking along the jib (+x) from the top of his capsule (as the airport's people: render/air.ts). */
function eyes(cap: APart, seg: (full: number, low: number) => number): THREE.BufferGeometry[] {
    const y = cap.b[1] + 0.05;
    return [-0.1, 0.1].map((s) => paint(new THREE.SphereGeometry(0.07, seg(10, 6), seg(6, 4)).translate(cap.b[0] + cap.r - 0.04, y, cap.b[2] + s), 0xffffff));
}
