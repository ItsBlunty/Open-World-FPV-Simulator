// Road vehicles (traffic v9, owner 2026-10-20: "add some variety to the cars other than color, and lets add some pickup
// trucks, and some semi trucks"): what each kind is made of, as solid boxes, and what it carries.
//
// A vehicle's boxes are given in its frame: f ahead of its place along its heading, s to its right, y up from the road.
// A semi has two frames: the tractor's (frame 0, at its place) and the trailer's (frame 1, at the kingpin, f ahead
// towards the tractor). The collision (world.ts) takes these very boxes and the renderer draws them, so what is drawn
// is what the quad hits; wheels, lamps, windows and the riders are drawn only (they sit inside or against the boxes).
//
// Sizes are real-world ones. The US trailer limits are federal: 102 in (2.59 m) wide (23 CFR 658.15), 48 ft trailers
// allowed everywhere and 53 ft (16.15 m) in most states (23 CFR 658.13); 13 ft 6 in (4.11 m) high is the usual state
// limit. The rest are typical of the kind of vehicle named and marked [estimate].
//
// The pickup loads and the semi trailers' doors and pallets come from each vehicle's own draws (network.ts, loops.ts),
// never from Mover.look (the renderer's): they are solid, so they are part of the world hash.

/** What a box is painted: the vehicle's colour ('body'), its trailer's colour, or a fixed one (the renderer's). */
export type Paint = 'body' | 'trailer' | 'door' | 'floor' | 'deck' | 'glass' | 'trim' | 'chrome' | 'cardboard' | 'wood' | 'wood2'
    | 'fabric' | 'white' | 'hay' | 'wrap' | 'water' | 'steel' | 'flag';

/** A solid box in a vehicle's frame: f0 < f1 along, s0 < s1 across, y0 < y1 up, m. */
export interface VBox {
    frame: 0 | 1;
    f0: number;
    f1: number;
    s0: number;
    s1: number;
    y0: number;
    y1: number;
    paint: Paint;
}

/** A wheel (drawn only): its middle along and across, its radius and width, m. */
export interface VWheel {
    frame: 0 | 1;
    f: number;
    s: number;
    r: number;
    w: number;
}

export type VehicleKind = 'car' | 'sedan' | 'suv' | 'van' | 'pickup' | 'semi';
export type PickupLoad = 'empty' | 'boxes' | 'lumber' | 'sofa' | 'fridge' | 'hay';
export type TrailerKind = 'van53' | 'pup28' | 'flatbed48';
export type TrailerLoad = 'closed' | 'empty' | 'pallets' | 'lumber' | 'steel';

export interface VehicleShape {
    kind: VehicleKind;
    /** what a pickup carries, or a semi's trailer and what it shows ('closed': doors shut) */
    load: PickupLoad | `${TrailerKind}/${TrailerLoad}`;
    boxes: VBox[];
    /** how far the vehicle reaches ahead of its place, and behind it along its path (a semi: to the trailer's tail), m */
    front: number;
    back: number;
    /** the highest point, m */
    top: number;
    /** how far any box reaches from each frame's origin on the ground plan, m (the collision's quick reject) */
    reach: [number, number];
    /** a semi's kingpin, this far behind its place, and the trailer's axles' middle this far behind the kingpin, m */
    trailer?: { kp: number; axle: number };
    wheels: VWheel[];
    /** the riders' seats (drawn only), along and across; their heads' top, m. None: the cab is not see-through */
    seats: [number, number][];
    headTop: number;
    /** headlamps and brake lamps (drawn only): along, up, across either side, frame */
    head: { f: number; y: number; s: number };
    tail: { f: number; y: number; s: number; frame: 0 | 1 };
}

function box(f0: number, f1: number, s0: number, s1: number, y0: number, y1: number, paint: Paint, frame: 0 | 1 = 0): VBox {
    return { frame, f0, f1, s0, s1, y0, y1, paint };
}

/** a box across the middle, half width hw */
function mid(f0: number, f1: number, hw: number, y0: number, y1: number, paint: Paint, frame: 0 | 1 = 0): VBox {
    return box(f0, f1, -hw, hw, y0, y1, paint, frame);
}

