// The airport's movers' shapes (air.ts): ten planes, the air ambulance helicopter, the tugs, the people. Each is a set of
// solid parts in its own frame (f ahead, u up, s to its right, origin at its main gear on the ground): capsules (the
// fuselages, nacelles, people) and boxes (wings, tails, gear), so the collision is the shape that is drawn. Props and
// rotors (owner, 2026-10-24: "solid propellers and rotors"): a turning one is a solid disc, as it is drawn; a stopped one
// its blades at the angle it always stops at (PROP_REST: the drawing settles there as it stops).
//
// Sizes and speeds: the length, span and height of each type, and where noted its stall speed, climb rate and take-off and
// landing distances, are from its Wikipedia article's specifications (read 2026-10-20) or the sources named on it;
// everything marked [estimate] is not. A plane's approach speed is 1.3 times its stall speed in the landing setting, the
// usual rule (AOPA, quoted in a search summary), unless a reference speed was found. Ground rolls are about half the
// distance over a 15 m (50 ft) obstacle where only that was found [estimate: the C172's 575 of 1335 ft, the Baron's 1440
// of 2490 ft (AOPA's G58 fact sheet)].

import type { AircraftKind } from '@owfpv/maps';
import { dcos, dsin } from '@owfpv/sim-core';
import { DEG } from './air-path';

/** tan of an angle in degrees, from sim-core's dmath (the shapes are solid: every engine must build the same bits) */
const tanD = (a: number): number => dsin(a * DEG) / dcos(a * DEG);

/** What a part is, for the drawing's colours (the collision treats them all alike). */
export type Role = 'body' | 'trim' | 'wing' | 'tail' | 'engine' | 'gear' | 'glass' | 'strut' | 'skid' | 'mast' | 'person' | 'stretcher' | 'tug'
    // the tower crane's (crane.ts): its painted steel, ballast, crates and ropes
    | 'crane' | 'ballast' | 'crate' | 'rope';

/** A solid part: a capsule from a to b of radius r, or a box of half sizes e about c with axes R (rows: its f, u, s axes). */
export interface APart {
    kind: 'cap' | 'box';
    role: Role;
    a: [number, number, number];
    b: [number, number, number];
    r: number;
    c: [number, number, number];
    e: [number, number, number];
    R: [number, number, number, number, number, number, number, number, number];
    /** gear that folds away after take-off: solid only while the mover's gear is down */
    gear: boolean;
    /** a rope (the crane's hoist rope): a capsule hanging straight down from a, its place's `len` long (b is its longest) */
    rope?: boolean;
}

/** A propeller or rotor as laid out: its hub, radius, blades and the axis it turns about ('f' a prop, 'u' a main rotor, 's' a tail rotor). */
export interface PropSpec {
    p: [number, number, number];
    r: number;
    blades: number;
    axis: 'f' | 'u' | 's';
}

/** A propeller or rotor, solid (air-world.ts): a disc while it turns, its blades where it stops while it does not. */
export interface Prop extends PropSpec {
    /** the blade's chord (the drawing's), m: the disc's thickness */
    chord: number;
    /** the axis it turns about, in the mover's frame */
    n: [number, number, number];
    /** its blades stopped at PROP_REST: boxes as the drawing's (r long, 3 cm thick, chord wide) */
    rest: APart[];
}

/**
 * The least room between a prop and the ground, m: 7 in, the rule for a plane with a nose wheel, "with the landing gear
 * statically deflected and in the level take-off, or taxiing attitude" (14 CFR 25.925(a)); used for the wing engines.
 */
const PROP_GROUND = 7 * 0.0254;

/** A blade's thickness, m (the drawing's) */
export const BLADE_THICK = 0.03;

/**
 * The angle a prop or rotor stops at, radians, as the drawing turns it (render/air.ts: blade k at rest + 2 pi k / n about
 * its axis): no blade straight down, so a parked prop is clear of the ground: an even count in an X (a 2-blade prop
 * level), an odd count with a blade straight up.
 */
export function propRest(blades: number): number {
    return Math.PI + (blades % 2 === 0 ? Math.PI / blades : 0);
}

/**
 * A blade's direction (from the hub out) and its chord's direction, in the mover's frame, at angle a about the prop's
 * axis: the drawing's blade (+x of its spin group, turned a about +y, then the holder onto the axis) worked through.
 */
