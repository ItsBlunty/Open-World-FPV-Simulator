// The traffic in Three.js: toy cars, saloons, SUVs, vans, pickups with what they carry and semis with their trailers
// (traffic v9), in candy colours, with see-through windows and bean people riding inside, big wheels that turn and
// brake lights; bean people (eyes, swinging legs, some in party hats, the street vendors in white caps); and the signal
// poles with their lamps (left-turn heads with arrows). Instanced: one draw per part for every vehicle of one shape,
// or every person. Each frame draws the traffic model at the sim's tick, so what is drawn is where the collision is:
// a vehicle is drawn from its very collision boxes (packages/traffic vehicles.ts), people from PERSON. Wheels, lamps,
// windows, roofs and riders are drawn only. Drawing never feeds back into the sim.

import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PERSON } from '@owfpv/traffic';
import type { Lamp, Paint, Place, TrafficModel, VBox, VehicleShape } from '@owfpv/traffic';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

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

/** The fixed paints of vehicle parts and loads (vehicles.ts Paint): trim, chrome, the loads' cardboard, lumber, ... */
const PAINT: Record<Exclude<Paint, 'body' | 'trailer' | 'door' | 'glass'>, number> = {
    trim: 0x2b2e33, chrome: 0xd5d9de, deck: 0x34363a, floor: 0x7d5f43, cardboard: 0xc49a6c, wood: 0xcfa66e, wood2: 0xb88d57,
    fabric: 0x6f8fb8, white: 0xf1f1ec, hay: 0xe0c565, wrap: 0xe9eef0, water: 0x4f9bd9, steel: 0x6c7279, flag: 0xff2a1a
};
/** Trailers are mostly white, some silver or in a fleet's colour. */
const TRAILER_COLOURS = [0xf4f4f0, 0xf4f4f0, 0xf4f4f0, 0xf4f4f0, 0xc9ced3, 0x2f6fb5, 0xc8352b, 0x2e8b57];
const trailerColour = (look: number): number => TRAILER_COLOURS[(look >>> 20) % TRAILER_COLOURS.length];
/** a semi's windows (its cab is not see-through) */
const DARK_GLASS = 0x1f2c38;
/** Low spec mode: movers further than this from the camera are not drawn, m (a car there is a few pixels across). */
const LOW_SPEC_REACH = 250;
/** A person's stride: one full swing of the legs per this many metres walked. */
const STRIDE = 1.2;
const HIP = 0.42;
/**
 * The riders: seated beans, the driver on the left (traffic drives on the right), a front passenger in some vehicles and
 * a back-seat one in some of those; their seats are the shape's (vehicles.ts), their heads' top its headTop.
 */
const RIDER_R = 0.2;
const RIDER_LEN = 0.32;
/** Riders in a vehicle, from its looks: 1, 2 or 3 (no more than it has seats). */
function riders(look: number, shape: VehicleShape): number {
    return Math.min(shape.seats.length, 1 + ((look >>> 12) % 3));
}

/** One vehicle shape's parts: an instanced mesh per frame and paint (body colour, trailer colour, glass, fixed). */
interface Layer {
    mesh: THREE.InstancedMesh;
    frame: 0 | 1;
    tint: 'body' | 'trailer' | null;
}
interface ShapeMesh {
    layers: Layer[];
    /** the cars (indices into cars) of this shape */
    cars: number[];
    /** how many are drawn this frame */
    n: number;
}

/** A box of a vehicle as geometry in its frame (x ahead, y up, z right), rounded off by r. */
function boxGeo(b: VBox, r: number, seg: number): THREE.BufferGeometry {
    const sx = b.f1 - b.f0, sy = b.y1 - b.y0, sz = b.s1 - b.s0;
    const rr = Math.min(r, sx / 2.5, sy / 2.5, sz / 2.5);
    const g = rr > 0.01 ? new RoundedBoxGeometry(sx, sy, sz, seg, rr) : new THREE.BoxGeometry(sx, sy, sz);
    return g.translate((b.f0 + b.f1) / 2, (b.y0 + b.y1) / 2, (b.s0 + b.s1) / 2);
}

