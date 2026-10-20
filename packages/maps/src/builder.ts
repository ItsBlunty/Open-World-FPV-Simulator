// Blockout geometry: boxes, prisms and slabs tagged with a material. One builder holds the whole
// level; the renderer draws each material's triangles and the collision takes all of them, so what
// the pilot sees is exactly what the quad hits.
//
// Determinism: a level is built from integers and simple decimals with a seeded integer PRNG (Rng),
// so every engine builds the same bytes; levelSha256 is the collision hash a log header records.

import { sha256Hex } from '@owfpv/sim-core';
import type { TimeTrial } from './trials';
import type { Vendor } from './vendors';

export const MATERIALS = [
    'grass', 'asphalt', 'sidewalk', 'path', 'concrete', 'concrete-dark', 'brick', 'plaster', 'glass',
    'metal', 'rust', 'wood', 'trunk', 'foliage', 'rubble', 'water', 'marking', 'container-a', 'container-b', 'container-c',
    // city building fronts: the renderer paints storeys of windows on their walls
    'facade-concrete', 'facade-brick', 'facade-plaster', 'facade-glass', 'facade-dark',
    // the glass set back in city windows: punched windows and shop fronts, and glass towers' ribbon windows (mullions painted)
    'window', 'window-ribbon',
    // the tower crane's steelwork (painted, as most tower cranes are)
    'crane',
    // street furniture: a bus shelter's frosted panels (drawn see-through, solid as glass), a dumpster, billboard faces
    'frosted', 'dumpster', 'billboard',
    // the railway (map v7): track ballast, steel rails, wooden sleepers (paint), the tunnel's stonework, goods wagons
    'ballast', 'rail', 'sleeper', 'stone', 'wagon',
    // map v10: two more container colours, conifer needles and a lighter broadleaf green
    'container-d', 'container-e', 'foliage-dark', 'foliage-light',
    // map v15: street vendors' carts (stainless steel) and their umbrellas' colours
    'cart', 'awning-red', 'awning-yellow', 'awning-blue', 'awning-green',
    // map v17: the Duga radar's rusted legs, its grey bracing and arms, its pale cages
    'duga-rust', 'duga-grey', 'duga-cage'
] as const;
export type Material = (typeof MATERIALS)[number];

export interface SpawnPoint {
    id: string;
    name: string;
    /** x, z of the spot and the heading (deg, 0 = north / -z, + = right); y is found by a ray down */
    x: number;
    z: number;
    yawDeg: number;
    /** start this high above the surface under it, m (0 = resting on it) */
    above?: number;
}

/** A city block's sidewalk, kerb to kerb, x0 < x1 and z0 < z1 (m). Traffic drives and walks around these. */
export interface Block {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    /** top of the sidewalk, m */
    y: number;
}

/**
 * A city building's street entrance: a 2.5 m shop-front bay whose glass runs down to the sidewalk (no sill), so
 * people can walk in. (x, z) is the middle of the opening on the building's outer face, (nx, nz) the face's
 * outward normal; the glass (and the door in it) sits `depth` m in from the face.
 */
export interface Door {
    x: number;
    z: number;
    /** the sidewalk under it, m */
    y: number;
    nx: number;
    nz: number;
    /** the opening's width and height, m */
    width: number;
    height: number;
    depth: number;
    /** the city block (index into Level.blocks) and the building (index into Level.buildings) */
    block: number;
    building: number;
}

/** A named city building, for the renderer's signs and the people's doors (not part of the collision). */
export interface Building {
    name: string;
    /** a number for its sign's colours: the renderer's */
    look: number;
    /** footprint of the street floor, m */
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    /** the sidewalk under it and its highest roof, m */
    y0: number;
    top: number;
    /** footprint of its highest part (a podium's set-back tower; else the footprint above) */
    tx0: number;
    tz0: number;
    tx1: number;
    tz1: number;
    storeys: number;
    /** the faces that look onto a street: a mask of FACE.nz, pz, nx, px */
    street: number;
    /** its entrance: index into Level.doors */
    door: number;
}

/**
 * A golden prop to collect (owner, 2026-10-18: Tony Hawk style pickups, numbered, hidden around the map). Not solid:
 * not in the collision, nor in its hash. The game counts one as taken when the quad's centre comes within its
 * radius (apps/fly collect.ts).
 */
