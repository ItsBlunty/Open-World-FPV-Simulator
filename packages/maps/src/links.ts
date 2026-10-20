// What joins the map's areas up (map v11; owner, 2026-10-19: "the paths in each section dont match up with each other,
// the edges of the city dont really make sense ... there are power poles but no lines, and the poles are facing the
// wrong way to connect"). A road south out of the city past the bando to the industrial yard's gate, over the railway
// on a level crossing; the bando's old driveway; the fields station's forecourt and the lane away from it; the park's
// paths carried on to that road and to the forest track, over the railway on boarded foot crossings; and the power line
// along the park's north edge, from a substation at its west end to a riser pole at its east end, its wires strung
// between crossarms that now stand square to the line. Metres, north is -z, east +x, y up.
//
// No random choices except the driveway's broken slabs (their own Rng), so nothing else on the map moves.

import { LevelBuilder, Rng } from './builder';
import type { Material } from './builder';
import { BALLAST_TOP, RAIL_OVER_BED } from './railway';

/**
 * The city's outer edge: the outer kerbs of the ring of roads round the blocks (the outermost road centres are at
 * x = -480 and 480, z = -490 and -90, each road 18 m kerb to kerb), and the sidewalk outside them, 5 m wide
 * [a usual city sidewalk; the blocks' own are wider].
 */
export const CITY_EDGE = { x0: -489, x1: 489, z0: -499, z1: -81, walk: 5 };

/** The road out of the city to the industrial yard: north-south at x -360, 7 m wide (two 3.5 m lanes [a usual rural two-lane road]). */
export const YARD_ROAD = { x: -360, hw: 3.5, z0: CITY_EDGE.z1, z1: 120 };
/** where it crosses the railway (the line's west straight runs along z 100) */
const CROSSING_Z = 100;
/** The power line: along z -40, a pole every 50 m from x -425 to the riser pole at 475; the substation at its west end. */
const LINE_Z = -40;
const POLE_X0 = -425, POLE_X1 = 475, SPAN = 50;
/** a 12 m wooden pole, its crossarm 8 ft (2.44 m) long 0.6 m under the top, pin insulators 15 cm high [usual distribution construction] */
const POLE_H = 12, ARM_Y = 11.4, PIN = 0.15;
/** the three wires' places along the crossarm, from the pole's centre (two on one side, one on the other) */
const WIRES = [-1.1, -0.4, 1.1];
/** a wire's sag at mid-span, about 1.2 % of a 50 m span [estimate for a distribution line on a mild day] */
const SAG = 0.6;
/**
 * Drawn 3.5 cm thick: a real conductor is 1-2 cm [estimate], which would vanish on screen at a few metres. Solid, as
 * real wires are (owner, 2026-10-19).
 */
const WIRE_W = 0.035;
/** The fields station's forecourt south of its platform, and the lane south from it, 6 m wide [a two-way country lane]. */
const FORECOURT = { x0: 214, x1: 286, z0: 482.5, z1: 503 };
const LANE = { x: 250, hw: 3 };
/** The forest track carries on east out of the forest along z 404, past the map's edge (woods.ts FOREST_TRACK ends at x 500). */
const TRACK_OUT_Z = 404;
/** The farm track from the park's east-west path south to the forest track's north end (woods.ts FOREST_TRACK starts at 176, 280). */
const FARM_TRACK = { x: 176, hw: 2, z0: 83, z1: 281.2 };
/** how far the ground reaches (first-map.ts GROUND): the lane and the track run on to it */
const FAR = 2000;

/**
 * Is (x, z) within d m of a road or track that leaves the map, or of the farm track (trees planted along those keep off
 * them: woods.ts)?
 */
export function onWayOut(x: number, z: number, d: number): boolean {
    if (z > FORECOURT.z1 - 1 && Math.abs(x - LANE.x) < LANE.hw + d) return true;
    if (x > 440 && Math.abs(z - TRACK_OUT_Z) < 2 + d) return true;
    return z > FARM_TRACK.z0 - d && z < FARM_TRACK.z1 + d && Math.abs(x - FARM_TRACK.x) < FARM_TRACK.hw + d;
}

export function links(b: LevelBuilder): void {
    yardRoad(b);
    bandoDriveway(b, new Rng(12));
    fieldsLane(b);
    footpaths(b);
    powerLine(b);
}

// ---------------------------------------------------------------- level crossings