export function bladeAxes(axis: PropSpec['axis'], a: number): { d: [number, number, number]; c: [number, number, number] } {
    const ca = dcos(a), sa = dsin(a);
    // in the spin group: blade (ca, 0, -sa), chord (sa, 0, ca); the holder maps it onto the mover's (f, u, s)
    if (axis === 'f') return { d: [0, -ca, -sa], c: [0, -sa, ca] }; // holder: z turned -90 deg (x -> -u, y -> f)
    if (axis === 's') return { d: [ca, sa, 0], c: [sa, -ca, 0] }; // holder: x turned 90 deg (y -> s, z -> -u)
    return { d: [ca, 0, -sa], c: [sa, 0, ca] };
}

function finishProp(p: PropSpec): Prop {
    const chord = Math.max(0.08, p.r * (p.axis === 'u' ? 0.06 : 0.12));
    const n: [number, number, number] = p.axis === 'f' ? [1, 0, 0] : p.axis === 'u' ? [0, 1, 0] : [0, 0, 1];
    const rest: APart[] = [];
    for (let k = 0; k < p.blades; k++) {
        const { d, c } = bladeAxes(p.axis, propRest(p.blades) + (2 * Math.PI * k) / p.blades);
        const h = p.r / 2;
        rest.push(box('engine', [p.p[0] + d[0] * h, p.p[1] + d[1] * h, p.p[2] + d[2] * h], [h, BLADE_THICK / 2, chord / 2],
            [d[0], d[1], d[2], n[0], n[1], n[2], c[0], c[1], c[2]]));
    }
    return { ...p, chord, n, rest };
}

export interface AirShape {
    parts: APart[];
    props: Prop[];
    /** how far any part reaches from the origin, m */
    reach: number;
    /** the nose and the tail, along f from the origin, m (the nose +, the tail -) */
    nose: number;
    tail: number;
    /** half the span (or width), m */
    half: number;
}

const I3: APart['R'] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function cap(role: Role, a: [number, number, number], b: [number, number, number], r: number, gear = false): APart {
    return { kind: 'cap', role, a, b, r, c: [0, 0, 0], e: [0, 0, 0], R: I3, gear };
}

function box(role: Role, c: [number, number, number], e: [number, number, number], R: APart['R'] = I3, gear = false): APart {
    return { kind: 'box', role, a: [0, 0, 0], b: [0, 0, 0], r: 0, c, e, R, gear };
}

function shape(parts: APart[], specs: PropSpec[]): AirShape {
    const props = specs.map(finishProp);
    let reach = 0, nose = -Infinity, tail = Infinity, half = 0;
    const see = (f: number, u: number, s: number, pad: number): void => {
        reach = Math.max(reach, Math.sqrt(f * f + u * u + s * s) + pad);
        nose = Math.max(nose, f + pad);
        tail = Math.min(tail, f - pad);
        half = Math.max(half, Math.abs(s) + pad);
    };
    for (const p of parts) {
        if (p.kind === 'cap') { see(p.a[0], p.a[1], p.a[2], p.r); see(p.b[0], p.b[1], p.b[2], p.r); continue; }
        for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) {
            const R = p.R, e = p.e;
            see(p.c[0] + i * e[0] * R[0] + j * e[1] * R[3] + k * e[2] * R[6],
                p.c[1] + i * e[0] * R[1] + j * e[1] * R[4] + k * e[2] * R[7],
                p.c[2] + i * e[0] * R[2] + j * e[1] * R[5] + k * e[2] * R[8], 0);
        }
    }
    for (const p of props) see(p.p[0], p.p[1], p.p[2], p.r);
    return { parts, props, reach, nose, tail, half };
}

// ---------------------------------------------------------------- planes

/** A plane laid out from its nose (X aft along the fuselage, m) at its level attitude; turned into its own frame by plane(). */
interface PlaneSpec {
    L: number;
    /** fuselage diameter, m */
    D: number;
    /** main gear and nose (or tail) wheel, X from the nose; the fuselage's underside over the main gear, m */
    mainX: number;
    noseX?: number;
    tailX?: number;
    clear: number;
    /** half the main gear's track, m */
    track: number;
    wheel: number;
    retract: boolean;
    wing: { X: number; span: number; root: number; tip: number; sweep: number; dihedral: number; high: boolean };
    htail: { X: number; span: number; root: number; tip: number; tee: boolean };
    fin: { X: number; h: number; root: number; tip: number; sweep: number };
    /** engines: 'nose' a prop at the nose; 'wing' nacelles at +-s with props at their front; 'rear' jets by the tail */
    engines: { at: 'nose' | 'wing' | 'rear'; s: number; X0: number; X1: number; r: number; prop: number; blades: number }[];
    struts: boolean;
    /** where the fuselage's full section ends, a share of L (default 0.62); a taildragger's tapers sooner so its tail clears the ground */
    aft?: number;
    /** a belly pod (the Caravan's cargo pod), X range and radius */
    pod?: [number, number, number];
}

