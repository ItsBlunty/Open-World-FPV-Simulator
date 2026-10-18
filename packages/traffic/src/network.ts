// The network traffic model (signals on): signalled junctions on the city grid, cars that follow each
// other, queue at red lights and turn at junctions, and people who walk the sidewalks, wait at the
// crossings and cross on the walk signal.
//
// It is a small simulation stepped every STEP_TICKS sim ticks (20 Hz), in lockstep with the sim tick:
// the state at step k is a function of k alone (it starts from the same seeded state every time and
// sees nothing of the quad), so replays stay exact. A mover's place at a tick between steps is
// interpolated between the two steps around it. Going back in time restarts from a checkpoint.
//
// Junctions (a design, not a measured city): one lane each way, LANE m right of the centre line. Each
// junction runs a fixed 60 s cycle: north-south green, then east-west green, then an all-way walk for
// people ("scramble"), with yellow and all-red between. Cars go straight or turn right; a left turn only
// where there is no road straight ahead (so never across oncoming traffic). No car movement crosses
// another one in the same phase, and people only cross while every car has red, so nothing needs to
// yield. A car does not enter a junction it cannot leave ("don't block the box").
//
// Car following: the Intelligent Driver Model (Treiber, Hennecke, Helbing 2000, Phys. Rev. E 62, 1805)
// with typical urban parameters [estimates]. Determinism: + - * /, Math.sqrt, Math.floor, Math.imul.

import type { Level } from '@owfpv/maps';
import { pathThrough, placeAt } from './route';
import type { Place, Route } from './route';
import { CAR, DT } from './model';
import type { Lamp, Mover, SignalHead, StaticBox, TrafficConfig, TrafficModel } from './model';

/** Sim ticks per traffic step (20 Hz), and the step in seconds */
const STEP_TICKS = 50;
const STEP = STEP_TICKS * DT;
/** a checkpoint of the whole state every this many steps (60 s), for going back in time */
const CHECKPOINT_STEPS = 1200;

/** Lane centre right of the road's centre line, m; stop line (a stopped car's front) from the junction centre, m */
const LANE = 4;
const STOP = 13;
/** Turn radii through a junction, m, and the sideways acceleration that sets the speed in them, m/s^2 [estimates] */
const R_RIGHT = 6;
const R_LEFT = 10;
const A_LAT = 2.5;
/** Fastest straight through a junction and along a road: 50 km/h, a common urban limit */
const V_ROAD = 13.9;

/** IDM: max acceleration, comfortable braking, jam gap, time headway; braking a car will use to stop on yellow [estimates] */
const IDM_A = 1.5;
const IDM_B = 2.5;
const IDM_S0 = 2;
const IDM_T = 1.2;
const B_YELLOW = 4;
/** an emergency stop never brakes harder than this, m/s^2 */
const ACC_MIN = -9;
/** a car shows brake lights below this acceleration, m/s^2 */
const BRAKE_LIGHTS = -0.8;
/** a stopped car's front this far before the stop line, m */
const STOP_MARGIN = 0.3;

/** Signal cycle (ms of sim time) [design choices]: green, yellow, all-red per car phase, then walk, flashing, all-red */
const CYCLE = 60000;
const NS_G = 15000, NS_Y = 18000, NS_R = 20000;
const EW_G = 35000, EW_Y = 38000, EW_R = 40000;
const PED_W = 46000, PED_F = 58000;

/** People: corner hub in from both kerbs, crossing ends in from the kerb, sidewalk lane offset, queue spacing, m */
const HUB_IN = 1.3;
const CROSS_IN = 0.6;
const CROSS_ALONG = 1.5;
const WALK_OFF = 0.3;
const QUEUE = 0.7;
const CROSS_OFF = 0.35;
/** the fastest a person crosses, m/s: the flashing phase (12 s) must see a road (19 m) crossed */
const V_CROSS_MIN = 1.5;
/**
 * A car this far along a link leaving a junction (its centre, from the link's start STOP m out) still counts as
 * in the junction for people about to cross: its back is then STOP + CLEAR_S - bodyHalfL = 15 m from the
 * junction's centre, 4 m past the crossing (half a road + CROSS_ALONG = 11 m on the first map's 19 m roads).
 */
const CLEAR_S = 4;

/** Headings: 0 east (+x), 1 south (+z), 2 west (-x), 3 north (-z); right of heading k is heading k + 1. */
const DX = [1, 0, -1, 0];
const DZ = [0, 1, 0, -1];

interface Elem {
    route: Route;
    len: number;
    link: boolean;
    /** link: the junction it ends at; movement: its junction */
    j: number;
    /** heading in (a link's heading) */
    dir: number;
    /** movement: the link it leaves on */
    out: number;
    /** link: the movements at its end; movement: all the movements from its link (itself included) */
    moves: number[];
    vmax: number;
    /** movement: how far along it the turn is done (0 straight), so cars on it and its siblings are apart */
    split: number;
    /** link: the movements that lead onto it */
    feeders: number[];
}

interface Crossing {
    j: number;
    /** the corner hubs at each end (A, B) */
    hA: number;
    hB: number;
    /** crossing ends on each kerb, and the unit direction from A to B */
    ax: number;
    az: number;
    bx: number;
    bz: number;
    dx: number;
    dz: number;
}

/** what a signal head shows: car heads by approach axis, walk heads by junction */
interface HeadRef {
    j: number;
    axis: number;
    walk: boolean;
}

