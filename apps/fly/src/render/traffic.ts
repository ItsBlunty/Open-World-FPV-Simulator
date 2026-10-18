// The traffic in Three.js: toy cars (candy colours, see-through windows with bean people riding inside, big
// wheels that turn, brake lights), bean people (eyes, swinging legs, some in party hats), and the signal poles with their lamps (left-turn heads with arrows). Instanced: one draw per part
// for every car or person. Each frame draws the traffic model at the sim's tick, so what is drawn is where
// the collision is (the shapes match packages/traffic CAR and PERSON). Drawing never feeds back into the sim.

import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, PERSON } from '@owfpv/traffic';
import type { Lamp, Place, TrafficModel } from '@owfpv/traffic';

/** Candy colours for car bodies, shirts and hats. */
const CANDY = [0xff6fa8, 0x5ce0b8, 0x5ab4ff, 0xffd84d, 0xff9a3c, 0xb38cff, 0xff5a5a, 0x2ec4c4, 0x9be15d, 0xf7f7f2];
const GLASS = 0x9fc4d8;
/** How much the car glass hides: a light tint, so the riders show through. */
const GLASS_OPACITY = 0.28;
const INTERIOR = 0x34373c;
const TYRE = 0x26272b;
const HUB = 0xe9e9e4;
const POLE = 0x3a4046;
const LIT: Record<'red' | 'yellow' | 'green', number> = { red: 0xff3b30, yellow: 0xffc21a, green: 0x3dff7a };
const UNLIT = 0x1d2024;
const WALK = 0xf4f6ee;
const DONT_WALK = 0xff7a1a;
const BRAKE_ON = 0xff2a2a;
const BRAKE_OFF = 0x5a1414;

/** Wheels: radius, width, and where they sit (along, across) in the car's frame, m. */
const WHEEL_R = 0.42;
const WHEEL_W = 0.32;
const WHEEL_F = 1.3;
const WHEEL_S = 0.8;
/** A person's stride: one full swing of the legs per this many metres walked. */
const STRIDE = 1.2;
const HIP = 0.42;
/**
 * The riders: seated beans, the driver on the left (traffic drives on the right), a front passenger in
 * some cars and a back-seat one in some of those. Seats (along, across) in the car's frame, m: the front
 * ones behind the dashboard, the back one on the bench.
 */
const RIDER_R = 0.2;
const RIDER_LEN = 0.32;
const RIDER_TOP = CAR.cabY1 - 0.12;
const SEATS = [[0.05, -0.38], [0.05, 0.38], [-0.85, 0.3]];
/** Riders in a car, from its looks: 1, 2 or 3. */
function riders(look: number): number {
    return 1 + ((look >>> 12) % 3);
}

function material(o: { rough?: number; basic?: boolean } = {}): THREE.Material {
    return o.basic ? new THREE.MeshBasicNodeMaterial() : new THREE.MeshStandardNodeMaterial({ roughness: o.rough ?? 0.6 });
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(n, 1));
    m.count = n;
    m.frustumCulled = false; // the instances spread over the whole city: a bounding sphere of one would cull them
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
}

/** One part of a toy: a geometry placed in the mover's frame (x ahead, y up, z to the right). */
function part(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
    return geo.translate(x, y, z);
}

export class TrafficView {
    readonly group = new THREE.Group();
    private model: TrafficModel | null = null;
    private cars: number[] = [];
    private people: number[] = [];
    private hatted: number[] = [];
    /** distance each mover has gone (wheels and legs), and its place last frame */
    private dist = new Float64Array(0);
    private last: Place[] = [];
    private meshes: Record<string, THREE.InstancedMesh> = {};
    private readonly p: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    private readonly base = new THREE.Matrix4();
    private readonly m = new THREE.Matrix4();
    private readonly r = new THREE.Matrix4();
    private readonly c = new THREE.Color();

    constructor() {
        this.group.name = 'traffic';
    }

