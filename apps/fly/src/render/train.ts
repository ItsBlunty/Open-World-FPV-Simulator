// The train in Three.js: a black steam engine and tender (after the LMS Ivatt Class 2 2-6-0, packages/traffic train.ts)
// and three maroon coaches, with wheels and coupling rods that turn with the distance run, and the smoke: simple
// cloud puffs out of the chimney, a big dark one on each exhaust beat while the engine pulls, thin wisps while it
// coasts or stands. Drawn at the sim's tick from the train model, so what is drawn is where the collision is (the
// solid outline matches train.ts). Drawing never feeds back into the sim.
//
// Cheap on purpose: each vehicle is one merged mesh coloured per vertex, the wheels, rods and smoke are instanced, so
// the whole train is eight draws. The smoke's puffs are a function of the tick too (each leaves the chimney at a fixed
// time slot), so a replay's smoke is the same smoke.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BEATS_PER_TURN, CHIMNEY, DRIVER_D } from '@owfpv/traffic';
import type { Place, Train, TrainState } from '@owfpv/traffic';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

const BLACK = 0x1c1e21;
const SMOKEBOX = 0x262626;
const RED = 0xa8261d;
const BRASS = 0xb98a3e;
const STEEL = 0x9aa0a6;
const COAL = 0x141414;
/** British Railways maroon, a grey roof, a black underframe */
const MAROON = 0x6e1f29;
const ROOF = 0x5d6165;
const UNDER = 0x23252a;
const GLASS = 0x22303a;
const LAMP = 0xfff3c4;

/** Wheels: the engine's coupled wheels (1.524 m) and every other wheel (pony truck, tender, coach bogies: 1 m [estimate]). */
const DRIVER_R = DRIVER_D / 2;
const SMALL_R = 0.5;
const RAIL_TOP = 0.45;
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

/** Smoke: a puff may leave every SLOT ticks; each lives LIFE_S (less in low spec). At most this many are drawn. */
const SLOT = 100;
const LIFE_S = 7;
/** a breeze drifting the smoke (render only: the sim's wind is the quad's) [made up] */
const BREEZE = { x: 0.7, z: 0.35 };
const SMOKE_DARK = new THREE.Color(0x7d7e82);
const SMOKE_LIGHT = new THREE.Color(0xeeeeec);

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

