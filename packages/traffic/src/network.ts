// The network traffic model (signals on): signalled junctions on the city grid, cars that follow each
// other, queue at red lights and turn at junctions, and people who walk the sidewalks, wait at the
// crossings and cross on the walk signal, and go in and out of the city buildings' street doors.
//
// It is a small simulation stepped every STEP_TICKS sim ticks (20 Hz), in lockstep with the sim tick:
// the state at step k is a function of k alone (it starts from the same seeded state every time and
// sees nothing of the quad), so replays stay exact. A mover's place at a tick between steps is
// interpolated between the two steps around it. Going back in time restarts from a checkpoint.
//
// Junctions (a design, not a measured city): one lane each way, LANE m right of the centre line. Each
// junction runs a fixed 84 s cycle like a city's: north-south left-turn arrows, north-south straight and
// right, east-west arrows, east-west straight and right, then an all-way walk for people ("scramble"), with
// yellow and all-red between. Cars go straight, turn right or turn left, each on its own light: a left turn
// that crosses an oncoming lane has an arrow, one with nothing oncoming (a T's stem, a corner) goes with the
// straight light. No car movement crosses another one in the same phase (the two opposing left turns pass
// each other), and people only cross while every car has red, so nothing needs to yield: cars only follow
// their light. A car does not enter a junction it cannot leave ("don't block the box").
//
// Car following: the Intelligent Driver Model (Treiber, Hennecke, Helbing 2000, Phys. Rev. E 62, 1805)
// with typical urban parameters [estimates]. Determinism: + - * /, Math.sqrt, Math.floor, Math.imul.

import type { Level } from '@owfpv/maps';
import { pathThrough, placeAt } from './route';
import { COACH, makeTrains, newTrainPlace } from './train';
import type { Train } from './train';
import type { Place, Route } from './route';
import { CAR, DT } from './model';
import type { Lamp, Mover, SignalHead, StaticBox, TrafficConfig, TrafficModel } from './model';

/** Sim ticks per traffic step (20 Hz), and the step in seconds */
const STEP_TICKS = 50;
const STEP = STEP_TICKS * DT;
/** a checkpoint of the whole state every this many steps (60 s), for going back in time */
const CHECKPOINT_STEPS = 1200;

/**
 * Lane centre right of the road's centre line, m (a 5 m wide lane's middle; a car 1.9 m wide), and the stop line (a
 * stopped car's front) from the junction centre, m
 */
const LANE = 2.5;
const STOP = 13;
/**
 * Turn radii through a junction, m, and the sideways acceleration that sets the speed in them, m/s^2 [estimates].
 * A left turn is one smooth quarter circle from just past the stop line into the far lane, so the two opposing left
 * turns on one arrow keep to their own side of the junction's centre and pass each other: their paths 2.9 m either
 * side of it (0.414 STOP - LANE).
 */
const R_RIGHT = 6;
const R_LEFT = STOP + LANE - 0.1;
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

/**
 * Signal cycle (ms of sim time) [design choices]. Car light groups: 0 north-south arrows, 1 north-south straight and
 * right, 2 east-west arrows, 3 east-west straight and right. Each group in turn: green from G0, yellow from Y0, all-red
 * from R0 (until the next group's green); then walk, flashing and all-red for people.
 */
const CYCLE = 84000;
const G0 = [0, 12000, 32000, 44000];
const Y0 = [7000, 27000, 39000, 59000];
const R0 = [10000, 30000, 42000, 62000];
const PED_W = 64000, PED_F = 70000, PED_R = 82000;

/** People: corner hub in from both kerbs, crossing ends in from the kerb, sidewalk lane offset, queue spacing, m */
const HUB_IN = 1.3;
/** traffic v8: 0.4 (was 0.6), so people waiting at the kerb stand clear of those walking past behind them (WALK_OFF) */
const CROSS_IN = 0.4;
const CROSS_ALONG = 1.5;
const WALK_OFF = 0.3;
const QUEUE = 0.7;
const CROSS_OFF = 0.35;
/**
 * Waiting to cross (traffic v8, owner 2026-10-19: people stood inside each other): each person waiting has a spot of
 * their own along the kerb, QUEUE_COL apart, the first CROSS_OFF to the right of the crossing's middle: QUEUE_COLS of
 * them (the street lamp 4 m from the corner comes next), or QUEUE_COLS_CORNER where the right is towards the block's
 * corner (the kerb round it is nearer). A spot within SPACE of anyone else's (the other crossing at the corner has its
 * own) is not free. When none is, the person walks on along the block instead. A person PERSON.r = 0.3 m round needs
 * 0.6 m between centres.
 */
const QUEUE_COL = 0.6;
const QUEUE_COLS = 3;
const QUEUE_COLS_CORNER = 2;
const SPACE = 0.6;
/**
 * Keeping apart (traffic v8, owner 2026-10-19: walkers walked into each other) [estimates]. A walker looks LOOK m ahead
 * along their way at anyone within SPACE of their line. Someone going the same way: they keep FOLLOW m behind (slowing
 * to their pace, or waiting). Someone crossing their way close ahead: the one with the higher index waits for them; the
 * same when each is ahead of the other (paths that meet), so two never wait for each other.
 */
