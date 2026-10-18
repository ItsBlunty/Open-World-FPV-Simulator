// Blockout geometry: boxes, prisms and slabs tagged with a material. One builder holds the whole
// level; the renderer draws each material's triangles and the collision takes all of them, so what
// the pilot sees is exactly what the quad hits.
//
// Determinism: a level is built from integers and simple decimals with a seeded integer PRNG (Rng),
// so every engine builds the same bytes; levelSha256 is the collision hash a log header records.

import { sha256Hex } from '@owfpv/sim-core';

export const MATERIALS = [
    'grass', 'asphalt', 'sidewalk', 'path', 'concrete', 'concrete-dark', 'brick', 'plaster', 'glass',
    'metal', 'rust', 'wood', 'trunk', 'foliage', 'rubble', 'water', 'marking', 'container-a', 'container-b', 'container-c',
    // city building fronts: the renderer paints storeys of windows on their walls
    'facade-concrete', 'facade-brick', 'facade-plaster', 'facade-glass', 'facade-dark'
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

export class LevelBuilder {
    private readonly tris = new Map<Material, number[]>();
    private readonly paint = new Map<Material, number[]>();
    readonly spawns: SpawnPoint[] = [];
    readonly blocks: Block[] = [];

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

    /** Quad a-b-c-d, counter-clockwise seen from the side it faces. */
    quad(m: Material, a: number[], b: number[], c: number[], d: number[]): this {
        this.push(m, a, b, c, a, c, d);
        return this;
    }

    /** Axis-aligned box from (x0, y0, z0) to (x1, y1, z1); faces wound outwards. */
    box(m: Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
        if (x1 < x0) [x0, x1] = [x1, x0];
        if (y1 < y0) [y0, y1] = [y1, y0];
        if (z1 < z0) [z0, z1] = [z1, z0];
        if (x1 - x0 <= 0 || y1 - y0 <= 0 || z1 - z0 <= 0) return this;
        this.quad(m, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // bottom
        this.quad(m, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // top
        this.quad(m, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // -z
        this.quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
        this.quad(m, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -x
        this.quad(m, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // +x
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

    /** Upright n-sided cone (tree canopies): base centre x, y0, z, radius r, apex at y1. */
    cone(m: Material, x: number, z: number, y0: number, y1: number, r: number, n = 6): this {
        for (let i = 0; i < n; i++) {
            const a = corner(n, i, r);
            const b = corner(n, i + 1, r);
            this.push(m, [x + a[0], y0, z + a[1]], [x + b[0], y0, z + b[1]], [x, y1, z]);
            this.push(m, [x, y0, z], [x + b[0], y0, z + b[1]], [x + a[0], y0, z + a[1]]);
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
        return { id, version, name, halfSize, parts, collision, triangleCount: n / 9, spawns: this.spawns.slice(), blocks: this.blocks.slice() };
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
