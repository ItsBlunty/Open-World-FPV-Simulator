// Bounding volume hierarchy over a static triangle set: a binary tree of axis-aligned boxes, so a
// query visits only the triangles near it. Built once per level, read-only afterwards.
//
// The build is deterministic: median splits on the longest axis, ties broken by triangle index,
// so the same mesh gives the same tree and the same visiting order in every engine.

import { TRI_STRIDE } from './triangle';

/** Triangles per leaf at most. */
const LEAF_SIZE = 4;

export class Bvh {
    /** per node: min x, y, z, max x, y, z */
    readonly box: Float64Array;
    /** per node: index of the left child (the right one follows it), or -1 for a leaf */
    readonly left: Int32Array;
    /** per leaf: range [first, first + count) into `order` */
    readonly first: Int32Array;
    readonly count: Int32Array;
    /** triangle indices in leaf order */
    readonly order: Int32Array;
    /** deepest level of the tree (the root is 1); a traversal stack never needs more than this + 1 slots */
    readonly depth: number;

    constructor(tris: Float64Array, n: number) {
        const maxNodes = Math.max(1, 2 * n);
        this.box = new Float64Array(maxNodes * 6);
        this.left = new Int32Array(maxNodes).fill(-1);
        this.first = new Int32Array(maxNodes);
        this.count = new Int32Array(maxNodes);
        const order = new Int32Array(n);
        for (let i = 0; i < n; i++) order[i] = i;
        this.order = order;
        const cen = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) {
            const o = i * TRI_STRIDE;
            for (let a = 0; a < 3; a++) cen[i * 3 + a] = (tris[o + a] + tris[o + 3 + a] + tris[o + 6 + a]) / 3;
        }
        let nodes = 1;
        let depth = 0;
        // explicit stack of [node, first, count, level]
        const stack: number[][] = [[0, 0, n, 1]];
        while (stack.length > 0) {
            const [node, f, c, level] = stack.pop()!;
            if (level > depth) depth = level;
            this.fitBox(node, tris, f, c);
            if (c <= LEAF_SIZE) {
                this.first[node] = f;
                this.count[node] = c;
                continue;
            }
            // split on the longest axis of the centroids' box, at the median
            let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity, hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity;
            for (let i = f; i < f + c; i++) {
                const j = order[i] * 3;
                if (cen[j] < lo0) lo0 = cen[j]; if (cen[j] > hi0) hi0 = cen[j];
                if (cen[j + 1] < lo1) lo1 = cen[j + 1]; if (cen[j + 1] > hi1) hi1 = cen[j + 1];
                if (cen[j + 2] < lo2) lo2 = cen[j + 2]; if (cen[j + 2] > hi2) hi2 = cen[j + 2];
            }
            const e0 = hi0 - lo0, e1 = hi1 - lo1, e2 = hi2 - lo2;
            const axis = e0 >= e1 && e0 >= e2 ? 0 : e1 >= e2 ? 1 : 2;
            const part = Array.from(order.subarray(f, f + c));
            part.sort((p, q) => cen[p * 3 + axis] - cen[q * 3 + axis] || p - q);
            order.set(part, f);
            const half = c >> 1;
            const l = nodes;
            nodes += 2;
            this.left[node] = l;
            stack.push([l + 1, f + half, c - half, level + 1], [l, f, half, level + 1]);
        }
        this.depth = depth;
    }

    private fitBox(node: number, tris: Float64Array, f: number, c: number): void {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let i = f; i < f + c; i++) {
            const o = this.order[i] * TRI_STRIDE;
            for (let v = 0; v < 9; v += 3) {
                const x = tris[o + v], y = tris[o + v + 1], z = tris[o + v + 2];
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
                if (z < z0) z0 = z; if (z > z1) z1 = z;
            }
        }
        const b = node * 6;
        this.box[b] = x0; this.box[b + 1] = y0; this.box[b + 2] = z0;
        this.box[b + 3] = x1; this.box[b + 4] = y1; this.box[b + 5] = z1;
    }
}