const LOOK = 1.8;
const FOLLOW = 0.75;
/**
 * Going into buildings [design choices]: a person walking a block's side goes in at one of its doors one time in
 * four (ENTER_PCT), walks INSIDE m in past the glass (out of sight in the building), stays DWELL_MIN to DWELL_MAX s,
 * then comes out and walks on either way.
 */
const ENTER_PCT = 25;
const INSIDE = 1.5;
const DWELL_MIN = 20;
const DWELL_MAX = 120;
/**
 * Going by train (map v9, owner 2026-10-19: "some of the walking NPCs to go up to board and come down to leave the
 * train when it stops at the city station") [design choices]: a person at a corner of the station's garden block goes
 * up to the city station STATION_PCT times in a hundred (when the trains run), waits on the platform by a coach door,
 * and boards the next train that stands there from BOARD_AFTER s after it stops until BOARD_LAST s before it leaves. On
 * board they are out of sight (and not solid) for RIDE_MIN s at least, then get off at the city station from whichever
 * train stands there, and walk down into the city. Nobody gets on or off at the fields station. ON_BOARD people start
 * on the trains, so some get off at the first stop.
 */
const STATION_PCT = 35;
const BOARD_AFTER = 3;
const BOARD_LAST = 12;
const RIDE_MIN = 240;
const ON_BOARD = 10;
/** a person's previous hub when there is none (after coming down from the station) */
const NO_HUB = -1000000;
/** the fastest a person crosses, m/s: the flashing phase (12 s) must see a road (19 m) crossed */
const V_CROSS_MIN = 1.5;
/**
 * A car this far along a link leaving a junction (its centre, from the link's start STOP m out) still counts as
 * in the junction for people about to cross: its back is then STOP + CLEAR_S - bodyHalfL = 15 m from the
 * junction's centre, 4 m past the crossing (half a road + CROSS_ALONG = 11 m on the first map's 19 m roads).
 */
const CLEAR_S = 4;

/** A block's corners NW, NE, SE, SW: which way each is from the block's middle. */
const CORNER_SX = [-1, 1, 1, -1], CORNER_SZ = [-1, -1, 1, 1];

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
    /** movement: the light group it follows (see CYCLE) */
    group: number;
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

/** what a signal head shows: car and arrow heads by light group, walk heads by junction */
interface HeadRef {
    j: number;
    group: number;
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
// per-person state slots: phase (0 to a hub, 1 to a crossing queue, 2 waiting, 3 crossing, 4 to a hub after crossing,
// 5 along the sidewalk to a door, 6 in through it, 7 inside, 8 out of it; going by train: 9 up the walkway to the
// platform, 10 along the platform to their waiting spot, 15 waiting, 16 along the platform to their coach door, 11 in
// through it, 12 on board, 13 out of it onto the platform, 17 along the platform to the walkway, 14 down the walkway to
// a corner of the garden block), edge from a to b, distance along it, speed, base speed, target hub, previous hub (or
// -1 - crossing), crossing, side, queue row, kerb distance (crossing), lane offset, which ends of the edge the lane offset
// eases in at (1 start, 2 end), door (a building's, or a coach door by number), tick to come out at (or to get off
// after), the walkway path (by the garden corner it starts or ends at)
const P_PH = 0, P_AX = 1, P_AZ = 2, P_BX = 3, P_BZ = 4, P_LEN = 5, P_S = 6, P_V = 7, P_VB = 8, P_H = 9, P_PREV = 10;
const P_C = 11, P_SIDE = 12, P_ROW = 13, P_KERB = 14, P_OFF = 15, P_EASE = 16, P_DOOR = 17, P_OUT = 18, P_PATH = 19;
// traffic v8: the waiting spot's column at a crossing (P_ROW its row)
const P_COL = 20, PN = 21;

/** Phases a person stands still in (waiting to cross, inside, waiting on the platform, on board): they never move along. */
function standing(ph: number): boolean {
    return ph === 2 || ph === 7 || ph === 12 || ph === 15;
}

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
    /** the doors along each block side (block * 4 + c, the side from corner hub c to c + 1), by Level.doors index */
    private readonly sideDoors: number[][] = [];
    /** per door: the point on its side's walking line in front of it, and the point INSIDE m in past its glass */
    private readonly doorFront: [number, number][] = [];
    private readonly doorIn: [number, number][] = [];

    // going by train (empty when no trains run or the level has no walkway)
    private readonly trains: Train[] = [];
    /** the trains' city stop (an index into Train.stops) */
    private cityStop = -1;
    /** per corner of the garden block: the walk from its hub up to the platform's waiting line, [x, y, z] points, and the distance to each */
    private readonly upPath: number[][][] = [];
    private readonly upDist: number[][] = [];
    /** the coach doors' x when a train stands at the city station, the line just inside them, the platform's top and the waiting line */
    private readonly coachDoors: number[] = [];
    private doorLineZ = 0;
    private platformY = 0;
    private waitZ = 0;
    private walkX = 0;