/** The engine's body (wheels and rods apart), 9.8 m over the buffers, chimney forward. */
function locoGeometry(seg: (f: number, l: number) => number): THREE.BufferGeometry {
    const s = seg(20, 10);
    const by = 2.65;
    const parts = [
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
    ];
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

function tenderGeometry(): THREE.BufferGeometry {
    const parts = [
        box(UNDER, 6.0, 0.55, 2.0, 0, 0.95, 0),
        box(BLACK, 6.0, 1.85, 2.6, 0, 2.15, 0),
        box(COAL, 5.0, 0.15, 2.3, 0.4, 3.1, 0),
        box(RED, 0.12, 0.4, 2.6, -3.0, 1.3, 0)
    ];
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

function coachGeometry(): THREE.BufferGeometry {
    const parts = [
        box(UNDER, 18.4, 0.3, 1.8, 0, 1.0, 0), // the underframe
        box(UNDER, 2.8, 0.3, 2.1, -7, 0.85, 0), box(UNDER, 2.8, 0.3, 2.1, 7, 0.85, 0), // the bogies' frames
        box(MAROON, 19.2, 2.35, 2.82, 0, 2.33, 0), // the body
        box(ROOF, 19.2, 0.18, 2.7, 0, 3.6, 0), box(ROOF, 19.0, 0.12, 2.2, 0, 3.75, 0), // the roof
        box(STEEL, 0.3, 1.9, 1.0, 9.65, 2.3, 0), box(STEEL, 0.3, 1.9, 1.0, -9.65, 2.3, 0) // the gangways
    ];
    // a row of windows each side
    for (let k = 0; k < 8; k++) parts.push(box(GLASS, 1.4, 0.8, 2.86, -7.7 + k * 2.2, 2.6, 0));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

/** A wheel of radius r with a spoke bar across it (so it shows turning), its axle across the track (z). */
function wheelGeometry(r: number, seg: number, counterweight: boolean): THREE.BufferGeometry {
    const parts = [
        paint(new THREE.CylinderGeometry(r, r, 0.13, seg).rotateX(Math.PI / 2), counterweight ? BLACK : UNDER),
        paint(new THREE.BoxGeometry(2 * r * 0.9, 0.08, 0.15), counterweight ? RED : STEEL)
    ];
    if (counterweight) parts.push(paint(new THREE.BoxGeometry(0.5 * r, 0.35 * r, 0.16).translate(-0.55 * r, 0, 0), BLACK));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
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
    private readonly p: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    private readonly frame = new THREE.Matrix4();
    private readonly m = new THREE.Matrix4();
    private readonly r = new THREE.Matrix4();
    private readonly c = new THREE.Color();
    private readonly life: number;
    private readonly slots: number;

    constructor(private readonly kit: Kit = FULL_KIT) {
        this.group.name = 'train';
        // super low spec: shorter-lived smoke (fewer puffs to draw)
        this.life = kit.graphics === 'super' ? 4 : LIFE_S;
        this.slots = Math.ceil((this.life * 1000) / SLOT) + 1;
    }

    /** A new train (or none). */
    rebuild(train: Train | null): void {
        for (const o of [...this.group.children]) {
            this.group.remove(o);
            const mesh = o as THREE.Mesh;
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        }
        this.bodies = [];
        this.drivers = this.small = this.rods = this.smoke = null;
        this.train = train;
        if (!train) return;
        const shadow = !this.kit.lowSpec;
        const seg = this.kit.seg;
        // one material for the whole train, one geometry per kind of vehicle (the coaches share theirs)
        const mat = this.kit.lit({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
        const geo = { loco: locoGeometry(seg), tender: tenderGeometry(), coach: coachGeometry() };
        for (const v of train.vehicles) {
            const mesh = new THREE.Mesh(geo[v.kind], mat);
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
        this.smoke = this.instanced('smoke', puff, this.slots, false, this.kit.lit({ color: 0xffffff, roughness: 1 }));
        this.smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.slots * 3), 3);
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

    /** The vehicle frame for place p: x along the heading, z to its right, y up. */
    private frameOf(p: Place): THREE.Matrix4 {
        return this.frame.set(
            p.hx, 0, -p.hz, p.x,
            0, 1, 0, p.y,
            p.hz, 0, p.hx, p.z,
            0, 0, 0, 1);
    }

    /** Draw the train at `tick` (fractions too). */
    update(tick: number): void {
        const tr = this.train;
        if (!tr) return;
        const st = tr.state(tick, this.st);
        const nd = 2 * DRIVERS.length;
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
            // the coupling rods: carried round on the crank pins, staying level
            for (const [j, side] of [[0, -1], [1, 1]]) {
                const th = -turnD + (side > 0 ? Math.PI / 2 : 0);
                this.m.makeTranslation((DRIVERS[0] + DRIVERS[2]) / 2 + CRANK * Math.cos(th), RAIL_TOP + DRIVER_R + CRANK * Math.sin(th), side * ROD_S);
                this.rods!.setMatrixAt(j, this.r.multiplyMatrices(f, this.m));
            }
        });
        this.drivers!.count = nd;
        for (const m of [this.drivers!, this.small!, this.rods!]) m.instanceMatrix.needsUpdate = true;
        this.updateSmoke(tr, tick);
    }

    /**
     * The smoke at `tick`: puff k leaves the chimney at tick k * SLOT if the engine exhausted then (a beat since the slot
     * before while moving: four per turn of the coupled wheels), or every half second as a wisp while it stands. It
     * rises fast, slows, swells and drifts on the breeze, lighter as it thins, and shrinks away at the end of its life.
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
            const x0 = p.x + p.hx * CHIMNEY.f, z0 = p.z + p.hz * CHIMNEY.f;
            // up: the blast, slowing over about 1.5 s, then the warm smoke's own slow rise
            const w0 = 1 + 2.5 * strength;
            let y = CHIMNEY.y + w0 * 1.2 * (1 - Math.exp(-age / 1.2)) + 0.3 * age;
            // along: the train's speed it left with, lost to the air in under a second; and the breeze
            const carry = st.v * 0.4 * (1 - Math.exp(-age / 0.4));
            let x = x0 + p.hx * carry + BREEZE.x * age;
            let z = z0 + p.hz * carry + BREEZE.z * age;
            // swells to about four times its size, then thins away over the last 40 % of its life
            let r = (0.25 + 0.3 * strength) * (1 + 0.45 * age) * Math.min(1, 0.5 + age * 5) * Math.min(1, (this.life - age) / (0.4 * this.life));
            // in the tunnel the smoke stays under the arch and spreads along it
            if (x0 > t.x0 && x0 < t.x1 && Math.abs(z0 - t.z) < t.halfWidth) {
                y = Math.min(y, t.crown - 0.6 * Math.min(r, t.halfWidth));
                x = x0 + p.hx * carry;
                z = z0;
                r = Math.min(r, t.halfWidth);
            }
            if (r <= 0.01) continue;
            this.m.makeScale(r, r * 0.85, r).setPosition(x, y, z);
            sm.setMatrixAt(n, this.m);
            this.c.copy(SMOKE_DARK).lerp(SMOKE_LIGHT, Math.min(1, age / 2.5 + (1 - strength) * 0.6));
            sm.setColorAt(n, this.c);
            n++;
        }
        sm.count = n;
        sm.instanceMatrix.needsUpdate = true;
        if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    }
}