/** the same box on both sides, from s0 to s1 out from the middle */
function sides(f0: number, f1: number, s0: number, s1: number, y0: number, y1: number, paint: Paint, frame: 0 | 1 = 0): VBox[] {
    return [box(f0, f1, s0, s1, y0, y1, paint, frame), box(f0, f1, -s1, -s0, y0, y1, paint, frame)];
}

function wheels4(ff: number, fb: number, s: number, r: number, w: number): VWheel[] {
    const out: VWheel[] = [];
    for (const f of [ff, fb]) for (const sd of [-s, s]) out.push({ frame: 0, f, s: sd, r, w });
    return out;
}

function finish(v: Omit<VehicleShape, 'top' | 'reach'>): VehicleShape {
    let top = 0;
    const reach: [number, number] = [0, 0];
    for (const b of v.boxes) {
        top = Math.max(top, b.y1);
        const f = Math.max(Math.abs(b.f0), Math.abs(b.f1)), s = Math.max(Math.abs(b.s0), Math.abs(b.s1));
        reach[b.frame] = Math.max(reach[b.frame], Math.sqrt(f * f + s * s));
    }
    return { ...v, top, reach };
}

// ---------------------------------------------------------------- cars

/** The toy car (traffic v4 to v8, unchanged): 4 m long, 1.9 m wide, a glass cabin. */
export const CAR = {
    bodyHalfL: 2.0, bodyHalfW: 0.95, bodyY0: 0.12, bodyY1: 1.0,
    cabHalfL: 1.1, cabHalfW: 0.8, cabY0: 1.0, cabY1: 1.55, cabBack: 0.25
} as const;

function car(): VehicleShape {
    const c = CAR;
    return finish({
        kind: 'car', load: 'empty',
        boxes: [
            mid(-c.bodyHalfL, c.bodyHalfL, c.bodyHalfW, c.bodyY0, c.bodyY1, 'body'),
            mid(-c.cabBack - c.cabHalfL, -c.cabBack + c.cabHalfL, c.cabHalfW, c.cabY0, c.cabY1, 'glass')
        ],
        front: c.bodyHalfL, back: c.bodyHalfL,
        wheels: wheels4(1.3, -1.3, 0.8, 0.42, 0.32),
        seats: [[0.05, -0.38], [0.05, 0.38], [-0.85, 0.3]], headTop: c.cabY1 - 0.12,
        head: { f: c.bodyHalfL + 0.01, y: 0.68, s: 0.6 }, tail: { f: -c.bodyHalfL - 0.01, y: 0.68, s: 0.6, frame: 0 }
    });
}

/** A saloon: long bonnet and boot, low glasshouse; 4.8 x 1.84 x 1.45 m [estimate, typical mid-size saloon]. */
function sedan(): VehicleShape {
    return finish({
        kind: 'sedan', load: 'empty',
        boxes: [mid(-2.4, 2.4, 0.92, 0.14, 0.9, 'body'), mid(-1.35, 1.05, 0.78, 0.9, 1.45, 'glass')],
        front: 2.4, back: 2.4,
        wheels: wheels4(1.45, -1.45, 0.78, 0.36, 0.26),
        seats: [[0.3, -0.36], [0.3, 0.36], [-0.75, -0.3]], headTop: 1.33,
        head: { f: 2.41, y: 0.66, s: 0.62 }, tail: { f: -2.41, y: 0.72, s: 0.65, frame: 0 }
    });
}

/** An SUV: tall, the glass running to the tail; 4.6 x 1.9 x 1.75 m [estimate, typical compact SUV]. */
function suv(): VehicleShape {
    return finish({
        kind: 'suv', load: 'empty',
        boxes: [mid(-2.3, 2.3, 0.95, 0.25, 1.1, 'body'), mid(-2.15, 0.95, 0.85, 1.1, 1.75, 'glass')],
        front: 2.3, back: 2.3,
        wheels: wheels4(1.4, -1.4, 0.8, 0.4, 0.3),
        seats: [[0.35, -0.38], [0.35, 0.38], [-0.65, 0.35], [-0.65, -0.35]], headTop: 1.63,
        head: { f: 2.31, y: 0.85, s: 0.65 }, tail: { f: -2.31, y: 0.95, s: 0.7, frame: 0 }
    });
}

