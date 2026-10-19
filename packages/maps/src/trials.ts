// Time trials (owner, 2026-10-19): courses through what the map already has (windows, gaps under roofs, the space
// between legs and wires), linked in order. Each starts and ends at a checkered arch with a landing pad under it and a
// checkered flag beside it: land on the pad to be offered the race, start on it, and finish by flying back through the
// arch. The gates are metadata (not solid, not in the collision hash); the arch, pad and flag are solid geometry.
//
// Every gate here was placed from the layout's own numbers (comments give them) and is checked by
// test/trials.test.ts: its opening is clear of geometry and a quad can fly from each gate to the next.

import type { LevelBuilder } from './builder';

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
}

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

const pad = (x: number, z: number, yawDeg: number, ground = 0): TrialPad => ({ x, z, y: ground + PAD_H, half: PAD_HALF, yawDeg });
const gx = (x: number, y: number, z: number, hw: number, hh: number, name: string): Gate => ({ x, y, z, nx: 1, ny: 0, nz: 0, hw, hh, name });
const gz = (x: number, y: number, z: number, hw: number, hh: number, name: string): Gate => ({ x, y, z, nx: 0, ny: 0, nz: 1, hw, hh, name });
/** a flat gate: hw along x, hh along z */
const gy = (x: number, y: number, z: number, hw: number, hh: number, name: string): Gate => ({ x, y, z, nx: 0, ny: 1, nz: 0, hw, hh, name });

/**
 * Park: an easy, open course. The post gate (posts at x 30-31 and 40-41, z 10-11, bar from 6 to 7 m); the power line's
 * wires at mid-span between the poles at x -25 and 25 (links.ts: pins 11.61 m up, 0.6 m sag, wires at z -41.1, -40.4
 * and -38.9, so 1.5 m between the last two; 1 m east of mid-span, where the wire is 11.016 m up, not on a joint of its
 * pieces); the fountain (column 0.8 m round, basin 7 m to its corners, water at
 * 0.62 m); the gazebo (posts at x -70 and -62, z 110 and 118, roof from 3 m; the gate between its west posts); the pond (x 50-95, z 100-140).
 */
function parkRun(): TimeTrial {
    const p = pad(68, 48, 0);
    return {
        id: 'park', name: 'Park loop', area: 'Park', version: 1, pad: p,
        gates: [
            gz(35.5, 3, 10.5, 4.2, 2.8, 'Under the bar of the post gate'),
            gy(1, 11.015, -39.65, 3, 0.55, 'Up between the power line\'s wires'),
            gx(0, 2.1, 83.85, 2.8, 1.3, 'Past the fountain, inside its rim'),
            gx(-70, 1.5, 114, 3.6, 1.4, 'Under the gazebo roof'),
            gx(72.5, 0.85, 120, 17.5, 0.75, 'Skim the pond, under 1.6 m'),
            finish(p)
        ]
    };
}

/**
 * Bando: in and out of windows, up the lift shaft, under the water tank, through the loading dock. The bando's frame
 * (first-map.ts bando): x -280 to -220, z -12 to 12, storeys 3.6 m; a window is 2.5 m wide, 1 to 2.8 m over its floor.
 * Which wall bays are windows is the map's own Rng(2): south face, first floor, bay x -244 to -238; north face, first
 * floor, bay x -256 to -250, and ground floor, bay x -232 to -226 (checked in the test). The shaft is bay x -232 to
 * -226, z -6 to 0, open through every floor and the roof (its beams on the column lines). The tank stands on legs at x
 * -236.5 and -233.5, z 4.5 and 7.5, its body from 22 m; the dunnage beams under the legs reach 18.4 m. The loading dock
 * annex: x -274 to -256, z 12 to 22, its dock 1.2 m up, roof from 7 m, posts on its south side at x -274, -268, -262,
 * -256; open to the east.
 */
function bandoRun(): TimeTrial {
    const p = pad(-242, 36, 0);
    return {
        id: 'bando', name: 'Bando line', area: 'Bando', version: 1, pad: p,
        gates: [
            gz(-241, 5.5, 12, 1.15, 0.8, 'In at a first-floor window, south side'),
            gz(-253, 5.5, -12, 1.15, 0.8, 'Out at a first-floor window, north side'),
            gz(-229, 2.0, -12, 1.15, 0.8, 'In at the ground-floor window by the shaft'),
            gy(-229, 18, -3, 2.6, 2.6, 'Up the lift shaft and out at the roof'),
            gz(-235, 20.2, 4.5, 1.25, 1.7, 'Between the water tank\'s legs'),
            gz(-265, 4.1, 22, 2.7, 2.8, 'Into the loading dock'),
            gx(-256, 4.1, 17, 4.6, 2.8, 'Out of the dock\'s open end'),
            finish(p)
        ]
    };
}

/**
 * Industrial yard: the hard one. The gantry (legs at x -310 and -280, beam 13-15 m, z 329-332); the hopper bins on legs
 * (yard.ts: at x -232, z 250-280, legs 2.2 m out, 0.3 m square, braced at 4.4 m), flown under all four; the conveyor
 * gallery (from x -338, 2 m up, to the headhouse's west face at x -263.5, 26 m up, along z 288; 2.4 m square inside its
 * chords, the belt along its floor), flown inside from the bottom to the top; out of the headhouse's south face
 * (between its beams at 24 and 29.5 m; braced on its north and east faces only); through the open shed (x -328 to
 * -298, z 362-377, roof 6.5 m falling to 5 m) out of its west end.
 */
function yardRun(): TimeTrial {
    const p = pad(-285, 348, 0);
    return {
        id: 'yard', name: 'Grain plant run', area: 'Industrial yard', version: 1, pad: p,
        gates: [
            gz(-294.5, 6.5, 330.5, 14.3, 6.3, 'Under the gantry'),
            gz(-232, 2.2, 282.2, 1.8, 2.0, 'Under the hopper bins, in at the south end'),
            gz(-232, 2.2, 247.8, 1.8, 2.0, 'Out under the north bin'),
            gx(-336.5, 3.75, 288, 0.8, 0.7, 'Into the conveyor gallery at its foot'),
            gx(-265, 26.9, 288, 0.8, 0.7, 'Up the gallery to the headhouse'),
            gz(-260, 26.75, 291.5, 3.0, 2.6, 'Out of the headhouse\'s south side'),
            gx(-328, 2.5, 369.5, 7.0, 2.3, 'Through the open shed, out its west end'),
            finish(p)
        ]
    };
}

/** Builds the arches, pads and flags (solid) and returns the courses. */
export function timeTrials(b: LevelBuilder): TimeTrial[] {
    const all = [parkRun(), bandoRun(), yardRun()];
    for (const t of all) startArch(b, t);
    return all;
}

/** A gate's across and up axes (unit vectors). */
export function gateAxes(g: Gate): { u: [number, number, number]; v: [number, number, number] } {
    if (Math.abs(g.ny) > 0.9) return { u: [1, 0, 0], v: [0, 0, 1] };
    const l = Math.hypot(g.nx, g.nz);
    return { u: [-g.nz / l, 0, g.nx / l], v: [0, 1, 0] };
}
