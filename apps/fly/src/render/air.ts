// The airport's movers in Three.js (packages/traffic air.ts): the ten planes in their liveries, the air ambulance, the
// tugs, the medics with the stretcher, the controllers in the tower. Each is drawn from its very collision parts
// (capsules and boxes, air-shapes.ts), so what is drawn is what the quad hits; the props and rotors, the window line and
// the lights are drawn only. Drawn at the sim's tick from the model; drawing never feeds back into the sim. The props'
// turning is the one thing kept between frames (an angle run on at the engine's speed): drawing only.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { newAirPlace } from '@owfpv/traffic';
import type { APart, AirMover, AirPlace, AirTraffic, Role } from '@owfpv/traffic';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

const GLASS = 0x1f2a33;
const GEAR = 0x2b2d31;
const STRUT = 0x9aa0a6;
const ENGINE_GREY = 0xc9ccd0;
const TUG_YELLOW = 0xf2b705;
/** the air ambulance: red and white [the usual HEMS colours] */
const HEMS = [0xd8262e, 0xf4f4f4] as const;
/** the medics' green overalls, the controllers' shirts, skin-free bean colours as the traffic's */
const MEDIC = 0x2f8f4e;
const SHIRTS = [0xffffff, 0x5ab4ff, 0xffd84d, 0xb38cff];
const MATTRESS = 0xf0f0f0;
/** props turn at this many radians per second at full power [drawing: fast enough to blur into the disc] */
const PROP_RATE = 60;

function paint(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    return mergeGeometries(parts.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (n.getAttribute('uv')) n.deleteAttribute('uv');
        return n;
    }));
}

const Y = new THREE.Vector3(0, 1, 0);

/** A part's geometry in the mover's frame (x = f ahead, y = u up, z = s to the right). */
function partGeometry(p: APart, seg: (full: number, low: number) => number): THREE.BufferGeometry {
    if (p.kind === 'cap') {
        const a = new THREE.Vector3(...p.a), b = new THREE.Vector3(...p.b);
        const d = b.clone().sub(a);
        const len = d.length();
        const g = new THREE.CapsuleGeometry(p.r, len, seg(6, 2), seg(16, 8));
        if (len > 1e-6) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
        return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    }
    const g = new THREE.BoxGeometry(2 * p.e[0], 2 * p.e[1], 2 * p.e[2]);
    const R = p.R;
    g.applyMatrix4(new THREE.Matrix4().set(R[0], R[3], R[6], p.c[0], R[1], R[4], R[7], p.c[1], R[2], R[5], R[8], p.c[2], 0, 0, 0, 1));
    return g;
}

/** A mover's colour for each kind of part. */
function colourOf(m: AirMover, role: Role): number {
    const [body, trim, wing] = m.type?.livery ?? (m.kind === 'heli' ? [HEMS[1], HEMS[0], HEMS[1]] : [0xffffff, 0xffffff, 0xffffff]);
    switch (role) {
        case 'body': return m.kind === 'heli' ? HEMS[0] : body;
        case 'trim': return trim;
        case 'wing': return wing;
        case 'tail': return m.kind === 'heli' ? HEMS[0] : trim;
        case 'engine': return m.type?.kind === 'cub' ? body : ENGINE_GREY;
        case 'gear': return GEAR;
        case 'skid': return STRUT;
        case 'strut': case 'mast': return STRUT;
        case 'glass': return GLASS;
        case 'tug': return TUG_YELLOW;
        case 'stretcher': return MATTRESS;
        case 'person': return m.kind === 'sitter' ? SHIRTS[m.look % SHIRTS.length] : MEDIC;
    }
}

interface PropView {
    pivot: THREE.Group;
    disc: THREE.Mesh;
    axis: 'f' | 'u' | 's';
    angle: number;
}

interface MoverView {
    group: THREE.Group;
    gear: THREE.Mesh | null;
    props: PropView[];
    beacon: THREE.Mesh | null;
}