/** A high-roof delivery van: glass cab, a tall closed box behind it; 5.4 x 2.0 x 2.45 m [estimate, typical panel van]. */
function van(): VehicleShape {
    return finish({
        kind: 'van', load: 'empty',
        boxes: [mid(-2.7, 2.7, 1.0, 0.2, 1.05, 'body'), mid(0.95, 1.85, 0.95, 1.05, 2.05, 'glass'), mid(-2.7, 0.95, 1.0, 1.05, 2.45, 'body')],
        front: 2.7, back: 2.7,
        wheels: wheels4(1.75, -1.85, 0.82, 0.38, 0.26),
        seats: [[1.3, -0.42], [1.3, 0.42]], headTop: 1.92,
        head: { f: 2.71, y: 0.8, s: 0.72 }, tail: { f: -2.71, y: 1.0, s: 0.85, frame: 0 }
    });
}

// ---------------------------------------------------------------- pickups

/**
 * A full-size crew-cab pickup with a 5.5 ft bed: 5.9 x 2.0 x 1.95 m, the bed floor 0.92 m up and 1.6 x 1.76 m inside, its
 * walls 0.53 m deep [estimate, typical of a full-size crew cab]. The tailgate is up, or down (flat, level with the bed
 * floor) when the load sticks out over it.
 */
const BED = { f0: -2.87, f1: -1.28, s: 0.88, y: 0.92, rail: 1.45 } as const;

function pickup(load: PickupLoad): VehicleShape {
    const open = load === 'lumber' || load === 'sofa' || load === 'hay';
    const b: VBox[] = [
        mid(-1.2, 2.95, 1.0, 0.4, 1.25, 'body'), // bonnet and the cab's lower half
        mid(-1.15, 0.95, 0.92, 1.25, 1.95, 'glass'), // the cab
        mid(-2.95, -1.2, 1.0, 0.4, BED.y, 'body'), // under the bed floor
        mid(-1.28, -1.2, 1.0, BED.y, BED.rail, 'body'), // the bed's front wall
        ...sides(-2.95, -1.28, BED.s, 1.0, BED.y, BED.rail, 'body') // its sides
    ];
    b.push(open ? mid(-3.45, -2.95, BED.s, BED.y - 0.08, BED.y, 'body') : mid(-2.95, -2.87, BED.s, BED.y, BED.rail, 'body'));
    let back = open ? 3.45 : 2.95;
    const y = BED.y;
    if (load === 'boxes') {
        b.push(
            box(-2.8, -2.25, -0.85, -0.3, y, y + 0.5, 'cardboard'), box(-2.8, -2.3, 0.1, 0.62, y, y + 0.45, 'cardboard'),
            box(-2.2, -1.65, -0.8, -0.25, y, y + 0.55, 'cardboard'), box(-1.95, -1.35, 0.15, 0.8, y, y + 0.58, 'cardboard'),
            box(-2.75, -2.3, -0.8, -0.35, y + 0.5, y + 0.88, 'cardboard'), box(-2.15, -1.7, -0.7, -0.3, y + 0.55, y + 0.85, 'cardboard')
        );
    } else if (load === 'lumber') {
        // 12 ft boards laid on the floor and over the dropped tailgate, a red flag on the overhang (most US states want one
        // past 4 ft)
        for (let k = 0; k < 3; k++) b.push(mid(-4.95, -1.3, 0.4, y + 0.08 * k, y + 0.08 * (k + 1), k % 2 ? 'wood2' : 'wood'));
        b.push(mid(-4.95, -4.75, 0.16, y - 0.3, y, 'flag'));
        back = 4.95;
    } else if (load === 'sofa') {
        b.push(
            box(-3.35, -1.35, -0.5, 0.42, y, y + 0.44, 'fabric'), box(-3.35, -1.35, 0.42, 0.74, y, y + 0.86, 'fabric'),
            box(-1.6, -1.35, -0.5, 0.42, y + 0.44, y + 0.64, 'fabric'), box(-3.35, -3.1, -0.5, 0.42, y + 0.44, y + 0.64, 'fabric')
        );
    } else if (load === 'fridge') {
        b.push(box(-2.05, -1.35, -0.75, -0.05, y, y + 1.72, 'white'), box(-2.8, -2.2, 0.15, 0.7, y, y + 0.5, 'cardboard'));
    } else if (load === 'hay') {
        // small square bales, 0.91 x 0.46 x 0.36 m: two along, three across, two layers, one on top
        for (const [f0, f1] of [[-2.25, -1.34], [-3.18, -2.27]]) {
            for (const s of [-0.71, 0, 0.71]) b.push(box(f0, f1, s - 0.23, s + 0.23, y, y + 0.36, 'hay'));
            for (const s of [-0.36, 0.36]) b.push(box(f0, f1, s - 0.23, s + 0.23, y + 0.36, y + 0.72, 'hay'));
        }
        b.push(box(-2.7, -1.79, -0.23, 0.23, y + 0.72, y + 1.08, 'hay'));
    }
    return finish({
        kind: 'pickup', load, boxes: b, front: 2.95, back,
        wheels: wheels4(1.85, -1.95, 0.85, 0.4, 0.3),
        seats: [[0.45, -0.4], [0.45, 0.4], [-0.5, 0.35]], headTop: 1.83,
        head: { f: 2.96, y: 0.98, s: 0.72 }, tail: { f: -2.96, y: 1.15, s: 0.9, frame: 0 }
    });
}