/**
 * Where a road or path crosses the railway on the level: a deck laid between and beside the rails, its top 1 cm under
 * the rails' (so the flanges' grooves stay open and the rails show), and a ramp each side from the ground (or the path,
 * `y0` up) to it. (cx, cz) is on the track's centre line, (tx, tz) the track's unit heading there; the deck runs `len` m
 * along the track and covers the ballast's 3 m top; each ramp is `ramp` m long, square to the track.
 */
function levelCrossing(b: LevelBuilder, m: Material, cx: number, cz: number, tx: number, tz: number, len: number, ramp: number, y0: number): void {
    const top = BALLAST_TOP + RAIL_OVER_BED - 0.01;
    const P = (u: number, v: number, y: number): number[] => [cx + tx * u - tz * v, y, cz + tz * u + tx * v];
    const h = len / 2, w = 1.5;
    const c = P(0, 0, (BALLAST_TOP + top) / 2);
    // the deck: its top, its two ends (along the track), its sides lie against the ramps
    b.quadOut(m, c, P(-h, -w, top), P(h, -w, top), P(h, w, top), P(-h, w, top));
    for (const u of [-h, h]) b.quadOut(m, c, P(u, -w, BALLAST_TOP), P(u, w, BALLAST_TOP), P(u, w, top), P(u, -w, top));
    // the ramps, one each side: a wedge from the deck's edge down to y0 at its foot
    for (const s of [-1, 1]) {
        const vi = s * w, vo = s * (w + ramp);
        const cw = P(0, s * (w + ramp / 3), top / 3);
        b.quadOut(m, cw, P(-h, vi, top), P(h, vi, top), P(h, vo, y0), P(-h, vo, y0));
        if (y0 > 0) b.quadOut(m, cw, P(-h, vo, 0), P(h, vo, 0), P(h, vo, y0), P(-h, vo, y0));
        for (const u of [-h, h]) {
            if (y0 > 0) b.quadOut(m, cw, P(u, vi, 0), P(u, vi, top), P(u, vo, y0), P(u, vo, 0));
            else b.triOut(m, cw, P(u, vi, 0), P(u, vi, top), P(u, vo, 0));
        }
    }
}

// ---------------------------------------------------------------- the road to the yard

/**
 * From the city's south ring road at x -360 south past the bando, over the railway, to the yard's north edge, where a
 * fence now runs with a gate in it. Its asphalt is part of the ground (first-map.ts ground); here: its paint, the level
 * crossing with its signs and raised barriers, and the yard's north and west fences.
 */
function yardRoad(b: LevelBuilder): void {
    const R = YARD_ROAD, W = 0.075;
    // paint: a dashed centre line (3 m dashes, 6 m gaps), solid edge lines 10 cm wide 20 cm in, a stop line at the city
    // road for the northbound lane (traffic keeps right), none over the crossing
    const off = (z: number): boolean => z > CROSSING_Z - 10 && z < CROSSING_Z + 10;
    for (let z = R.z0 + 4; z + 3 <= R.z1; z += 9) if (!off(z) && !off(z + 3)) b.decal('marking', R.x - W, z, R.x + W, z + 3);
    for (const [za, zb] of [[R.z0 + 2, CROSSING_Z - 10], [CROSSING_Z + 10, R.z1]]) {
        b.decal('marking', R.x - R.hw + 0.2, za, R.x - R.hw + 0.3, zb);
        b.decal('marking', R.x + R.hw - 0.3, za, R.x + R.hw - 0.2, zb);
    }
    b.decal('marking', R.x + 0.2, R.z0 + 1.6, R.x + R.hw - 0.2, R.z0 + 2);
    // the crossing: a 9 m deck, ramps of 6.5 m (0.44 m up: under 7 %), so cars cross it without grounding
    levelCrossing(b, 'concrete', R.x, CROSSING_Z, 1, 0, 2 * R.hw + 2, 6.5, 0);
    // a crossbuck on the right of each approach, 6 m from the track, and a half barrier raised upright beside it
    // (each half barrier closes the lane coming towards the crossing: its pivot on the road's right-hand edge)
    for (const s of [-1, 1]) {
        // s = 1: the northbound approach (from the yard, south of the track); its right is +x
        const x = R.x + s * (R.hw + 0.8), z = CROSSING_Z + s * 6;
        b.block('metal', x, z, 0.1, 0.1, 0, 3.4);
        b.bar('marking', [x - 0.62, 2.6, z], [x + 0.62, 3.3, z], 0.08);
        b.bar('marking', [x - 0.62, 3.3, z], [x + 0.62, 2.6, z], 0.08);
        b.box('metal', x - 0.35, 2.0, z - 0.08, x + 0.35, 2.3, z + 0.08); // the two red lights' housing
        // the barrier: a pedestal and its boom raised, 3.6 m long, a little behind the crossbuck
        const bz = z + s * 1.2;
        b.block('metal', x, bz, 0.4, 0.4, 0, 1.1);
        b.block('marking', x, bz, 0.12, 0.12, 1.1, 3.6);
    }
    // the yard's fence posts on its north side (a gate in it for the road) and its west side, matching its others
    for (let x = -460; x < -200; x += 10) if (Math.abs(x - R.x) > 6) b.prism('metal', x, R.z1, 0, 2.4, 0.08, 4);
    for (let z = 130; z <= 420; z += 10) b.prism('metal', -460, z, 0, 2.4, 0.08, 4);
    for (const s of [-1, 1]) b.block('metal', R.x + s * (R.hw + 1.5), R.z1, 0.3, 0.3, 0, 2.6); // the gate posts
    // a sliding gate, open: pushed back along the fence line west of the opening
    b.box('metal', R.x - R.hw - 9.5, 0.1, R.z1 + 0.25, R.x - R.hw - 1.7, 0.2, R.z1 + 0.33);
    b.box('metal', R.x - R.hw - 9.5, 2.0, R.z1 + 0.25, R.x - R.hw - 1.7, 2.1, R.z1 + 0.33);
    for (let x = R.x - R.hw - 9.5; x <= R.x - R.hw - 1.7; x += 1.95) b.box('metal', x, 0.2, R.z1 + 0.25, x + 0.06, 2.0, R.z1 + 0.33);
}