export interface Collectible {
    /** its number, 1 up: what the collection screen shows and pilots call it by */
    n: number;
    /** its centre, m */
    x: number;
    y: number;
    z: number;
    /** the part of the map it is in, shown before it is found */
    area: string;
    /** where it is, said the way one pilot tells another; shown once it is found */
    spot: string;
}

export interface Level {
    id: string;
    version: number;
    name: string;
    /** the playable square's half size, m (the ground reaches further) */
    halfSize: number;
    /** per material: flat triangle soup, xyz per vertex, three vertices per triangle (decals included) */
    parts: Map<Material, Float32Array>;
    /** every triangle for the collision, xyz per vertex (Float64: the collision's own precision) */
    collision: Float64Array;
    triangleCount: number;
    spawns: SpawnPoint[];
    /** the city blocks, for traffic routes (not part of the collision, nor of its hash) */
    blocks: Block[];
    /** named city buildings and their entrances (not part of the collision, nor of its hash) */
    buildings: Building[];
    doors: Door[];
    /** golden props to collect (not part of the collision, nor of its hash) */
    collectibles: Collectible[];
    /** the railway the train runs on (map v7; not part of the collision, nor of its hash: the track itself is), or null */
    railway: Railway | null;
    /** time trial courses (map v12; their gates are not part of the collision, nor of its hash: the arches and pads are) */
    trials: TimeTrial[];
    /** street vendors (map v15; who sells and their signs are not part of the collision, nor of its hash: the carts are) */
    vendors: Vendor[];
}

/**
 * A railway loop for the train (packages/traffic train.ts): a polygon's corners in the order the train runs them, every
 * turn a right angle rounded to `radius` (the same path as traffic route.ts pathThrough builds, closed). Metres, x and z.
 */
export interface Railway {
    corners: [number, number][];
    radius: number;
    /** the loop's length, m */
    length: number;
    /**
     * the track bed's height along the loop (ballast top, or the viaduct deck's top), as breakpoints [s, y] from s = 0 to
     * `length`, straight between them and eased over `curve` m round each (railway.ts bedAt); the rails' top is 0.15 m up
     */
    profile: [number, number][];
    curve: number;
    /** where the front of the train stops at each station, a point on a straight, in the order the train reaches them */
    stops: { name: string; x: number; z: number }[];
    /** the tunnel: its straight bore from a0 to a1 along its axis, at `c` across it; its inside half width and crown height, m */
    tunnel: { axis: 'x' | 'z'; a0: number; a1: number; c: number; halfWidth: number; crown: number };
    /**
     * the way from the street up to the city station (map v9): the city block (Level.blocks index) whose garden it leaves
     * from; the garden's cross path (z) that meets the block's west and east sidewalks; the walk from there up the stair to
     * the platform's waiting line ([x, y, z] points); the platform's top; the waiting line (z, from waitX0 to waitX1) and
     * the line just inside the coaches' doors (z)
     */
    walkway?: { block: number; plazaZ: number; up: [number, number, number][]; platformY: number; waitZ: number; doorZ: number; waitX0: number; waitX1: number };
}

/** Mulberry32: 32-bit integer state, Math.imul only, so every JavaScript engine draws the same numbers. */
export class Rng {
    private s: number;
    constructor(seed: number) {
        this.s = seed >>> 0;
    }
    /** an integer in [0, 2^32) */
    u32(): number {
        this.s = (this.s + 0x6d2b79f5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    }
    /** an integer in [lo, hi] */
    int(lo: number, hi: number): number {
        return lo + (this.u32() % (hi - lo + 1));
    }
    /** true with probability num / den */
    chance(num: number, den: number): boolean {
        return this.u32() % den < num;
    }
    pick<T>(a: readonly T[]): T {
        return a[this.u32() % a.length];
    }
}

/** A box's faces, for LevelBuilder.box's `skip` mask: bottom, top, and the faces looking along -z, +z, -x, +x. */
export const FACE = { bottom: 1, top: 2, nz: 4, pz: 8, nx: 16, px: 32 } as const;

export class LevelBuilder {
    private readonly tris = new Map<Material, number[]>();
    private readonly paint = new Map<Material, number[]>();
    readonly spawns: SpawnPoint[] = [];
    readonly blocks: Block[] = [];
    readonly buildings: Building[] = [];
    readonly doors: Door[] = [];
    readonly collectibles: Collectible[] = [];
    railway: Railway | null = null;
    readonly trials: TimeTrial[] = [];
    readonly vendors: Vendor[] = [];

