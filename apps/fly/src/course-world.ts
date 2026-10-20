// The time trials' own solids in the collision (owner, 2026-10-20): the pads, arches and flags of courses made in the
// creator (always solid), and one course's race gates while it is raced (its solid layer: sim-core log format /4 world
// records switch it on and off, so a replay has the gates exactly when the flight had them). The map's own courses'
// arches are part of the map. A wrapper round the collision the sim flies in (map, traffic, trains): stateless itself,
// so the session and every replay may build as many as they like.

import { sha256Hex } from '@owfpv/sim-core';
import type { ContactOut, ContactWorld } from '@owfpv/sim-core';
import { courseSolids } from '@owfpv/maps';
import type { TimeTrial } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';

/** The courses' solids built once: the always-solid part and each course's race gates (null: none). */
export interface CourseSolids {
    always: MeshContactWorld | null;
    race: (MeshContactWorld | null)[];
    /** folded into the collision hash (null: nothing of the courses' own is solid, so the hash is the map's as before) */
    sha256: string | null;
}

export function buildCourseSolids(courses: readonly TimeTrial[]): CourseSolids {
    const s = courseSolids(courses);
    const mesh = (t: Float64Array | null): MeshContactWorld | null => (t && t.length ? new MeshContactWorld(t) : null);
    const always = mesh(s.always), race = s.race.map(mesh);
    // what decides the collision: the custom courses (their arches) and every course's race gates, in layer order
    const solid = courses.map((t, c) => (t.custom || race[c] ? t : null));
    return { always, race, sha256: solid.some((t) => t !== null) ? textSha(JSON.stringify(solid)) : null };
}

/** The collision hash with the courses folded in (unchanged when they add nothing solid). */
export function withCourses(sha: string, solids: CourseSolids): string {
    return solids.sha256 === null ? sha : textSha(`${sha}|courses/1|${solids.sha256}`);
}

function textSha(text: string): string {
    return sha256Hex(new TextEncoder().encode(text));
}

/** The solid layer of course c (0 up) while it is raced: c + 1, or 0 when it has no race gates. */
export const layerOf = (solids: CourseSolids, c: number): number => (c >= 0 && solids.race[c] ? c + 1 : 0);

/** inner, with the custom courses' pads and arches, and the race gates of solid layer `layer` (0: none). */
export function courseWorld(inner: ContactWorld, solids: CourseSolids, layer: number): ContactWorld {
    const extra = [solids.always, layer > 0 ? solids.race[layer - 1] ?? null : null].filter((w): w is MeshContactWorld => w !== null);
    return extra.length ? new CourseWorld(inner, extra) : inner;
}

/** A contact as the merge keeps it: normal and distance. */
const C = 4;

export class CourseWorld implements ContactWorld {
    private readonly tmp = new Float64Array(64 * C);
    private readonly tmpOut: ContactOut = { sphere: 0, nx: 0, ny: 0, nz: 0 };

    constructor(readonly inner: ContactWorld, private readonly extra: readonly MeshContactWorld[]) {}

    at(tick: number): void {
        this.inner.at?.(tick);
    }

    movingNear(x: number, y: number, z: number, r: number): boolean {
        return this.inner.movingNear?.(x, y, z, r) ?? false;
    }

    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        let best = this.inner.sweep(c0, c1, r, pad, n, out);
        const o = this.tmpOut;
        for (const w of this.extra) {
            const t = w.sweep(c0, c1, r, pad, n, o);
            if (t < 0 || (best >= 0 && !(t < best))) continue;
            best = t;
            out.sphere = o.sphere; out.nx = o.nx; out.ny = o.ny; out.nz = o.nz;
        }
        return best;
    }

    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        if (this.inner.pushOut(x, y, z, r, out)) return true;
        for (const w of this.extra) if (w.pushOut(x, y, z, r, out)) return true;
        return false;
    }

    contacts(x: number, y: number, z: number, r: number, out: Float64Array, max: number, vel?: Float64Array): number {
        let k = this.inner.contacts(x, y, z, r, out, max, vel);
        const tmp = this.tmp, cap = Math.min(max, tmp.length / C);
        for (const w of this.extra) {
            const m = w.contacts(x, y, z, r, tmp, cap);
            for (let j = 0; j < m; j++) {
                // a free slot, else over the farthest if this one is closer (as TrafficWorld keeps them)
                let slot = k;
                if (k >= max) {
                    slot = 0;
                    for (let i = 1; i < max; i++) if (out[i * C + 3] > out[slot * C + 3]) slot = i;
                    if (!(tmp[j * C + 3] < out[slot * C + 3])) continue;
                } else k++;
                for (let i = 0; i < C; i++) out[slot * C + i] = tmp[j * C + i];
                // a pad or a gate does not move
                if (vel) { vel[slot * 3] = 0; vel[slot * 3 + 1] = 0; vel[slot * 3 + 2] = 0; }
            }
        }
        return k;
    }
}
