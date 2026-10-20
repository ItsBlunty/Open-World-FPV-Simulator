// Street food vendors (map v15; owner, 2026-10-20: "Add some vendors around the city selling hot dogs and similar
// items"): carts with striped umbrellas on the city's sidewalks and in the park, selling hot dogs, pretzels, ice cream,
// coffee or tacos. The carts are solid (in the collision and its hash); who sells and the sign naming the food are
// not: the vendor is a person of the traffic (packages/traffic, standing behind the cart, there when people are on),
// the sign is drawn only (apps/fly buildings.ts). They come after everything else, from their own Rng, so the rest of
// the map is drawn exactly as before.
//
// Sizes are those of a New York street cart [estimate, typical: about 1.7 x 0.9 m, the counter 1 m up, an umbrella
// 2.4 m across]: carts are licensed for a spot on a sidewalk wide enough to leave people room to pass, against the
// kerb or the building line. Here they stand on the building side of the walking line (people walk the first 1.9 m from
// the kerb: traffic network.ts HUB_IN, WALK_OFF, PERSON.r), facing the street, the vendor behind.

import type { LevelBuilder, Material, Rng } from './builder';
import type { Spot } from './golden-props';

export type VendorKind = 'hotdogs' | 'pretzels' | 'icecream' | 'coffee' | 'tacos';

/** A street vendor: where they stand and the way they face (over their cart, to the customers), and what they sell. */
export interface Vendor {
    kind: VendorKind;
    /** the sign's words */
    name: string;
    /** where the vendor stands (the ground's height y), and the unit direction they face (an axis), m */
    x: number;
    y: number;
    z: number;
    nx: number;
    nz: number;
    /** the cart's middle on the ground plan, and its half length along the kerb and half depth, m */
    cx: number;
    cz: number;
    halfL: number;
    halfD: number;
    /** the cart's body: from y0 to y1 above the ground (the sign goes on its face to the customers) */
    bodyY0: number;
    bodyY1: number;
}

const NAMES: Record<VendorKind, string> = { hotdogs: 'HOT DOGS', pretzels: 'PRETZELS', icecream: 'ICE CREAM', coffee: 'COFFEE', tacos: 'TACOS' };

/** Each kind's cart body and its umbrella's two colours, alternating panel by panel. */
const LOOKS: Record<VendorKind, { body: Material; canopy: [Material, Material] }> = {
    hotdogs: { body: 'cart', canopy: ['awning-red', 'awning-yellow'] },
    pretzels: { body: 'cart', canopy: ['awning-blue', 'awning-yellow'] },
    icecream: { body: 'billboard', canopy: ['awning-red', 'billboard'] },
    coffee: { body: 'awning-green', canopy: ['awning-green', 'billboard'] },
    tacos: { body: 'cart', canopy: ['awning-green', 'awning-red'] }
};

/** the sidewalk carts, in turn (hot dogs most) */
const STREET_KINDS: VendorKind[] = ['hotdogs', 'pretzels', 'coffee', 'hotdogs', 'tacos', 'icecream', 'hotdogs', 'pretzels', 'coffee', 'hotdogs'];

/** The cart: 1.7 m long, 0.76 m deep body, the counter 0.99 m up, the umbrella's rim 2.2 m up and 1.2 m out [estimates]. */
const HALF_L = 0.85;
const HALF_D = 0.38;
const BODY_Y0 = 0.3;
const BODY_Y1 = 0.95;
const RIM = 2.2;
const CANOPY_R = 1.2;
/** where things stand in from the kerb: the cart's middle, the vendor; the building's face no nearer than FACE_MIN, m */
const CART_IN = 2.45;
const VENDOR_IN = 3.35;
const FACE_MIN = 3.9;
/** room a cart needs from a block's corner (crossing queues, lamps, signal poles), a door, a bus shelter, another cart */
const CORNER_ROOM = 14;
const DOOR_ROOM = 5;
const SHELTER_ROOM = 8;
const SPREAD = 70;
const STREET_CARTS = 8;

