// The train in Three.js: a black steam engine and tender (after the LMS Ivatt Class 2 2-6-0, packages/traffic train.ts)
// and three maroon coaches with open windows and people inside, with wheels and coupling rods that turn with the
// distance run, and the smoke: cloud puffs out of the chimney, a big dark one on each exhaust beat while the engine
// pulls, thin wisps while it coasts or stands, each billowing out into a bigger, lighter cloud as it drifts away.
// Drawn at the sim's tick from the train model, so what is drawn is where the collision is (the coaches are drawn from
// their very collision boxes). Drawing never feeds back into the sim.
//
// Cheap on purpose: each vehicle is one merged mesh coloured per vertex, the wheels, rods and smoke are instanced, so
// each train is nine draws. The smoke's puffs are a function of the tick too (each leaves the chimney at a fixed
// time slot), so a replay's smoke is the same smoke.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BEATS_PER_TURN, CHIMNEY, DRIVER_D, TRAIN_RAIL_TOP, newTrainPlace } from '@owfpv/traffic';
import type { Train, TrainBox, TrainPlace, TrainState, Vehicle } from '@owfpv/traffic';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

const BLACK = 0x1c1e21;
const SMOKEBOX = 0x262626;
const RED = 0xa8261d;
const BRASS = 0xb98a3e;
const STEEL = 0x9aa0a6;
const COAL = 0x141414;
/** British Railways maroon, a grey roof, a black underframe, a wooden floor, blue seats */
const MAROON = 0x6e1f29;
/** the second train (owner, 2026-10-19): Brunswick green engine and tender, green coaches, as BR painted both */
const GREEN_LOCO = 0x1e4a2c;
const GREEN_COACH = 0x2b5a35;
const ROOF = 0x5d6165;
const UNDER = 0x23252a;
const FLOORING = 0x5a4634;
const SEATS = 0x2f4d73;
const LAMP = 0xfff3c4;
const GLASS = 0x22303a;
/** the people's shirts: the traffic's candy colours (render/traffic.ts) */
const CANDY = [0xff6fa8, 0x5ce0b8, 0x5ab4ff, 0xffd84d, 0xff9a3c, 0xb38cff, 0xff5a5a, 0x2ec4c4, 0x9be15d, 0xf7f7f2];

/** Wheels: the engine's coupled wheels (1.524 m) and every other wheel (pony truck, tender, coach bogies: 1 m [estimate]). */
const DRIVER_R = DRIVER_D / 2;
const SMALL_R = 0.5;
const RAIL_TOP = TRAIN_RAIL_TOP;
/** across the track, the wheels' middle, m (the rails are 0.75 m out) */
const WHEEL_S = 0.75;
/** the engine's three coupled axles, along its frame, and its crank pins' throw (the coupling rods' circle), m [estimates] */
const DRIVERS = [-2.6, -0.6, 1.4];
const CRANK = 0.3;
const ROD_S = 1.2;
/** every small axle: [vehicle kind, along its frame] */
const SMALL_AXLES: Record<'loco' | 'tender' | 'coach', number[]> = {
    loco: [3.7],
    tender: [-2, 0, 2],
    coach: [-8.3, -5.7, 5.7, 8.3]
};

/**
 * Smoke: a puff may leave every SLOT ticks and lives LIFE_S (less in super low spec). Each puff is a cluster of BLOBS
 * round blobs that spread apart as it grows, so it reads as a cloud and not one ball.
 */
const SLOT = 100;
const LIFE_S = 10;
const BLOBS = 3;
/** a breeze drifting the smoke (render only: the sim's wind is the quad's) [made up] */
const BREEZE = { x: 0.7, z: 0.35 };
const SMOKE_DARK = new THREE.Color(0x707176);
const SMOKE_LIGHT = new THREE.Color(0xf0f0ee);

/** A box of colour c, sx long, sy high, sz across, centred at (x, y, z) in the vehicle's frame (x ahead, y up, z right). */
function box(c: number, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.BufferGeometry {
    return paint(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), c);
}

/** A cylinder of colour c along the vehicle (axis x) or upright (axis y). */
function cyl(c: number, r: number, len: number, axis: 'x' | 'y', x: number, y: number, z: number, seg: number): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    return paint(g.translate(x, y, z), c);
}

function paint(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
}