    private push(m: Material, ...v: number[][]): void {
        let a = this.tris.get(m);
        if (!a) this.tris.set(m, (a = []));
        for (const p of v) a.push(p[0], p[1], p[2]);
    }

    /**
     * Paint on the ground (road lines, crossings): an upward rectangle drawn 2 cm above y but left out
     * of the collision. 2 cm is under half the quad's 45 mm collision spheres, so flying over it looks
     * and feels the same as flying over the surface beneath; as geometry, every stripe's edges would be
     * steps for the contact solver to catch on.
     */
    decal(m: Material, x0: number, z0: number, x1: number, z1: number, y = 0): this {
        const v = y + 0.02;
        let a = this.paint.get(m);
        if (!a) this.paint.set(m, (a = []));
        a.push(x0, v, z0, x0, v, z1, x1, v, z1, x0, v, z0, x1, v, z1, x1, v, z0);
        return this;
    }

    /** Paint quad a-b-c-d (counter-clockwise seen from the side it faces): drawn, left out of the collision, as decal(). */
    paintQuad(m: Material, a: number[], b: number[], c: number[], d: number[]): this {
        let p = this.paint.get(m);
        if (!p) this.paint.set(m, (p = []));
        for (const v of [a, b, c, a, c, d]) p.push(v[0], v[1], v[2]);
        return this;
    }

    /** Triangle a-b-c, counter-clockwise seen from the side it faces. */
    tri(m: Material, a: number[], b: number[], c: number[]): this {
        this.push(m, a, b, c);
        return this;
    }

    /** Quad a-b-c-d, counter-clockwise seen from the side it faces. */
    quad(m: Material, a: number[], b: number[], c: number[], d: number[]): this {
        this.push(m, a, b, c, a, c, d);
        return this;
    }