/**
 * The bando's driveway off the yard road, cracked concrete slabs with grass coming through the joints and a few slabs
 * gone, to the yard in front of its loading dock (first-map.ts bando: the dock from x -274 to -256, its front at z 22).
 * Painted on the ground: flat, so the quad feels the grass under it.
 */
function bandoDriveway(b: LevelBuilder, r: Rng): void {
    const slab = (x0: number, z0: number, x1: number, z1: number): void => {
        for (let x = x0; x < x1 - 0.01; x += 4) for (let z = z0; z < z1 - 0.01; z += 4) {
            const gone = r.chance(1, 9);
            // (map v14) 5 mm over the worn path's paint where it meets them, so the two do not flicker
            if (!gone) b.decal('concrete-dark', x + 0.08, z + 0.08, Math.min(x + 4, x1) - 0.08, Math.min(z + 4, z1) - 0.08, 0.005);
        }
    };
    slab(YARD_ROAD.x + YARD_ROAD.hw, 27, -282, 33);
    slab(-282, 22, -238, 42);
}

// ---------------------------------------------------------------- the fields station

/** The station's forecourt and car park behind its platform, a ramp up to the platform, and the lane south from it. */
function fieldsLane(b: LevelBuilder): void {
    const F = FORECOURT;
    b.decal('asphalt', F.x0, F.z0, F.x1, F.z1);
    // parking bays along its south side, 2.5 m wide and 5 m deep [usual bay size]
    for (let x = F.x0 + 2; x <= LANE.x - LANE.hw - 2; x += 2.5) b.decal('marking', x - 0.05, F.z1 - 5, x + 0.05, F.z1 - 0.3, 0.02);
    for (let x = LANE.x + LANE.hw + 2; x <= F.x1 - 2; x += 2.5) b.decal('marking', x - 0.05, F.z1 - 5, x + 0.05, F.z1 - 0.3, 0.02);
    // the ramp from the forecourt up to the platform's back edge, 0.9 m over 11 m (1 in 12, the usual steepest for a ramp
    // people walk), clear of the station building (x 230 to 255)
    b.rampZ('concrete', 260, 263, F.z0 + 10.8, F.z0, 0, 0.9, 0.3);
    // the lane: on south past the map's edge, through a gap in the trees
    b.decal('asphalt', LANE.x - LANE.hw, F.z1, LANE.x + LANE.hw, FAR);
}

// ---------------------------------------------------------------- footpaths

/**
 * The park's paths carried on: the east-west one west to the yard road and east to the farm track; a trodden line off
 * it to the bando; the farm track south to the forest track's north end, and the forest track east past the map's edge;
 * and boarded foot crossings where the park's paths cross the railway. The park's own paths are first-map.ts park.
 */