// ---------------------------------------------------------------- semis

/**
 * A day-cab tractor, 6.75 m long, 2.5 m wide, the cab roof 3.15 m up and a fairing to 3.7 m; the fifth wheel (the
 * trailer's kingpin) KP m behind its place [estimate, typical of a US day cab with tandem drive axles].
 */
const KP = 2.1;

function tractor(): VBox[] {
    return [
        mid(1.3, 3.3, 1.12, 0.5, 1.7, 'body'), // bonnet
        mid(-0.95, 1.3, 1.24, 0.85, 3.15, 'body'), // cab
        mid(-0.95, 0.95, 1.15, 3.15, 3.7, 'body'), // roof fairing
        mid(-0.95, 0.6, 1.25, 0.45, 0.85, 'trim'), // fuel tanks and steps
        mid(-3.45, -0.95, 1.25, 0.35, 1.15, 'trim'), // frame, drive axles and the fifth wheel
        ...sides(-1.18, -1.0, 0.95, 1.13, 1.15, 3.95, 'chrome') // exhaust stacks
    ];
}

const TRACTOR_WHEELS: VWheel[] = [
    ...[-1, 1].map((s) => ({ frame: 0 as const, f: 2.2, s: s * 1.0, r: 0.52, w: 0.32 })),
    ...[-1.65, -2.95].flatMap((f) => [-1, 1].map((s) => ({ frame: 0 as const, f, s: s * 0.95, r: 0.52, w: 0.58 })))
];

/** Trailer sizes: front (ahead of the kingpin) and rear, the axles, the landing gear, the floor's top, m. */
const TRAILERS: Record<TrailerKind, { front: number; rear: number; axles: number[]; gear: number; floor: number }> = {
    // 53 ft dry van: the tandem's middle 12.2 m behind the kingpin (the 40 ft kingpin-to-axle limit of many states)
    van53: { front: 0.95, rear: -15.2, axles: [-11.6, -12.8], gear: -3.0, floor: 1.27 },
    // a 28 ft "pup", one axle [estimate, typical city delivery trailer]
    pup28: { front: 0.6, rear: -7.93, axles: [-6.9], gear: -1.9, floor: 1.27 },
    // a 48 ft flatbed, the deck 1.52 m up [estimate, typical], a headache rack at its front
    flatbed48: { front: 0.9, rear: -13.73, axles: [-10.6, -11.8], gear: -3.0, floor: 1.52 }
};
/** a box van's walls: 4.11 m high outside, the roof and walls 6 cm thick [estimate], 2.6 m wide */
const VAN_TOP = 4.11;
const HW = 1.3;
const WALL = 0.06;
/** pallets: 1.22 m along, 1.02 m across, 0.15 m high (the 48 x 40 in GMA pallet), loaded two across */
const PALLET_L = 1.22, PALLET_W = 1.02, PALLET_H = 0.15;