/** Mulberry32 on one cell of a state array, so every agent draws its own sequence and checkpoints keep it. */
function draw(st: Uint32Array, i: number): number {
    st[i] = (st[i] + 0x6d2b79f5) >>> 0;
    let t = st[i];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
}

// per-car state slots
const C_E = 0, C_S = 1, C_V = 2, C_GO = 3, C_NEXT = 4, C_ACC = 5, C_V0 = 6, CN = 7;
// per-person state slots: phase (0 to a hub, 1 to a crossing queue, 2 waiting, 3 crossing, 4 to a hub after crossing),
// edge from a to b, distance along it, speed, base speed, target hub, previous hub (or -1 - crossing), crossing, side,
// queue row, kerb distance (crossing), lane offset
const P_PH = 0, P_AX = 1, P_AZ = 2, P_BX = 3, P_BZ = 4, P_LEN = 5, P_S = 6, P_V = 7, P_VB = 8, P_H = 9, P_PREV = 10;
const P_C = 11, P_SIDE = 12, P_ROW = 13, P_KERB = 14, P_OFF = 15, PN = 16;

interface Checkpoint {
    step: number;
    cars: Float64Array;
    people: Float64Array;
    rngCar: Uint32Array;
    rngPeople: Uint32Array;
}

export class NetTraffic implements TrafficModel {
    readonly config: TrafficConfig;
    readonly movers: Mover[] = [];
    readonly maxSpeed = V_ROAD;
    readonly signals: SignalHead[] = [];
    private readonly heads: HeadRef[] = [];

    // the grid
    private readonly xs: number[];
    private readonly zs: number[];
    private readonly half: number;
    private readonly walkY: number;
    private readonly offset: number[] = [];
    private readonly elems: Elem[] = [];
    /** link leaving junction j with heading k: linkOf[j * 4 + k], -1 none */
    private readonly linkOf: number[] = [];
    /** the movements through each junction */
    private readonly movesAt: number[][] = [];
    /** links no car enters (by link index, which is the element index): see buildRoads */
    private readonly dead: boolean[] = [];
    private readonly statics: StaticBox[][] = [];

    // people's network
    private readonly hubX: number[] = [];
    private readonly hubZ: number[] = [];
    private readonly crossings: Crossing[] = [];
    /** crossings at each hub */
    private readonly crossAt: number[][] = [];