function footpaths(b: LevelBuilder): void {
    // (the park's east-west path is a 5 cm slab from x -150 to 150, z 77 to 83)
    b.box('path', YARD_ROAD.x + YARD_ROAD.hw, 0, 77, -150, 0.05, 83);
    b.box('path', 150, 0, 77, FARM_TRACK.x + FARM_TRACK.hw, 0.05, 83);
    // the line people have worn from the path to the bando's yard, 1.2 m wide
    const worn: [number, number][] = [[-232, 77], [-238, 62], [-246, 42]];
    for (let i = 0; i + 1 < worn.length; i++) strip(b, 'path', worn[i], worn[i + 1], 0.6, 0.02);
    // the farm track: dirt, painted, like the forest track it leads to
    b.decal('path', FARM_TRACK.x - FARM_TRACK.hw, FARM_TRACK.z0, FARM_TRACK.x + FARM_TRACK.hw, FARM_TRACK.z1);
    // the forest track's way out east, from its last point (500, 404)
    b.decal('path', 498.8, TRACK_OUT_Z - 2, FAR, TRACK_OUT_Z + 2);
    // foot crossings over the railway, where the park's paths meet it: the west loop path (x -104 to -100) over the
    // west straight (z 100); the north-south path (x -3 to 3) and the south loop path (z 150 to 154) over the curve round
    // the corner at (20, 100), whose centre is (-80, 200), radius 100
    levelCrossing(b, 'wood', -102, 100, 1, 0, 6, 2, 0.05);
    for (const [px, pz, w, alongX] of [[0, 140, 6, false], [7.7, 152, 4, true]] as const) {
        // the track's heading there: square to the radius
        const rx = px + 80, rz = pz - 200, rl = Math.sqrt(rx * rx + rz * rz);
        const tx = -rz / rl, tz = rx / rl;
        // how far along the track the path's width reaches, crossing it at a slant
        const slant = alongX ? Math.abs(tz) : Math.abs(tx);
        const cx = -80 + (rx / rl) * 100, cz = 200 + (rz / rl) * 100;
        levelCrossing(b, 'wood', cx, cz, tx, tz, w / slant + 1, 2, 0.05);
    }
}

/** A flat strip of paint `hw` m either side of the line a-b, `y` up (a worn path). */
function strip(b: LevelBuilder, m: Material, a: [number, number], c: [number, number], hw: number, y: number): void {
    const [ax, az] = a, [cx, cz] = c;
    const l = Math.sqrt((cx - ax) * (cx - ax) + (cz - az) * (cz - az));
    const nx = (-(cz - az) / l) * hw, nz = ((cx - ax) / l) * hw;
    const ex = ((cx - ax) / l) * hw, ez = ((cz - az) / l) * hw;
    const p = [[ax - ex + nx, az - ez + nz], [cx + ex + nx, cz + ez + nz], [cx + ex - nx, cz + ez - nz], [ax - ex - nx, az - ez - nz]];
    // wound to face up (counter-clockwise seen from above, y up and z south)
    const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    const q = cross < 0 ? p : [p[0], p[3], p[2], p[1]];
    b.paintQuad(m, [q[0][0], y, q[0][1]], [q[1][0], y, q[1][1]], [q[2][0], y, q[2][1]], [q[3][0], y, q[3][1]]);
}

// ---------------------------------------------------------------- the power line

/**
 * A three-wire distribution line on wooden poles along the park's north edge. Its crossarms stand square to the line (on
 * map v10 they ran along it, so no wire could have joined them), the wires hang in a shallow curve between the pins,
 * drawn as straight pieces. At the west end it comes out of a small substation, at the east end it ends on a riser pole:
 * a guy wire takes the pull of the wires, and the line goes down the pole in a conduit to run underground into the city.
 */
function powerLine(b: LevelBuilder): void {
    const z = LINE_Z;
    const pin = ARM_Y + 0.06 + PIN;
    for (let x = POLE_X0; x <= POLE_X1; x += SPAN) {
        b.prism('wood', x, z, 0, POLE_H, 0.16, 6);
        b.box('wood', x - 0.05, ARM_Y - 0.06, z - 1.22, x + 0.05, ARM_Y + 0.06, z + 1.22);
        // two braces from the pole to the arm
        for (const s of [-1, 1]) b.bar('metal', [x, ARM_Y - 0.75, z], [x, ARM_Y - 0.06, z + s * 0.7], 0.04);
        for (const w of WIRES) b.prism('concrete', x, z + w, ARM_Y + 0.06, pin, 0.05, 6);
    }
    // the wires, pin to pin; the first span runs from the substation's gantry
    const GX = -468;
    const ends = [GX];
    for (let x = POLE_X0; x <= POLE_X1; x += SPAN) ends.push(x);
    for (let i = 0; i + 1 < ends.length; i++) for (const w of WIRES) wire(b, [ends[i], pin, z + w], [ends[i + 1], pin, z + w]);
    // the riser pole at the east end: the guy wire to its anchor 8 m east, the wires down to the cable heads, the conduit
    const xe = POLE_X1;
    b.bar('metal', [xe + 0.1, ARM_Y - 0.3, z], [xe + 8, 0.3, z], 0.025);
    b.block('concrete', xe + 8.15, z, 0.5, 0.5, 0, 0.3);
    for (const w of WIRES) {
        b.bar('metal', [xe, pin, z + w], [xe + 0.3, ARM_Y - 1.3, z + w * 0.25], WIRE_W);
        b.prism('concrete', xe + 0.3, z + w * 0.25, ARM_Y - 1.7, ARM_Y - 1.3, 0.07, 6); // the cable head
    }
    b.box('metal', xe + 0.16, 0, z - 0.06, xe + 0.28, ARM_Y - 1.7, z + 0.06);
    substation(b, GX, z);
}

