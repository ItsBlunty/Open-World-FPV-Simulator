// Time trials (owner, 2026-10-19): courses through what the map already has (windows, gaps under roofs, the space
// between legs and wires), linked in order. Each starts and ends at a checkered arch with a landing pad under it and a
// checkered flag beside it: land on the pad to be offered the race, start on it, and finish by flying back through the
// arch. An open gate is metadata (not solid, not in the collision hash); the arch, pad and flag are solid geometry.
//
// Courses are files (owner, 2026-10-20: "a simplified system to create time trials", by hand in the in-game creator,
// or by Claude): `owfpv-course/1` JSON, CourseFile below. The game's own are in `packages/maps/courses/`, one file each,
// every gate placed from the layout's own numbers (each file's `notes` give them) and checked by test/trials.test.ts:
// its opening is clear of geometry and a quad can fly from each gate to the next. Courses made in the creator are kept
// in the browser (apps/fly course-store.ts) and their arches are built apart from the map (courseSolids). A gate of
// kind 'gate' is a race gate standing in the open: drawn always, solid only while its own course is raced (owner,
// 2026-10-20), so it is never part of the map's collision.

import { LevelBuilder } from './builder';
import type { Level } from './builder';
import park from '../courses/01-park.json';
import bando from '../courses/02-bando.json';
import yard from '../courses/03-yard.json';

/**
 * A gate: a rectangle the quad's centre must pass through, either way. Its across axis is horizontal; its up axis is
 * world up, or for a gate lying flat (a hole in a floor, a gap between wires) the north-south axis (z).
 */
export interface Gate {
    /** its centre, m */
    x: number;
    y: number;
    z: number;
    /** the way through it (a unit vector; either way counts) */
    nx: number;
    ny: number;
    nz: number;
    /** half its width (across) and half its height (up), m */
    hw: number;
    hh: number;
    /** what it is, said the way one pilot tells another */
    name: string;
    /**
     * 'open' (the default): a window, a gap, a space between things, marked only while racing; 'gate': a race gate
     * standing there (a frame round the opening, on two legs down to `foot`), solid only while its course is raced
     */
    kind?: GateKind;
    /** a race gate's legs reach down to this height, m (the ground under it when it was placed); none: no legs */
    foot?: number;
}

export type GateKind = 'open' | 'gate';

/** The landing pad a course starts from: its centre, its top, its half size, and the heading the race starts on. */
export interface TrialPad {
    x: number;
    z: number;
    y: number;
    half: number;
    yawDeg: number;
}

export interface TimeTrial {
    id: string;
    name: string;
    /** the part of the map it is in */
    area: string;
    /** bump it when the gates change: the times flown on the old course are kept apart */
    version: number;
    pad: TrialPad;
    /** in the order they are flown; the last is the start arch, which ends the race */
    gates: Gate[];
    /** made in the creator (or opened from a file): its arch, pad and flag are not part of the map (courseSolids) */
    custom?: boolean;
}

/**
 * The pad: 4.6 m square, 0.2 m high, filling the arch between its posts (owner, 2026-10-19: "make the pad much
 * larger"; it was 2.4 m).
 */
const PAD_HALF = 2.3;
const PAD_H = 0.2;
/**
 * The start arch: two posts 5.2 m apart, a checkered banner across their tops from 3.5 to 4.2 m [estimates, about the
 * size of a race's start gantry for quads]; the flag on a 6.5 m pole 4 m beside it.
 */
const ARCH_HALF = 2.6;
const POST = 0.25;
const ARCH_OPEN = 3.5;
const ARCH_TOP = 4.2;
/** The arch's opening and banner top, m over the ground it stands on (the render hangs the pad's markers by them). */
export const ARCH = { open: ARCH_OPEN, top: ARCH_TOP, padHeight: PAD_H } as const;

const BANNER_T = 0.12;
const FLAG_OFF = 4;
const POLE_H = 6.5;
const FLAG_W = 1.5;
const FLAG_H = 1.0;

/** Where the checkered faces are drawn (render only): a banner or flag face, its centre, width, height and facing. */
export interface CheckerFace {
    x: number;
    y: number;
    z: number;
    /** the face's normal is along x (true) or z */
    alongX: boolean;
    w: number;
    h: number;
}