    // state
    private readonly nCars: number;
    private readonly nPeople: number;
    private cars: Float64Array;
    private people: Float64Array;
    private rngCar: Uint32Array;
    private rngPeople: Uint32Array;
    private lists: number[][] = [];
    private readonly checkpoints: Checkpoint[] = [];
    /** the step the current state is at; places of the step before (prev) and of this one (cur), 5 per mover */
    private cur = 0;
    private prevPl: Float64Array;
    private curPl: Float64Array;
    private readonly tmp: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };

    constructor(level: Level, config: TrafficConfig) {
        this.config = { cars: config.cars, people: config.people, signals: true };
        const b0 = level.blocks;
        // the grid: road centre lines half a road outside the blocks (city blocks on a regular grid)
        let gap = Infinity;
        const x0s = [...new Set(b0.map((b) => b.x0))].sort((a, b) => a - b);
        const x1s = [...new Set(b0.map((b) => b.x1))].sort((a, b) => a - b);
        for (let i = 1; i < x0s.length; i++) gap = Math.min(gap, x0s[i] - x1s[i - 1]);
        this.half = gap / 2;
        const h = this.half;
        this.xs = [...new Set([...x0s.map((x) => x - h), ...x1s.map((x) => x + h)])].sort((a, b) => a - b);
        this.zs = [...new Set([...b0.map((b) => b.z0 - h), ...b0.map((b) => b.z1 + h)])].sort((a, b) => a - b);
        this.walkY = b0.length ? b0[0].y : 0.15;
        const nx = this.xs.length, nz = this.zs.length;
        for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) this.offset.push(((ix * 13 + iz * 29) % 60) * 1000);
        this.buildRoads();
        this.buildSignals();
        this.buildWalks(level);

        // the starting state: one draw sequence each for cars and people, so either toggle leaves the other as it was
        const carRng = new Uint32Array([0xca75]);
        const startCars: number[][] = [];
        for (let e = 0; e < this.elems.length; e++) {
            const el = this.elems[e];
            if (!el.link) continue;
            const take = draw(carRng, 0) % 100 < 55;
            const s = 5 + (draw(carRng, 0) % 1000) / 1000 * (el.len - 20);
            const v0 = 9 + (draw(carRng, 0) % 31) / 10; // 32-43 km/h
            const seed = draw(carRng, 0);
            const look = draw(carRng, 0);
            if (take && config.cars && !this.dead[e]) startCars.push([e, s, v0, seed, look]);
        }
        const pRng = new Uint32Array([0x9e0f1e]);
        const startPeople: number[][] = [];
        for (let b = 0; b < b0.length; b++) for (let c = 0; c < 4; c++) {
            const n = draw(pRng, 0) % 3;
            for (let k = 0; k < n; k++) {
                const fwd = draw(pRng, 0) % 2 === 0;
                const u = (draw(pRng, 0) % 1000) / 1000;
                const vb = 1.1 + (draw(pRng, 0) % 6) / 10; // 1.1-1.6 m/s
                const seed = draw(pRng, 0);
                const look = draw(pRng, 0);
                const ha = b * 4 + c, hb = b * 4 + ((c + 1) % 4);
                if (config.people) startPeople.push(fwd ? [ha, hb, u, vb, seed, look] : [hb, ha, u, vb, seed, look]);
            }
        }
        this.nCars = startCars.length;
        this.nPeople = startPeople.length;
        this.cars = new Float64Array(this.nCars * CN);
        this.people = new Float64Array(this.nPeople * PN);
        this.rngCar = new Uint32Array(this.nCars);
        this.rngPeople = new Uint32Array(this.nPeople);
        for (const e of this.elems) this.lists.push([]);
        startCars.forEach(([e, s, v0, seed, look], i) => {
            this.movers.push({ kind: 'car', v: v0, look });
            this.rngCar[i] = seed;
            const o = i * CN;
            this.cars[o + C_S] = s;
            this.cars[o + C_V0] = v0;
            this.enter(i, e);
        });
        startPeople.forEach(([ha, hb, u, vb, seed, look], i) => {
            this.movers.push({ kind: 'person', v: Math.max(vb * 1.15, V_CROSS_MIN), look });
            this.rngPeople[i] = seed;
            const o = i * PN;
            this.people[o + P_VB] = vb;
            this.walkEdge(i, 0, this.hubX[ha], this.hubZ[ha], this.hubX[hb], this.hubZ[hb], vb, WALK_OFF);
            this.people[o + P_S] = u * this.people[o + P_LEN];
            this.people[o + P_H] = hb;
            this.people[o + P_PREV] = ha;
        });
        const n = this.movers.length;
        this.prevPl = new Float64Array(n * 5);
        this.curPl = new Float64Array(n * 5);
        this.save();
        this.placesInto(this.curPl);
        this.prevPl.set(this.curPl);
    }

    // ------------------------------------------------------------ layout

    private jid(ix: number, iz: number): number {
        return iz * this.xs.length + ix;
    }

    private jx(j: number): number {
        return this.xs[j % this.xs.length];
    }

    private jz(j: number): number {
        return this.zs[Math.floor(j / this.xs.length)];
    }

    /** the junction next to j in heading k, -1 at the grid's edge */
    private neighbour(j: number, k: number): number {
        const nx = this.xs.length;
        const ix = (j % nx) + DX[k], iz = Math.floor(j / nx) + DZ[k];
        return ix < 0 || iz < 0 || ix >= nx || iz >= this.zs.length ? -1 : this.jid(ix, iz);
    }

    /** a point at d along heading k and r to its right from junction j */
    private at2(j: number, k: number, d: number, r: number): [number, number] {
        const rk = (k + 1) % 4;
        return [this.jx(j) + DX[k] * d + DX[rk] * r, this.jz(j) + DZ[k] * d + DZ[rk] * r];
    }

    private buildRoads(): void {
        const nJ = this.xs.length * this.zs.length;
        for (let j = 0; j < nJ; j++) for (let k = 0; k < 4; k++) {
            const n = this.neighbour(j, k);
            if (n < 0) { this.linkOf.push(-1); continue; }
            const a = this.at2(j, k, STOP, LANE), b = this.at2(n, k, -STOP, LANE);
            const route = pathThrough([a, b], 0, false, 0);
            this.linkOf.push(this.elems.length);
            this.elems.push({ route, len: route.length, link: true, j: n, dir: k, out: -1, moves: [], vmax: V_ROAD, split: 0, feeders: [] });
        }
        for (let j = 0; j < nJ; j++) this.movesAt.push([]);
        // the turns at the end of each link: straight, right, and left only where nothing comes the other way
        const nLinks = this.elems.length;
        const turns: number[][] = [];
        for (let e = 0; e < nLinks; e++) {
            const el = this.elems[e];
            const j = el.j, k = el.dir;
            const ahead = this.linkOf[j * 4 + k];
            turns.push([k, (k + 1) % 4, (k + 3) % 4].filter((out) =>
                this.linkOf[j * 4 + out] >= 0 && !(out === (k + 3) % 4 && ahead >= 0)));
        }
        // Those rules leave a trap: the lane round the grid's edge the other way from the clock can never turn
        // off (right is out of the city, left has oncoming traffic), so cars that joined it would circle it for
        // ever and fill it. A car never turns into a lane from which it cannot reach every other one: a link is
        // dead if it reaches fewer links than the best connected one (only dead links lead on from a dead link).
        const reach = (e0: number): number => {
            const seen = new Uint8Array(nLinks);
            const todo = [e0];
            seen[e0] = 1;
            let n = 1;
            while (todo.length) {
                const e = todo.pop()!, el = this.elems[e];
                for (const out of turns[e]) {
                    const ol = this.linkOf[el.j * 4 + out];
                    if (!seen[ol]) { seen[ol] = 1; n++; todo.push(ol); }
                }
            }
            return n;
        };
        const counts = Array.from({ length: nLinks }, (_, e) => reach(e));
        const most = Math.max(...counts);
        for (let e = 0; e < nLinks; e++) this.dead.push(counts[e] < most);
        // the movements at the end of each live link
        for (let e = 0; e < nLinks; e++) {
            if (this.dead[e]) continue;
            const el = this.elems[e];
            const j = el.j, k = el.dir;
            for (const out of turns[e]) {
                const ol = this.linkOf[j * 4 + out];
                if (this.dead[ol]) continue;
                const p0 = this.at2(j, k, -STOP, LANE), p1 = this.at2(j, out, STOP, LANE);
                let route: Route;
                let vmax = V_ROAD;
                let split = 0;
                if (out === k) route = pathThrough([p0, p1], 0, false, 0);
                else {
                    // the corner where the in and out lane lines meet: LANE back (right turn) or ahead (left)
                    const right = out === (k + 1) % 4;
                    const K = this.at2(j, k, right ? -LANE : LANE, LANE);
                    const R = right ? R_RIGHT : R_LEFT;
                    route = pathThrough([p0, K, p1], R, false, 0);
                    vmax = Math.sqrt(A_LAT * R);
                    // the straight up to the arc, then the quarter circle
                    split = STOP + (right ? -LANE : LANE) - R + R * (Math.PI / 2);
                }
                const m = this.elems.length;
                el.moves.push(m);
                this.movesAt[j].push(m);
                this.elems[ol].feeders.push(m);
                this.elems.push({ route, len: route.length, link: false, j, dir: k, out: ol, moves: el.moves, vmax, split, feeders: [] });
            }
        }
    }

    /**
     * A signal pole at the near-right corner of every approach: a mast arm over its lane with the car head,
     * and two walk heads facing across the two roads at that corner. All of it solid.
     */
    private buildSignals(): void {
        const nJ = this.xs.length * this.zs.length;
        for (let j = 0; j < nJ; j++) this.statics.push([]);
        const h = this.half;
        const box = (j: number, a: [number, number], b: [number, number], y0: number, y1: number): void => {
            this.statics[j].push({ x0: Math.min(a[0], b[0]), y0, z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1, z1: Math.max(a[1], b[1]) });
        };
        for (let j = 0; j < nJ; j++) for (let k = 0; k < 4; k++) {
            const from = this.neighbour(j, (k + 2) % 4);
            if (from < 0 || this.linkOf[from * 4 + k] < 0) continue;
            const pd = -(h + 0.3), pr = h + 0.3; // pole: 0.3 m in from both kerbs of the corner
            box(j, this.at2(j, k, pd - 0.12, pr - 0.12), this.at2(j, k, pd + 0.12, pr + 0.12), this.walkY, 6.0);
            box(j, this.at2(j, k, pd - 0.1, pr), this.at2(j, k, pd + 0.1, LANE - 1.6), 5.65, 5.85);
            box(j, this.at2(j, k, pd - 0.15, LANE - 0.18), this.at2(j, k, pd + 0.15, LANE + 0.18), 4.7, 5.65);
            const face = this.at2(j, k, pd - 0.16, LANE);
            this.signals.push({ kind: 'car', x: face[0], y: 5.15, z: face[1], fx: -DX[k], fz: -DZ[k] });
            this.heads.push({ j, axis: k % 2, walk: false });
            // walk heads: across the approach road (facing left of the heading) and across the cross road (facing ahead)
            const rk = (k + 1) % 4;
            const w1 = this.at2(j, k, pd, pr - 0.22), w2 = this.at2(j, k, pd + 0.22, pr);
            box(j, this.at2(j, k, pd - 0.12, pr - 0.34), this.at2(j, k, pd + 0.12, pr - 0.12), 2.5, 2.9);
            box(j, this.at2(j, k, pd + 0.12, pr - 0.12), this.at2(j, k, pd + 0.34, pr + 0.12), 2.5, 2.9);
            this.signals.push({ kind: 'walk', x: w1[0] - DX[rk] * 0.13, y: 2.7, z: w1[1] - DZ[rk] * 0.13, fx: -DX[rk], fz: -DZ[rk] });
            this.heads.push({ j, axis: 0, walk: true });
            this.signals.push({ kind: 'walk', x: w2[0] + DX[k] * 0.13, y: 2.7, z: w2[1] + DZ[k] * 0.13, fx: DX[k], fz: DZ[k] });
            this.heads.push({ j, axis: 0, walk: true });
        }
    }

    private buildWalks(level: Level): void {
        // hubs: one per block corner (NW, NE, SE, SW), in from both kerbs
        const corner = new Map<string, number>();
        const SX = [-1, 1, 1, -1], SZ = [-1, -1, 1, 1];
        level.blocks.forEach((b, bi) => {
            for (let c = 0; c < 4; c++) {
                const kx = SX[c] < 0 ? b.x0 : b.x1, kz = SZ[c] < 0 ? b.z0 : b.z1;
                this.hubX.push(kx - SX[c] * HUB_IN);
                this.hubZ.push(kz - SZ[c] * HUB_IN);
                this.crossAt.push([]);
                corner.set(`${kx},${kz}`, bi * 4 + c);
            }
        });
        const h = this.half;
        level.blocks.forEach((b, bi) => {
            for (let c = 0; c < 4; c++) {
                const sx = SX[c], sz = SZ[c];
                const kx = sx < 0 ? b.x0 : b.x1, kz = sz < 0 ? b.z0 : b.z1;
                const hA = bi * 4 + c;
                const jx = kx + sx * h, jz = kz + sz * h;
                const j = this.jid(this.xs.indexOf(jx), this.zs.indexOf(jz));
                // across the road beside the corner in x, then in z; each crossing once, from its lower hub
                const across: [number, number, number, number, number, number][] = [
                    [kx + sx * 2 * h, kz, kx - sx * CROSS_IN, kz - sz * CROSS_ALONG, sx, 0],
                    [kx, kz + sz * 2 * h, kx - sx * CROSS_ALONG, kz - sz * CROSS_IN, 0, sz]
                ];
                for (const [ox, oz, ax, az, dx, dz] of across) {
                    const hB = corner.get(`${ox},${oz}`);
                    if (hB === undefined || hB < hA) continue;
                    const bx = ax + dx * (2 * h + 2 * CROSS_IN), bz = az + dz * (2 * h + 2 * CROSS_IN);
                    const id = this.crossings.length;
                    this.crossings.push({ j, hA, hB, ax, az, bx, bz, dx, dz });
                    this.crossAt[hA].push(id);
                    this.crossAt[hB].push(id);
                }
            }
        });
    }

    // ------------------------------------------------------------ signals

    /** Car signal for an approach axis (0 east-west, 1 north-south) at junction j and tick. */
    carSignal(j: number, axis: number, tick: number): 'red' | 'yellow' | 'green' {
        const c = (Math.floor(tick) + this.offset[j]) % CYCLE;
        if (axis === 1) return c < NS_G ? 'green' : c < NS_Y ? 'yellow' : 'red';
        if (c < NS_R) return 'red';
        return c < EW_G ? 'green' : c < EW_Y ? 'yellow' : 'red';
    }

    /** ms of yellow left for an approach axis at junction j and tick (only meaningful while it shows yellow) */
    private yellowLeft(j: number, axis: number, tick: number): number {
        const c = (Math.floor(tick) + this.offset[j]) % CYCLE;
        return (axis === 1 ? NS_Y : EW_Y) - c;
    }

    walkSignal(j: number, tick: number): 'walk' | 'flash' | 'stop' {
        const c = (Math.floor(tick) + this.offset[j]) % CYCLE;
        if (c < EW_R) return 'stop';
        return c < PED_W ? 'walk' : c < PED_F ? 'flash' : 'stop';
    }

    lamp(h: number, tick: number): Lamp {
        const r = this.heads[h];
        return r.walk ? this.walkSignal(r.j, tick) : this.carSignal(r.j, r.axis, tick);
    }

    staticsNear(x: number, z: number, reach: number): readonly StaticBox[] {
        const lim = this.half + 4 + reach;
        let ix = -1, iz = -1;
        for (let i = 0; i < this.xs.length; i++) if (Math.abs(x - this.xs[i]) <= lim) { ix = i; break; }
        for (let i = 0; i < this.zs.length; i++) if (Math.abs(z - this.zs[i]) <= lim) { iz = i; break; }
        return ix < 0 || iz < 0 ? [] : this.statics[this.jid(ix, iz)];
    }

    // ------------------------------------------------------------ for tests

    /** What mover i is doing at the current step: a car's element, junction, approach axis, distance and speed; a person's phase and crossing junction. */
    inspect(i: number): { link: boolean; j: number; axis: number; s: number; v: number; phase: number } {
        if (i < this.nCars) {
            const o = i * CN, el = this.elems[this.cars[o + C_E]];
            return { link: el.link, j: el.j, axis: el.dir % 2, s: this.cars[o + C_S], v: this.cars[o + C_V], phase: -1 };
        }
        const o = (i - this.nCars) * PN;
        const ph = this.people[o + P_PH];
        return { link: false, j: ph >= 1 && ph <= 3 ? this.crossings[this.people[o + P_C]].j : -1, axis: -1, s: this.people[o + P_S], v: this.people[o + P_V], phase: ph };
    }

    /** Every path a mover can take: car lanes and turns, and people's sidewalk, queue and crossing edges (y: the ground). */
    paths(): { kind: 'car' | 'walk'; route: Route }[] {
        const out: { kind: 'car' | 'walk'; route: Route }[] = this.elems.map((e) => ({ kind: 'car' as const, route: e.route }));
        const walk = (a: [number, number], b: [number, number], y: number): void => {
            out.push({ kind: 'walk', route: pathThrough([a, b], 0, false, y) });
        };
        const nHub = this.hubX.length;
        for (let h = 0; h < nHub; h++) {
            const blk = Math.floor(h / 4), c = h % 4;
            const n = blk * 4 + ((c + 1) % 4);
            // both directions of a side, each WALK_OFF to its right
            for (const [a, b] of [[h, n], [n, h]]) {
                const ax = this.hubX[a], az = this.hubZ[a], bx = this.hubX[b], bz = this.hubZ[b];
                const l = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
                const rx = -(bz - az) / l * WALK_OFF, rz = (bx - ax) / l * WALK_OFF;
                walk([ax + rx, az + rz], [bx + rx, bz + rz], this.walkY);
            }
        }
        this.crossings.forEach((x, cid) => {
            for (const side of [0, 1]) for (const row of [0, 1]) {
                const h = side ? x.hB : x.hA;
                const a = this.slot(cid, side, row, false), b = this.slot(cid, side, row, true);
                walk([this.hubX[h], this.hubZ[h]], a, this.walkY);
                walk(a, b, 0.0);
            }
        });
        return out;
    }

    /** Every fixed box of the signals. */
    allStatics(): StaticBox[] {
        return this.statics.flat();
    }

    // ------------------------------------------------------------ time

    at(tick: number): void {
        const need = Math.floor(tick / STEP_TICKS) + 1;
        if (need < this.cur) this.restore(need - 1);
        while (this.cur < need) {
            const t = this.prevPl;
            this.prevPl = this.curPl;
            this.curPl = t;
            this.step();
            this.cur++;
            if (this.cur % CHECKPOINT_STEPS === 0 && this.checkpoints[this.checkpoints.length - 1].step < this.cur) this.save();
            this.placesInto(this.curPl);
        }
    }

    place(i: number, tick: number, out: Place): Place {
        let f = (tick - (this.cur - 1) * STEP_TICKS) / STEP_TICKS;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const a = this.prevPl, b = this.curPl, o = i * 5;
        out.x = a[o] + (b[o] - a[o]) * f;
        out.y = a[o + 1] + (b[o + 1] - a[o + 1]) * f;
        out.z = a[o + 2] + (b[o + 2] - a[o + 2]) * f;
        let hx = a[o + 3] + (b[o + 3] - a[o + 3]) * f;
        let hz = a[o + 4] + (b[o + 4] - a[o + 4]) * f;
        const l = Math.sqrt(hx * hx + hz * hz);
        if (l > 1e-9) { hx /= l; hz /= l; } else { hx = b[o + 3]; hz = b[o + 4]; }
        out.hx = hx;
        out.hz = hz;
        return out;
    }

    braking(i: number): boolean {
        return i < this.nCars && this.cars[i * CN + C_ACC] < BRAKE_LIGHTS;
    }

    private save(): void {
        this.checkpoints.push({ step: this.cur, cars: this.cars.slice(), people: this.people.slice(), rngCar: this.rngCar.slice(), rngPeople: this.rngPeople.slice() });
    }

    /** Back to the latest checkpoint at or before `step`, then forward to it, so prev holds that step's places. */
    private restore(step: number): void {
        let c = this.checkpoints[0];
        for (const k of this.checkpoints) if (k.step <= step) c = k;
        this.cars = c.cars.slice();
        this.people = c.people.slice();
        this.rngCar = c.rngCar.slice();
        this.rngPeople = c.rngPeople.slice();
        this.cur = c.step;
        // the queues follow from the state: on each element, the furthest along first (ties by index)
        for (const l of this.lists) l.length = 0;
        for (let i = 0; i < this.nCars; i++) this.lists[this.cars[i * CN + C_E]].push(i);
        for (const l of this.lists) l.sort((a, b) => this.cars[b * CN + C_S] - this.cars[a * CN + C_S] || a - b);
        this.placesInto(this.curPl);
        while (this.cur < step) {
            this.step();
            this.cur++;
            this.placesInto(this.curPl);
        }
    }

    private placesInto(out: Float64Array): void {
        const p = this.tmp;
        for (let i = 0; i < this.nCars; i++) {
            const o = i * CN;
            placeAt(this.elems[this.cars[o + C_E]].route, this.cars[o + C_S], p, true);
            out.set([p.x, p.y, p.z, p.hx, p.hz], i * 5);
        }
        for (let q = 0; q < this.nPeople; q++) {
            this.personPlace(q, p);
            out.set([p.x, p.y, p.z, p.hx, p.hz], (this.nCars + q) * 5);
        }
    }

    // ------------------------------------------------------------ cars

    private step(): void {
        const tick = this.cur * STEP_TICKS;
        if (this.nCars > 0) this.stepCars(tick);
        if (this.nPeople > 0) this.stepPeople(tick);
    }

    /** A car enters element e (at its current distance along it). */
    private enter(i: number, e: number): void {
        const c = this.cars, o = i * CN;
        c[o + C_E] = e;
        const list = this.lists[e];
        let k = list.length;
        while (k > 0 && c[list[k - 1] * CN + C_S] < c[o + C_S]) k--;
        list.splice(k, 0, i);
        const el = this.elems[e];
        if (el.link) {
            const mv = el.moves;
            // straight ahead three times in five where there is a choice [design choice]
            let pick = mv[0];
            if (mv.length > 1) {
                const straight = mv.find((m) => this.elems[m].vmax === V_ROAD);
                const u = draw(this.rngCar, i) % 100;
                if (straight !== undefined && u < 60) pick = straight;
                else {
                    const turns = mv.filter((m) => m !== straight);
                    pick = turns[draw(this.rngCar, i) % turns.length];
                }
            }
            c[o + C_NEXT] = pick;
            c[o + C_GO] = 0;
        } else {
            c[o + C_NEXT] = el.out;
        }
    }

    private stopPos(e: number): number {
        return this.elems[e].len - CAR.bodyHalfL - STOP_MARGIN;
    }

    private last(e: number): number {
        const l = this.lists[e];
        return l.length ? l[l.length - 1] : -1;
    }

    /** Room on link e for one more car at its start, counting the cars in the junction already headed onto it. */
    private room(e: number): boolean {
        const i = this.last(e);
        let free = i < 0 ? this.elems[e].len : this.cars[i * CN + C_S];
        for (const m of this.elems[e].feeders) free -= this.lists[m].length * (2 * CAR.bodyHalfL + IDM_S0);
        return free >= 2 * CAR.bodyHalfL + IDM_S0 + 1;
    }

    /** No car is in junction j on a movement of the other axis (crossing traffic still clearing the box). */
    private boxClear(j: number, axis: number): boolean {
        for (const m of this.movesAt[j]) if (this.elems[m].dir % 2 !== axis && this.lists[m].length) return false;
        return true;
    }

    private stepCars(tick: number): void {
        const c = this.cars;
        // The front car of each link decides at every step whether it goes through the junction (C_GO 1), until
        // it is too close to stop comfortably: then it is committed (C_GO 2) and goes whatever the light does.
        // A car close enough to commit on green reaches the junction within the 3 s yellow (a stopped car in
        // 1.8 s, one at 50 km/h through its 24 m stopping distance in 1.9 s). On yellow a car goes only if it cannot stop
        // comfortably and gets into the junction before red; otherwise it stops.
        for (let e = 0; e < this.elems.length; e++) {
            const el = this.elems[e];
            if (!el.link || this.lists[e].length === 0) continue;
            const i = this.lists[e][0], o = i * CN;
            if (c[o + C_GO] === 2) continue;
            const axis = el.dir % 2;
            const sig = this.carSignal(el.j, axis, tick);
            const v = c[o + C_V];
            const toStop = this.stopPos(e) - c[o + C_S];
            const stopDist = (v * v) / (2 * B_YELLOW);
            let go = false;
            if (sig !== 'red' && this.room(this.elems[c[o + C_NEXT]].out) && this.boxClear(el.j, axis)) {
                if (sig === 'green') go = true;
                else go = toStop < stopDist && el.len - c[o + C_S] < v * (this.yellowLeft(el.j, axis, tick) * 0.001 - STEP);
            }
            c[o + C_GO] = !go ? 0 : toStop <= stopDist ? 2 : 1;
        }
        for (let i = 0; i < this.nCars; i++) c[i * CN + C_ACC] = this.idm(i);
        for (let i = 0; i < this.nCars; i++) {
            const o = i * CN;
            const v = c[o + C_V];
            let v1 = v + c[o + C_ACC] * STEP;
            if (v1 < 0) v1 = 0;
            c[o + C_S] += (v + v1) * 0.5 * STEP;
            c[o + C_V] = v1;
            const e = c[o + C_E];
            if (this.elems[e].link && c[o + C_GO] === 0 && c[o + C_S] > this.stopPos(e)) {
                c[o + C_S] = this.stopPos(e);
                c[o + C_V] = 0;
            }
        }
        // onto the next element, the furthest along first
        for (let e = 0; e < this.elems.length; e++) {
            const list = this.lists[e];
            const len = this.elems[e].len;
            while (list.length && c[list[0] * CN + C_S] >= len) {
                const i = list.shift()!;
                c[i * CN + C_S] -= len;
                this.enter(i, c[i * CN + C_NEXT]);
            }
        }
    }

    /**
     * The car nearest ahead of distance s on movement m (other than car `self`): on m itself, or on another
     * movement from the same lane while the follower or that car has not finished its turn. -1 if none.
     */
    private ahead(m: number, s: number, self: number): number {
        const c = this.cars, split = this.elems[m].split;
        let best = -1, bs = Infinity;
        for (const mv of this.elems[m].moves) {
            const list = this.lists[mv], sp = this.elems[mv].split;
            // lists run furthest along first: the nearest ahead is the last one past s
            for (let k = list.length - 1; k >= 0; k--) {
                const l = list[k], sl = c[l * CN + C_S];
                if (l === self || sl < s) continue;
                if ((mv === m || s < split || sl < sp) && sl < bs) { best = l; bs = sl; }
                break;
            }
        }
        return best;
    }

    /** The Intelligent Driver Model's acceleration for car i: its leader, or the stop line, or the open road. */
    private idm(i: number): number {
        const c = this.cars, o = i * CN;
        const e = c[o + C_E], el = this.elems[e];
        const s = c[o + C_S], v = c[o + C_V];
        const list = this.lists[e];
        const pos = list.indexOf(i);
        const L = 2 * CAR.bodyHalfL;
        let gap = 1e9, vl = v;
        if (el.link && pos > 0) {
            const l = list[pos - 1];
            gap = c[l * CN + C_S] - s - L;
            vl = c[l * CN + C_V];
        } else if (el.link && c[o + C_GO] === 0) {
            gap = this.stopPos(e) - s + IDM_S0;
            vl = 0;
        } else {
            // in or into a junction: the nearest car ahead on this movement or, while either is still turning,
            // on another movement from the same lane (their paths start together); then the link after it
            const m = el.link ? c[o + C_NEXT] : e;
            const sm = el.link ? s - el.len : s;
            const l = this.ahead(m, sm, i);
            const me = this.elems[m];
            if (l >= 0) {
                gap = c[l * CN + C_S] - sm - L;
                vl = c[l * CN + C_V];
            } else {
                const l2 = this.last(me.out);
                if (l2 >= 0) {
                    gap = me.len - sm + c[l2 * CN + C_S] - L;
                    vl = c[l2 * CN + C_V];
                }
            }
        }
        // the speed it wants: its own, the element's limit, and slowing in time for the next one's
        let v0 = Math.min(c[o + C_V0], el.vmax);
        const vn = this.elems[c[o + C_NEXT]].vmax;
        const lim = Math.sqrt(vn * vn + 2 * IDM_B * Math.max(0, el.len - s));
        if (lim < v0) v0 = lim;
        const sStar = IDM_S0 + Math.max(0, v * IDM_T + (v * (v - vl)) / (2 * Math.sqrt(IDM_A * IDM_B)));
        const g = gap > 0.1 ? gap : 0.1;
        const r = v / v0, q = sStar / g;
        const a = IDM_A * (1 - r * r * r * r - q * q);
        return a < ACC_MIN ? ACC_MIN : a;
    }

    // ------------------------------------------------------------ people

    private walkEdge(q: number, phase: number, ax: number, az: number, bx: number, bz: number, v: number, off: number): void {
        const p = this.people, o = q * PN;
        p[o + P_PH] = phase;
        p[o + P_AX] = ax; p[o + P_AZ] = az; p[o + P_BX] = bx; p[o + P_BZ] = bz;
        p[o + P_LEN] = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
        p[o + P_S] = 0;
        p[o + P_V] = v;
        p[o + P_OFF] = off;
    }

    /** Where person q waits (row 0 at the crossing end, row 1 behind) to cross crossing cid from `side`. */
    private slot(cid: number, side: number, row: number, far: boolean): [number, number] {
        const x = this.crossings[cid];
        const dx = side ? -x.dx : x.dx, dz = side ? -x.dz : x.dz;
        const fromA = (side === 0) !== far;
        const ex = fromA ? x.ax : x.bx, ez = fromA ? x.az : x.bz;
        // back from the kerb (into the sidewalk) and to the walker's right, so the two sides pass
        const back = far ? 1 : -1;
        return [ex + dx * back * QUEUE * row - dz * CROSS_OFF, ez + dz * back * QUEUE * row + dx * CROSS_OFF];
    }

    /**
     * A car is still in junction j, or just out of it with its back over a crossing (CLEAR_S along the link
     * leaving it). People do not step off on WALK until it has gone, as people check before crossing.
     */
    private junctionBusy(j: number): boolean {
        for (const m of this.movesAt[j]) if (this.lists[m].length) return true;
        for (let k = 0; k < 4; k++) {
            const e = this.linkOf[j * 4 + k];
            const l = e < 0 ? -1 : this.last(e);
            if (l >= 0 && this.cars[l * CN + C_S] < CLEAR_S) return true;
        }
        return false;
    }

    private stepPeople(tick: number): void {
        const p = this.people;
        for (let q = 0; q < this.nPeople; q++) {
            const o = q * PN;
            const ph = p[o + P_PH];
            if (ph === 2) {
                const cid = p[o + P_C];
                const j = this.crossings[cid].j;
                if (this.walkSignal(j, tick) !== 'walk' || this.junctionBusy(j)) continue;
                const side = p[o + P_SIDE], row = p[o + P_ROW];
                const a = this.slot(cid, side, row, false), b = this.slot(cid, side, row, true);
                this.walkEdge(q, 3, a[0], a[1], b[0], b[1], Math.max(V_CROSS_MIN, p[o + P_VB] * 1.15), 0);
                p[o + P_KERB] = CROSS_IN + QUEUE * row;
                continue;
            }
            p[o + P_S] += p[o + P_V] * STEP;
            if (p[o + P_S] < p[o + P_LEN]) continue;
            p[o + P_S] = p[o + P_LEN];
            if (ph === 1) {
                p[o + P_PH] = 2;
            } else if (ph === 3) {
                const cid = p[o + P_C], x = this.crossings[cid];
                const h = p[o + P_SIDE] ? x.hA : x.hB;
                this.walkEdge(q, 4, p[o + P_BX], p[o + P_BZ], this.hubX[h], this.hubZ[h], p[o + P_VB], 0);
                p[o + P_H] = h;
                p[o + P_PREV] = -1 - cid;
            } else {
                this.choose(q);
            }
        }
    }

    /** Person q is at hub P_H: on along the block, or to a crossing's queue; never straight back. */
    private choose(q: number): void {
        const p = this.people, o = q * PN;
        const h = p[o + P_H], prev = p[o + P_PREV];
        const blk = Math.floor(h / 4), c = h % 4;
        const opts: number[] = [];
        for (const n of [blk * 4 + ((c + 1) % 4), blk * 4 + ((c + 3) % 4)]) if (n !== prev) opts.push(n);
        for (const x of this.crossAt[h]) if (-1 - x !== prev) opts.push(-1 - x);
        const pick = opts[draw(this.rngPeople, q) % opts.length];
        const hx = this.hubX[h], hz = this.hubZ[h];
        if (pick >= 0) {
            this.walkEdge(q, 0, hx, hz, this.hubX[pick], this.hubZ[pick], p[o + P_VB], WALK_OFF);
            p[o + P_H] = pick;
            p[o + P_PREV] = h;
            return;
        }
        const cid = -1 - pick;
        const side = this.crossings[cid].hA === h ? 0 : 1;
        let queued = 0;
        for (let r = 0; r < this.nPeople; r++) {
            const ro = r * PN;
            if ((p[ro + P_PH] === 1 || p[ro + P_PH] === 2) && p[ro + P_C] === cid && p[ro + P_SIDE] === side) queued++;
        }
        const row = queued % 2;
        const s = this.slot(cid, side, row, false);
        this.walkEdge(q, 1, hx, hz, s[0], s[1], p[o + P_VB], 0);
        p[o + P_C] = cid;
        p[o + P_SIDE] = side;
        p[o + P_ROW] = row;
    }

    private personPlace(q: number, out: Place): void {
        const p = this.people, o = q * PN;
        const ax = p[o + P_AX], az = p[o + P_AZ], bx = p[o + P_BX], bz = p[o + P_BZ];
        const len = p[o + P_LEN], s = p[o + P_S];
        let hx = 1, hz = 0;
        if (len > 1e-9) { hx = (bx - ax) / len; hz = (bz - az) / len; }
        const ph = p[o + P_PH];
        if (ph === 2) {
            // waiting: facing across
            const x = this.crossings[p[o + P_C]];
            const sg = p[o + P_SIDE] ? -1 : 1;
            out.x = bx; out.z = bz; out.y = this.walkY;
            out.hx = x.dx * sg; out.hz = x.dz * sg;
            return;
        }
        // on a sidewalk keep to the right, easing in and out at the ends so the path stays continuous
        const ease = Math.min(1, s / 0.6, (len - s) / 0.6);
        const off = p[o + P_OFF] * (ease > 0 ? ease : 0);
        out.x = ax + hx * s - hz * off;
        out.z = az + hz * s + hx * off;
        out.hx = hx;
        out.hz = hz;
        if (ph === 3) {
            // down the kerb, across the road, up the far kerb (over 0.3 m each)
            const d = Math.min(s, len - s);
            let u = (p[o + P_KERB] + 0.15 - d) / 0.3;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            out.y = this.walkY * u;
        } else out.y = this.walkY;
    }
}
