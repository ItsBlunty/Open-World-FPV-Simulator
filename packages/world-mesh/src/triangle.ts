// Sphere-vs-triangle geometry for the mesh contact world.
//
// Collision results change the simulation state, so this file uses only + - * /, Math.sqrt and
// comparisons: those are exactly rounded by IEEE 754 and give the same bits in every JavaScript
// engine (CLAUDE.md, Determinism). Triangles are two-sided: a level can be open geometry.

/**
 * Triangles packed in one Float64Array, TRI_STRIDE numbers each: vertices a, b, c (9), the unit
 * normal n = (b - a) x (c - a) / |...| (3) and the plane offset d = n . a (1).
 */
export const TRI_STRIDE = 13;

/** Region of a closest point: inside the face, or on an edge or vertex. */
export const FACE = 0;
export const EDGE_OR_VERTEX = 1;

/** Result of `closest`: the closest point q, the distance, and the unit direction from q to the query point. */
export interface Closest {
    qx: number; qy: number; qz: number;
    dist: number;
    nx: number; ny: number; nz: number;
}

export function newClosest(): Closest {
    return { qx: 0, qy: 0, qz: 0, dist: 0, nx: 0, ny: 0, nz: 0 };
}

/**
 * Closest point of triangle `k` to p: the standard Voronoi-region test (which vertex, edge or the
 * face is nearest, from dot products along the two edges from each vertex). Inside the face, the
 * distance and direction come straight from the plane, so a sphere over a flat floor gets exactly
 * the floor's normal. When p lies on the surface the direction is n.
 */
export function closest(tris: Float64Array, k: number, px: number, py: number, pz: number, out: Closest): number {
    const o = k * TRI_STRIDE;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
    const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return point(tris, o, ax, ay, az, px, py, pz, out);
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return point(tris, o, bx, by, bz, px, py, pz, out);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return point(tris, o, ax + abx * v, ay + aby * v, az + abz * v, px, py, pz, out);
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return point(tris, o, cx, cy, cz, px, py, pz, out);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return point(tris, o, ax + acx * w, ay + acy * w, az + acz * w, px, py, pz, out);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        return point(tris, o, bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w, px, py, pz, out);
    }
    // inside the face: project along the normal
    const nx = tris[o + 9], ny = tris[o + 10], nz = tris[o + 11];
    const s = nx * px + ny * py + nz * pz - tris[o + 12];
    out.qx = px - nx * s; out.qy = py - ny * s; out.qz = pz - nz * s;
    if (s < 0) {
        out.dist = -s;
        out.nx = -nx; out.ny = -ny; out.nz = -nz;
    } else {
        out.dist = s;
        out.nx = nx; out.ny = ny; out.nz = nz;
    }
    return FACE;
}

function point(tris: Float64Array, o: number, qx: number, qy: number, qz: number, px: number, py: number, pz: number, out: Closest): number {
    out.qx = qx; out.qy = qy; out.qz = qz;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out.dist = dist;
    if (dist > 0) {
        out.nx = dx / dist; out.ny = dy / dist; out.nz = dz / dist;
    } else {
        out.nx = tris[o + 9]; out.ny = tris[o + 10]; out.nz = tris[o + 11];
    }
    return EDGE_OR_VERTEX;
}

/** Contact normal written by `sweepTriangle`. */
export interface SweepHit {
    nx: number; ny: number; nz: number;
}

/**
 * Earliest fraction t in [0, 1] at which a sphere of radius R, its centre moving from A to A + D,
 * touches triangle `k`; -1 if it never does. The caller has checked that the sphere does not
 * overlap the triangle at t = 0. On a hit, `hit` receives the outward unit normal at the contact.
 *
 * Exact, not stepped: the earliest contact is with the face, an edge or a vertex. A face contact
 * is a plane crossing whose touch point lies inside the triangle; an edge contact is the entry into
 * a cylinder of radius R around the edge, inside the edge's length; a vertex contact is the entry
 * into a sphere of radius R around it. Each is a linear or quadratic equation in t, solved exactly,
 * so no step size can miss a wall.
 */
export function sweepTriangle(
    tris: Float64Array, k: number,
    ax: number, ay: number, az: number, dx: number, dy: number, dz: number, R: number,
    hit: SweepHit
): number {
    const o = k * TRI_STRIDE;
    const nx = tris[o + 9], ny = tris[o + 10], nz = tris[o + 11], d = tris[o + 12];
    const s0 = nx * ax + ny * ay + nz * az - d;
    const s1 = nx * (ax + dx) + ny * (ay + dy) + nz * (az + dz) - d;
    // face: the touch point of the plane crossing must lie inside the triangle (s0 = R: touching
    // at the start and moving in, t = 0)
    if (s0 >= R && s1 < R) {
        const t = (s0 - R) / (s0 - s1);
        if (insideFace(tris, o, ax + dx * t - nx * R, ay + dy * t - ny * R, az + dz * t - nz * R)) {
            hit.nx = nx; hit.ny = ny; hit.nz = nz;
            return t;
        }
    } else if (s0 <= -R && s1 > -R) {
        const t = (s0 + R) / (s0 - s1);
        if (insideFace(tris, o, ax + dx * t + nx * R, ay + dy * t + ny * R, az + dz * t + nz * R)) {
            hit.nx = -nx; hit.ny = -ny; hit.nz = -nz;
            return t;
        }
    }
    // otherwise the first touch, if any, is on an edge or a vertex
    let best = -1;
    best = sweepEdge(tris[o], tris[o + 1], tris[o + 2], tris[o + 3], tris[o + 4], tris[o + 5], ax, ay, az, dx, dy, dz, R, best, hit);
    best = sweepEdge(tris[o + 3], tris[o + 4], tris[o + 5], tris[o + 6], tris[o + 7], tris[o + 8], ax, ay, az, dx, dy, dz, R, best, hit);
    best = sweepEdge(tris[o + 6], tris[o + 7], tris[o + 8], tris[o], tris[o + 1], tris[o + 2], ax, ay, az, dx, dy, dz, R, best, hit);
    best = sweepVertex(tris[o], tris[o + 1], tris[o + 2], ax, ay, az, dx, dy, dz, R, best, hit);
    best = sweepVertex(tris[o + 3], tris[o + 4], tris[o + 5], ax, ay, az, dx, dy, dz, R, best, hit);
    best = sweepVertex(tris[o + 6], tris[o + 7], tris[o + 8], ax, ay, az, dx, dy, dz, R, best, hit);
    return best;
}

