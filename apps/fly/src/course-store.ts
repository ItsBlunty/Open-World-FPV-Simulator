// The time trial creator's courses (owner, 2026-10-20): kept in this browser by map id, opened from and saved to files,
// and proposed for the game as a new file in the repository (GitHub's new-file page, which offers a fork and a pull
// request to anyone without write access). No DOM, so the Node tests check it.

import { COURSE_FORMAT, courseProblem } from '@owfpv/maps';
import type { CourseFile } from '@owfpv/maps';

export type StoredCourses = Record<string, CourseFile[]>;

/** The store read back: courses that are no longer valid are dropped (an old or hand-edited store must not break the page). */
export function parseCourses(raw: unknown): StoredCourses {
    const out: StoredCourses = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [map, list] of Object.entries(raw as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        const ok = list.filter((c) => courseProblem(c, map) === null) as CourseFile[];
        // one course per id
        out[map] = ok.filter((c, i) => ok.findIndex((d) => d.id === c.id) === i);
    }
    return out;
}

/** A new course's id: unique in this browser (the page's clock; nothing in the sim reads it). */
export function newCourseId(now: number, taken: readonly string[]): string {
    let id = `c${now.toString(36)}`;
    for (let k = 2; taken.includes(id); k++) id = `c${now.toString(36)}-${k}`;
    return id;
}

/** An empty course on `map`: its pad where the creator was, no gates yet (it needs one before it can be saved). */
export function blankCourse(id: string, map: string, name: string, area: string): CourseFile {
    return { format: COURSE_FORMAT, id, name, area, version: 1, map, pad: { x: 0, z: 0, y: 0.2, yawDeg: 0 }, gates: [] };
}

/**
 * Put a course in the store (replacing one with its id). When its gates or pad changed from the stored one, its version
 * goes up, so times flown on the old layout are kept apart (trial-times.ts keys them by id and version).
 */
export function putCourse(store: StoredCourses, c: CourseFile): CourseFile {
    const list = (store[c.map] ??= []);
    const i = list.findIndex((d) => d.id === c.id);
    const next: CourseFile = JSON.parse(JSON.stringify(c)) as CourseFile;
    if (i >= 0) {
        const old = list[i];
        if (JSON.stringify([old.pad, old.gates]) !== JSON.stringify([next.pad, next.gates])) next.version = Math.max(next.version, old.version + 1);
        list[i] = next;
    } else list.push(next);
    return next;
}

export function removeCourse(store: StoredCourses, map: string, id: string): void {
    store[map] = (store[map] ?? []).filter((c) => c.id !== id);
}

/** A course as a file's text: the JSON the game's own courses are kept in (packages/maps/courses). */
export function courseText(c: CourseFile): string {
    return `${JSON.stringify(c, null, 2)}\n`;
}

/** A file name for a course: its name in lower case, letters and digits joined by - (its id if that leaves nothing). */
export function courseFileName(c: CourseFile): string {
    const slug = c.name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return `${slug || c.id}.owfpv-course.json`;
}

/**
 * A course file's text read back for map `map`. `builtIn` are the game's own course ids (a file may not take one).
 * Returns the course, or why it cannot be opened.
 */
export function readCourseText(text: string, map: string, builtIn: readonly string[]): { course: CourseFile } | { error: string } {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { error: 'not a course file (not JSON)' };
    }
    const problem = courseProblem(raw, map);
    if (problem) return { error: problem };
    const c = raw as CourseFile;
    if (builtIn.includes(c.id)) return { error: `its id "${c.id}" is one of the game's own courses` };
    // only the fields the format knows (a file may carry more; they would ride along into the store and the flights)
    const g = c.gates.map((x) => {
        const o: CourseFile['gates'][number] = { name: x.name, x: x.x, y: x.y, z: x.z, nx: x.nx, ny: x.ny, nz: x.nz, hw: x.hw, hh: x.hh, kind: x.kind ?? 'open' };
        if (x.foot !== undefined) o.foot = x.foot;
        return o;
    });
    const course: CourseFile = { format: COURSE_FORMAT, id: c.id, name: c.name, area: c.area, version: c.version, map: c.map, pad: { x: c.pad.x, z: c.pad.z, y: c.pad.y, yawDeg: c.pad.yawDeg }, gates: g };
    if (c.author) course.author = c.author;
    if (c.notes) course.notes = c.notes;
    return { course };
}

/** Where the game's own courses live in the repository (the new file goes here). */
export const COURSES_DIR = 'packages/maps/courses';

/** GitHub answers links much longer than about 8 kB with an error page (report.ts MAX_URL): stay under it. */
const MAX_URL = 7500;

/**
 * The link that proposes a course for the game: GitHub's new-file page on the main branch, the file name (with its
 * folder) and its text filled in. Someone without write access is offered a fork and a pull request there. A course
 * too long for a link gets the page without the text (`fits` false): the page then asks the pilot to paste it.
 */
export function proposeLink(repo: string, c: CourseFile): { url: string; fits: boolean; fileName: string } {
    const fileName = `${COURSES_DIR}/${c.id}.json`;
    const full = `${repo}/new/main?${new URLSearchParams({ filename: fileName, value: courseText(c) }).toString()}`;
    if (full.length <= MAX_URL) return { url: full, fits: true, fileName };
    return { url: `${repo}/new/main?${new URLSearchParams({ filename: fileName }).toString()}`, fits: false, fileName };
}