/** Merge parts that may be indexed or not, keeping position, normal and colour (uv dropped: nothing here is textured). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    return mergeGeometries(parts.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (n.getAttribute('uv')) n.deleteAttribute('uv');
        return n;
    }));
}

/** The engine's body (wheels and rods apart), 9.8 m over the buffers, chimney forward. */
function locoGeometry(seg: (f: number, l: number) => number, BLACK: number): THREE.BufferGeometry {
    const s = seg(20, 10);
    const by = 2.65;
    return merge([
        box(BLACK, 9.0, 0.95, 1.2, 0, 1.45, 0), // the frames, inside the wheels
        box(BLACK, 9.2, 0.08, 2.7, 0, 1.96, 0), // the running plate
        cyl(BLACK, 0.75, 4.4, 'x', 0.8, by, 0, s), // the boiler
        cyl(SMOKEBOX, 0.8, 1.4, 'x', 3.7, by, 0, s), // the smokebox
        cyl(SMOKEBOX, 0.25, 0.55, 'y', CHIMNEY.f, CHIMNEY.y - 0.27, 0, seg(12, 8)), // the chimney
        cyl(BRASS, 0.3, 0.08, 'y', CHIMNEY.f, CHIMNEY.y - 0.04, 0, seg(12, 8)), // its rim
        cyl(BLACK, 0.34, 0.45, 'y', 1.4, 3.35, 0, seg(12, 8)), // the dome
        cyl(BRASS, 0.12, 0.25, 'y', -0.9, 3.45, 0, 8), // the safety valves
        box(BLACK, 3.2, 1.7, 2.6, -3.0, 2.85, 0), // the cab
        box(BLACK, 3.5, 0.15, 2.75, -3.05, 3.78, 0), // its roof
        box(GLASS, 0.05, 0.5, 0.5, -1.38, 3.1, -0.75), box(GLASS, 0.05, 0.5, 0.5, -1.38, 3.1, 0.75), // the front windows
        box(GLASS, 1.2, 0.6, 2.62, -2.6, 3.05, 0), // the side windows (a band through the cab)
        box(BLACK, 1.1, 0.5, 0.45, 3.1, 1.6, -1.12), box(BLACK, 1.1, 0.5, 0.45, 3.1, 1.6, 1.12), // the cylinders
        box(RED, 0.15, 0.45, 2.6, 4.55, 1.3, 0), // the buffer beam
        cyl(STEEL, 0.17, 0.3, 'x', 4.75, 1.3, -0.85, 10), cyl(STEEL, 0.17, 0.3, 'x', 4.75, 1.3, 0.85, 10), // the buffers
        cyl(LAMP, 0.12, 0.1, 'x', 4.6, 2.15, 0, 10) // a lamp on the buffer beam
    ]);
}

function tenderGeometry(BLACK: number): THREE.BufferGeometry {
    return merge([
        box(UNDER, 6.0, 0.55, 2.0, 0, 0.95, 0),
        box(BLACK, 6.0, 1.85, 2.6, 0, 2.15, 0),
        box(COAL, 5.0, 0.15, 2.3, 0.4, 3.1, 0),
        box(RED, 0.12, 0.4, 2.6, -3.0, 1.3, 0)
    ]);
}

/** One of the coach's own collision boxes, coloured by what it is. */
function boxOf(b: TrainBox, c: number): THREE.BufferGeometry {
    return box(c, b.f1 - b.f0, b.y1 - b.y0, b.s1 - b.s0, (b.f0 + b.f1) / 2, (b.y0 + b.y1) / 2, (b.s0 + b.s1) / 2);
}

/**
 * A coach drawn from its collision boxes (train.ts), so its walls, windows, seats and people are where the quad meets
 * them; the people drawn as beans with eyes looking along the coach (as the traffic's people), the roof with a crown.
 */