export class AirView {
    readonly group = new THREE.Group();
    private air: AirTraffic | null = null;
    private views: MoverView[] = [];
    private readonly p: AirPlace = newAirPlace();
    private readonly frame = new THREE.Matrix4();
    private lastTick = -1;

    constructor(private readonly kit: Kit = FULL_KIT) {
        this.group.name = 'airport';
    }

    /** New airport traffic (or none). */
    rebuild(air: AirTraffic | null): void {
        const done = new Set<unknown>();
        this.group.traverse((o) => {
            const mesh = o as THREE.Mesh;
            for (const x of [mesh.geometry, mesh.material as THREE.Material]) {
                if (!x || done.has(x)) continue;
                done.add(x);
                (x as { dispose?: () => void }).dispose?.();
            }
        });
        this.group.clear();
        this.views = [];
        this.air = air;
        this.lastTick = -1;
        if (!air) return;
        const seg = this.kit.seg;
        const shadow = !this.kit.lowSpec;
        const mat = this.kit.lit({ vertexColors: true, roughness: 0.45, metalness: 0.1 });
        const discMat = this.kit.lit({ color: 0x222222, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
        const bladeMat = this.kit.lit({ color: 0x1b1b1b, roughness: 0.6 });
        const lamp = (c: number): THREE.Material => this.kit.flat({ color: c });
        for (const m of air.movers) {
            const g = new THREE.Group();
            g.matrixAutoUpdate = false;
            const body: THREE.BufferGeometry[] = [], gear: THREE.BufferGeometry[] = [];
            for (const p of m.shape.parts) (p.gear ? gear : body).push(paint(partGeometry(p, seg), colourOf(m, p.role)));
            if (m.kind === 'plane') body.push(...windowLine(m));
            if (m.kind === 'walker' || m.kind === 'sitter') body.push(...eyes(m, seg));
            if (m.kind === 'stretcher') body.push(paint(new THREE.CapsuleGeometry(0.2, 1.3, seg(4, 2), seg(10, 6)).rotateZ(Math.PI / 2).translate(0, 1.1, 0), SHIRTS[2]));
            const mesh = new THREE.Mesh(merge(body), mat);
            mesh.castShadow = shadow;
            mesh.receiveShadow = true;
            g.add(mesh);
            let gearMesh: THREE.Mesh | null = null;
            if (gear.length) {
                gearMesh = new THREE.Mesh(merge(gear), mat);
                gearMesh.castShadow = shadow;
                g.add(gearMesh);
            }
            const props: PropView[] = [];
            for (const pr of m.shape.props) {
                const pivot = new THREE.Group();
                pivot.position.set(...pr.p);
                // the disc and blades are made about +y, then turned onto the prop's axis
                const holder = new THREE.Group();
                if (pr.axis === 'f') holder.rotation.z = -Math.PI / 2;
                else if (pr.axis === 's') holder.rotation.x = Math.PI / 2;
                pivot.add(holder);
                const spin = new THREE.Group();
                holder.add(spin);
                const disc = new THREE.Mesh(new THREE.CircleGeometry(pr.r, seg(24, 12)).rotateX(-Math.PI / 2), discMat);
                holder.add(disc);
                const chord = Math.max(0.08, pr.r * (pr.axis === 'u' ? 0.06 : 0.12));
                for (let k = 0; k < pr.blades; k++) {
                    const blade = new THREE.Mesh(new THREE.BoxGeometry(pr.r, 0.03, chord).translate(pr.r / 2, 0, 0), bladeMat);
                    blade.rotation.y = (2 * Math.PI * k) / pr.blades;
                    spin.add(blade);
                }
                g.add(pivot);
                props.push({ pivot: spin, disc, axis: pr.axis, angle: 0 });
            }
            // navigation lights: red on the left wingtip, green on the right, a red beacon on top [usual]
            let beacon: THREE.Mesh | null = null;
            if (m.kind === 'plane' || m.kind === 'heli') {
                const ball = new THREE.SphereGeometry(0.12, seg(8, 4), seg(6, 3));
                const tip = wingtip(m);
                if (tip) {
                    const red = new THREE.Mesh(ball, lamp(0xff2020)); red.position.set(tip[0], tip[1], -tip[2]);
                    const green = new THREE.Mesh(ball, lamp(0x20ff40)); green.position.set(tip[0], tip[1], tip[2]);
                    g.add(red, green);
                }
                beacon = new THREE.Mesh(ball, lamp(0xff3030));
                const top = m.shape.parts[0];
                beacon.position.set(top.kind === 'cap' ? (top.a[0] + top.b[0]) / 2 : top.c[0], (top.kind === 'cap' ? top.a[1] + top.r : top.c[1] + top.e[1]) + 0.1, 0);
                g.add(beacon);
            }
            this.group.add(g);
            this.views.push({ group: g, gear: gearMesh, props, beacon });
        }
    }

    /** Draw the airport's movers at `tick` (fractions too). */
    update(tick: number): void {
        const air = this.air;
        if (!air) return;
        const dt = this.lastTick < 0 ? 0 : Math.max(0, Math.min(0.1, (tick - this.lastTick) / 1000));
        this.lastTick = tick;
        const p = this.p;
        for (let i = 0; i < this.views.length; i++) {
            const v = this.views[i];
            air.place(i, tick, p);
            v.group.visible = !p.hidden;
            if (p.hidden) continue;
            v.group.matrix.copy(this.frame.set(
                p.f[0], p.u[0], p.s[0], p.x,
                p.f[1], p.u[1], p.s[1], p.y,
                p.f[2], p.u[2], p.s[2], p.z,
                0, 0, 0, 1));
            v.group.matrixWorldNeedsUpdate = true;
            if (v.gear) v.gear.visible = p.g >= 0.5;
            for (const pr of v.props) {
                pr.angle = (pr.angle + p.e * PROP_RATE * dt) % (2 * Math.PI);
                pr.pivot.rotation.y = pr.angle;
                // a spinning prop blurs into its disc; a main rotor's long blades still show turning
                pr.pivot.visible = p.e < 0.5 || pr.axis === 'u';
                pr.disc.visible = p.e > 0.15;
            }
            if (v.beacon) v.beacon.visible = p.e > 0.05 && Math.floor(tick / 100) % 10 === 0;
        }
    }
}

/** The tip of a plane's right wing (or the helicopter's skid), in its frame, for the lights; null for neither. */
function wingtip(m: AirMover): [number, number, number] | null {
    let best: [number, number, number] | null = null;
    for (const p of m.shape.parts) {
        if (p.role !== 'wing' && p.role !== 'skid') continue;
        if (p.kind !== 'box') continue;
        const R = p.R, e = p.e;
        for (const k of [-1, 1]) {
            const s = p.c[2] + k * e[2] * R[8] + 0;
            if (!best || s > best[2]) best = [p.c[0] + k * e[2] * R[6], p.c[1] + k * e[2] * R[7], s];
        }
    }
    return best;
}

/** A plane's cabin windows: a dark band along the fuselage's sides, just proud of it (drawing only). */
function windowLine(m: AirMover): THREE.BufferGeometry[] {
    const f = m.shape.parts[0];
    if (f.kind !== 'cap') return [];
    const len = Math.abs(f.a[0] - f.b[0]) * 0.75;
    const mid = (f.a[0] + f.b[0]) / 2 - len * 0.05;
    const h = Math.max(0.12, f.r * 0.22);
    return [paint(new THREE.BoxGeometry(len, h, 2 * f.r + 0.03).translate(mid, f.a[1] + f.r * 0.3, 0), GLASS)];
}

/** A bean person's eyes, facing ahead (+f). */
function eyes(m: AirMover, seg: (full: number, low: number) => number): THREE.BufferGeometry[] {
    const cap = m.shape.parts[0];
    const y = cap.b[1] + 0.05;
    return [-0.1, 0.1].map((s) => paint(new THREE.SphereGeometry(0.07, seg(10, 6), seg(6, 4)).translate(cap.r - 0.04, y, s), 0xffffff));
}