/** The arch's banner and the flag, each a slab facing both ways: the render draws the checks on both sides. */
export function checkerFaces(t: TimeTrial): CheckerFace[] {
    const { x, z, yawDeg } = t.pad;
    const spanX = yawDeg % 180 === 0;
    const bannerW = 2 * (ARCH_HALF + POST / 2);
    // the flag 4 m out from the east (or south) post
    const fx = spanX ? x + ARCH_HALF + FLAG_OFF : x, fz = spanX ? z : z + ARCH_HALF + FLAG_OFF;
    const flagC = spanX ? [fx - FLAG_W / 2 - 0.05, fz] : [fx, fz - FLAG_W / 2 - 0.05];
    return [
        { x, y: (ARCH_OPEN + ARCH_TOP) / 2, z, alongX: !spanX, w: bannerW, h: ARCH_TOP - ARCH_OPEN },
        { x: flagC[0], y: POLE_H - 0.2 - FLAG_H / 2, z: flagC[1], alongX: !spanX, w: FLAG_W, h: FLAG_H }
    ];
}

/** The checkered faces' thickness, m: the render puts its checks this far out from the slab's middle. */
export const CHECKER_SLAB = { banner: BANNER_T, flag: 0.04 };

/** The pad, the arch over it and the flag: solid. `yawDeg` is 0, 90, 180 or 270 (the arch spans across it). */
function startArch(b: LevelBuilder, t: TimeTrial): void {
    const { x, z, y, yawDeg } = t.pad;
    const y0 = y - PAD_H;
    b.box('concrete', x - PAD_HALF, y0, z - PAD_HALF, x + PAD_HALF, y, z + PAD_HALF);
    const spanX = yawDeg % 180 === 0;
    // (u, v): along the arch and through it; box() wants x and z
    const box = (m: 'metal' | 'billboard', u0: number, ya: number, v0: number, u1: number, yb: number, v1: number): void => {
        if (spanX) b.box(m, x + u0, y0 + ya, z + v0, x + u1, y0 + yb, z + v1);
        else b.box(m, x + v0, y0 + ya, z + u0, x + v1, y0 + yb, z + u1);
    };
    const p = POST / 2;
    for (const s of [-1, 1]) box('metal', s * ARCH_HALF - p, 0, -p, s * ARCH_HALF + p, ARCH_OPEN, p);
    box('billboard', -ARCH_HALF - p, ARCH_OPEN, -BANNER_T / 2, ARCH_HALF + p, ARCH_TOP, BANNER_T / 2);
    // the flag: a pole, the cloth hanging from its top towards the arch
    const f = ARCH_HALF + FLAG_OFF;
    box('metal', f - 0.05, 0, -0.05, f + 0.05, POLE_H, 0.05);
    box('billboard', f - 0.05 - FLAG_W, POLE_H - 0.2 - FLAG_H, -0.02, f - 0.05, POLE_H - 0.2, 0.02);
}

/** The arch as the last gate: its opening over the pad, crossed along the race's heading or back. */
function finish(pad: TrialPad): Gate {
    const r = (pad.yawDeg * Math.PI) / 180;
    // heading 0 is north (-z), + to the right (east); axis-aligned headings only, so these are exact
    const nx = Math.round(Math.sin(r)), nz = -Math.round(Math.cos(r));
    const inner = ARCH_HALF - POST / 2;
    const open = ARCH_OPEN - PAD_H;
    return { x: pad.x, y: pad.y + open / 2, z: pad.z, nx, ny: 0, nz, hw: inner - 0.05, hh: open / 2 - 0.1, name: 'Back through the start arch' };
}

// ---------------------------------------------------------------- course files

/** The format of a course file; bump it when a field changes meaning. */
export const COURSE_FORMAT = 'owfpv-course/1';

/** A gate as a course file has it. */
export interface CourseGateFile {
    name: string;
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    hw: number;
    hh: number;
    kind?: GateKind;
    foot?: number;
}

/**
 * A course as a file: what the creator exports, imports and proposes for the game, and what the game's own courses are
 * (packages/maps/courses/*.json). The start arch, which ends every race, is not in `gates`: it follows from the pad.
 */