function trailerBoxes(t: TrailerKind, load: TrailerLoad, draw: () => number): VBox[] {
    const T = TRAILERS[t];
    const out: VBox[] = [];
    const add = (f0: number, f1: number, s0: number, s1: number, y0: number, y1: number, p: Paint): void => {
        out.push(box(f0, f1, s0, s1, y0, y1, p, 1));
    };
    const below = T.floor - 0.2;
    // under the floor: the axles and tyres as one block, the landing gear's legs and their brace, the rear under-ride bar
    const a0 = Math.min(...T.axles) - 0.6, a1 = Math.max(...T.axles) + 0.6;
    add(a0, a1, -1.27, 1.27, 0.05, below, 'trim');
    for (const s of [-1, 1]) add(T.gear - 0.15, T.gear, s > 0 ? 0.85 : -0.97, s > 0 ? 0.97 : -0.85, 0.3, below, 'trim');
    add(T.gear - 0.12, T.gear - 0.03, -0.85, 0.85, 0.6, 0.7, 'trim');
    add(T.rear + 0.1, T.rear + 0.25, -1.1, 1.1, 0.45, 0.6, 'trim');
    for (const s of [-0.8, 0.8]) add(T.rear + 0.15, T.rear + 0.25, s - 0.05, s + 0.05, 0.6, below, 'trim');
    if (t === 'flatbed48') {
        add(T.rear, T.front, -HW, HW, below, T.floor, 'deck');
        add(T.front - 0.15, T.front, -1.25, 1.25, T.floor, 2.9, 'trim'); // headache rack
        const y = T.floor;
        if (load === 'lumber') {
            // bundles of 16 ft lumber, 1.15 x 0.65 m, two across, three along, two high
            for (const [f1, f0] of [[0.6, -4.3], [-4.4, -9.3], [-9.4, -13.6]]) for (const s of [-1, 1]) for (const k of [0, 1]) {
                add(f0, f1, s > 0 ? 0.05 : -1.2, s > 0 ? 1.2 : -0.05, y + 0.65 * k, y + 0.65 * (k + 1), (k + (s > 0 ? 1 : 0)) % 2 ? 'wood2' : 'wood');
            }
        } else {
            // steel beams, 12 m, 0.3 m deep, on two layers of timber dunnage
            for (const f of [-1, -6.5, -12]) add(f - 0.1, f + 0.1, -1.2, 1.2, y, y + 0.1, 'wood');
            for (let k = 0; k < 6; k++) add(-12.6, -0.6, -1.15 + k * 0.4, -0.85 + k * 0.4, y + 0.1, y + 0.4, 'steel');
            for (const f of [-1, -6.5, -12]) add(f - 0.1, f + 0.1, -1.2, 1.2, y + 0.4, y + 0.5, 'wood');
            for (let k = 0; k < 5; k++) add(-12.6, -0.6, -0.95 + k * 0.4, -0.65 + k * 0.4, y + 0.5, y + 0.8, 'steel');
        }
        return out;
    }
    // a box van: floor, roof, side walls, the front wall, and the rear frame round the door opening
    const top = VAN_TOP, inTop = top - WALL, fr = T.rear;
    add(fr, T.front, -HW, HW, below, T.floor, 'floor');
    add(fr, T.front, -HW, HW, inTop, top, 'trailer');
    for (const s of [-1, 1]) add(fr, T.front, s > 0 ? HW - WALL : -HW, s > 0 ? HW : -HW + WALL, T.floor, inTop, 'trailer');
    add(T.front - WALL, T.front, -HW + WALL, HW - WALL, T.floor, inTop, 'trailer');
    add(fr, fr + 0.12, -HW + WALL, HW - WALL, inTop - 0.2, inTop, 'trim');
    for (const s of [-1, 1]) add(fr, fr + 0.12, s > 0 ? 1.12 : -HW + WALL, s > 0 ? HW - WALL : -1.12, T.floor, inTop - 0.2, 'trim');
    if (load === 'closed') {
        for (const s of [-1, 1]) add(fr, fr + 0.06, s > 0 ? 0 : -1.12, s > 0 ? 1.12 : 0, T.floor, inTop - 0.2, 'door');
        return out;
    }
    // the doors swung right round and latched back against the sides, as drivers do to drive with them open
    for (const s of [-1, 1]) add(fr + 0.02, fr + 1.14, s > 0 ? HW : -HW - 0.05, s > 0 ? HW + 0.05 : -HW, T.floor + 0.05, inTop - 0.2, 'door');
    if (load === 'pallets') {
        // shrink-wrapped pallets from the front wall back, two across; the rest of the floor already unloaded
        const most = Math.floor((T.front - WALL - (fr + 0.12)) / (PALLET_L + 0.05));
        const rows = 2 + (draw() % (most - 1)); // 2 rows to a full trailer
        for (let k = 0; k < rows; k++) {
            const f1 = T.front - WALL - 0.03 - k * (PALLET_L + 0.05), f0 = f1 - PALLET_L;
            for (const s of [-1, 1]) {
                if (k === rows - 1 && s > 0 && draw() % 2 === 0) continue; // the last row often half taken off
                const h = 1.0 + (draw() % 7) / 10; // 1.0-1.6 m of goods on the pallet
                const goods: Paint = (['cardboard', 'wrap', 'water'] as const)[draw() % 3]; // boxes, wrapped goods, bottled water
                const s0 = s > 0 ? 0.08 : -0.08 - PALLET_W, s1 = s0 + PALLET_W;
                add(f0, f1, s0, s1, T.floor, T.floor + PALLET_H, 'wood');
                add(f0 + 0.03, f1 - 0.03, s0 + 0.03, s1 - 0.03, T.floor + PALLET_H, T.floor + PALLET_H + h, goods);
            }
        }
    }
    return out;
}