    /** A new model (or none): rebuild the instances and the signal hardware. */
    rebuild(model: TrafficModel | null): void {
        for (const o of [...this.group.children]) {
            this.group.remove(o);
            const mesh = o as THREE.Mesh;
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        }
        this.meshes = {};
        this.model = model;
        if (!model) return;
        this.cars = [];
        this.people = [];
        this.hatted = [];
        model.movers.forEach((mv, i) => {
            if (mv.kind === 'car') this.cars.push(i);
            else {
                this.people.push(i);
                if (mv.look % 3 === 0) this.hatted.push(i);
            }
        });
        this.dist = new Float64Array(model.movers.length);
        this.last = model.movers.map(() => ({ x: NaN, y: 0, z: 0, hx: 1, hz: 0 }));
        this.buildCars(model);
        this.buildPeople(model);
        this.buildSignals(model);
    }

    private add(name: string, mesh: THREE.InstancedMesh): THREE.InstancedMesh {
        mesh.name = `traffic:${name}`;
        this.meshes[name] = mesh;
        this.group.add(mesh);
        return mesh;
    }

    private buildCars(model: TrafficModel): void {
        const n = this.cars.length;
        if (!n) return;
        const body = part(new RoundedBoxGeometry(2 * CAR.bodyHalfL, CAR.bodyY1 - CAR.bodyY0, 2 * CAR.bodyHalfW, 3, 0.2), 0, (CAR.bodyY0 + CAR.bodyY1) / 2, 0);
        const cabH = CAR.cabY1 - CAR.cabY0;
        const cab = part(new RoundedBoxGeometry(2 * CAR.cabHalfL, cabH, 2 * CAR.cabHalfW, 3, 0.16), -CAR.cabBack, CAR.cabY0 + cabH / 2, 0);
        const roof = part(new RoundedBoxGeometry(2 * CAR.cabHalfL - 0.12, 0.1, 2 * CAR.cabHalfW - 0.1, 2, 0.04), -CAR.cabBack, CAR.cabY1 - 0.03, 0);
        // the window frame in the body colour: a pillar at each corner and one each side between the doors
        const front = -CAR.cabBack + CAR.cabHalfL, back = -CAR.cabBack - CAR.cabHalfL;
        const pillar = (x: number, z: number): THREE.BufferGeometry => part(new THREE.BoxGeometry(0.12, cabH, 0.1), x, CAR.cabY0 + cabH / 2, z);
        const pillars = mergeGeometries([
            pillar(front - 0.12, CAR.cabHalfW - 0.06), pillar(front - 0.12, -CAR.cabHalfW + 0.06),
            pillar(-CAR.cabBack - 0.25, CAR.cabHalfW - 0.04), pillar(-CAR.cabBack - 0.25, -CAR.cabHalfW + 0.04),
            pillar(back + 0.12, CAR.cabHalfW - 0.06), pillar(back + 0.12, -CAR.cabHalfW + 0.06)
        ]);
        // inside: the floor, a dashboard with the steering wheel on the driver's side, seat backs
        const inside = mergeGeometries([
            part(new THREE.BoxGeometry(2 * CAR.cabHalfL - 0.1, 0.02, 2 * CAR.cabHalfW - 0.1), -CAR.cabBack, CAR.cabY0 + 0.01, 0),
            part(new THREE.BoxGeometry(0.28, 0.16, 2 * CAR.cabHalfW - 0.12), front - 0.16, CAR.cabY0 + 0.08, 0),
            part(new THREE.TorusGeometry(0.13, 0.022, 6, 16).rotateY(Math.PI / 2).rotateZ(0.5), front - 0.36, CAR.cabY0 + 0.26, SEATS[0][1]),
            part(new THREE.BoxGeometry(0.1, 0.42, 0.5), SEATS[0][0] - 0.28, CAR.cabY0 + 0.21, SEATS[0][1]),
            part(new THREE.BoxGeometry(0.1, 0.42, 0.5), SEATS[1][0] - 0.28, CAR.cabY0 + 0.21, SEATS[1][1]),
            part(new THREE.BoxGeometry(0.1, 0.36, 2 * CAR.cabHalfW - 0.14), back + 0.12, CAR.cabY0 + 0.18, 0)
        ]);
        const rider = part(new THREE.CapsuleGeometry(RIDER_R, RIDER_LEN, 6, 14), 0, RIDER_TOP - RIDER_R - RIDER_LEN / 2, 0);
        const eye = new THREE.SphereGeometry(0.055, 10, 6);
        const pupil = new THREE.SphereGeometry(0.028, 8, 6);
        const wheel = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 20).rotateX(Math.PI / 2);
        const hub = new THREE.CylinderGeometry(WHEEL_R * 0.45, WHEEL_R * 0.45, WHEEL_W + 0.02, 12).rotateX(Math.PI / 2);
        // a spoke-like bar across the hub so turning shows
        const spoke = new THREE.BoxGeometry(WHEEL_R * 1.1, 0.06, WHEEL_W + 0.03);
        const head = new THREE.BoxGeometry(0.06, 0.14, 0.34);
        const bodyMesh = this.add('body', instanced(body, material({ rough: 0.35 }), n, true));
        const roofMesh = this.add('roof', instanced(roof, material({ rough: 0.35 }), n, true));
        const pillarMesh = this.add('pillar', instanced(pillars, material({ rough: 0.35 }), n, true));
        this.add('inside', instanced(inside, new THREE.MeshStandardNodeMaterial({ color: INTERIOR, roughness: 0.8 }), n, false));
        // glass on both sides (the far window tints what is behind the car too), drawn after everything solid, writing no depth
        const glass = new THREE.MeshStandardNodeMaterial({
            color: GLASS, roughness: 0.05, metalness: 0.1, transparent: true, opacity: GLASS_OPACITY, side: THREE.DoubleSide, depthWrite: false
        });
        this.add('cab', instanced(cab, glass, n, false));
        this.seats = [];
        this.cars.forEach((i, k) => {
            for (let s = 0; s < riders(model.movers[i].look); s++) this.seats.push(k);
        });
        const nr = this.seats.length;
        const riderMesh = this.add('rider', instanced(rider, material({ rough: 0.55 }), nr, true));
        this.add('riderEye', instanced(eye, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.3 }), 2 * nr, false));
        this.add('riderPupil', instanced(pupil, new THREE.MeshBasicNodeMaterial({ color: 0x111111 }), 2 * nr, false));
        this.seats.forEach((k, r) => {
            this.c.setHex(CANDY[((model.movers[this.cars[k]].look >>> 16) + 3 * r) % CANDY.length]);
            riderMesh.setColorAt(r, this.c);
        });
        this.add('wheel', instanced(wheel, new THREE.MeshStandardNodeMaterial({ color: TYRE, roughness: 0.9 }), 4 * n, true));
        this.add('hub', instanced(hub, new THREE.MeshStandardNodeMaterial({ color: HUB, roughness: 0.4 }), 4 * n, false));
        this.add('spoke', instanced(spoke, new THREE.MeshStandardNodeMaterial({ color: HUB, roughness: 0.4 }), 4 * n, false));
        this.add('headlight', instanced(head, new THREE.MeshBasicNodeMaterial({ color: 0xfff6d0 }), 2 * n, false));
        const brake = this.add('brake', instanced(head.clone(), material({ basic: true }), 2 * n, false));
        this.cars.forEach((i, k) => {
            this.c.setHex(CANDY[model.movers[i].look % CANDY.length]);
            bodyMesh.setColorAt(k, this.c);
            roofMesh.setColorAt(k, this.c);
            pillarMesh.setColorAt(k, this.c);
            this.c.setHex(BRAKE_OFF);
            brake.setColorAt(2 * k, this.c);
            brake.setColorAt(2 * k + 1, this.c);
        });
    }

    private buildPeople(model: TrafficModel): void {
        const n = this.people.length;
        if (!n) return;
        // the bean: the collision capsule's top, standing on short legs
        const beanLen = PERSON.y1 + PERSON.r - HIP + 0.08 - 2 * PERSON.r;
        const bean = part(new THREE.CapsuleGeometry(PERSON.r, beanLen, 6, 16), 0, HIP - 0.08 + PERSON.r + beanLen / 2, 0);
        const eyeY = PERSON.y1 - 0.02;
        const eye = new THREE.SphereGeometry(0.075, 12, 8);
        const pupil = new THREE.SphereGeometry(0.038, 10, 6);
        // a leg hangs from the hip: its top at the origin, so it swings about it
        const leg = part(new THREE.CapsuleGeometry(0.085, HIP - 0.17, 4, 8), 0, -(HIP - 0.17) / 2 - 0.085, 0);
        const hat = part(new THREE.ConeGeometry(0.17, 0.38, 14), 0, 0.19, 0);
        const beanMesh = this.add('bean', instanced(bean, material({ rough: 0.55 }), n, true));
        this.add('eye', instanced(eye, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.3 }), 2 * n, false));
        this.add('pupil', instanced(pupil, new THREE.MeshBasicNodeMaterial({ color: 0x111111 }), 2 * n, false));
        const legMesh = this.add('leg', instanced(leg, material({ rough: 0.7 }), 2 * n, true));
        const hatMesh = this.add('hat', instanced(hat, material({ rough: 0.5 }), this.hatted.length, true));
        this.people.forEach((i, k) => {
            const look = model.movers[i].look;
            this.c.setHex(CANDY[look % CANDY.length]);
            beanMesh.setColorAt(k, this.c);
            this.c.setHex(CANDY[(look >>> 4) % CANDY.length]).multiplyScalar(0.55);
            legMesh.setColorAt(2 * k, this.c);
            legMesh.setColorAt(2 * k + 1, this.c);
        });
        this.hatted.forEach((i, k) => {
            this.c.setHex(CANDY[(model.movers[i].look >>> 8) % CANDY.length]);
            hatMesh.setColorAt(k, this.c);
        });
        this.eyeY = eyeY;
    }

    private eyeY = 0;
    /** per rider, the car (index into cars) it sits in; a car's riders follow each other, front seats first */
    private seats: number[] = [];

    private buildSignals(model: TrafficModel): void {
        const boxes = model.allStatics();
        if (boxes.length) {
            const mesh = this.add('pole', instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardNodeMaterial({ color: POLE, roughness: 0.6, metalness: 0.3 }), boxes.length, true));
            boxes.forEach((b, k) => {
                this.m.makeScale(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
                mesh.setMatrixAt(k, this.m);
            });
            mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        }
        // the lamps: three per car head (red, yellow, green from the top), three arrows per arrow head, one per walk head
        let nLamps = 0, nArrows = 0;
        for (const s of model.signals) {
            if (s.kind === 'arrow') nArrows += 3;
            else nLamps += s.kind === 'car' ? 3 : 1;
        }
        const disc = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16).rotateZ(Math.PI / 2); // facing +x
        // an arrow pointing along +z (the driver's left, seen from the lamp's front at +x), facing +x
        const shape = new THREE.Shape();
        shape.moveTo(-0.09, -0.03).lineTo(0.02, -0.03).lineTo(0.02, -0.075).lineTo(0.1, 0).lineTo(0.02, 0.075)
            .lineTo(0.02, 0.03).lineTo(-0.09, 0.03).closePath();
        const arrow = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.02, 0, 0);
        const lamps = nLamps ? this.add('lamp', instanced(disc, material({ basic: true }), nLamps, false)) : null;
        const arrows = nArrows ? this.add('arrowLamp', instanced(arrow, material({ basic: true }), nArrows, false)) : null;
        let k = 0, a = 0;
        for (const s of model.signals) {
            // +x of the lamp along the way it faces
            this.r.set(s.fx, 0, -s.fz, 0, 0, 1, 0, 0, s.fz, 0, s.fx, 0, 0, 0, 0, 1);
            const rows = s.kind === 'walk' ? [0] : [0.3, 0, -0.3];
            for (const dy of rows) {
                this.m.copy(this.r).setPosition(s.x, s.y + dy, s.z);
                if (s.kind === 'arrow') arrows!.setMatrixAt(a++, this.m);
                else lamps!.setMatrixAt(k++, this.m);
            }
        }
        lamps?.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        arrows?.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    }

    /** Every mover where it is at `tick`, wheels and legs turned by how far it went, lamps lit. */
    update(tick: number): void {
        const model = this.model;
        if (!model) return;
        model.at(tick);
        const p = this.p;
        for (let i = 0; i < model.movers.length; i++) {
            model.place(i, tick, p);
            const l = this.last[i];
            if (!Number.isNaN(l.x)) {
                const d = Math.hypot(p.x - l.x, p.z - l.z);
                // a jump (time going back, a new life) is not walking
                if (d < 5) this.dist[i] += d;
            }
            l.x = p.x; l.y = p.y; l.z = p.z; l.hx = p.hx; l.hz = p.hz;
        }
        this.updateCars(model);
        this.updatePeople(model);
        this.updateLamps(model, tick);
    }

    /** The mover's frame: x ahead (its heading), y up, z to its right. */
    private frame(i: number): THREE.Matrix4 {
        const l = this.last[i];
        return this.base.set(l.hx, 0, -l.hz, l.x, 0, 1, 0, l.y, l.hz, 0, l.hx, l.z, 0, 0, 0, 1);
    }

    private updateCars(model: TrafficModel): void {
        const M = this.meshes;
        if (!M.body) return;
        this.cars.forEach((i, k) => {
            const f = this.frame(i);
            M.body.setMatrixAt(k, f);
            M.roof.setMatrixAt(k, f);
            M.cab.setMatrixAt(k, f);
            M.pillar.setMatrixAt(k, f);
            M.inside.setMatrixAt(k, f);
            const turn = -this.dist[i] / WHEEL_R;
            let w = 0;
            for (const wf of [WHEEL_F, -WHEEL_F]) for (const ws of [WHEEL_S, -WHEEL_S]) {
                this.m.makeRotationZ(turn).setPosition(wf, WHEEL_R, ws);
                this.m.premultiply(f);
                M.wheel.setMatrixAt(4 * k + w, this.m);
                M.hub.setMatrixAt(4 * k + w, this.m);
                M.spoke.setMatrixAt(4 * k + w, this.m);
                w++;
            }
            const braking = model.braking(i);
            for (let s = 0; s < 2; s++) {
                const z = s ? 0.6 : -0.6;
                this.m.makeTranslation(CAR.bodyHalfL + 0.01, 0.68, z).premultiply(f);
                M.headlight.setMatrixAt(2 * k + s, this.m);
                this.m.makeTranslation(-CAR.bodyHalfL - 0.01, 0.68, z).premultiply(f);
                M.brake.setMatrixAt(2 * k + s, this.m);
                this.c.setHex(braking ? BRAKE_ON : BRAKE_OFF);
                M.brake.setColorAt(2 * k + s, this.c);
            }
        });
        let seat = 0;
        this.seats.forEach((k, r) => {
            const f = this.frame(this.cars[k]);
            seat = r > 0 && this.seats[r - 1] === k ? seat + 1 : 0;
            const [sx, sz] = SEATS[seat];
            this.m.makeTranslation(sx, 0, sz).premultiply(f);
            M.rider.setMatrixAt(r, this.m);
            const ey = RIDER_TOP - RIDER_R - 0.02;
            for (let s = 0; s < 2; s++) {
                const ez = sz + (s ? 0.075 : -0.075);
                this.m.makeTranslation(sx + RIDER_R - 0.045, ey, ez).premultiply(f);
                M.riderEye.setMatrixAt(2 * r + s, this.m);
                this.m.makeTranslation(sx + RIDER_R + 0.003, ey, ez).premultiply(f);
                M.riderPupil.setMatrixAt(2 * r + s, this.m);
            }
        });
        for (const name of ['body', 'roof', 'cab', 'pillar', 'inside', 'rider', 'riderEye', 'riderPupil', 'wheel', 'hub', 'spoke', 'headlight', 'brake']) {
            M[name].instanceMatrix.needsUpdate = true;
        }
        if (M.brake.instanceColor) M.brake.instanceColor.needsUpdate = true;
    }

    private updatePeople(model: TrafficModel): void {
        const M = this.meshes;
        if (!M.bean) return;
        let h = 0;
        const gone = this.r.makeScale(0, 0, 0);
        this.people.forEach((i, k) => {
            if (model.hidden?.(i)) {
                // inside a building: drawn nowhere
                M.bean.setMatrixAt(k, gone);
                for (let s = 0; s < 2; s++) for (const part of [M.eye, M.pupil, M.leg]) part.setMatrixAt(2 * k + s, gone);
                if (this.hatted[h] === i) M.hat.setMatrixAt(h++, gone);
                return;
            }
            const phase = (this.dist[i] / STRIDE) * 2 * Math.PI;
            const bob = 0.035 * Math.abs(Math.sin(phase));
            const f = this.frame(i);
            this.m.makeTranslation(0, bob, 0).premultiply(f);
            M.bean.setMatrixAt(k, this.m);
            for (let s = 0; s < 2; s++) {
                const z = s ? 0.1 : -0.1;
                this.m.makeTranslation(PERSON.r - 0.06, this.eyeY + bob, z).premultiply(f);
                M.eye.setMatrixAt(2 * k + s, this.m);
                this.m.makeTranslation(PERSON.r + 0.005, this.eyeY + bob, z).premultiply(f);
                M.pupil.setMatrixAt(2 * k + s, this.m);
                const swing = (s ? 1 : -1) * 0.55 * Math.sin(phase);
                this.m.makeRotationZ(swing).setPosition(0, HIP + bob, s ? 0.13 : -0.13).premultiply(f);
                M.leg.setMatrixAt(2 * k + s, this.m);
            }
            if (this.hatted[h] === i) {
                this.m.makeRotationX(0.15).setPosition(0, PERSON.y1 + PERSON.r - 0.04 + bob, 0).premultiply(f);
                M.hat.setMatrixAt(h++, this.m);
            }
        });
        for (const name of ['bean', 'eye', 'pupil', 'leg', 'hat']) M[name].instanceMatrix.needsUpdate = true;
    }

    private updateLamps(model: TrafficModel, tick: number): void {
        const lamps = this.meshes.lamp, arrows = this.meshes.arrowLamp;
        if (!lamps && !arrows) return;
        // 'flash' blinks at 1 Hz
        const blinkOn = Math.floor(tick / 500) % 2 === 0;
        let k = 0, a = 0;
        model.signals.forEach((s, hIdx) => {
            const on: Lamp = model.lamp(hIdx, tick);
            if (s.kind === 'walk') {
                this.c.setHex(on === 'walk' ? WALK : on === 'flash' && !blinkOn ? UNLIT : DONT_WALK);
                lamps.setColorAt(k++, this.c);
                return;
            }
            for (const c of ['red', 'yellow', 'green'] as const) {
                this.c.setHex(on === c ? LIT[c] : UNLIT);
                if (s.kind === 'arrow') arrows.setColorAt(a++, this.c);
                else lamps.setColorAt(k++, this.c);
            }
        });
        if (lamps?.instanceColor) lamps.instanceColor.needsUpdate = true;
        if (arrows?.instanceColor) arrows.instanceColor.needsUpdate = true;
    }
}