function coachGeometry(v: Vehicle, seg: (f: number, l: number) => number, body: number): THREE.BufferGeometry {
    const COL: Record<string, number> = { floor: FLOORING, wall: body, roof: ROOF, bogie: UNDER, seat: SEATS };
    const parts: THREE.BufferGeometry[] = [];
    let top = 0, len = 0;
    for (const b of v.boxes) {
        top = Math.max(top, b.y1);
        len = Math.max(len, b.f1);
        if (b.part !== 'rider') { parts.push(boxOf(b, COL[b.part] ?? body)); continue; }
        // a bean: a capsule from the seat up to the box's top, eyes on the side it faces
        const r = Math.min(b.f1 - b.f0, b.s1 - b.s0) / 2;
        const h = b.y1 - b.y0;
        const fx = (b.f0 + b.f1) / 2, sz = (b.s0 + b.s1) / 2, face = b.face ?? 1;
        const look = b.look ?? 0;
        parts.push(paint(new THREE.CapsuleGeometry(r, h - 2 * r, seg(4, 2), seg(10, 6)).translate(fx, b.y0 + h / 2, sz), CANDY[look % CANDY.length]));
        for (const side of [-1, 1]) {
            const ex = fx + face * (r - 0.02), ey = b.y1 - 0.17, ez = sz + side * 0.08;
            parts.push(paint(new THREE.SphereGeometry(0.055, seg(8, 5), seg(6, 3)).translate(ex, ey, ez), 0xffffff));
            parts.push(paint(new THREE.SphereGeometry(0.028, seg(6, 4), seg(4, 3)).translate(ex + face * 0.04, ey, ez), 0x111111));
        }
    }
    // the roof's crown, and the buffers at each end
    parts.push(box(ROOF, 2 * len - 0.4, 0.1, 1.9, 0, top + 0.05, 0));
    for (const end of [-1, 1]) for (const s of [-0.85, 0.85]) parts.push(cyl(STEEL, 0.17, 0.3, 'x', end * (len + 0.12), 1.0, s, 10));
    return merge(parts);
}

/** A wheel of radius r with a spoke bar across it (so it shows turning), its axle across the track (z). */
function wheelGeometry(r: number, seg: number, counterweight: boolean): THREE.BufferGeometry {
    const parts = [
        paint(new THREE.CylinderGeometry(r, r, 0.13, seg).rotateX(Math.PI / 2), counterweight ? BLACK : UNDER),
        paint(new THREE.BoxGeometry(2 * r * 0.9, 0.08, 0.15), counterweight ? RED : STEEL)
    ];
    if (counterweight) parts.push(paint(new THREE.BoxGeometry(0.5 * r, 0.35 * r, 0.16).translate(-0.55 * r, 0, 0), BLACK));
    return merge(parts);
}

/** A number in [0, 1) from an integer (the smoke's variety: render only). */
function hash01(n: number, salt: number): number {
    return ((Math.imul(n ^ Math.imul(salt, 0x27d4eb2d), 0x9e3779b1) >>> 0) % 10007) / 10007;
}

export class TrainView {
    readonly group = new THREE.Group();
    private train: Train | null = null;
    private bodies: THREE.Mesh[] = [];
    private drivers: THREE.InstancedMesh | null = null;
    private small: THREE.InstancedMesh | null = null;
    private rods: THREE.InstancedMesh | null = null;
    private smoke: THREE.InstancedMesh | null = null;
    private readonly st: TrainState = { run: 0, s: 0, v: 0, effort: 0, brake: 0 };
    private readonly st0: TrainState = { run: 0, s: 0, v: 0, effort: 0, brake: 0 };
    private readonly p: TrainPlace = newTrainPlace();
    private readonly frame = new THREE.Matrix4();
    private readonly m = new THREE.Matrix4();
    private readonly r = new THREE.Matrix4();
    private readonly c = new THREE.Color();
    private readonly life: number;
    private readonly blobs: number;
    private readonly slots: number;

    /** `livery`: 0 black and maroon, 1 green (the second train) */
    constructor(private readonly kit: Kit = FULL_KIT, private readonly livery = 0) {
        this.group.name = `train${livery}`;
        // super low spec: shorter-lived smoke of fewer blobs (fewer to draw)
        this.life = kit.graphics === 'super' ? 5 : LIFE_S;
        this.blobs = kit.graphics === 'super' ? 2 : BLOBS;
        this.slots = Math.ceil((this.life * 1000) / SLOT) + 1;
    }