/** A wing panel: a box from station s0 to s1 out on one side (sign), chord c at its middle, its leading edge at X (root) swept back. */
function panel(role: Role, sp: PlaneSpec, X: number, s0: number, s1: number, c0: number, c1: number, sweep: number, dih: number, u0: number, t: number, sign: number): APart {
    const sm = (s0 + s1) / 2, c = (c0 + c1) / 2;
    const xle = X + (sm - s0) * tanD(sweep);
    const f = sp.mainX - (xle + c / 2);
    const d = dih * DEG, cd = dcos(d), sd = dsin(d);
    const u = u0 + (sm - 0) * sd;
    // axes: f, then up and out tilted by the dihedral (out rising)
    const R: APart['R'] = [1, 0, 0, 0, cd, -sign * sd, 0, sign * sd, cd];
    return box(role, [f, u, sign * sm * cd], [c / 2, t / 2, (s1 - s0) / 2], R);
}

function plane(sp: PlaneSpec): AirShape {
    const { L, D, mainX } = sp;
    const yc = sp.clear + D / 2;
    const F = (X: number): number => mainX - X;
    const parts: APart[] = [];
    // the fuselage: a main capsule, then two narrowing towards the tail, rising to its top line
    const aft = sp.aft ?? 0.62;
    parts.push(cap('body', [F(D / 2), yc, 0], [F(aft * L), yc, 0], D / 2));
    parts.push(cap('body', [F((aft - 0.04) * L), yc + 0.08 * D, 0], [F((aft + 0.2) * L), yc + 0.2 * D, 0], 0.34 * D));
    parts.push(cap('body', [F((aft + 0.16) * L), yc + 0.22 * D, 0], [F(L - 0.15 * D), yc + 0.3 * D, 0], 0.18 * D));
    // the cockpit's windows, a dark band round the nose's upper part (drawn over the body: solid as it)
    parts.push(cap('glass', [F(0.55 * D + 0.06 * L), yc + 0.22 * D, 0], [F(0.55 * D + 0.1 * L), yc + 0.22 * D, 0], 0.32 * D));
    if (sp.pod) parts.push(cap('trim', [F(sp.pod[0]), sp.clear + sp.pod[2] * 0.3, 0], [F(sp.pod[1]), sp.clear + sp.pod[2] * 0.3, 0], sp.pod[2]));
    // the wings: two panels each side, from the fuselage's side out
    const w = sp.wing;
    const t = Math.max(0.14, 0.13 * w.root);
    const u0 = w.high ? yc + D / 2 + t / 2 - 0.05 : sp.clear + t / 2 + 0.05;
    const s0 = 0.3 * D, half = w.span / 2, sm = (s0 + half) / 2;
    const cmid = (w.root + w.tip) / 2;
    for (const sign of [-1, 1]) {
        parts.push(panel('wing', sp, w.X, s0, sm, w.root, cmid, w.sweep, w.dihedral, u0, t, sign));
        parts.push(panel('wing', sp, w.X + (sm - s0) * tanD(w.sweep), sm, half, cmid, w.tip, w.sweep, w.dihedral, u0, t * 0.8, sign));
    }
    // across the fuselage under (or over) the wing root, so the wing reads as one piece
    parts.push(box('wing', [F(w.X + w.root / 2), u0, 0], [w.root / 2, t / 2, s0]));
    // the fin, in two stacked boxes swept back, and the tailplane (on the fin's top: a T-tail)
    const fi = sp.fin, top = yc + 0.3 * D + 0.18 * D;
    const ft = Math.max(0.12, 0.1 * fi.root);
    const sw = tanD(fi.sweep);
    parts.push(box('tail', [F(fi.X + fi.root / 2), top + fi.h / 4 - 0.1, 0], [fi.root / 2, fi.h / 4 + 0.1, ft / 2]));
    const c2 = (fi.root + fi.tip) / 2;
    parts.push(box('tail', [F(fi.X + (fi.h / 2) * sw + c2 / 2), top + (3 * fi.h) / 4, 0], [c2 / 2, fi.h / 4, (ft * 0.8) / 2]));
    const ht = sp.htail;
    const hy = ht.tee ? top + fi.h - 0.08 : yc + 0.25 * D;
    const hc = (ht.root + ht.tip) / 2;
    parts.push(box('tail', [F(ht.X + hc / 2), hy, 0], [hc / 2, 0.08, ht.span / 2]));
    // engines and props
    const props: PropSpec[] = [];
    for (const en of sp.engines) {
        if (en.at === 'nose') {
            props.push({ p: [F(-0.15), yc, 0], r: en.prop, blades: en.blades, axis: 'f' });
            parts.push(cap('engine', [F(0.05), yc, 0], [F(0.3), yc, 0], 0.18));
            continue;
        }
        for (const sign of [-1, 1]) {
            const s = sign * en.s;
            if (en.at === 'wing') {
                // hung under a high wing, or sitting on a low one's top
                // (air v3) at least PROP_GROUND between the prop and the ground, sitting level: the King Air's 2.68 m props
                // went 8 cm into the runway (found when props became solid, 2026-10-24)
                const ny = Math.max(w.high ? u0 - t / 2 - en.r * 0.6 : u0 + t / 2 + en.r * 0.3, en.prop + PROP_GROUND);
                parts.push(cap('engine', [F(en.X0 + en.r), ny, s], [F(en.X1 - en.r), ny, s], en.r));
                props.push({ p: [F(en.X0 - 0.15), ny, s], r: en.prop, blades: en.blades, axis: 'f' });
            } else {
                const ny = yc + 0.35 * D;
                parts.push(cap('engine', [F(en.X0 + en.r), ny, s], [F(en.X1 - en.r), ny, s], en.r));
                parts.push(box('engine', [F((en.X0 + en.X1) / 2), ny, sign * (en.s - en.r) / 2 + sign * 0.2], [0.5, 0.08, Math.abs(en.s - en.r) / 2]));
            }
        }
    }
    // the gear: wheels as small boxes, and their legs
    const wr = sp.wheel / 2, ww = Math.max(0.12, sp.wheel * 0.35);
    for (const sign of [-1, 1]) {
        parts.push(box('gear', [0, wr, sign * sp.track], [wr, wr, ww / 2], I3, sp.retract));
        parts.push(box('gear', [0, (wr + sp.clear) / 2 + 0.05, sign * sp.track * 0.75], [0.06, (sp.clear - wr) / 2 + 0.1, sp.track * 0.25 + 0.04], I3, sp.retract));
    }
    if (sp.noseX !== undefined) {
        const nr = wr * 0.8;
        parts.push(box('gear', [F(sp.noseX), nr, 0], [nr, nr, ww / 2], I3, sp.retract));
        parts.push(box('gear', [F(sp.noseX), (nr + sp.clear) / 2 + 0.1, 0], [0.05, (sp.clear - nr) / 2 + 0.1, 0.05], I3, sp.retract));
    }
    if (sp.tailX !== undefined) {
        // a taildragger: the tail wheel where the tail sits on the ground in its three-point attitude
        const f = F(sp.tailX), up = -f * tanD(TAILDRAGGER_PITCH);
        parts.push(box('gear', [f, up + 0.1, 0], [0.1, 0.1, 0.05]));
    }
    // a high wing's struts, from the fuselage's lower side by the main gear out to the wing's middle
    if (sp.struts) {
        for (const sign of [-1, 1]) {
            parts.push(cap('strut', [F(w.X + w.root * 0.4), sp.clear + 0.25 * D, sign * 0.42 * D], [F(w.X + w.root * 0.4), u0 - t / 2, sign * half * 0.55], 0.05));
        }
    }
    return shape(parts, props);
}