/** A wire from pin a to pin b (same height), hanging SAG at mid-span: a parabola drawn as 8 straight pieces. */
function wire(b: LevelBuilder, a: number[], c: number[]): void {
    const N = 8;
    let p = a;
    for (let k = 1; k <= N; k++) {
        const t = k / N;
        const q = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - 4 * SAG * t * (1 - t), a[2] + (c[2] - a[2]) * t];
        b.bar('metal', p, q, WIRE_W);
        p = q;
    }
}

/**
 * The substation the line leaves from: a gravel yard behind a fence (posts and rails, 2.4 m), a transformer with its
 * cooling fins, and the steel gantry the wires are tied off on; a gravel drive to its gate from the city's ring road.
 * Its gantry stands at x `gx`, on the line.
 */
function substation(b: LevelBuilder, gx: number, z: number): void {
    const x0 = -492, x1 = -462, z0 = z - 14, z1 = z + 12;
    b.decal('ballast', x0, z0, x1, z1);
    // the drive from the ring road's outer sidewalk (the city's edge at z -76) to the gate in the north fence
    b.decal('ballast', -481, CITY_EDGE.z1 + CITY_EDGE.walk, -475, z0);
    // the fence: posts every 3 m, a top and a bottom rail, the gate opening on the north side (x -481 to -475)
    const gate = (x: number): boolean => x > -481 && x < -475;
    for (let x = x0; x <= x1; x += 3) for (const zz of [z0, z1]) if (!(zz === z0 && gate(x))) b.prism('metal', x, zz, 0, 2.4, 0.05, 4);
    for (let zz = z0 + 2; zz < z1; zz += 3) for (const xx of [x0, x1]) b.prism('metal', xx, zz, 0, 2.4, 0.05, 4);
    for (const y of [0.25, 2.3]) {
        b.box('metal', x0, y, z1 - 0.025, x1, y + 0.05, z1 + 0.025);
        b.box('metal', x0, y, z0 - 0.025, -481, y + 0.05, z0 + 0.025);
        b.box('metal', -475, y, z0 - 0.025, x1, y + 0.05, z0 + 0.025);
        for (const xx of [x0, x1]) b.box('metal', xx - 0.025, y, z0, xx + 0.025, y + 0.05, z1);
    }
    // the gantry: two lattice-like posts (drawn solid) and a beam the wires end on, with their strain insulators
    for (const s of [-1, 1]) b.block('metal', gx, z + s * 2.2, 0.35, 0.35, 0, ARM_Y + 0.6);
    b.box('metal', gx - 0.15, ARM_Y + 0.3, z - 2.4, gx + 0.15, ARM_Y + 0.6, z + 2.4);
    const pin = ARM_Y + 0.06 + PIN;
    for (const w of WIRES) b.bar('concrete', [gx, ARM_Y + 0.3, z + w], [gx + 0.05, pin, z + w], 0.08);
    // the transformer: its tank, the fins down both sides, three bushings on top with leads up to the gantry
    const tx = gx - 13;
    b.block('metal', tx, z, 2.4, 3.2, 0.3, 2.6);
    b.block('concrete', tx, z, 3.0, 3.8, 0, 0.3); // its plinth
    for (const s of [-1, 1]) for (let k = 0; k < 6; k++) b.box('metal', tx - 1.0 + k * 0.4, 0.6, z + s * 1.6, tx - 0.9 + k * 0.4, 2.6, z + s * 2.2);
    for (const w of WIRES) {
        b.prism('concrete', tx + 0.8, z + w * 0.7, 2.9, 3.6, 0.09, 6);
        b.bar('metal', [tx + 0.8, 3.6, z + w * 0.7], [gx, ARM_Y + 0.3, z + w], WIRE_W);
    }
}