export interface CourseFile {
    format: typeof COURSE_FORMAT;
    /** unique on its map: letters, digits, - and _ (the times are kept by id and version) */
    id: string;
    name: string;
    /** the part of the map it is in */
    area: string;
    /** bump it when the gates or the pad change: times flown on the old course are kept apart */
    version: number;
    /** the map it is laid out on (Level.id) */
    map: string;
    /** the pad's centre and top (m), and the heading the race starts on: 0, 90, 180 or 270 (the arch spans across it) */
    pad: { x: number; z: number; y: number; yawDeg: number };
    gates: CourseGateFile[];
    /** who made it, if they want it said */
    author?: string;
    /** how the gates were placed: free text */
    notes?: string;
}

/** Limits on a course file, so a typo or a hostile file cannot build a gate across the whole map. */
export const COURSE_LIMITS = { gates: 60, half: 30, name: 80, coord: 5000 } as const;

/** Why a parsed JSON value is not a course this game can fly, or null. `mapId`: the map it must be for (any if omitted). */
export function courseProblem(f: unknown, mapId?: string): string | null {
    const c = f as Partial<CourseFile> | null;
    if (!c || typeof c !== 'object') return 'not a course (not a JSON object)';
    if (c.format !== COURSE_FORMAT) return `not a course file (format ${String(c.format)}, expected ${COURSE_FORMAT})`;
    if (typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(c.id)) return 'its id must be 1-64 letters, digits, - or _';
    const text = (v: unknown, what: string, max: number = COURSE_LIMITS.name): string | null =>
        typeof v === 'string' && v.trim().length > 0 && v.length <= max ? null : `its ${what} must be text of 1-${max} characters`;
    const named = text(c.name, 'name') ?? text(c.area, 'area');
    if (named) return named;
    if (!Number.isInteger(c.version) || (c.version as number) < 1) return 'its version must be a whole number from 1';
    if (typeof c.map !== 'string') return 'it names no map';
    if (mapId !== undefined && c.map !== mapId) return `it is laid out on map ${c.map}, not this one (${mapId})`;
    const fin = (v: unknown, lim: number = COURSE_LIMITS.coord): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
    const p = c.pad;
    if (!p || !fin(p.x) || !fin(p.y) || !fin(p.z)) return 'its pad needs x, y and z (m)';
    if (![0, 90, 180, 270].includes(p.yawDeg)) return 'its pad\'s yawDeg must be 0, 90, 180 or 270';
    if (!Array.isArray(c.gates) || c.gates.length < 1) return 'it needs at least one gate before the arch';
    if (c.gates.length > COURSE_LIMITS.gates) return `at most ${COURSE_LIMITS.gates} gates`;
    for (let i = 0; i < c.gates.length; i++) {
        const g = c.gates[i] as Partial<CourseGateFile> | null;
        const at = `gate ${i + 1}`;
        if (!g || typeof g !== 'object') return `${at} is not an object`;
        const t = text(g.name, `${at}'s name`);
        if (t) return t;
        if (!fin(g.x) || !fin(g.y) || !fin(g.z)) return `${at} needs x, y and z (m)`;
        if (!fin(g.hw, COURSE_LIMITS.half) || !fin(g.hh, COURSE_LIMITS.half) || g.hw < 0.05 || g.hh < 0.05) return `${at}'s hw and hh must be half sizes from 0.05 to ${COURSE_LIMITS.half} m`;
        if (!fin(g.nx, 2) || !fin(g.ny, 2) || !fin(g.nz, 2)) return `${at} needs its way through, nx, ny and nz`;
        if (Math.abs(Math.hypot(g.nx, g.ny, g.nz) - 1) > 1e-3) return `${at}'s nx, ny, nz must be a unit vector`;
        // standing (the way through level) or flat (straight up): gateAxes knows these two
        if (Math.abs(g.ny) > 1e-6 && Math.abs(Math.abs(g.ny) - 1) > 1e-6) return `${at} must stand (ny 0) or lie flat (ny 1)`;
        if (g.kind !== undefined && g.kind !== 'open' && g.kind !== 'gate') return `${at}'s kind must be "open" or "gate"`;
        if (g.foot !== undefined && (!fin(g.foot) || g.foot > g.y)) return `${at}'s foot must be a height under its centre`;
    }
    if (c.author !== undefined) {
        const a = text(c.author, 'author');
        if (a) return a;
    }
    if (c.notes !== undefined && (typeof c.notes !== 'string' || c.notes.length > 4000)) return 'its notes must be text of at most 4000 characters';
    return null;
}