    // state
    private readonly nCars: number;
    private readonly nPeople: number;
    private cars: Float64Array;
    private people: Float64Array;
    /** keeping apart: everyone's x, y, z, heading x, z and phase at the start of the step, and who is in each 2 m square (snapPeople) */
    private pplAt = new Float64Array(0);
    private readonly pplGrid = new Map<number, number[]>();
    private readonly pplTmp: Place = { x: 0, y: 0, z: 0, hx: 0, hz: 0 };
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
        this.config = { cars: config.cars, people: config.people, signals: true, train: config.train === true };
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
        for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) this.offset.push(((ix * 13 + iz * 29) % (CYCLE / 1000)) * 1000);
        this.buildRoads();
        this.buildSignals();
        this.buildWalks(level);
        if (config.people) this.buildStation(level, config.train === true);

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
        // the people already on the trains at the start: their own draws, after everyone else's
        const nBlockPeople = startPeople.length;
        if (this.trains.length) {
            const rRng = new Uint32Array([0x7a1e5]);
            for (let k = 0; k < ON_BOARD; k++) {
                const vb = 1.1 + (draw(rRng, 0) % 6) / 10;
                startPeople.push([-1, -1, 0, vb, draw(rRng, 0), draw(rRng, 0)]);
            }
        }
        this.nCars = startCars.length;
        this.nPeople = startPeople.length;
        this.cars = new Float64Array(this.nCars * CN);
        this.people = new Float64Array(this.nPeople * PN);
        this.pplAt = new Float64Array(this.nPeople * 6);
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
            if (i >= nBlockPeople) {
                // on board from the start: off at the first city stop, through a door of their own
                this.people[o + P_PH] = 12;
                this.people[o + P_DOOR] = (i - nBlockPeople) % this.coachDoors.length;
                this.people[o + P_OUT] = 0;
                return;
            }
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

    /** A lane comes into junction j heading against heading k (from the junction ahead). */
    private oncoming(j: number, k: number): boolean {
        const n = this.neighbour(j, k);
        return n >= 0 && this.linkOf[n * 4 + ((k + 2) % 4)] >= 0;
    }

    private buildRoads(): void {
        const nJ = this.xs.length * this.zs.length;
        for (let j = 0; j < nJ; j++) for (let k = 0; k < 4; k++) {
            const n = this.neighbour(j, k);
            if (n < 0) { this.linkOf.push(-1); continue; }
            const a = this.at2(j, k, STOP, LANE), b = this.at2(n, k, -STOP, LANE);
            const route = pathThrough([a, b], 0, false, 0);
            this.linkOf.push(this.elems.length);
            this.elems.push({ route, len: route.length, link: true, j: n, dir: k, out: -1, moves: [], vmax: V_ROAD, split: 0, group: -1, feeders: [] });
        }
        for (let j = 0; j < nJ; j++) this.movesAt.push([]);
        // the turns at the end of each link: straight, right and left, where there is a road
        const nLinks = this.elems.length;
        const turns: number[][] = [];
        for (let e = 0; e < nLinks; e++) {
            const el = this.elems[e];
            const j = el.j, k = el.dir;
            turns.push([k, (k + 1) % 4, (k + 3) % 4].filter((out) => this.linkOf[j * 4 + out] >= 0));
        }
        // A car never turns into a lane from which it cannot reach every other one (cars there would circle it for
        // ever and fill it): a link is dead if it reaches fewer links than the best connected one. On a full grid
        // with left turns no link is dead; the check stays for maps where one would be.
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
                // a left turn across an oncoming lane has its arrow; the rest go on the straight light
                const oncoming = out === (k + 3) % 4 && this.oncoming(j, k);
                const group = (k % 2 === 1 ? 0 : 2) + (oncoming ? 0 : 1);
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
                this.elems.push({ route, len: route.length, link: false, j, dir: k, out: ol, moves: el.moves, vmax, split, group, feeders: [] });
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
            this.heads.push({ j, group: k % 2 === 1 ? 1 : 3, walk: false });
            // the left-turn arrow head, left of the other, where a left turn crosses an oncoming lane
            if (this.linkOf[j * 4 + ((k + 3) % 4)] >= 0 && this.oncoming(j, k)) {
                box(j, this.at2(j, k, pd - 0.15, LANE - 1.08), this.at2(j, k, pd + 0.15, LANE - 0.72), 4.7, 5.65);
                const af = this.at2(j, k, pd - 0.16, LANE - 0.9);
                this.signals.push({ kind: 'arrow', x: af[0], y: 5.15, z: af[1], fx: -DX[k], fz: -DZ[k] });
                this.heads.push({ j, group: k % 2 === 1 ? 0 : 2, walk: false });
            }
            // walk heads: across the approach road (facing left of the heading) and across the cross road (facing ahead)
            const rk = (k + 1) % 4;
            const w1 = this.at2(j, k, pd, pr - 0.22), w2 = this.at2(j, k, pd + 0.22, pr);
            box(j, this.at2(j, k, pd - 0.12, pr - 0.34), this.at2(j, k, pd + 0.12, pr - 0.12), 2.5, 2.9);
            box(j, this.at2(j, k, pd + 0.12, pr - 0.12), this.at2(j, k, pd + 0.34, pr + 0.12), 2.5, 2.9);
            this.signals.push({ kind: 'walk', x: w1[0] - DX[rk] * 0.13, y: 2.7, z: w1[1] - DZ[rk] * 0.13, fx: -DX[rk], fz: -DZ[rk] });
            this.heads.push({ j, group: -1, walk: true });
            this.signals.push({ kind: 'walk', x: w2[0] + DX[k] * 0.13, y: 2.7, z: w2[1] + DZ[k] * 0.13, fx: DX[k], fz: DZ[k] });
            this.heads.push({ j, group: -1, walk: true });
        }
    }

    /**
     * Going by train: the trains (their timetable says when one stands at the city station), the walk from each corner of
     * the station's garden block up to the platform (along the block's west or east sidewalk to the garden's cross path,
     * along it to the stair, up the stair and over the footbridge: maps railway.ts), and the coach doors' places.
     */
    private buildStation(level: Level, trains: boolean): void {
        const w = level.railway?.walkway;
        if (!trains || !w) return;
        this.trains.push(...makeTrains(level, true));
        this.stationBlockIndex = w.block;
        const t0 = this.trains[0];
        this.cityStop = t0.stops.findIndex((x) => x.name === 'City station');
        if (this.cityStop < 0) throw new Error('the railway has no city station');
        this.platformY = w.platformY;
        this.waitZ = w.waitZ;
        this.doorLineZ = w.doorZ;
        this.walkX = w.up[0][0];
        const blk = level.blocks[w.block];
        for (let c = 0; c < 4; c++) {
            const h = w.block * 4 + c;
            const hx = this.hubX[h], hz = this.hubZ[h];
            // the corner's own side of the block (west for the north-west and south-west corners, east for the others)
            const ex = c === 0 || c === 3 ? blk.x0 + HUB_IN : blk.x1 - HUB_IN;
            const pts: number[][] = [[hx, this.walkY, hz], [ex, this.walkY, w.plazaZ], ...w.up.map((q) => [q[0], q[1], q[2]])];
            const dist = [0];
            for (let k = 1; k < pts.length; k++) {
                const a = pts[k - 1], b = pts[k];
                dist.push(dist[k - 1] + Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]) + (b[2] - a[2]) * (b[2] - a[2])));
            }
            this.upPath.push(pts);
            this.upDist.push(dist);
        }
        // the side doors on the platform's side of each coach while a train stands at the city station
        const pl = newTrainPlace();
        const stopS = t0.stops[this.cityStop].s;
        t0.vehicles.forEach((v, i) => {
            if (v.kind !== 'coach') return;
            t0.placeAtS(i, stopS, pl);
            for (const f of [-1, 1]) this.coachDoors.push(pl.x + pl.fx * f * ((COACH.sideDoor0 + COACH.sideDoor1) / 2));
        });
        this.coachDoors.sort((a, b) => a - b);
    }

    /** Can a person board (or get off) now: a train stands at the city station, stopped long enough ago and not leaving soon? `wait` is the person's own extra wait, ms. */
    private trainIn(tick: number, wait: number): boolean {
        for (const t of this.trains) {
            const st = t.standing(tick, this.cityStop);
            if (st && tick - st.from >= BOARD_AFTER * 1000 + wait && st.to - tick >= BOARD_LAST * 1000) return true;
        }
        return false;
    }

    /** Person q's waiting spot on the platform: by their coach door, a little to one side, in one of three rows (none two on one spot unless a door draws more than 27). */
    private spotX(q: number): number {
        return this.coachDoors[this.people[q * PN + P_DOOR]] + (((q * 7) % 9) - 4) * 0.55;
    }

    private spotZ(q: number): number {
        return this.waitZ - (Math.floor(q / 9) % 3) * 0.4;
    }

    private buildWalks(level: Level): void {
        // hubs: one per block corner (NW, NE, SE, SW), in from both kerbs
        const corner = new Map<string, number>();
        const SX = CORNER_SX, SZ = CORNER_SZ;
        level.blocks.forEach((b, bi) => {
            for (let c = 0; c < 4; c++) {
                const kx = SX[c] < 0 ? b.x0 : b.x1, kz = SZ[c] < 0 ? b.z0 : b.z1;
                this.hubX.push(kx - SX[c] * HUB_IN);
                this.hubZ.push(kz - SZ[c] * HUB_IN);
                this.crossAt.push([]);
                corner.set(`${kx},${kz}`, bi * 4 + c);
            }
        });
        // doors: each on the block side its face looks onto (side c runs from hub c to c + 1: north, east, south, west)
        for (let k = 0; k < level.blocks.length * 4; k++) this.sideDoors.push([]);
        (level.doors ?? []).forEach((d, di) => {
            const b = level.blocks[d.block];
            const c = d.nz < 0 ? 0 : d.nx > 0 ? 1 : d.nz > 0 ? 2 : 3;
            this.sideDoors[d.block * 4 + c].push(di);
            this.doorFront.push(c === 0 ? [d.x, b.z0 + HUB_IN] : c === 1 ? [b.x1 - HUB_IN, d.z] : c === 2 ? [d.x, b.z1 - HUB_IN] : [b.x0 + HUB_IN, d.z]);
            this.doorIn.push([d.x - d.nx * (d.depth + INSIDE), d.z - d.nz * (d.depth + INSIDE)]);
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

    /** Car light of a group (see CYCLE) at junction j and tick. */
    carSignal(j: number, group: number, tick: number): 'red' | 'yellow' | 'green' {
        const c = (Math.floor(tick) + this.offset[j]) % CYCLE;
        return c < G0[group] || c >= R0[group] ? 'red' : c < Y0[group] ? 'green' : 'yellow';
    }

    /** ms of yellow left for a light group at junction j and tick (only meaningful while it shows yellow) */
    private yellowLeft(j: number, group: number, tick: number): number {
        const c = (Math.floor(tick) + this.offset[j]) % CYCLE;
        return R0[group] - c;
    }

    walkSignal(j: number, tick: number): 'walk' | 'flash' | 'stop' {
        const c = (Math.floor(tick) + this.offset[j]) % CYCLE;
        if (c < PED_W || c >= PED_R) return 'stop';
        return c < PED_F ? 'walk' : 'flash';
    }

    lamp(h: number, tick: number): Lamp {
        const r = this.heads[h];
        return r.walk ? this.walkSignal(r.j, tick) : this.carSignal(r.j, r.group, tick);
    }

    staticsNear(x: number, z: number, reach: number): readonly StaticBox[] {
        const lim = this.half + 4 + reach;
        let ix = -1, iz = -1;
        for (let i = 0; i < this.xs.length; i++) if (Math.abs(x - this.xs[i]) <= lim) { ix = i; break; }
        for (let i = 0; i < this.zs.length; i++) if (Math.abs(z - this.zs[i]) <= lim) { iz = i; break; }
        return ix < 0 || iz < 0 ? [] : this.statics[this.jid(ix, iz)];
    }

    // ------------------------------------------------------------ for tests

    /** What mover i is doing at the current step: a car's element, junction, light group (of the movement it is on or takes next), distance and speed; a person's phase and crossing junction. */
    inspect(i: number): { link: boolean; j: number; group: number; s: number; v: number; phase: number } {
        if (i < this.nCars) {
            const o = i * CN, el = this.elems[this.cars[o + C_E]];
            return { link: el.link, j: el.j, group: this.elems[el.link ? this.cars[o + C_NEXT] : this.cars[o + C_E]].group, s: this.cars[o + C_S], v: this.cars[o + C_V], phase: -1 };
        }
        const o = (i - this.nCars) * PN;
        const ph = this.people[o + P_PH];
        return { link: false, j: ph >= 1 && ph <= 3 ? this.crossings[this.people[o + P_C]].j : -1, group: -1, s: this.people[o + P_S], v: this.people[o + P_V], phase: ph };
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
            for (const side of [0, 1]) for (const row of [0]) for (let col = 0; col < this.cols(cid, side); col++) {
                const h = side ? x.hB : x.hA;
                const a = this.slot(cid, side, row, false, col), b = this.slot(cid, side, row, true, col);
                walk([this.hubX[h], this.hubZ[h]], a, this.walkY);
                walk(a, b, 0.0);
            }
        });
        return out;
    }

    /** Person mover i is out of sight inside a building or on a train (and not solid then: world.ts). */
    hidden(i: number): boolean {
        if (i < this.nCars) return false;
        const ph = this.people[(i - this.nCars) * PN + P_PH];
        return ph === 7 || ph === 12;
    }

    /** The door (Level.doors index) mover i is walking in or out through, else -1. */
    doorUse(i: number): number {
        if (i < this.nCars) return -1;
        const o = (i - this.nCars) * PN, ph = this.people[o + P_PH];
        return ph === 6 || ph === 8 ? this.people[o + P_DOOR] : -1;
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

    /** No car is in junction j on a movement of another light group (the last phase's cars still clearing the box). */
    private boxClear(j: number, group: number): boolean {
        for (const m of this.movesAt[j]) if (this.elems[m].group !== group && this.lists[m].length) return false;
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
            // its light: the one for the movement it takes
            const mv = this.elems[c[o + C_NEXT]], group = mv.group;
            const sig = this.carSignal(el.j, group, tick);
            const v = c[o + C_V];
            const toStop = this.stopPos(e) - c[o + C_S];
            const stopDist = (v * v) / (2 * B_YELLOW);
            let go = false;
            if (sig !== 'red' && this.room(mv.out) && this.boxClear(el.j, group)) {
                if (sig === 'green') go = true;
                else go = toStop < stopDist && el.len - c[o + C_S] < v * (this.yellowLeft(el.j, group, tick) * 0.001 - STEP);
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
        p[o + P_EASE] = 3;
    }

    /** The point on the walking line in front of door d, WALK_OFF to the right of the way to (tx, tz). */
    private laneAt(d: number, tx: number, tz: number): [number, number] {
        const [fx, fz] = this.doorFront[d];
        const l = Math.sqrt((tx - fx) * (tx - fx) + (tz - fz) * (tz - fz));
        return [fx - (tz - fz) / l * WALK_OFF, fz + (tx - fx) / l * WALK_OFF];
    }

    /** Where person q waits (row 0 at the crossing end, row 1 behind; column 0, then along the kerb to its right) to cross crossing cid from `side`. */
    private slot(cid: number, side: number, row: number, far: boolean, col = 0): [number, number] {
        const x = this.crossings[cid];
        const dx = side ? -x.dx : x.dx, dz = side ? -x.dz : x.dz;
        const fromA = (side === 0) !== far;
        const ex = fromA ? x.ax : x.bx, ez = fromA ? x.az : x.bz;
        // back from the kerb (into the sidewalk) and to the walker's right, so the two sides pass
        const back = far ? 1 : -1;
        const off = CROSS_OFF + QUEUE_COL * col;
        return [ex + dx * back * QUEUE * row - dz * off, ez + dz * back * QUEUE * row + dx * off];
    }

    /** How many waiting spots side `side` of crossing cid has in a row: fewer where they run towards the block's corner. */
    private cols(cid: number, side: number): number {
        const x = this.crossings[cid], h = side ? x.hB : x.hA;
        const c = h % 4;
        const cx = this.hubX[h] + CORNER_SX[c] * HUB_IN, cz = this.hubZ[h] + CORNER_SZ[c] * HUB_IN;
        const [ax, az] = this.slot(cid, side, 0, false, 0), [bx, bz] = this.slot(cid, side, 0, false, 1);
        return (bx - ax) * (cx - ax) + (bz - az) * (cz - az) > 0 ? QUEUE_COLS_CORNER : QUEUE_COLS;
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
        this.snapPeople();
        for (let q = 0; q < this.nPeople; q++) {
            const o = q * PN;
            const ph = p[o + P_PH];
            if (ph === 7) {
                if (tick < p[o + P_OUT]) continue;
                // out again, on either way along the side
                const a = p[o + P_H], b = p[o + P_PREV];
                const back = draw(this.rngPeople, q) % 2 === 1;
                const to = back ? b : a;
                p[o + P_H] = to;
                p[o + P_PREV] = back ? a : b;
                const [lx, lz] = this.laneAt(p[o + P_DOOR], this.hubX[to], this.hubZ[to]);
                this.walkEdge(q, 8, p[o + P_BX], p[o + P_BZ], lx, lz, p[o + P_VB], 0);
                continue;
            }
            if (ph === 15) {
                // waiting on the platform: to the door when a train stands here
                if (!this.trainIn(tick, (q % 8) * 700)) continue;
                const dx = this.coachDoors[p[o + P_DOOR]];
                this.walkEdge(q, 16, p[o + P_BX], p[o + P_BZ], dx, this.waitZ, p[o + P_VB], 0);
                continue;
            }
            if (ph === 12) {
                // on board: off at the city station once the ride is long enough
                if (tick < p[o + P_OUT] || !this.trainIn(tick, (q % 8) * 700)) continue;
                const dx = this.coachDoors[p[o + P_DOOR]];
                this.walkEdge(q, 13, dx, this.doorLineZ, dx, this.waitZ, p[o + P_VB], 0);
                continue;
            }
            if (ph === 2) {
                const cid = p[o + P_C];
                const j = this.crossings[cid].j;
                if (this.walkSignal(j, tick) !== 'walk' || this.junctionBusy(j)) continue;
                const side = p[o + P_SIDE], row = p[o + P_ROW], col = p[o + P_COL];
                const a = this.slot(cid, side, row, false, col), b = this.slot(cid, side, row, true, col);
                this.walkEdge(q, 3, a[0], a[1], b[0], b[1], Math.max(V_CROSS_MIN, p[o + P_VB] * 1.15), 0);
                p[o + P_KERB] = CROSS_IN + QUEUE * row;
                continue;
            }
            p[o + P_S] += this.keepApart(q);
            if (p[o + P_S] < p[o + P_LEN]) continue;
            p[o + P_S] = p[o + P_LEN];
            if (ph === 1) {
                p[o + P_PH] = 2;
            } else if (ph === 9) {
                // on the platform: along the waiting line to their spot
                this.walkEdge(q, 10, this.walkX, this.waitZ, this.spotX(q), this.spotZ(q), p[o + P_VB], 0);
            } else if (ph === 10) {
                p[o + P_PH] = 15;
            } else if (ph === 16) {
                const dx = this.coachDoors[p[o + P_DOOR]];
                this.walkEdge(q, 11, dx, this.waitZ, dx, this.doorLineZ, p[o + P_VB], 0);
            } else if (ph === 11) {
                p[o + P_PH] = 12;
                p[o + P_OUT] = tick + RIDE_MIN * 1000;
            } else if (ph === 13) {
                this.walkEdge(q, 17, p[o + P_BX], p[o + P_BZ], this.walkX, this.waitZ, p[o + P_VB], 0);
            } else if (ph === 17) {
                // down the walkway to one of the garden's corners
                const c = draw(this.rngPeople, q) % 4;
                p[o + P_PH] = 14;
                p[o + P_PATH] = c;
                p[o + P_S] = 0;
                p[o + P_LEN] = this.upDist[c][this.upDist[c].length - 1];
                p[o + P_V] = p[o + P_VB];
            } else if (ph === 14) {
                // at the corner's hub: on into the city
                const c = p[o + P_PATH];
                p[o + P_H] = this.upPath.length ? Math.floor(this.hubOfPath(c)) : 0;
                p[o + P_PREV] = NO_HUB;
                this.choose(q);
            } else if (ph === 5) {
                // at the door: in through it
                const d = p[o + P_DOOR];
                const [ix, iz] = this.doorIn[d];
                const [lx, lz] = this.laneAt(d, this.hubX[p[o + P_H]], this.hubZ[p[o + P_H]]);
                this.walkEdge(q, 6, lx, lz, ix, iz, p[o + P_VB], 0);
            } else if (ph === 6) {
                p[o + P_PH] = 7;
                p[o + P_OUT] = tick + (DWELL_MIN + (draw(this.rngPeople, q) % (DWELL_MAX - DWELL_MIN + 1))) * 1000;
            } else if (ph === 8) {
                // back on the sidewalk, on to the hub
                const [fx, fz] = this.doorFront[p[o + P_DOOR]];
                const h = p[o + P_H];
                this.walkEdge(q, 0, fx, fz, this.hubX[h], this.hubZ[h], p[o + P_VB], WALK_OFF);
                p[o + P_EASE] = 2;
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

    /** The first free waiting spot (its column) along the kerb on side `side` of crossing cid, or -1 when all are taken. */
    private freeSpot(cid: number, side: number): number {
        const p = this.people, n = this.cols(cid, side);
        for (let col = 0; col < n; col++) {
            const [sx, sz] = this.slot(cid, side, 0, false, col);
            let free = true;
            for (let r = 0; r < this.nPeople && free; r++) {
                const ro = r * PN;
                if (p[ro + P_PH] !== 1 && p[ro + P_PH] !== 2) continue;
                const ddx = p[ro + P_BX] - sx, ddz = p[ro + P_BZ] - sz;
                if (ddx * ddx + ddz * ddz < SPACE * SPACE) free = false;
            }
            if (free) return col;
        }
        return -1;
    }

    /** Everyone's place and heading at the start of this step (keepApart reads them), and a 2 m grid of who is where. */
    private snapPeople(): void {
        const at = this.pplAt, pl = this.pplTmp, grid = this.pplGrid;
        grid.clear();
        for (let q = 0; q < this.nPeople; q++) {
            const ph = this.people[q * PN + P_PH];
            if (ph === 7 || ph === 12) continue; // out of sight: in a building, on a train
            this.personPlace(q, pl);
            const o = q * 6;
            at[o] = pl.x; at[o + 1] = pl.y; at[o + 2] = pl.z;
            // the way they walk (a waiting person faces across the road, but goes nowhere)
            at[o + 3] = standing(ph) ? 0 : pl.hx; at[o + 4] = standing(ph) ? 0 : pl.hz;
            at[o + 5] = ph;
            const key = Math.floor(pl.x / 2) * 100003 + Math.floor(pl.z / 2);
            const cell = grid.get(key);
            if (cell) cell.push(q); else grid.set(key, [q]);
        }
    }

    /**
     * How far walking person q goes along their way this step, keeping apart (LOOK, FOLLOW): their pace, less behind
     * someone going the same way, or nothing while someone crosses close in front of them.
     */
    private keepApart(q: number): number {
        const at = this.pplAt, o = q * 6;
        let go = this.people[q * PN + P_V] * STEP;
        const qx = at[o], qy = at[o + 1], qz = at[o + 2], hx = at[o + 3], hz = at[o + 4];
        const cx = Math.floor(qx / 2), cz = Math.floor(qz / 2);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
            const cell = this.pplGrid.get(gx * 100003 + gz);
            if (!cell) continue;
            for (const r of cell) {
                if (r === q) continue;
                const ro = r * 6;
                const dx = at[ro] - qx, dz = at[ro + 2] - qz, dy = at[ro + 1] - qy;
                if (dy > 1 || dy < -1) continue;
                const along = dx * hx + dz * hz;
                if (along <= 0 || along > LOOK) continue;
                const side = dz * hx - dx * hz;
                if (side >= SPACE || side <= -SPACE) continue;
                const rhx = at[ro + 3], rhz = at[ro + 4];
                const dot = rhx * hx + rhz * hz;
                // each ahead of the other (ways that meet): only the higher index waits, so they never both stand
                const back = -(dx * rhx + dz * rhz), rside = dx * rhz - dz * rhx;
                if (back > 0 && back <= LOOK && rside < SPACE && rside > -SPACE && q < r) continue;
                // going the same way: FOLLOW behind them; crossing their way close in front: the higher index waits
                if (dot > 0.5) go = Math.min(go, Math.max(0, along - FOLLOW));
                else if (dot > -0.5 && !standing(at[ro + 5]) && along < FOLLOW && q > r) go = 0;
            }
        }
        return go;
    }

    /** Person q is at hub P_H: on along the block, or to a crossing's queue; never straight back. */
    private choose(q: number): void {
        const p = this.people, o = q * PN;
        const h = p[o + P_H], prev = p[o + P_PREV];
        const blk = Math.floor(h / 4), c = h % 4;
        const opts: number[] = [];
        for (const n of [blk * 4 + ((c + 1) % 4), blk * 4 + ((c + 3) % 4)]) if (n !== prev) opts.push(n);
        for (const x of this.crossAt[h]) if (-1 - x !== prev) opts.push(-1 - x);
        // at a corner of the station's garden block: now and then up to the city station to take a train
        if (this.upPath.length && prev !== NO_HUB && Math.floor(h / 4) === this.stationBlock && draw(this.rngPeople, q) % 100 < STATION_PCT) {
            const c = h % 4;
            p[o + P_PH] = 9;
            p[o + P_PATH] = c;
            p[o + P_S] = 0;
            p[o + P_LEN] = this.upDist[c][this.upDist[c].length - 1];
            p[o + P_V] = p[o + P_VB];
            p[o + P_DOOR] = draw(this.rngPeople, q) % this.coachDoors.length;
            return;
        }
        let pick = opts[draw(this.rngPeople, q) % opts.length];
        const hx = this.hubX[h], hz = this.hubZ[h];
        // a crossing whose waiting spots are all taken: on along the block instead (opts starts with the sides)
        const spot = pick < 0 ? this.freeSpot(-1 - pick, this.crossings[-1 - pick].hA === h ? 0 : 1) : -1;
        if (pick < 0 && spot < 0 && opts[0] >= 0) pick = opts[0];
        if (pick >= 0) {
            p[o + P_H] = pick;
            p[o + P_PREV] = h;
            // along the block's side; now and then in at one of its doors on the way
            const side = blk * 4 + (pick === blk * 4 + ((c + 1) % 4) ? c : (c + 3) % 4);
            const doors = this.sideDoors[side];
            if (doors.length && draw(this.rngPeople, q) % 100 < ENTER_PCT) {
                const d = doors[draw(this.rngPeople, q) % doors.length];
                const [fx, fz] = this.doorFront[d];
                this.walkEdge(q, 5, hx, hz, fx, fz, p[o + P_VB], WALK_OFF);
                p[o + P_EASE] = 1;
                p[o + P_DOOR] = d;
                return;
            }
            this.walkEdge(q, 0, hx, hz, this.hubX[pick], this.hubZ[pick], p[o + P_VB], WALK_OFF);
            return;
        }
        const cid = -1 - pick;
        const side = this.crossings[cid].hA === h ? 0 : 1;
        // the first free spot along the kerb (free: checked above; when none was and there was no other way, the first)
        const row = 0, col = Math.max(0, spot);
        const s = this.slot(cid, side, row, false, col);
        this.walkEdge(q, 1, hx, hz, s[0], s[1], p[o + P_VB], 0);
        p[o + P_C] = cid;
        p[o + P_SIDE] = side;
        p[o + P_ROW] = row;
        p[o + P_COL] = col;
    }

    /** The garden block's index in Level.blocks (-1: none). */
    private get stationBlock(): number {
        return this.upPath.length ? this.stationBlockIndex : -1;
    }

    private stationBlockIndex = -1;

    /** The hub a walkway path starts at. */
    private hubOfPath(c: number): number {
        return this.stationBlockIndex * 4 + c;
    }

    /** The place `d` m along walkway path c from its hub end; facing up it, or down it when `down`. */
    private pathPlace(c: number, d: number, down: boolean, out: Place): void {
        const pts = this.upPath[c], dist = this.upDist[c];
        let k = 1;
        while (k < pts.length - 1 && d > dist[k]) k++;
        const a = pts[k - 1], b = pts[k];
        const seg = dist[k] - dist[k - 1];
        const t = seg > 1e-9 ? Math.min(1, Math.max(0, (d - dist[k - 1]) / seg)) : 0;
        out.x = a[0] + (b[0] - a[0]) * t;
        out.y = a[1] + (b[1] - a[1]) * t;
        out.z = a[2] + (b[2] - a[2]) * t;
        const ex = b[0] - a[0], ez = b[2] - a[2];
        const l = Math.sqrt(ex * ex + ez * ez);
        const sg = down ? -1 : 1;
        if (l > 1e-9) { out.hx = (ex / l) * sg; out.hz = (ez / l) * sg; } else { out.hx = 0; out.hz = -sg; }
    }

    private personPlace(q: number, out: Place): void {
        const p = this.people, o = q * PN;
        const ax = p[o + P_AX], az = p[o + P_AZ], bx = p[o + P_BX], bz = p[o + P_BZ];
        const len = p[o + P_LEN], s = p[o + P_S];
        let hx = 1, hz = 0;
        if (len > 1e-9) { hx = (bx - ax) / len; hz = (bz - az) / len; }
        const ph = p[o + P_PH];
        if (ph === 9 || ph === 14) {
            // on the walkway: up it from the garden's corner, or down it from the platform
            this.pathPlace(p[o + P_PATH], ph === 9 ? s : len - s, ph === 14, out);
            return;
        }
        if (ph === 12) {
            // on board: out of sight, just inside their door (where they will step out)
            out.x = this.coachDoors[p[o + P_DOOR]]; out.y = this.platformY; out.z = this.doorLineZ;
            out.hx = 0; out.hz = 1;
            return;
        }
        if (ph === 15) {
            // waiting: facing the track
            out.x = bx; out.z = bz; out.y = this.platformY;
            out.hx = 0; out.hz = -1;
            return;
        }
        if (ph === 10 || ph === 11 || ph === 13 || ph === 16 || ph === 17) {
            out.x = ax + hx * s; out.z = az + hz * s; out.y = this.platformY;
            out.hx = hx; out.hz = hz;
            return;
        }
        if (ph === 7) {
            // inside, out of sight
            out.x = bx; out.z = bz; out.y = this.walkY;
            out.hx = hx; out.hz = hz;
            return;
        }
        if (ph === 2) {
            // waiting: facing across
            const x = this.crossings[p[o + P_C]];
            const sg = p[o + P_SIDE] ? -1 : 1;
            out.x = bx; out.z = bz; out.y = this.walkY;
            out.hx = x.dx * sg; out.hz = x.dz * sg;
            return;
        }
        // on a sidewalk keep to the right, easing in and out at the ends so the path stays continuous
        const e = p[o + P_EASE];
        const ease = Math.min(1, e & 1 ? s / 0.6 : 1, e & 2 ? (len - s) / 0.6 : 1);
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