/** Point q (on the triangle's plane) inside the triangle or on its border. */
function insideFace(tris: Float64Array, o: number, qx: number, qy: number, qz: number): boolean {
    const nx = tris[o + 9], ny = tris[o + 10], nz = tris[o + 11];
    for (let e = 0; e < 3; e++) {
        const i = o + e * 3, j = o + ((e + 1) % 3) * 3;
        const ex = tris[j] - tris[i], ey = tris[j + 1] - tris[i + 1], ez = tris[j + 2] - tris[i + 2];
        const wx = qx - tris[i], wy = qy - tris[i + 1], wz = qz - tris[i + 2];
        // (e x w) . n < 0: q is outside this edge
        if ((ey * wz - ez * wy) * nx + (ez * wx - ex * wz) * ny + (ex * wy - ey * wx) * nz < 0) return false;
    }
    return true;
}

/** Entry into the cylinder of radius R around edge p0-p1, within its length. Returns the new best t. */
function sweepEdge(
    p0x: number, p0y: number, p0z: number, p1x: number, p1y: number, p1z: number,
    ax: number, ay: number, az: number, dx: number, dy: number, dz: number, R: number,
    best: number, hit: SweepHit
): number {
    const ex = p1x - p0x, ey = p1y - p0y, ez = p1z - p0z;
    const mx = ax - p0x, my = ay - p0y, mz = az - p0z;
    const ee = ex * ex + ey * ey + ez * ez;
    const md = mx * ex + my * ey + mz * ez;
    const dd = dx * ex + dy * ey + dz * ez;
    // |m + t D|^2 - ((m + t D) . e)^2 / ee = R^2, multiplied through by ee: a t^2 + 2 b t + c = 0
    const a = ee * (dx * dx + dy * dy + dz * dz) - dd * dd;
    if (a <= 0) return best; // moving along the edge (or not at all): its end vertices are the contacts
    const b = ee * (mx * dx + my * dy + mz * dz) - md * dd;
    if (b >= 0) return best; // moving away from the edge's line
    const c = ee * (mx * mx + my * my + mz * mz) - md * md - R * R * ee;
    if (c < 0) return best; // already within R of the line, beyond the edge's ends: the vertices decide
    const disc = b * b - a * c;
    if (disc < 0) return best;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > 1 || (best >= 0 && t >= best)) return best;
    const u = (md + t * dd) / ee;
    if (u < 0 || u > 1) return best;
    const qx = ax + dx * t - (p0x + ex * u), qy = ay + dy * t - (p0y + ey * u), qz = az + dz * t - (p0z + ez * u);
    const l = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (l <= 0) return best;
    hit.nx = qx / l; hit.ny = qy / l; hit.nz = qz / l;
    return t;
}

/** Entry into the sphere of radius R around vertex p. Returns the new best t. */
function sweepVertex(
    px: number, py: number, pz: number,
    ax: number, ay: number, az: number, dx: number, dy: number, dz: number, R: number,
    best: number, hit: SweepHit
): number {
    const mx = ax - px, my = ay - py, mz = az - pz;
    const a = dx * dx + dy * dy + dz * dz;
    if (a <= 0) return best;
    const b = mx * dx + my * dy + mz * dz;
    if (b >= 0) return best;
    const c = mx * mx + my * my + mz * mz - R * R;
    if (c < 0) return best;
    const disc = b * b - a * c;
    if (disc < 0) return best;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > 1 || (best >= 0 && t >= best)) return best;
    const qx = mx + dx * t, qy = my + dy * t, qz = mz + dz * t;
    const l = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (l <= 0) return best;
    hit.nx = qx / l; hit.ny = qy / l; hit.nz = qz / l;
    return t;
}

/**
 * Ray against triangle `k`, both sides: solves origin + t d = a + u (b - a) + v (c - a) by Cramer's
 * rule (the method known as Moller-Trumbore). Returns the ray parameter of the hit, or -1.
 */
export function rayTriangle(tris: Float64Array, k: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const o = k * TRI_STRIDE;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az;
    const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det === 0) return -1;
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t >= 0 ? t : -1;
}