    /**
     * Axis-aligned box from (x0, y0, z0) to (x1, y1, z1); faces wound outwards. `skip` leaves out faces that
     * lie against other solid geometry (nobody can see or reach them): a mask of the FACE bits.
     */
    box(m: Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = 0): this {
        if (x1 < x0) [x0, x1] = [x1, x0];
        if (y1 < y0) [y0, y1] = [y1, y0];
        if (z1 < z0) [z0, z1] = [z1, z0];
        if (x1 - x0 <= 0 || y1 - y0 <= 0 || z1 - z0 <= 0) return this;
        if (!(skip & FACE.bottom)) this.quad(m, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
        if (!(skip & FACE.top)) this.quad(m, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
        if (!(skip & FACE.nz)) this.quad(m, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
        if (!(skip & FACE.pz)) this.quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
        if (!(skip & FACE.nx)) this.quad(m, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
        if (!(skip & FACE.px)) this.quad(m, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
        return this;
    }

    /**
     * A sloped slab (a ramp) between x0 and x1: its top rises in a straight line from height ya at z = za to
     * yb at z = zb, and it is t thick (measured straight down). Its two ends are left open: they sit in the
     * floor it starts from and against the edge of the floor it climbs to.
     */
    rampZ(m: Material, x0: number, x1: number, za: number, zb: number, ya: number, yb: number, t: number): this {
        const a = [x0, ya, za], b = [x1, ya, za], c = [x1, yb, zb], d = [x0, yb, zb];
        const a2 = [x0, ya - t, za], b2 = [x1, ya - t, za], c2 = [x1, yb - t, zb], d2 = [x0, yb - t, zb];
        const centre = [(x0 + x1) / 2, (ya + yb - t) / 2, (za + zb) / 2];
        this.quadOut(m, centre, a, b, c, d); // top
        this.quadOut(m, centre, a2, d2, c2, b2); // underside
        this.quadOut(m, centre, a, d, d2, a2); // x0 side
        this.quadOut(m, centre, b, b2, c2, c); // x1 side
        return this;
    }

    /** Quad a-b-c-d (a planar convex one, its corners in order around it), wound to face away from `centre`. */
    quadOut(m: Material, centre: number[], a: number[], b: number[], c: number[], d: number[]): void {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const out = nx * (a[0] - centre[0]) + ny * (a[1] - centre[1]) + nz * (a[2] - centre[2]);
        if (out >= 0) this.quad(m, a, b, c, d);
        else this.quad(m, a, d, c, b);
    }

    /**
     * A straight bar of square section w from point a to point b (lattice members, ropes): its sides are
     * parallel to the line a-b, its ends square to it. Points are [x, y, z]; only + - * / and sqrt are used.
     */
    bar(m: Material, a: number[], b: number[], w: number): this {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (l <= 0) return this;
        // u: square to the bar and level (or along x for an upright bar), v square to both
        let ux = -dz, uy = 0, uz = dx;
        let ul = Math.sqrt(ux * ux + uz * uz);
        if (ul < 1e-6 * l) { ux = l; uz = 0; ul = l; }
        ux = (ux / ul) * w / 2; uy = 0; uz = (uz / ul) * w / 2;
        let vx = (dy * uz - dz * uy) / l, vy = (dz * ux - dx * uz) / l, vz = (dx * uy - dy * ux) / l;
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        vx = (vx / vl) * w / 2; vy = (vy / vl) * w / 2; vz = (vz / vl) * w / 2;
        const p = (q: number[], su: number, sv: number): number[] => [q[0] + su * ux + sv * vx, q[1] + su * uy + sv * vy, q[2] + su * uz + sv * vz];
        const a0 = p(a, -1, -1), a1 = p(a, 1, -1), a2 = p(a, 1, 1), a3 = p(a, -1, 1);
        const b0 = p(b, -1, -1), b1 = p(b, 1, -1), b2 = p(b, 1, 1), b3 = p(b, -1, 1);
        const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        this.quadOut(m, centre, a0, a1, b1, b0);
        this.quadOut(m, centre, a1, a2, b2, b1);
        this.quadOut(m, centre, a2, a3, b3, b2);
        this.quadOut(m, centre, a3, a0, b0, b3);
        this.quadOut(m, centre, a0, a1, a2, a3);
        this.quadOut(m, centre, b0, b1, b2, b3);
        return this;
    }

    /** Box given by its footprint centre and size, from y0 up h. */
    block(m: Material, cx: number, cz: number, sx: number, sz: number, y0: number, h: number): this {
        return this.box(m, cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + h, cz + sz / 2);
    }

    /** Upright n-sided prism (poles, trunks): centre x, z, from y0 to y1, radius r to the corners. */
    prism(m: Material, x: number, z: number, y0: number, y1: number, r: number, n = 6): this {
        const ring: number[][] = [];
        for (let i = 0; i < n; i++) ring.push(corner(n, i, r));
        for (let i = 0; i < n; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % n];
            this.quad(m, [x + a[0], y0, z + a[1]], [x + b[0], y0, z + b[1]], [x + b[0], y1, z + b[1]], [x + a[0], y1, z + a[1]]);
        }
        for (let i = 1; i < n - 1; i++) {
            const a = ring[0], b = ring[i], c = ring[i + 1];
            this.push(m, [x + a[0], y1, z + a[1]], [x + b[0], y1, z + b[1]], [x + c[0], y1, z + c[1]]);
            this.push(m, [x + a[0], y0, z + a[1]], [x + c[0], y0, z + c[1]], [x + b[0], y0, z + b[1]]);
        }
        return this;
    }

    /** Upright n-sided cone (tree canopies): base centre x, y0, z, radius r, apex at y1 (below y0: a hopper, point down). */
    cone(m: Material, x: number, z: number, y0: number, y1: number, r: number, n = 6): this {
        const down = y1 < y0;
        for (let i = 0; i < n; i++) {
            const a = corner(n, i, r);
            const b = corner(n, i + 1, r);
            const pa = [x + a[0], y0, z + a[1]], pb = [x + b[0], y0, z + b[1]];
            if (down) {
                this.push(m, pb, pa, [x, y1, z]);
                this.push(m, [x, y0, z], pa, pb);
            } else {
                this.push(m, pa, pb, [x, y1, z]);
                this.push(m, [x, y0, z], pb, pa);
            }
        }
        return this;
    }

    /** Triangle a-b-c, wound to face away from `centre`. */
    triOut(m: Material, centre: number[], a: number[], b: number[], c: number[]): void {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const out = nx * (a[0] - centre[0]) + ny * (a[1] - centre[1]) + nz * (a[2] - centre[2]);
        if (out >= 0) this.push(m, a, b, c);
        else this.push(m, a, c, b);
    }

    /**
     * A rounded lump (a clump of leaves): centre (x, y, z), radius r across and ry up. An n-sided band from 0.4 ry
     * below the centre to 0.4 ry above it, at 0.92 r, capped by a point at each end: 4n triangles.
     */
    blob(m: Material, x: number, y: number, z: number, r: number, ry: number, n = 6): this {
        const c = [x, y, z];
        const top = [x, y + ry, z], bot = [x, y - ry, z];
        const hi = y + 0.4 * ry, lo = y - 0.4 * ry, rr = 0.92 * r;
        for (let i = 0; i < n; i++) {
            const a = corner(n, i, rr), d = corner(n, i + 1, rr);
            const ah = [x + a[0], hi, z + a[1]], dh = [x + d[0], hi, z + d[1]];
            const al = [x + a[0], lo, z + a[1]], dl = [x + d[0], lo, z + d[1]];
            this.quadOut(m, c, al, dl, dh, ah);
            this.triOut(m, c, ah, dh, top);
            this.triOut(m, c, dl, al, bot);
        }
        return this;
    }

    /** A flat ground rectangle facing up at height y. */
    floor(m: Material, x0: number, z0: number, x1: number, z1: number, y = 0): this {
        return this.quad(m, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
    }

    spawn(s: SpawnPoint): this {
        this.spawns.push(s);
        return this;
    }

    build(id: string, version: number, name: string, halfSize: number): Level {
        const parts = new Map<Material, Float32Array>();
        let n = 0;
        for (const m of MATERIALS) {
            const a = this.tris.get(m) ?? [];
            const d = this.paint.get(m) ?? [];
            n += a.length;
            if (a.length + d.length > 0) parts.set(m, Float32Array.from(d.length ? a.concat(d) : a));
        }
        // collision in a fixed order (MATERIALS), so the hash does not depend on build order between materials
        const collision = new Float64Array(n);
        let o = 0;
        for (const m of MATERIALS) {
            const a = this.tris.get(m);
            if (!a) continue;
            collision.set(a, o);
            o += a.length;
        }
        return { id, version, name, halfSize, parts, collision, triangleCount: n / 9, spawns: this.spawns.slice(), blocks: this.blocks.slice(),
            buildings: this.buildings.slice(), doors: this.doors.slice(), collectibles: this.collectibles.slice(), railway: this.railway,
            trials: this.trials.slice(), vendors: this.vendors.slice() };
    }
}

/** Corner i of an n-gon of radius r, as [x, z]; the angles come from a table, not Math.cos, so every engine agrees. */
function corner(n: number, i: number, r: number): number[] {
    const t = UNIT[n];
    if (!t) throw new RangeError(`prisms and cones have 4, 6 or 8 sides, not ${n}`);
    const k = (i % n) * 2;
    return [t[k] * r, t[k + 1] * r];
}

const S2 = 0.7071067811865476; // sqrt(1/2)
const S3 = 0.8660254037844386; // sqrt(3)/2
const UNIT: Record<number, number[]> = {
    4: [1, 0, 0, -1, -1, 0, 0, 1],
    6: [1, 0, 0.5, -S3, -0.5, -S3, -1, 0, -0.5, S3, 0.5, S3],
    8: [1, 0, S2, -S2, 0, -1, -S2, -S2, -1, 0, -S2, S2, 0, 1, S2, S2]
};

/** sha256 of the collision triangles' bytes (little-endian Float64): the log header's collisionSha256. */
export function levelSha256(level: Level): string {
    const c = level.collision;
    const bytes = new Uint8Array(c.length * 8);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < c.length; i++) dv.setFloat64(i * 8, c[i], true);
    return sha256Hex(bytes);
}

/**
 * Where a spawn point puts the craft: x, y, z, yaw for sim-core's respawn. `groundY` is the height of
 * the first surface straight down from high above (x, z); the craft's lowest point (bodyBottom below
 * its centre) rests 1 cm above it, plus the point's `above`.
 */
export function spawnPose(s: SpawnPoint, groundY: (x: number, z: number) => number, bodyBottom: number): [number, number, number, number] {
    return [s.x, groundY(s.x, s.z) + bodyBottom + 0.01 + (s.above ?? 0), s.z, s.yawDeg];
}