/** A course file as the game flies it (call courseProblem first): its gates and the start arch as the last. */
export function courseFromFile(f: CourseFile, custom = false): TimeTrial {
    const p: TrialPad = { x: f.pad.x, z: f.pad.z, y: f.pad.y, half: PAD_HALF, yawDeg: f.pad.yawDeg };
    const gates = f.gates.map((g): Gate => {
        const l = Math.hypot(g.nx, g.nz);
        const out: Gate = Math.abs(g.ny) > 0.5
            ? { x: g.x, y: g.y, z: g.z, nx: 0, ny: 1, nz: 0, hw: g.hw, hh: g.hh, name: g.name }
            : { x: g.x, y: g.y, z: g.z, nx: g.nx / l, ny: 0, nz: g.nz / l, hw: g.hw, hh: g.hh, name: g.name };
        if (g.kind === 'gate') out.kind = 'gate';
        if (g.foot !== undefined) out.foot = g.foot;
        return out;
    });
    const t: TimeTrial = { id: f.id, name: f.name, area: f.area, version: f.version, pad: p, gates: [...gates, finish(p)] };
    if (custom) t.custom = true;
    return t;
}

/** A course as a file again (the start arch left out: it follows from the pad). */
export function courseToFile(t: TimeTrial, map: string, extra: { author?: string; notes?: string } = {}): CourseFile {
    const f: CourseFile = {
        format: COURSE_FORMAT, id: t.id, name: t.name, area: t.area, version: t.version, map,
        pad: { x: t.pad.x, z: t.pad.z, y: t.pad.y, yawDeg: t.pad.yawDeg },
        gates: t.gates.slice(0, -1).map((g) => {
            const o: CourseGateFile = { name: g.name, x: g.x, y: g.y, z: g.z, nx: g.nx, ny: g.ny, nz: g.nz, hw: g.hw, hh: g.hh, kind: g.kind ?? 'open' };
            if (g.foot !== undefined) o.foot = g.foot;
            return o;
        })
    };
    if (extra.author) f.author = extra.author;
    if (extra.notes) f.notes = extra.notes;
    return f;
}

/** The pad's top for a pad standing on ground at height `ground`, m. */
export const padTop = (ground: number): number => ground + PAD_H;

/** The game's own courses (packages/maps/courses), in the order their arches are built (the map's hash depends on it). */
export const COURSE_FILES: readonly CourseFile[] = [park, bando, yard] as CourseFile[];

/**
 * A race gate (kind 'gate'): a frame of bars round its opening and, standing, two legs from its lower corners down to
 * its foot. [MultiGP's standard chapter gate is a 5 x 5 ft (1.52 m) opening of PVC pipe with vinyl panels (multigp.com,
 * course obstacles; MultiGP shop, start-finish gate 5'x5'); bars 10 cm wide and 5 cm deep and 6 cm legs are estimates.]
 */
export const RACE_GATE = { bar: 0.1, depth: 0.05, leg: 0.06, defaultHalf: 0.76 } as const;

/** A box centred on c with half sizes hu, hv, hn along the perpendicular unit axes u, v, n; faces wound outwards. */
function orientedBox(b: LevelBuilder, c: number[], u: number[], v: number[], n: number[], hu: number, hv: number, hn: number): void {
    const p = (a: number, e: number, d: number): number[] => [0, 1, 2].map((k) => c[k] + u[k] * a * hu + v[k] * e * hv + n[k] * d * hn);
    const faces: number[][][] = [
        [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)],
        [p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), p(1, -1, -1)],
        [p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)],
        [p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1)],
        [p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)],
        [p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)]
    ];
    for (const [a, e, f, d] of faces) b.quadOut('metal', c, a, e, f, d);
}