function semi(t: TrailerKind, load: TrailerLoad, draw: () => number): VehicleShape {
    const T = TRAILERS[t];
    const axle = -(T.axles[0] + T.axles[T.axles.length - 1]) / 2;
    const wheels = [...TRACTOR_WHEELS, ...T.axles.flatMap((f) => [-1, 1].map((s) => ({ frame: 1 as const, f, s: s * 0.95, r: 0.5, w: 0.58 })))];
    return finish({
        kind: 'semi', load: `${t}/${load}`, boxes: [...tractor(), ...trailerBoxes(t, load, draw)],
        front: 3.3, back: KP - T.rear, trailer: { kp: KP, axle }, wheels,
        seats: [], headTop: 0,
        head: { f: 3.31, y: 0.85, s: 0.85 }, tail: { f: T.rear - 0.01, y: 1.0, s: 1.1, frame: 1 }
    });
}

// ---------------------------------------------------------------- the mix

/**
 * One vehicle from three draws of its own (integers): its kind, its load, and one for the loads that need more. Out of a
 * hundred: 26 toy cars, 20 saloons, 18 SUVs, 9 vans, 17 pickups, 10 semis (none when `semis` is false: the loops'
 * corners are too tight for a trailer) [design choices]. Pickups carry nothing 35 times in 100, else one of five loads;
 * trailers: a 53 ft van shut (30), open with pallets (20) or open and empty (10), a pup shut or open with pallets (10
 * each), a flatbed with lumber or steel (10 each).
 */
export function pickVehicle(kind: number, load: number, draw: () => number, semis: boolean): VehicleShape {
    let u = kind % 100;
    if (!semis) u = u % 90;
    if (u < 26) return car();
    if (u < 46) return sedan();
    if (u < 64) return suv();
    if (u < 73) return van();
    if (u < 90) {
        const l = load % 100;
        const loads: PickupLoad[] = ['boxes', 'lumber', 'sofa', 'fridge', 'hay'];
        return pickup(l < 35 ? 'empty' : loads[(l - 35) % loads.length]);
    }
    const l = load % 100;
    if (l < 30) return semi('van53', 'closed', draw);
    if (l < 50) return semi('van53', 'pallets', draw);
    if (l < 60) return semi('van53', 'empty', draw);
    if (l < 70) return semi('pup28', 'closed', draw);
    if (l < 80) return semi('pup28', 'pallets', draw);
    if (l < 90) return semi('flatbed48', 'lumber', draw);
    return semi('flatbed48', 'steel', draw);
}

/** The toy car's shape (the loops' and the tests' default). */
export const TOY_CAR: VehicleShape = car();