/** Colour a geometry's every vertex c (the merged fixed-paint parts). */
function tint(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
    const geo = g.index ? g.toNonIndexed() : g;
    const col = new THREE.Color(c);
    const n = geo.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { a[k * 3] = col.r; a[k * 3 + 1] = col.g; a[k * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
}

/** Merge geometries that may be indexed or not, keeping only position, normal and (when all have it) colour. */
function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const flat = gs.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') n.deleteAttribute(k);
        return n;
    });
    return mergeGeometries(flat);
}

/** A mover's colours, from its looks. */
const carColour = (look: number): number => CANDY[look % CANDY.length];
/** a vendor's cap */
const CAP = 0xfbfbf7;
/** the r-th rider of all the cars (riders of one car take colours three apart) */
const riderColour = (look: number, r: number): number => CANDY[((look >>> 16) + 3 * r) % CANDY.length];
const beanColour = (look: number): number => CANDY[look % CANDY.length];
const hatColour = (look: number): number => CANDY[(look >>> 8) % CANDY.length];
/** trousers: the shirt colours, darker */
function legColour(look: number, out: THREE.Color): THREE.Color {
    return out.setHex(CANDY[(look >>> 4) % CANDY.length]).multiplyScalar(0.55);
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
    /** the street vendors: a white cap each */
    private capped: number[] = [];
    /** distance each mover has gone (wheels and legs), and its place last frame */
    private dist = new Float64Array(0);
    /** per mover: past LOW_SPEC_REACH from the camera this frame (low spec only) */
    private far = new Uint8Array(0);
    private last: Place[] = [];
    /** semis' trailers' places last frame */
    private lastT: Place[] = [];
    private readonly baseT = new THREE.Matrix4();
    private readonly v = new THREE.Vector3();
    private meshes: Record<string, THREE.InstancedMesh> = {};
    private readonly p: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    private readonly base = new THREE.Matrix4();
    private readonly m = new THREE.Matrix4();
    private readonly r = new THREE.Matrix4();
    private readonly c = new THREE.Color();

    /** low spec (kit.ts): matte materials, and fewer segments on the round parts (the same shapes, a quarter of the triangles) */
    constructor(private readonly kit: Kit = FULL_KIT) {
        this.group.name = 'traffic';
    }

    private material(o: { rough?: number; basic?: boolean } = {}): THREE.Material {
        return o.basic ? this.kit.flat() : this.kit.lit({ roughness: o.rough ?? 0.6 });
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
        this.capped = [];
        model.movers.forEach((mv, i) => {
            if (mv.kind === 'car') this.cars.push(i);
            else {
                this.people.push(i);
                if (mv.vendor) this.capped.push(i);
                else if (mv.look % 3 === 0) this.hatted.push(i);
            }
        });
        this.dist = new Float64Array(model.movers.length);
        this.far = new Uint8Array(model.movers.length);
        this.last = model.movers.map(() => ({ x: NaN, y: 0, z: 0, hx: 1, hz: 0 }));
        this.lastT = model.movers.map(() => ({ x: 0, y: 0, z: 0, hx: 1, hz: 0 }));
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
        const seg = this.kit.seg;
        // one set of meshes per distinct shape (a semi's pallets are its own, so some shapes have one vehicle)
        const byKey = new Map<string, number>();
        const shapes: VehicleShape[] = [];
        this.shapeOf = [];
        this.shapeMeshes = [];
        this.cars.forEach((i, k) => {
            const sh = model.movers[i].shape!;
            const key = sh.boxes.map((b) => `${b.frame},${b.f0},${b.f1},${b.s0},${b.s1},${b.y0},${b.y1},${b.paint}`).join(';');
            let m = byKey.get(key);
            if (m === undefined) {
                m = shapes.length;
                byKey.set(key, m);
                shapes.push(sh);
                this.shapeMeshes.push({ layers: [], cars: [], n: 0 });
            }
            this.shapeMeshes[m].cars.push(k);
            this.shapeOf.push(m);
        });
        const paint = this.material({ rough: 0.35 });
        const fixed = this.kit.lit({ vertexColors: true, roughness: 0.7 });
        // glass on both sides (the far window tints what is behind the car too), drawn after everything solid, writing no depth
        const glass = this.kit.lit({
            color: GLASS, roughness: 0.05, metalness: 0.1, transparent: true, opacity: GLASS_OPACITY, side: THREE.DoubleSide, depthWrite: false
        });
        shapes.forEach((sh, m) => {
            const sm = this.shapeMeshes[m];
            const geos: Record<string, THREE.BufferGeometry[]> = {};
            const put = (key: string, g: THREE.BufferGeometry): void => { (geos[key] ??= []).push(g); };
            for (const b of sh.boxes) {
                const f = b.frame;
                if (b.paint === 'body') put(`body${f}`, boxGeo(b, f === 0 ? 0.2 : 0.03, seg(3, 1)));
                else if (b.paint === 'trailer') put(`trailer${f}`, boxGeo(b, 0.02, 1));
                else if (b.paint === 'door') {
                    put(`trailer${f}`, boxGeo(b, 0.02, 1));
                    this.lockBars(b, (g) => put(`fixed${f}`, g));
                }
                else if (b.paint === 'glass') {
                    put('glass', boxGeo(b, 0.16, seg(3, 1)));
                    this.cabin(b, sh, (g) => put(`body${f}`, g), (g) => put(`fixed${f}`, g));
                } else put(`fixed${f}`, tint(boxGeo(b, 0.02, 1), PAINT[b.paint]));
            }
            if (sh.kind === 'semi') this.semiDetails((g) => put('fixed0', g));
            const count = sm.cars.length;
            for (const [key, gs] of Object.entries(geos)) {
                const frame = key.endsWith('1') ? 1 : 0;
                const kind = key.replace(/[01]$/, '');
                const mat = kind === 'glass' ? glass : kind === 'fixed' ? fixed : paint;
                const mesh = this.add(`${m}:${key}`, instanced(merge(gs), mat, count, kind !== 'glass'));
                sm.layers.push({ mesh, frame, tint: kind === 'body' ? 'body' : kind === 'trailer' ? 'trailer' : null });
            }
        });
        const rider = part(new THREE.CapsuleGeometry(RIDER_R, RIDER_LEN, seg(6, 2), seg(14, 8)), 0, -RIDER_R - RIDER_LEN / 2, 0);
        const eye = new THREE.SphereGeometry(0.055, seg(10, 6), seg(6, 4));
        const pupil = new THREE.SphereGeometry(0.028, seg(8, 5), seg(6, 3));
        // a unit wheel (radius 1, width 1, its axle along z), scaled to each wheel
        const wheel = new THREE.CylinderGeometry(1, 1, 1, seg(20, 10)).rotateX(Math.PI / 2);
        const hub = new THREE.CylinderGeometry(0.45, 0.45, 1.06, seg(12, 6)).rotateX(Math.PI / 2);
        // a spoke-like bar across the hub so turning shows
        const spoke = new THREE.BoxGeometry(1.1, 0.14, 1.1);
        const head = new THREE.BoxGeometry(0.06, 0.14, 0.34);
        let nWheels = 0, nRiders = 0;
        this.cars.forEach((i) => {
            const sh = model.movers[i].shape!;
            nWheels += sh.wheels.length;
            nRiders += riders(model.movers[i].look, sh);
        });
        const riderMesh = this.add('rider', instanced(rider, this.material({ rough: 0.55 }), nRiders, true));
        this.add('riderEye', instanced(eye, this.kit.lit({ color: 0xffffff, roughness: 0.3 }), 2 * nRiders, false));
        this.add('riderPupil', instanced(pupil, this.kit.flat({ color: 0x111111 }), 2 * nRiders, false));
        riderMesh.count = 0;
        this.add('wheel', instanced(wheel, this.kit.lit({ color: TYRE, roughness: 0.9 }), nWheels, true));
        this.add('hub', instanced(hub, this.kit.lit({ color: HUB, roughness: 0.4 }), nWheels, false));
        this.add('spoke', instanced(spoke, this.kit.lit({ color: HUB, roughness: 0.4 }), nWheels, false));
        this.add('headlight', instanced(head, this.kit.flat({ color: 0xfff6d0 }), 2 * n, false));
        const brake = this.add('brake', instanced(head.clone(), this.material({ basic: true }), 2 * n, false));
        for (let k = 0; k < 2 * n; k++) brake.setColorAt(k, this.c.setHex(BRAKE_OFF));
    }

    /**
     * A glass cabin's frame and inside (drawn only, within its box): a roof in the body colour, a pillar at each corner
     * and one each side between the doors; the floor, a dashboard with the steering wheel on the driver's side, seat backs.
     */
    private cabin(b: VBox, sh: VehicleShape, body: (g: THREE.BufferGeometry) => void, fixed: (g: THREE.BufferGeometry) => void): void {
        const seg = this.kit.seg;
        const len = b.f1 - b.f0, wid = b.s1 - b.s0, h = b.y1 - b.y0;
        const cf = (b.f0 + b.f1) / 2, cs = (b.s0 + b.s1) / 2, y0 = b.y0;
        body(part(new RoundedBoxGeometry(len - 0.12, 0.1, wid - 0.1, seg(2, 1), 0.04), cf, b.y1 - 0.03, cs));
        for (const f of [b.f1 - 0.12, cf - 0.1, b.f0 + 0.12]) for (const s of [b.s1 - 0.06, b.s0 + 0.06]) {
            body(part(new THREE.BoxGeometry(0.12, h, 0.1), f, y0 + h / 2, s));
        }
        const seats = sh.seats;
        const inside: THREE.BufferGeometry[] = [
            part(new THREE.BoxGeometry(len - 0.1, 0.02, wid - 0.1), cf, y0 + 0.01, cs),
            part(new THREE.BoxGeometry(0.28, 0.16, wid - 0.12), b.f1 - 0.16, y0 + 0.08, cs)
        ];
        if (seats.length) {
            inside.push(part(new THREE.TorusGeometry(0.13, 0.022, seg(6, 3), seg(16, 8)).rotateY(Math.PI / 2).rotateZ(0.5), b.f1 - 0.36, y0 + 0.26, seats[0][1]));
            for (const [f, s] of seats.slice(0, 2)) inside.push(part(new THREE.BoxGeometry(0.1, 0.42, 0.5), f - 0.28, y0 + 0.21, s));
            if (seats.length > 2 && seats[2][0] - 0.3 > b.f0) inside.push(part(new THREE.BoxGeometry(0.1, 0.36, wid - 0.14), seats[2][0] - 0.3, y0 + 0.18, cs));
        }
        for (const g of inside) fixed(tint(g, INTERIOR));
    }

    /**
     * A trailer door's two lock bars and its hinges (drawn only), on its outer face: the back when it is shut (thin along
     * the trailer), the side when it is swung round against the wall (thin across).
     */
    private lockBars(b: VBox, fixed: (g: THREE.BufferGeometry) => void): void {
        const h = b.y1 - b.y0, y = (b.y0 + b.y1) / 2;
        const bar = (sx: number, sz: number, x: number, z: number): void => {
            fixed(tint(part(new THREE.BoxGeometry(sx, h - 0.1, sz), x, y, z), PAINT.chrome));
        };
        if (b.f1 - b.f0 < b.s1 - b.s0) {
            for (const u of [0.3, 0.7]) bar(0.04, 0.05, b.f0 - 0.02, b.s0 + (b.s1 - b.s0) * u);
            for (const u of [0.15, 0.5, 0.85]) fixed(tint(part(new THREE.BoxGeometry(0.04, 0.12, b.s1 - b.s0 - 0.06), b.f0 - 0.02, b.y0 + h * u, (b.s0 + b.s1) / 2), PAINT.trim));
        } else {
            const out = b.s0 + b.s1 > 0 ? b.s1 + 0.02 : b.s0 - 0.02;
            for (const u of [0.3, 0.7]) bar(0.05, 0.04, b.f0 + (b.f1 - b.f0) * u, out);
            for (const u of [0.15, 0.5, 0.85]) fixed(tint(part(new THREE.BoxGeometry(b.f1 - b.f0 - 0.06, 0.12, 0.04), (b.f0 + b.f1) / 2, b.y0 + h * u, out), PAINT.trim));
        }
    }

    /** A semi tractor's windows (its cab is not see-through), grille and bumper, drawn just outside its boxes (vehicles.ts tractor()). */
    private semiDetails(fixed: (g: THREE.BufferGeometry) => void): void {
        const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, c: number): void => {
            fixed(tint(part(new THREE.BoxGeometry(sx, sy, sz), x, y, z), c));
        };
        box(0.02, 0.95, 2.2, 1.31, 2.5, 0, DARK_GLASS); // windscreen
        for (const s of [-1, 1]) box(1.05, 0.9, 0.02, 0.62, 2.45, s * 1.25, DARK_GLASS); // door windows
        box(0.02, 0.9, 1.4, 3.31, 1.15, 0, PAINT.chrome); // grille
        box(0.06, 0.22, 2.3, 3.33, 0.6, 0, PAINT.chrome); // bumper
    }

    private buildPeople(model: TrafficModel): void {
        const n = this.people.length;
        if (!n) return;
        const seg = this.kit.seg;
        // the bean: the collision capsule's top, standing on short legs
        const beanLen = PERSON.y1 + PERSON.r - HIP + 0.08 - 2 * PERSON.r;
        const bean = part(new THREE.CapsuleGeometry(PERSON.r, beanLen, seg(6, 2), seg(16, 8)), 0, HIP - 0.08 + PERSON.r + beanLen / 2, 0);
        const eyeY = PERSON.y1 - 0.02;
        const eye = new THREE.SphereGeometry(0.075, seg(12, 6), seg(8, 4));
        const pupil = new THREE.SphereGeometry(0.038, seg(10, 5), seg(6, 3));
        // a leg hangs from the hip: its top at the origin, so it swings about it
        const leg = part(new THREE.CapsuleGeometry(0.085, HIP - 0.17, seg(4, 1), seg(8, 5)), 0, -(HIP - 0.17) / 2 - 0.085, 0);
        const hat = part(new THREE.ConeGeometry(0.17, 0.38, seg(14, 6)), 0, 0.19, 0);
        const beanMesh = this.add('bean', instanced(bean, this.material({ rough: 0.55 }), n, true));
        this.add('eye', instanced(eye, this.kit.lit({ color: 0xffffff, roughness: 0.3 }), 2 * n, false));
        this.add('pupil', instanced(pupil, this.kit.flat({ color: 0x111111 }), 2 * n, false));
        const legMesh = this.add('leg', instanced(leg, this.material({ rough: 0.7 }), 2 * n, true));
        const hatMesh = this.add('hat', instanced(hat, this.material({ rough: 0.5 }), this.hatted.length, true));
        // a vendor's paper cap: a low drum with a visor
        const cap = mergeGeometries([
            new THREE.CylinderGeometry(0.2, 0.21, 0.14, seg(14, 6)).translate(0, 0.07, 0),
            new THREE.BoxGeometry(0.16, 0.02, 0.26).translate(0.2, 0.01, 0)
        ]);
        this.add('cap', instanced(cap, this.kit.lit({ color: CAP, roughness: 0.6 }), this.capped.length, true));
        this.people.forEach((i, k) => {
            const look = model.movers[i].look;
            beanMesh.setColorAt(k, this.c.setHex(beanColour(look)));
            legColour(look, this.c);
            legMesh.setColorAt(2 * k, this.c);
            legMesh.setColorAt(2 * k + 1, this.c);
        });
        this.hatted.forEach((i, k) => hatMesh.setColorAt(k, this.c.setHex(hatColour(model.movers[i].look))));
        this.eyeY = eyeY;
    }

    private eyeY = 0;
    /** per car (index into cars), its shape's meshes (index into shapeMeshes) */
    private shapeOf: number[] = [];
    private shapeMeshes: ShapeMesh[] = [];

    private buildSignals(model: TrafficModel): void {
        const boxes = model.allStatics();
        if (boxes.length) {
            const mesh = this.add('pole', instanced(new THREE.BoxGeometry(1, 1, 1), this.kit.lit({ color: POLE, roughness: 0.6, metalness: 0.3 }), boxes.length, true));
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
        const disc = new THREE.CylinderGeometry(0.11, 0.11, 0.04, this.kit.seg(16, 8)).rotateZ(Math.PI / 2); // facing +x
        // an arrow pointing along +z (the driver's left, seen from the lamp's front at +x), facing +x
        const shape = new THREE.Shape();
        shape.moveTo(-0.09, -0.03).lineTo(0.02, -0.03).lineTo(0.02, -0.075).lineTo(0.1, 0).lineTo(0.02, 0.075)
            .lineTo(0.02, 0.03).lineTo(-0.09, 0.03).closePath();
        const arrow = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.02, 0, 0);
        const lamps = nLamps ? this.add('lamp', instanced(disc, this.material({ basic: true }), nLamps, false)) : null;
        const arrows = nArrows ? this.add('arrowLamp', instanced(arrow, this.material({ basic: true }), nArrows, false)) : null;
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

    /**
     * Every mover where it is at `tick`, wheels and legs turned by how far it went, lamps lit. In low spec, movers further
     * than LOW_SPEC_REACH from `eye` (the camera) are drawn nowhere.
     */
    update(tick: number, eye?: { x: number; z: number }): void {
        const model = this.model;
        if (!model) return;
        model.at(tick);
        const p = this.p;
        const reach = this.kit.lowSpec && eye ? LOW_SPEC_REACH : Infinity;
        for (let i = 0; i < model.movers.length; i++) {
            model.place(i, tick, p);
            const l = this.last[i];
            if (!Number.isNaN(l.x)) {
                const d = Math.hypot(p.x - l.x, p.z - l.z);
                // a jump (time going back, a new life) is not walking
                if (d < 5) this.dist[i] += d;
            }
            l.x = p.x; l.y = p.y; l.z = p.z; l.hx = p.hx; l.hz = p.hz;
            if (model.movers[i].shape?.trailer) model.trailer!(i, tick, this.lastT[i]);
            this.far[i] = reach < Infinity && Math.hypot(p.x - eye!.x, p.z - eye!.z) > reach ? 1 : 0;
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

    /** A semi's trailer's frame, as frame(). */
    private trailerFrame(i: number): THREE.Matrix4 {
        const l = this.lastT[i];
        return this.baseT.set(l.hx, 0, -l.hz, l.x, 0, 1, 0, l.y, l.hz, 0, l.hx, l.z, 0, 0, 0, 1);
    }

    /**
     * The vehicles drawn this frame are packed into the first instances of their shape's meshes (low spec: only the ones
     * within reach), so the GPU gets no work for the rest; their colours are packed with them.
     */
    private updateCars(model: TrafficModel): void {
        const M = this.meshes;
        if (!M.wheel) return;
        for (const sm of this.shapeMeshes) sm.n = 0;
        let w = 0, j = 0, q = 0;
        const bodyC = new THREE.Color(), trailerC = new THREE.Color();
        this.cars.forEach((i, k) => {
            if (this.far[i]) return;
            const mv = model.movers[i], sh = mv.shape!;
            const f0 = this.frame(i);
            const f1 = sh.trailer ? this.trailerFrame(i) : f0;
            bodyC.setHex(carColour(mv.look));
            trailerC.setHex(trailerColour(mv.look));
            const sm = this.shapeMeshes[this.shapeOf[k]];
            const slot = sm.n++;
            for (const L of sm.layers) {
                L.mesh.setMatrixAt(slot, L.frame ? f1 : f0);
                if (L.tint) L.mesh.setColorAt(slot, L.tint === 'body' ? bodyC : trailerC);
            }
            for (const wh of sh.wheels) {
                const turn = -this.dist[i] / wh.r;
                this.m.makeRotationZ(turn).scale(this.v.set(wh.r, wh.r, wh.w)).setPosition(wh.f, wh.r, wh.s);
                this.m.premultiply(wh.frame ? f1 : f0);
                M.wheel.setMatrixAt(w, this.m);
                M.hub.setMatrixAt(w, this.m);
                M.spoke.setMatrixAt(w, this.m);
                w++;
            }
            const braking = model.braking(i);
            const hd = sh.head, tl = sh.tail;
            for (let s = 0; s < 2; s++) {
                const z = s ? 1 : -1;
                this.m.makeTranslation(hd.f, hd.y, z * hd.s).premultiply(f0);
                M.headlight.setMatrixAt(2 * j + s, this.m);
                this.m.makeTranslation(tl.f, tl.y, z * tl.s).premultiply(tl.frame ? f1 : f0);
                M.brake.setMatrixAt(2 * j + s, this.m);
                this.c.setHex(braking ? BRAKE_ON : BRAKE_OFF);
                M.brake.setColorAt(2 * j + s, this.c);
            }
            j++;
            const nr = riders(mv.look, sh);
            for (let r = 0; r < nr; r++) {
                const [sx, sz] = sh.seats[r];
                this.m.makeTranslation(sx, sh.headTop, sz).premultiply(f0);
                M.rider.setMatrixAt(q, this.m);
                M.rider.setColorAt(q, this.c.setHex(riderColour(mv.look, r)));
                const ey = sh.headTop - RIDER_R - 0.02;
                for (let s = 0; s < 2; s++) {
                    const ez = sz + (s ? 0.075 : -0.075);
                    this.m.makeTranslation(sx + RIDER_R - 0.045, ey, ez).premultiply(f0);
                    M.riderEye.setMatrixAt(2 * q + s, this.m);
                    this.m.makeTranslation(sx + RIDER_R + 0.003, ey, ez).premultiply(f0);
                    M.riderPupil.setMatrixAt(2 * q + s, this.m);
                }
                q++;
            }
        });
        for (const sm of this.shapeMeshes) for (const L of sm.layers) {
            L.mesh.count = sm.n;
            L.mesh.instanceMatrix.needsUpdate = true;
            if (L.mesh.instanceColor) L.mesh.instanceColor.needsUpdate = true;
        }
        for (const name of ['wheel', 'hub', 'spoke']) M[name].count = w;
        M.headlight.count = M.brake.count = 2 * j;
        M.rider.count = q;
        M.riderEye.count = M.riderPupil.count = 2 * q;
        for (const name of ['rider', 'riderEye', 'riderPupil', 'wheel', 'hub', 'spoke', 'headlight', 'brake']) {
            M[name].instanceMatrix.needsUpdate = true;
        }
        for (const name of ['rider', 'brake']) {
            const c = M[name].instanceColor;
            if (c) c.needsUpdate = true;
        }
    }

    /** The people drawn this frame packed into the first instances, as the cars (updateCars); not those inside a building. */
    private updatePeople(model: TrafficModel): void {
        const M = this.meshes;
        if (!M.bean) return;
        let h = 0, j = 0, hat = 0, cap = 0, c = 0;
        this.people.forEach((i) => {
            const hatted = this.hatted[h] === i;
            if (hatted) h++;
            const capped = this.capped[c] === i;
            if (capped) c++;
            // inside a building (or, in low spec, far off): drawn nowhere
            if (model.hidden?.(i) || this.far[i]) return;
            const look = model.movers[i].look;
            const phase = (this.dist[i] / STRIDE) * 2 * Math.PI;
            const bob = 0.035 * Math.abs(Math.sin(phase));
            const f = this.frame(i);
            this.m.makeTranslation(0, bob, 0).premultiply(f);
            M.bean.setMatrixAt(j, this.m);
            M.bean.setColorAt(j, this.c.setHex(beanColour(look)));
            legColour(look, this.c);
            for (let s = 0; s < 2; s++) {
                const z = s ? 0.1 : -0.1;
                this.m.makeTranslation(PERSON.r - 0.06, this.eyeY + bob, z).premultiply(f);
                M.eye.setMatrixAt(2 * j + s, this.m);
                this.m.makeTranslation(PERSON.r + 0.005, this.eyeY + bob, z).premultiply(f);
                M.pupil.setMatrixAt(2 * j + s, this.m);
                const swing = (s ? 1 : -1) * 0.55 * Math.sin(phase);
                this.m.makeRotationZ(swing).setPosition(0, HIP + bob, s ? 0.13 : -0.13).premultiply(f);
                M.leg.setMatrixAt(2 * j + s, this.m);
                M.leg.setColorAt(2 * j + s, this.c);
            }
            if (capped) {
                this.m.makeTranslation(0, PERSON.y1 + PERSON.r - 0.08 + bob, 0).premultiply(f);
                M.cap.setMatrixAt(cap++, this.m);
            }
            if (hatted) {
                this.m.makeRotationX(0.15).setPosition(0, PERSON.y1 + PERSON.r - 0.04 + bob, 0).premultiply(f);
                M.hat.setMatrixAt(hat, this.m);
                M.hat.setColorAt(hat++, this.c.setHex(hatColour(look)));
            }
            j++;
        });
        M.bean.count = j;
        M.eye.count = M.pupil.count = M.leg.count = 2 * j;
        M.hat.count = hat;
        M.cap.count = cap;
        for (const name of ['bean', 'eye', 'pupil', 'leg', 'hat', 'cap']) M[name].instanceMatrix.needsUpdate = true;
        for (const name of ['bean', 'leg', 'hat']) {
            const c = M[name].instanceColor;
            if (c) c.needsUpdate = true;
        }
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