/** A race gate's bars and legs, as boxes: centre, the three axes and half sizes (the collision and the drawing share them). */
export function raceGateBoxes(g: Gate): { c: number[]; u: number[]; v: number[]; n: number[]; h: [number, number, number] }[] {
    const { u, v } = gateAxes(g);
    const n = [g.nx, g.ny, g.nz];
    const { bar, depth, leg } = RACE_GATE;
    const W = g.hw + bar / 2, H = g.hh + bar / 2;
    const at = (a: number, e: number): number[] => [g.x + u[0] * a + v[0] * e, g.y + u[1] * a + v[1] * e, g.z + u[2] * a + v[2] * e];
    const out = [
        { c: at(0, H), u, v, n, h: [W + bar / 2, bar / 2, depth / 2] as [number, number, number] },
        { c: at(0, -H), u, v, n, h: [W + bar / 2, bar / 2, depth / 2] as [number, number, number] },
        { c: at(W, 0), u, v, n, h: [bar / 2, g.hh, depth / 2] as [number, number, number] },
        { c: at(-W, 0), u, v, n, h: [bar / 2, g.hh, depth / 2] as [number, number, number] }
    ];
    // the legs: a standing gate whose bottom bar is clear of its foot
    const bottom = g.y - g.hh - bar;
    if (Math.abs(g.ny) > 0.5 || g.foot === undefined || bottom - g.foot < 0.05) return out;
    for (const s of [-1, 1]) {
        const top = at(s * W, 0);
        out.push({ c: [top[0], (bottom + g.foot) / 2, top[2]], u, v: [0, 1, 0], n, h: [leg / 2, (bottom - g.foot) / 2, leg / 2] });
    }
    return out;
}

/** A race gate into b, solid (while its course is raced). */
export function raceGate(b: LevelBuilder, g: Gate): void {
    for (const x of raceGateBoxes(g)) orientedBox(b, x.c, x.u, x.v, x.n, x.h[0], x.h[1], x.h[2]);
}

/**
 * The solid parts of courses that are not the map's own, each as collision triangles: `always`, every custom course's
 * pad, arch and flag; `race[c]`, course c's race gates (null when it has none), solid only while it is raced. `courses`
 * is every course the game knows (the map's own arches are in the map already, so only custom ones are built here).
 */
export function courseSolids(courses: readonly TimeTrial[]): { always: Float64Array | null; race: (Float64Array | null)[] } {
    const solid = (fill: (b: LevelBuilder) => number): Float64Array | null => {
        const b = new LevelBuilder();
        if (fill(b) === 0) return null;
        return b.build('course-solids', 1, 'course solids', COURSE_LIMITS.coord).collision;
    };
    const always = solid((b) => {
        let n = 0;
        for (const t of courses) if (t.custom) { startArch(b, t); n++; }
        return n;
    });
    const race = courses.map((t) => solid((b) => {
        let n = 0;
        for (const g of t.gates) if (g.kind === 'gate') { raceGate(b, g); n++; }
        return n;
    }));
    return { always, race };
}

/** The pads, arches and flags of the custom courses, as a level of their own (the renderer draws it like the map). */
export function customArches(courses: readonly TimeTrial[]): Level {
    const b = new LevelBuilder();
    for (const t of courses) if (t.custom) startArch(b, t);
    return b.build('custom-arches', 1, 'custom arches', COURSE_LIMITS.coord);
}

/** Builds the game's own courses' arches, pads and flags (solid, part of the map) and returns the courses. */
export function timeTrials(b: LevelBuilder): TimeTrial[] {
    const all = COURSE_FILES.map((f) => {
        const problem = courseProblem(f);
        if (problem) throw new Error(`course ${f.id}: ${problem}`);
        return courseFromFile(f);
    });
    for (const t of all) startArch(b, t);
    return all;
}

/** A gate's across and up axes (unit vectors). */
export function gateAxes(g: Gate): { u: [number, number, number]; v: [number, number, number] } {
    if (Math.abs(g.ny) > 0.9) return { u: [1, 0, 0], v: [0, 0, 1] };
    const l = Math.hypot(g.nx, g.nz);
    return { u: [-g.nz / l, 0, g.nx / l], v: [0, 1, 0] };
}