    /** A new train (or none). */
    rebuild(train: Train | null): void {
        const done = new Set<unknown>();
        for (const o of [...this.group.children]) {
            this.group.remove(o);
            const mesh = o as THREE.Mesh;
            for (const x of [mesh.geometry, mesh.material as THREE.Material]) {
                if (done.has(x)) continue;
                done.add(x);
                x.dispose();
            }
        }
        this.bodies = [];
        this.drivers = this.small = this.rods = this.smoke = null;
        this.train = train;
        if (!train) return;
        const shadow = !this.kit.lowSpec;
        const seg = this.kit.seg;
        // one material for the whole train; the engine and tender have their own shapes, each coach is built from its boxes
        const mat = this.kit.lit({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
        for (const v of train.vehicles) {
            const loco = this.livery ? GREEN_LOCO : BLACK;
            const geo = v.kind === 'loco' ? locoGeometry(seg, loco) : v.kind === 'tender' ? tenderGeometry(loco) : coachGeometry(v, seg, this.livery ? GREEN_COACH : MAROON);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.matrixAutoUpdate = false;
            mesh.castShadow = shadow;
            mesh.receiveShadow = true;
            mesh.name = `train:${v.kind}`;
            this.bodies.push(mesh);
            this.group.add(mesh);
        }
        const nSmall = train.vehicles.reduce((n, v) => n + 2 * SMALL_AXLES[v.kind].length, 0);
        this.drivers = this.instanced('drivers', wheelGeometry(DRIVER_R, seg(24, 12), true), 2 * DRIVERS.length, false);
        this.small = this.instanced('wheels', wheelGeometry(SMALL_R, seg(16, 8), false), nSmall, false);
        this.rods = this.instanced('rods', paint(new THREE.BoxGeometry(DRIVERS[2] - DRIVERS[0] + 0.3, 0.12, 0.06), STEEL), 2, false);
        const puff = new THREE.IcosahedronGeometry(1, this.kit.lowSpec ? 0 : 1);
        const n = this.slots * this.blobs;
        this.smoke = this.instanced('smoke', puff, n, false, this.kit.lit({ color: 0xffffff, roughness: 1 }));
        this.smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    }

    private instanced(name: string, geo: THREE.BufferGeometry, n: number, shadow: boolean, mat?: THREE.Material): THREE.InstancedMesh {
        const m = new THREE.InstancedMesh(geo, mat ?? this.kit.lit({ vertexColors: true, roughness: 0.5, metalness: 0.2 }), n);
        m.frustumCulled = false;
        m.castShadow = shadow;
        m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.name = `train:${name}`;
        this.group.add(m);
        return m;
    }

    /** The vehicle frame for place p: x along it (tilted on a grade), y up square to that, z across to its right. */
    private frameOf(p: TrainPlace): THREE.Matrix4 {
        return this.frame.set(
            p.fx, p.ux, -p.hz, p.x,
            p.fy, p.uy, 0, p.y,
            p.fz, p.uz, p.hx, p.z,
            0, 0, 0, 1);
    }

    /** Draw the train at `tick` (fractions too). */
    update(tick: number): void {
        const tr = this.train;
        if (!tr) return;
        const st = tr.state(tick, this.st);
        const turnD = st.run / DRIVER_R, turnS = st.run / SMALL_R;
        let si = 0;
        tr.vehicles.forEach((v, i) => {
            tr.placeAtS(i, st.s, this.p);
            const f = this.frameOf(this.p);
            const body = this.bodies[i];
            body.matrix.copy(f);
            body.matrixWorldNeedsUpdate = true;
            for (const a of SMALL_AXLES[v.kind]) for (const side of [-1, 1]) {
                this.m.makeRotationZ(-turnS).setPosition(a, RAIL_TOP + SMALL_R, side * WHEEL_S);
                this.small!.setMatrixAt(si++, this.r.multiplyMatrices(f, this.m));
            }
            if (v.kind !== 'loco') return;
            let k = 0;
            for (const a of DRIVERS) for (const side of [-1, 1]) {
                // the two sides' cranks a quarter turn apart, as on a two-cylinder engine
                this.m.makeRotationZ(-turnD + (side > 0 ? Math.PI / 2 : 0)).setPosition(a, RAIL_TOP + DRIVER_R, side * WHEEL_S);
                this.drivers!.setMatrixAt(k++, this.r.multiplyMatrices(f, this.m));
            }
            // the coupling rods: carried round on the crank pins, staying level with the frame
            for (const [j, side] of [[0, -1], [1, 1]]) {
                const th = -turnD + (side > 0 ? Math.PI / 2 : 0);
                this.m.makeTranslation((DRIVERS[0] + DRIVERS[2]) / 2 + CRANK * Math.cos(th), RAIL_TOP + DRIVER_R + CRANK * Math.sin(th), side * ROD_S);
                this.rods!.setMatrixAt(j, this.r.multiplyMatrices(f, this.m));
            }
        });
        for (const m of [this.drivers!, this.small!, this.rods!]) m.instanceMatrix.needsUpdate = true;
        this.updateSmoke(tr, tick);
    }

    /**
     * The smoke at `tick`: puff k leaves the chimney at tick k * SLOT if the engine exhausted then (a beat since the slot
     * before while moving: four per turn of the coupled wheels), or every half second as a wisp while it stands. It
     * rises fast and slows, keeps the train's speed for a moment, drifts on the breeze, and billows: its blobs swell to
     * several metres and spread apart, lighter as they thin, then shrink away at the end of its life.
     */
    private updateSmoke(tr: Train, tick: number): void {
        const sm = this.smoke!;
        const beat = (Math.PI * DRIVER_D) / BEATS_PER_TURN;
        const last = Math.floor(tick / SLOT);
        const t = tr.tunnel;
        let n = 0;
        for (let k = last; k > last - this.slots && k >= 0; k--) {
            const age = (tick - k * SLOT) / 1000;
            if (age > this.life) break;
            const st = tr.state(k * SLOT, this.st);
            let strength: number;
            if (st.v < 0.05) {
                if (k % 5 !== 0) continue;
                strength = 0.2;
            } else {
                const prev = tr.state((k - 1) * SLOT, this.st0);
                if (Math.floor(st.run / beat) === Math.floor(prev.run / beat)) continue;
                strength = st.effort > 0.02 ? Math.min(1, 0.35 + st.effort * 1.1) : 0.25;
            }
            tr.placeAtS(0, st.s, this.p);
            const p = this.p;
            const x0 = p.x + p.fx * CHIMNEY.f + p.ux * CHIMNEY.y, z0 = p.z + p.fz * CHIMNEY.f + p.uz * CHIMNEY.y;
            const y0 = p.y + p.fy * CHIMNEY.f + p.uy * CHIMNEY.y;
            // up: the blast, slowing over about 1.2 s, then the warm smoke's own slow rise
            const w0 = 1 + 2.5 * strength;
            let y = y0 + w0 * 1.2 * (1 - Math.exp(-age / 1.2)) + 0.35 * age;
            // along: the train's speed it left with, lost to the air in under a second; and the breeze
            const carry = st.v * 0.4 * (1 - Math.exp(-age / 0.4));
            let x = x0 + p.hx * carry + BREEZE.x * age;
            let z = z0 + p.hz * carry + BREEZE.z * age;
            // the cloud's size: from a chimney's width to several metres, faster at first, a little different each puff
            const size = (0.75 + 0.5 * hash01(k, 1)) * (0.3 + 0.3 * strength);
            let r = size * (1 + 1.25 * Math.pow(age, 0.85)) * Math.min(1, 0.5 + age * 5) * Math.min(1, (this.life - age) / (0.3 * this.life));
            // in the tunnel the smoke stays under the arch, spread along it
            const along = t.axis === 'x' ? x0 : z0, across = t.axis === 'x' ? z0 : x0;
            if (along > t.a0 && along < t.a1 && Math.abs(across - t.c) < t.halfWidth) {
                r = Math.min(r, t.halfWidth * 0.8);
                y = Math.min(y, p.y + t.crown - 0.15 - r * 0.6);
                x = x0 + p.hx * carry;
                z = z0 + p.hz * carry;
            }
            if (r <= 0.01) continue;
            for (let j = 0; j < this.blobs; j++) {
                // each blob a little off the cloud's middle, further as it grows, and of its own size
                const spread = j === 0 ? 0 : r * 0.7;
                const ox = (hash01(k, 10 + j) * 2 - 1) * spread, oy = (hash01(k, 20 + j) * 2 - 1) * spread * 0.5, oz = (hash01(k, 30 + j) * 2 - 1) * spread;
                const rb = r * (j === 0 ? 1 : 0.65 + 0.25 * hash01(k, 40 + j));
                this.m.makeScale(rb, rb * 0.85, rb).setPosition(x + ox, y + oy, z + oz);
                sm.setMatrixAt(n, this.m);
                this.c.copy(SMOKE_DARK).lerp(SMOKE_LIGHT, Math.min(1, age / 3 + (1 - strength) * 0.6 + j * 0.06));
                sm.setColorAt(n, this.c);
                n++;
            }
        }
        sm.count = n;
        sm.instanceMatrix.needsUpdate = true;
        if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    }
}