/**
 * The carts: up to STREET_CARTS on the sidewalks in front of buildings set back far enough, spread over the city, and
 * three in the park, along the east-west path either side of the fountain and by the path from the city. `shelters` are
 * the bus shelters (kept clear of).
 */
export function vendors(b: LevelBuilder, r: Rng, shelters: readonly Spot[]): Vendor[] {
    const cand: { x: number; z: number; y: number; nx: number; nz: number; ax: number; az: number }[] = [];
    const NX = [0, 0, -1, 1], NZ = [-1, 1, 0, 0];
    b.buildings.forEach((bd) => {
        const door = b.doors[bd.door];
        const blk = b.blocks[door.block];
        for (let k = 0; k < 4; k++) {
            const set = k === 0 ? bd.z0 - blk.z0 : k === 1 ? blk.z1 - bd.z1 : k === 2 ? bd.x0 - blk.x0 : blk.x1 - bd.x1;
            if (set < FACE_MIN) continue;
            // along the kerb (x for the north and south sides, z for the others); the kerb's line and the way into the block
            const fa = k < 2 ? bd.x0 : bd.z0, fc = k < 2 ? bd.x1 : bd.z1;
            const ua = k < 2 ? blk.x0 : blk.z0, uc = k < 2 ? blk.x1 : blk.z1;
            const lo = Math.max(fa + 1 + HALF_L, ua + CORNER_ROOM), hi = Math.min(fc - 1 - HALF_L, uc - CORNER_ROOM);
            if (hi < lo) continue;
            const kerb = k === 0 ? blk.z0 : k === 1 ? blk.z1 : k === 2 ? blk.x0 : blk.x1;
            const into = k === 0 || k === 2 ? 1 : -1;
            const onDoor = door.nx === NX[k] && door.nz === NZ[k];
            const du = k < 2 ? door.x : door.z;
            // the middle of the face, or the nearest place to it clear of the door
            for (const off of [0, 4, -4, 8, -8, 12, -12]) {
                const u = Math.round((lo + hi) / 2) + off;
                if (u < lo || u > hi) continue;
                if (onDoor && Math.abs(u - du) < DOOR_ROOM + HALF_L) continue;
                const at = (d: number): [number, number] => (k < 2 ? [u, kerb + into * d] : [kerb + into * d, u]);
                const [x, z] = at(VENDOR_IN), [ax, az] = at(CART_IN);
                if (shelters.some((s) => Math.hypot(s.x - ax, s.z - az) < SHELTER_ROOM)) continue;
                cand.push({ x, z, y: blk.y, nx: NX[k], nz: NZ[k], ax, az });
                break;
            }
        }
    });
    // shuffled with the map's own integer Rng, then spread out
    for (let i = cand.length - 1; i > 0; i--) {
        const j = r.int(0, i);
        [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    const picked: typeof cand = [];
    for (const c of cand) {
        if (picked.length >= STREET_CARTS) break;
        if (picked.every((p) => Math.hypot(p.ax - c.ax, p.az - c.az) >= SPREAD)) picked.push(c);
    }
    const out: Vendor[] = [];
    picked.forEach((p, i) => out.push(cart(b, STREET_KINDS[i % STREET_KINDS.length], p.ax, p.az, p.y, p.nx, p.nz)));
    // the park: either side of the fountain on the north edge of the east-west path (z 77-83), facing it, and one by
    // the path up from the city (x -3 to 3), facing it, south of the spawn pad's power line
    out.push(cart(b, 'icecream', -20, 75.4, 0, 0, 1));
    out.push(cart(b, 'hotdogs', 22, 75.4, 0, 0, 1));
    out.push(cart(b, 'coffee', 5.4, 28, 0, -1, 0));
    return out;
}

/**
 * A cart at (cx, cz) on ground y, its front (the customers' side) facing (nx, nz): a cabinet and wheels under the body,
 * the counter, the lids or display on top, the umbrella's pole and its striped canopy. The vendor stands behind it.
 */
function cart(b: LevelBuilder, kind: VendorKind, cx: number, cz: number, y: number, nx: number, nz: number): Vendor {
    const look = LOOKS[kind];
    // a box given along the cart (t, its length, to the right of the front) and across it (f, towards the front)
    const tx = -nz, tz = nx;
    const box = (m: Material, t0: number, t1: number, f0: number, f1: number, y0: number, y1: number): void => {
        const xs = [cx + tx * t0 + nx * f0, cx + tx * t1 + nx * f1], zs = [cz + tz * t0 + nz * f0, cz + tz * t1 + nz * f1];
        b.box(m, Math.min(xs[0], xs[1]), y + y0, Math.min(zs[0], zs[1]), Math.max(xs[0], xs[1]), y + y1, Math.max(zs[0], zs[1]));
    };
    box('metal', -HALF_L + 0.1, HALF_L - 0.1, -HALF_D + 0.06, HALF_D - 0.06, 0, BODY_Y0); // the cabinet
    for (const t of [-1, 1]) box('rubble', t * HALF_L - 0.04, t * HALF_L + 0.04, -0.28, 0.28, 0, 0.56); // the wheels
    box(look.body, -HALF_L, HALF_L, -HALF_D, HALF_D, BODY_Y0, BODY_Y1);
    box('metal', -HALF_L - 0.05, HALF_L + 0.05, -HALF_D - 0.07, HALF_D + 0.07, BODY_Y1, BODY_Y1 + 0.04); // the counter
    const top = BODY_Y1 + 0.04;
    if (kind === 'pretzels') box('glass', -0.55, 0.45, -0.22, 0.22, top, top + 0.42); // the display case
    else if (kind === 'coffee') box('metal', -0.6, -0.2, -0.15, 0.15, top, top + 0.45); // the urn
    else for (const t of [-0.55, 0.05]) box('metal', t, t + 0.45, -0.22, 0.22, top, top + 0.09); // steam well or freezer lids
    // two squeeze bottles at the front corner (ketchup and mustard; salsas at the taco cart)
    if (kind === 'hotdogs' || kind === 'tacos') {
        box('awning-red', 0.62, 0.69, 0.22, 0.29, top, top + 0.2);
        box(kind === 'tacos' ? 'awning-green' : 'awning-yellow', 0.72, 0.79, 0.22, 0.29, top, top + 0.2);
    }
    box('metal', 0.3, 0.35, -0.03, 0.03, top, RIM + 0.4); // the umbrella's pole, by the counter's end
    stripedCone(b, look.canopy, cx + tx * 0.325, cz + tz * 0.325, y + RIM, y + RIM + 0.45, CANOPY_R);
    return {
        kind, name: NAMES[kind], x: cx - nx * (VENDOR_IN - CART_IN), y, z: cz - nz * (VENDOR_IN - CART_IN), nx, nz,
        cx, cz, halfL: HALF_L, halfD: HALF_D, bodyY0: y + BODY_Y0, bodyY1: y + BODY_Y1
    };
}

/** An eight-sided cone (b.cone's), its panels in two colours by turns, closed underneath in the first. */
function stripedCone(b: LevelBuilder, m: [Material, Material], x: number, z: number, y0: number, y1: number, r: number): void {
    const S2 = 0.7071067811865476;
    const U = [1, 0, S2, -S2, 0, -1, -S2, -S2, -1, 0, -S2, S2, 0, 1, S2, S2];
    for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const pa = [x + U[i * 2] * r, y0, z + U[i * 2 + 1] * r], pb = [x + U[j * 2] * r, y0, z + U[j * 2 + 1] * r];
        b.tri(m[i % 2], pa, pb, [x, y1, z]);
        b.tri(m[0], [x, y0, z], pb, pa);
    }
}