/** A taildragger's three-point attitude on the ground, deg [estimate for a Cub] */
export const TAILDRAGGER_PITCH = 11;

/** How a type flies: speeds m/s, climb m/s, distances m, attitudes deg [see the file's notes; estimates marked]. */
export interface Perf {
    name: string;
    /** approach speed on final, at the touchdown, at lift-off, in the climb */
    vapp: number;
    vtd: number;
    vlof: number;
    vclimb: number;
    roc: number;
    /** landing ground roll (touchdown to stop) and take-off ground roll, m */
    landRoll: number;
    toRoll: number;
    /** flare starts this high over the runway, m [estimate] */
    flareH: number;
    /** pitch on final, at lift-off and in the climb, deg [estimates] */
    pitchApp: number;
    pitchLof: number;
    pitchClimb: number;
    taildragger: boolean;
    retract: boolean;
}

const KT = 0.514444;
const FT = 0.3048;

export interface AircraftType {
    kind: AircraftKind;
    perf: Perf;
    shape: AirShape;
    /** colours: body, trim, wings and tail (drawing) */
    livery: [number, number, number];
}

/**
 * The ten types (owner, 2026-10-20: "ten different planes, of different types/larger and smaller"), from a Piper Cub to
 * an ATR 72. Their sources are on each.
 */
export const AIRCRAFT: AircraftType[] = [
    {
        // Piper J-3 Cub: 6.83 m long, 10.74 m span, 2.03 m high; stalls at 33 kn, climbs 2.3 m/s (Wikipedia, J3C-65)
        kind: 'cub',
        perf: {
            name: 'Piper J-3 Cub', vapp: 1.3 * 33 * KT, vtd: 1.15 * 33 * KT, vlof: 1.15 * 33 * KT, vclimb: 55 * KT, roc: 2.3,
            landRoll: 90, toRoll: 110, flareH: 2, pitchApp: 4, pitchLof: 6, pitchClimb: 8, taildragger: true, retract: false
        },
        livery: [0xf2c12e, 0x1d1d1d, 0xf2c12e],
        shape: plane({
            L: 6.83, D: 0.95, mainX: 1.55, tailX: 6.45, clear: 0.45, track: 0.9, wheel: 0.55, retract: false,
            wing: { X: 1.9, span: 10.74, root: 1.6, tip: 1.6, sweep: 0, dihedral: 1, high: true },
            htail: { X: 5.85, span: 3.0, root: 0.95, tip: 0.8, tee: false },
            fin: { X: 6.0, h: 0.9, root: 0.75, tip: 0.55, sweep: 25 },
            engines: [{ at: 'nose', s: 0, X0: 0, X1: 0, r: 0, prop: 0.9, blades: 2 }], struts: true, aft: 0.4
        })
    },
    {
        // Cessna 172R: 8.28 m long, 11.00 m span, 2.72 m high; stalls at 47 kn flaps down, climbs 3.66 m/s, prop 1.91 m (Wikipedia)
        kind: 'c172',
        perf: {
            name: 'Cessna 172 Skyhawk', vapp: 1.3 * 47 * KT, vtd: 1.15 * 47 * KT, vlof: 55 * KT, vclimb: 74 * KT, roc: 3.66,
            landRoll: 175, toRoll: 290, flareH: 3, pitchApp: 2, pitchLof: 7, pitchClimb: 9, taildragger: false, retract: false
        },
        livery: [0xf4f4f0, 0x2a4f9a, 0xf4f4f0],
        shape: plane({
            L: 8.28, D: 1.25, mainX: 3.2, noseX: 1.0, clear: 0.55, track: 1.15, wheel: 0.5, retract: false,
            wing: { X: 2.4, span: 11.0, root: 1.63, tip: 1.13, sweep: 0, dihedral: 1.7, high: true },
            htail: { X: 7.0, span: 3.45, root: 1.1, tip: 0.8, tee: false },
            fin: { X: 6.6, h: 1.1, root: 1.4, tip: 0.75, sweep: 35 },
            engines: [{ at: 'nose', s: 0, X0: 0, X1: 0, r: 0, prop: 0.95, blades: 2 }], struts: true
        })
    },
    {
        // Cirrus SR22 (G5): 7.92 m long, 11.68 m span, 2.72 m high; stalls at 60 kn flaps down, climbs 6.5 m/s, 3 blades (Wikipedia)
        kind: 'sr22',
        perf: {
            name: 'Cirrus SR22', vapp: 1.3 * 60 * KT, vtd: 1.15 * 60 * KT, vlof: 70 * KT, vclimb: 100 * KT, roc: 6.5,
            landRoll: 330, toRoll: 330, flareH: 3, pitchApp: 2, pitchLof: 7, pitchClimb: 10, taildragger: false, retract: false
        },
        livery: [0xf2f2f2, 0x8a1c2b, 0xf2f2f2],
        shape: plane({
            L: 7.92, D: 1.3, mainX: 3.1, noseX: 0.95, clear: 0.5, track: 1.4, wheel: 0.5, retract: false,
            wing: { X: 2.4, span: 11.68, root: 1.5, tip: 0.9, sweep: 2, dihedral: 4, high: false },
            htail: { X: 6.75, span: 3.9, root: 0.9, tip: 0.6, tee: false },
            fin: { X: 6.45, h: 1.0, root: 1.3, tip: 0.7, sweep: 35 },
            engines: [{ at: 'nose', s: 0, X0: 0, X1: 0, r: 0, prop: 0.99, blades: 3 }], struts: false
        })
    },
    {
        // Beechcraft Baron G58: 29 ft 10 in long, 37 ft 10 in span, 9 ft 9 in high; stalls at 73 kn in the landing setting,
        // lands in a 1440 ft ground roll (AOPA's G58 fact sheet, quoted in a search summary)
        kind: 'baron',
        perf: {
            name: 'Beechcraft Baron 58', vapp: 1.3 * 73 * KT, vtd: 1.15 * 73 * KT, vlof: 90 * KT, vclimb: 105 * KT, roc: 8,
            landRoll: 1440 * FT, toRoll: 430, flareH: 3.5, pitchApp: 2, pitchLof: 7, pitchClimb: 9, taildragger: false, retract: true
        },
        livery: [0xf3f1ea, 0x6b2234, 0xf3f1ea],
        shape: plane({
            L: (29 * 12 + 10) * 0.0254, D: 1.25, mainX: 3.6, noseX: 1.1, clear: 0.6, track: 1.6, wheel: 0.55, retract: true,
            wing: { X: 3.0, span: (37 * 12 + 10) * 0.0254, root: 1.9, tip: 1.1, sweep: 2, dihedral: 6, high: false },
            htail: { X: 7.85, span: 4.9, root: 1.0, tip: 0.6, tee: false },
            fin: { X: 7.25, h: 1.35, root: 1.5, tip: 0.7, sweep: 40 },
            engines: [{ at: 'wing', s: 2.25, X0: 2.0, X1: 4.7, r: 0.42, prop: 0.95, blades: 3 }], struts: false
        })
    },
    {
        // Cessna 208 Caravan: 11.46 m long, 15.87 m span, 4.53 m high; stalls at 61 kn, climbs 6.27 m/s; the Grand Caravan
        // EX's take-off run 660 m and landing roll 570 m (Wikipedia)
        kind: 'caravan',
        perf: {
            name: 'Cessna 208 Caravan', vapp: 1.3 * 61 * KT, vtd: 1.15 * 61 * KT, vlof: 70 * KT, vclimb: 104 * KT, roc: 6.27,
            landRoll: 570, toRoll: 660, flareH: 4, pitchApp: 2, pitchLof: 7, pitchClimb: 9, taildragger: false, retract: false
        },
        livery: [0xf4f4f0, 0xc0392b, 0xf4f4f0],
        shape: plane({
            L: 11.46, D: 1.75, mainX: 4.9, noseX: 1.3, clear: 0.75, track: 1.8, wheel: 0.7, retract: false,
            wing: { X: 3.9, span: 15.87, root: 1.98, tip: 1.22, sweep: 0, dihedral: 3, high: true },
            htail: { X: 9.8, span: 6.25, root: 1.4, tip: 1.0, tee: false },
            fin: { X: 9.2, h: 1.75, root: 2.0, tip: 1.0, sweep: 35 },
            engines: [{ at: 'nose', s: 0, X0: 0, X1: 0, r: 0, prop: 1.32, blades: 3 }], struts: true, pod: [2.6, 8.0, 0.35]
        })
    },
    {
        // Pilatus PC-12 NG: 14.4 m long, 16.28 m span, 4.26 m high; stalls at 67 kn, climbs 9.75 m/s; 793 m to take off and 661 m to
        // land over 15 m; a 4-blade prop 2.67 m across (Wikipedia)
        kind: 'pc12',
        perf: {
            name: 'Pilatus PC-12', vapp: 1.3 * 67 * KT, vtd: 1.15 * 67 * KT, vlof: 80 * KT, vclimb: 120 * KT, roc: 9.75,
            landRoll: 0.5 * 661, toRoll: 0.6 * 793, flareH: 4, pitchApp: 2, pitchLof: 7, pitchClimb: 10, taildragger: false, retract: true
        },
        livery: [0xf5f5f5, 0x1f3f7a, 0xf5f5f5],
        shape: plane({
            L: 14.4, D: 1.8, mainX: 6.2, noseX: 2.0, clear: 0.75, track: 2.0, wheel: 0.65, retract: true,
            wing: { X: 5.4, span: 16.28, root: 2.3, tip: 1.2, sweep: 2, dihedral: 5, high: false },
            htail: { X: 13.0, span: 5.2, root: 1.6, tip: 1.0, tee: true },
            fin: { X: 11.4, h: 1.75, root: 2.6, tip: 1.6, sweep: 40 },
            engines: [{ at: 'nose', s: 0, X0: 0, X1: 0, r: 0, prop: 1.335, blades: 4 }], struts: false
        })
    },
    {
        // Beechcraft King Air 350: 14.22 m long, 17.65 m span, 4.37 m high (Wikipedia); 1006 m to take off (350i); Vref 104 kn
        // (aerocorner) to 112 kn (Twin & Turbine, 2017), quoted in a search summary: 107 taken
        kind: 'kingair',
        perf: {
            name: 'Beechcraft King Air 350', vapp: 107 * KT, vtd: 100 * KT, vlof: 100 * KT, vclimb: 140 * KT, roc: 10,
            landRoll: 420, toRoll: 0.6 * 1006, flareH: 5, pitchApp: 1, pitchLof: 7, pitchClimb: 10, taildragger: false, retract: true
        },
        livery: [0xf6f4ee, 0xb08d3c, 0xf6f4ee],
        shape: plane({
            L: 14.22, D: 1.7, mainX: 6.3, noseX: 2.0, clear: 0.75, track: 2.6, wheel: 0.65, retract: true,
            wing: { X: 5.0, span: 17.65, root: 2.4, tip: 1.2, sweep: 2, dihedral: 6, high: false },
            htail: { X: 12.9, span: 5.6, root: 1.5, tip: 1.0, tee: true },
            fin: { X: 11.2, h: 1.95, root: 2.8, tip: 1.7, sweep: 40 },
            engines: [{ at: 'wing', s: 2.6, X0: 3.6, X1: 7.6, r: 0.5, prop: 1.34, blades: 4 }], struts: false
        })
    },
    {
        // DHC-6 Twin Otter (Series 300): 15.77 m long, 19.81 m span, 5.94 m high; stalls at 56 kn, climbs 8.1 m/s; 450 m to take
        // off and 460 m to land over 15 m (Wikipedia)
        kind: 'twinotter',
        perf: {
            name: 'DHC-6 Twin Otter', vapp: 1.3 * 56 * KT, vtd: 1.15 * 56 * KT, vlof: 65 * KT, vclimb: 90 * KT, roc: 8.1,
            landRoll: 0.5 * 460, toRoll: 0.6 * 450, flareH: 4, pitchApp: 2, pitchLof: 7, pitchClimb: 10, taildragger: false, retract: false
        },
        livery: [0xf3f3ee, 0xd04a1f, 0xf3f3ee],
        shape: plane({
            L: 15.77, D: 1.8, mainX: 6.5, noseX: 1.6, clear: 0.85, track: 1.85, wheel: 0.8, retract: false,
            wing: { X: 5.6, span: 19.81, root: 1.98, tip: 1.98, sweep: 0, dihedral: 3, high: true },
            htail: { X: 13.7, span: 6.3, root: 1.6, tip: 1.4, tee: false },
            fin: { X: 12.9, h: 2.55, root: 2.6, tip: 1.6, sweep: 30 },
            engines: [{ at: 'wing', s: 3.2, X0: 4.2, X1: 7.4, r: 0.5, prop: 1.3, blades: 3 }], struts: true
        })
    },
    {
        // Embraer Phenom 300E: 15.64 m long, 15.91 m span, 5.1 m high; 978 m to take off, 674 m to land; engines on pylons by the
        // tail (Wikipedia); Vref about 108 kn at usual weights (Twin & Turbine, 2011, quoted in a search summary)
        kind: 'phenom',
        perf: {
            name: 'Embraer Phenom 300', vapp: 108 * KT, vtd: 102 * KT, vlof: 105 * KT, vclimb: 160 * KT, roc: 15,
            landRoll: 0.5 * 674, toRoll: 0.6 * 978, flareH: 6, pitchApp: 2, pitchLof: 8, pitchClimb: 12, taildragger: false, retract: true
        },
        livery: [0xf7f7f7, 0x30343b, 0xf7f7f7],
        shape: plane({
            L: 15.64, D: 1.9, mainX: 8.7, noseX: 2.5, clear: 0.65, track: 2.0, wheel: 0.6, retract: true,
            wing: { X: 6.4, span: 15.91, root: 3.0, tip: 1.1, sweep: 26, dihedral: 5, high: false },
            htail: { X: 14.4, span: 5.8, root: 1.6, tip: 0.9, tee: true },
            fin: { X: 12.6, h: 2.45, root: 3.0, tip: 1.8, sweep: 45 },
            engines: [{ at: 'rear', s: 1.6, X0: 10.3, X1: 13.0, r: 0.55, prop: 0, blades: 0 }], struts: false
        })
    },
    {
        // ATR 72-600: 27.17 m long, 27.05 m span, 7.65 m high, cabin 2.57 m wide; 1279 m to take off, 915 m to land (Wikipedia, its
        // table read column by column); six-blade props (a caption there); Vref 113 kn and V2 116 kn (an ATR spec sheet, quoted
        // in a search summary)
        kind: 'atr72',
        perf: {
            name: 'ATR 72-600', vapp: 113 * KT, vtd: 108 * KT, vlof: 112 * KT, vclimb: 150 * KT, roc: 7,
            landRoll: 0.5 * 915, toRoll: 0.6 * 1279, flareH: 6, pitchApp: 1, pitchLof: 7, pitchClimb: 9, taildragger: false, retract: true
        },
        livery: [0xf6f6f6, 0x1e4fa0, 0xf6f6f6],
        shape: plane({
            L: 27.17, D: 2.8, mainX: 15.2, noseX: 1.9, clear: 0.75, track: 2.05, wheel: 0.9, retract: true,
            wing: { X: 11.1, span: 27.05, root: 2.6, tip: 1.45, sweep: 3, dihedral: 2.5, high: true },
            htail: { X: 25.2, span: 7.3, root: 2.0, tip: 1.3, tee: true },
            fin: { X: 22.0, h: 3.85, root: 4.4, tip: 2.8, sweep: 35 },
            engines: [{ at: 'wing', s: 4.05, X0: 9.0, X1: 14.5, r: 0.75, prop: 1.96, blades: 6 }], struts: false
        })
    }
];

// ---------------------------------------------------------------- the helicopter, tugs, people

/**
 * The air ambulance: an Airbus (Eurocopter) EC135, the type mainly flown for air medical transport (Wikipedia: 10.2 m long,
 * main rotor 10.2 m across with four blades, 3.51 m high, cruise 254 km/h, climb 7.62 m/s). Cabin, tail boom, Fenestron
 * and skids from the photos' proportions [estimates]. Its origin is on the ground under the rotor mast.
 */
export const HELI: AirShape = (() => {
    const mast = 2.5;
    const F = (X: number): number => mast - X;
    const parts: APart[] = [
        cap('body', [F(0.85), 1.25, 0], [F(3.6), 1.3, 0], 0.8),
        cap('glass', [F(0.75), 1.45, 0], [F(1.2), 1.45, 0], 0.68),
        box('body', [F(3.0), 2.15, 0], [1.3, 0.35, 0.55]),
        cap('body', [F(4.2), 1.55, 0], [F(8.6), 1.85, 0], 0.32),
        box('tail', [F(9.35), 1.95, 0], [0.75, 0.75, 0.2]),
        box('tail', [F(9.1), 2.2, 0], [0.35, 0.06, 1.1]),
        cap('mast', [0, 2.5, 0], [0, 3.35, 0], 0.18),
        box('skid', [F(2.4), 0.05, -1.0], [1.7, 0.05, 0.05]),
        box('skid', [F(2.4), 0.05, 1.0], [1.7, 0.05, 0.05]),
        box('skid', [F(1.6), 0.3, 0], [0.04, 0.3, 1.0]),
        box('skid', [F(3.2), 0.3, 0], [0.04, 0.3, 1.0])
    ];
    return shape(parts, [{ p: [0, 3.4, 0], r: 5.1, blades: 4, axis: 'u' }, { p: [F(9.35), 1.95, 0.25], r: 0.5, blades: 8, axis: 's' }]);
})();
export const HELI_PERF = { name: 'Airbus Helicopters EC135', cruise: 50, climb: 7.62 };

/** A small aircraft tug [estimate: 3.2 m long, 1.9 m wide]: its body and cab; its origin on the ground at its middle. */
export const TUG: AirShape = shape([
    box('tug', [0, 0.55, 0], [1.6, 0.4, 0.95]),
    box('tug', [-0.9, 1.35, 0], [0.5, 0.45, 0.8]),
    box('gear', [0, 0.3, 0], [1.2, 0.3, 1.0])
], []);
/** half its length and the tow bar's length between its front and the plane's nose wheel [estimate] */
export const TUG_HALF = 1.6;
export const TOW_BAR = 2.5;

/** A person standing (as the traffic's: traffic model.ts PERSON) and one sitting (the controllers). */
export const WALKER: AirShape = shape([cap('person', [0, 0.3, 0], [0, 1.45, 0], 0.3)], []);
export const SITTER: AirShape = shape([cap('person', [0, 0.3, 0], [0, 0.75, 0], 0.3)], []);
/** A stretcher on its trolley with the patient lying on it [estimate: 2 m x 0.6 m, 0.9 m high] */
export const STRETCHER: AirShape = shape([box('stretcher', [0, 0.65, 0], [1.0, 0.25, 0.3])], []);
