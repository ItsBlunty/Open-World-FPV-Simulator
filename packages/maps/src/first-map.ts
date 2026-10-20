// The first map (SPEC.md 4.2): one open world with a park in the middle, a 5-storey bando to the
// west, city blocks to the north and an industrial yard to the south-west. Blockout geometry only;
// sizes are real-world ones so speeds and gaps feel right. North is -z, east +x, metres, y up.
//
// The layout is code, not a file: every number is here, and the seeded Rng makes the "random"
// choices (missing floor panels, building heights) the same on every machine. Changing anything
// here changes the collision hash, so bump MAP_VERSION with it.

import { FACE, LevelBuilder, Rng } from './builder';
import type { Building, Level, Material } from './builder';
import { goldenProps, streetFurniture } from './golden-props';
import type { Rect } from './golden-props';
import { nearTrack, railway, underHill } from './railway';
import { borderBelt, forest, treeLine } from './woods';
import type { WoodSpot } from './woods';
import { CITY_EDGE, YARD_ROAD, links } from './links';
import { industrial } from './yard';
import { timeTrials } from './trials';
import { vendors } from './vendors';
import { duga } from './duga';
import { HOSPITAL, PAVE, airport } from './airport';

export const MAP_ID = 'mixed-1';
/**
 * 7: the railway loop, its hill and tunnel, the station and goods yard, and four golden props there (owner, 2026-10-19);
 * 8: the railway round the whole map, over the city on a viaduct with a station there, the hill moved (owner, 2026-10-19);
 * 9: the city station's footbridge and stair down to a garden in the lot beside it, its platforms raised (owner, 2026-10-19);
 * 10: a forest in the south-east fields, trees with limbs to fly through, the tree lines and the border broken up, the
 * industrial yard filled out: opened and stacked containers, the grain plant, trailers, sheds (owner, 2026-10-19);
 * 11: the map joined up: the city's edge a kerb and sidewalk with no road stubs, a road out to the bando and the yard over
 * a level crossing, the fields station's forecourt and lane, the park's paths carried on, the power line's wires strung
 * on crossarms square to the line, from a substation to a riser pole (owner, 2026-10-19);
 * 12: time trials: a start arch, landing pad and checkered flag for each of three courses (owner, 2026-10-19);
 * 13: the time trial pads 4.6 m square, filling their arches (owner, 2026-10-19);
 * 14: no faces flickering in each other (owner, 2026-10-19): stacked containers kept out of their neighbours, the
 * warehouse trusses and workshop beams end inside the walls, the site's plank decks 1 cm up, the driveway's slabs 5 mm up;
 * 15: street vendors' carts on the sidewalks and in the park (owner, 2026-10-20);
 * 16: no cart in front of a building's inner face (one stood inside the building next to it), carts in the tree plazas
 * and on a paved strip in the station garden, its south lawns pulled back for it (owner, 2026-10-20);
 * 17: the Duga radar's two antenna curtains north of the city, past the border trees (owner, 2026-10-20);
 * 18: the Duga remade after photos: separate towers, end masts, reflector wires, dipoles on bent feed pipes (owner, 2026-10-20);
 * 19: the Duga's reflector wires taken out, its dipole rows staggered, its feed pipes shaped and coloured after photos (owner, 2026-10-20);
 * 20: the Duga's dipoles one per bay on each row, in front of each tower then mid-bay, 0.7 of a bay long (owner, 2026-10-20);
 * 21: the airport east of the railway (runway, taxiways, apron, three hangars, the tower, terminal, heliport), the grass
 * carried 600 m further east under its far end, the border trees cleared from its approach, and the hospital's rooftop
 * helipad on the building that was the Cobalt Hotel (owner, 2026-10-20)
 */
export const MAP_VERSION = 21;
const HALF = 500;
/** how far the ground reaches, so the horizon is not a cliff edge */
const GROUND = 2000;
/** (map v21) how far the grass reaches east, past the runway's far end at x 2060 */
const GROUND_EAST = 2600;

export function buildFirstMap(): Level {
    const b = new LevelBuilder();
    /** what stands on each city roof (AC units), so the billboards keep clear of it */
    const roofClutter: Rect[] = [];
    ground(b);
    park(b, new Rng(1));
    bando(b, new Rng(2));
    const plazas: Plaza[] = [], stalls: [number, number][] = [];
    city(b, new Rng(3), roofClutter, plazas, stalls);
    const yardSpots = industrial(b, new Rng(4), (x, z) => nearTrack(x, z, 4));
    const woodSpots = southEast(b, new Rng(5));
    border(b, new Rng(6));
    // no random choices: the rest of the map is drawn as before it (bar the hay bales and fence posts on its line)
    railway(b);
    // (map v11) no random choices but its own: the rest of the map is drawn as before
    links(b);
    cityEdge(b, new Rng(11));
    // after everything else, from their own Rng: the rest of the map is drawn exactly as before they existed
    const hideouts = streetFurniture(b, new Rng(8), roofClutter);
    // (map v10) numbered after every prop before them, so those keep their numbers
    goldenProps(b, hideouts, [{ area: 'Industrial yard', spots: yardSpots }, { area: 'Forest', spots: woodSpots }]);
    // (map v12) no random choices: the rest of the map is drawn as before
    b.trials.push(...timeTrials(b));
    // (map v15) last, from their own Rng: the rest of the map is drawn as before
    b.vendors.push(...vendors(b, new Rng(12), hideouts.shelters, plazas, stalls));
    // (map v17) no random choices: the rest of the map is drawn as before
    duga(b);
    // (map v21) no random choices: the rest of the map is drawn as before
    b.airport = airport(b, hospital(b), (g, m, x0, z0, x1, z1, n) => windowedBlock(g, m, x0, z0, x1, z1, PAVE, n, SHOP, RIBBON));
    b.spawn({ id: 'park', name: 'Park', x: 0, z: 40, yawDeg: 0 });
    b.spawn({ id: 'bando', name: 'Bando (front)', x: -250, z: 30, yawDeg: 0 });
    b.spawn({ id: 'bando-roof', name: 'Bando roof', x: -277, z: -9, yawDeg: 90 });
    b.spawn({ id: 'city', name: 'City street', x: 0, z: -130, yawDeg: 0 });
    b.spawn({ id: 'yard', name: 'Industrial yard', x: -330, z: 200, yawDeg: 180 });
    b.spawn({ id: 'station', name: 'Fields station', x: 292, z: 480, yawDeg: 270 });
    b.spawn({ id: 'city-station', name: 'City station (on the viaduct)', x: 10, z: -253.3, yawDeg: 90 });
    b.spawn({ id: 'tunnel', name: 'Railway tunnel', x: 30, z: 335, yawDeg: 0 });
    b.spawn({ id: 'forest', name: 'Forest track', x: 196, z: 318, yawDeg: 150 });
    b.spawn({ id: 'duga', name: 'Duga radar', x: 0, z: -585, yawDeg: 0 });
    b.spawn({ id: 'airport', name: 'Airport (apron)', x: 742, z: 178, yawDeg: 0 });
    b.spawn({ id: 'hospital', name: 'Hospital roof', x: 368, z: -205, yawDeg: 270 });
    return b.build(MAP_ID, MAP_VERSION, 'Park, bando and city', HALF);
}

// ---------------------------------------------------------------- ground

/**
 * Asphalt under the city's roads, the road out to the yard and the yard itself, grass everywhere else, as rectangles that
 * never overlap. The city's outer sidewalk (cityEdge) stands on the ground round the roads, so none is drawn under it.
 */
function ground(b: LevelBuilder): void {
    const G = GROUND, E = CITY_EDGE, R = YARD_ROAD;
    const ox0 = E.x0 - E.walk, ox1 = E.x1 + E.walk, oz0 = E.z0 - E.walk, oz1 = E.z1 + E.walk;
    const rx0 = R.x - R.hw, rx1 = R.x + R.hw;
    b.floor('asphalt', E.x0, E.z0, E.x1, E.z1);
    // the yard road: through the gap in the outer sidewalk, then south to the yard
    b.floor('asphalt', rx0, E.z1, rx1, R.z1);
    b.floor('asphalt', -460, 120, -200, 420);
    b.floor('grass', -G, -G, G, oz0);
    b.floor('grass', -G, oz0, ox0, oz1);
    b.floor('grass', ox1, oz0, G, oz1);
    b.floor('grass', -G, oz1, rx0, 120);
    b.floor('grass', rx1, oz1, G, 120);
    b.floor('grass', -G, 120, -460, 420);
    b.floor('grass', -200, 120, G, 420);
    b.floor('grass', -G, 420, G, G);
    b.floor('grass', G, -G, GROUND_EAST, G);
}

/** (map v21) The city building that becomes the hospital: renamed, and its roof's height for the helipad. */
function hospital(b: LevelBuilder): number {
    const h = b.buildings.find((u) => u.x0 < HOSPITAL.x && u.x1 > HOSPITAL.x && u.z0 < HOSPITAL.z && u.z1 > HOSPITAL.z);
    if (!h) throw new Error('no building where the hospital should be');
    h.name = HOSPITAL.name;
    return h.top;
}

// ---------------------------------------------------------------- park

function tree(b: LevelBuilder, r: Rng, x: number, z: number, scale = 1): void {
    const trunkH = (2.5 + r.int(0, 10) / 10) * scale;
    const top = trunkH + (5 + r.int(0, 40) / 10) * scale;
    const rad = (2 + r.int(0, 15) / 10) * scale;
    const round = r.chance(1, 3);
    // (map v8) a tree the railway runs through, or under its hill, is left out after its draws: the rest stays as it was
    if (nearTrack(x, z, rad * 1.1 + 3) || underHill(x, z, rad)) return;
    b.prism('trunk', x, z, 0, trunkH + 0.5, 0.25 * scale, 6);
    if (round) {
        // a round-ish tree: two stacked canopies
        b.cone('foliage', x, z, trunkH, top - 1, rad * 1.1, 8);
        b.cone('foliage', x, z, trunkH + 1.5, top + 1, rad * 0.8, 8);
    } else b.cone('foliage', x, z, trunkH, top, rad, 6);
}

function park(b: LevelBuilder, r: Rng): void {
    // spawn pad and paths (thin slabs, 5 cm)
    b.block('concrete', 0, 40, 5, 5, 0, 0.1);
    b.box('path', -3, 0, CITY_EDGE.z1 + CITY_EDGE.walk, 3, 0.05, 37.5); // north-south path from the city's sidewalk (map v11), stops at the pad
    b.box('path', -3, 0, 42.5, 3, 0.05, 200);
    b.box('path', -150, 0, 77, 150, 0.05, 83); // east-west path
    b.box('path', -100, 0, 150, 100, 0.05, 154); // southern loop
    b.box('path', -104, 0, 77, -100, 0.05, 154);
    b.box('path', 100, 0, 77, 104, 0.05, 154);
    // fountain on the crossing
    b.prism('concrete', 0, 80, 0, 0.6, 7, 8);
    b.prism('water', 0, 80, 0.6, 0.62, 6.4, 8);
    b.prism('concrete', 0, 80, 0.6, 3.5, 0.8, 8);
    // pond
    b.box('water', 50, 0, 100, 95, 0.05, 140);
    // gazebo: 4 posts and a roof
    for (let i = 0; i < 4; i++) {
        const x = -70 + (i % 2) * 8;
        const z = 110 + Math.floor(i / 2) * 8;
        b.prism('wood', x, z, 0, 3, 0.15, 4);
    }
    b.box('wood', -70.5, 3, 109.5, -61.5, 3.4, 118.5);
    b.cone('wood', -66, 114, 3.4, 6, 6.4, 4);
    // benches along the east-west path
    for (let x = -120; x <= 120; x += 30) {
        if (x === 0) continue;
        b.box('wood', x - 1, 0.45, 85, x + 1, 0.55, 85.5);
        b.box('metal', x - 0.9, 0, 85.1, x - 0.8, 0.45, 85.4);
        b.box('metal', x + 0.8, 0, 85.1, x + 0.9, 0.45, 85.4);
    }
    // a gate of two posts and a bar, and a low wall line to fly along: freestyle features
    b.box('concrete', 30, 0, 10, 31, 6, 11);
    b.box('concrete', 40, 0, 10, 41, 6, 11);
    b.box('concrete', 30, 6, 10, 41, 7, 11);
    for (let i = 0; i < 6; i++) b.box('concrete', -60 + i * 6, 0, 20, -57 + i * 6, 1 + i * 0.5, 21);
    // (the power line along z -40, poles and wires, is links.ts powerLine since map v11)
    // trees: scattered, kept off the paths, the pad, the fountain and the pond
    const clear = (x: number, z: number): boolean =>
        !(Math.abs(x) < 8) && !(z > 72 && z < 88) && !(z > 145 && z < 159 && Math.abs(x) < 108)
        && !(x > 44 && x < 101 && z > 94 && z < 146) && !(x > -78 && x < -54 && z > 102 && z < 126)
        && !(x > 25 && x < 46 && z > 5 && z < 16) && !(x > -64 && x < -20 && z > 16 && z < 25)
        && !(z > -46 && z < -34);
    let n = 0;
    for (let k = 0; k < 400 && n < 70; k++) {
        const x = r.int(-140, 140);
        const z = r.int(-55, 195);
        if (!clear(x, z)) continue;
        tree(b, r, x, z);
        n++;
    }
}

// ---------------------------------------------------------------- bando

/** Storey height, slab thickness, bay size of the bando. */
const H = 3.6;
const SLAB = 0.3;
const BAY = 6;
/**
 * The bando's beams: on every column line at every floor, 0.45 m deep and 0.3 m wide [estimates, typical
 * of a 6 m cast-in-place frame: depth about span / 13]. The floor panels span between them, and the
 * exterior walls are infill from the floor up to the beam above, so a wall never ends in the air where
 * a panel is missing (owner, 2026-10-18: walls "floating like the pillars were").
 */
const BEAM = 0.45;
const BEAM_W = 0.3;

function wallX(b: LevelBuilder, m: Material, x0: number, x1: number, z: number, y0: number, y1: number, kind: 'solid' | 'window' | 'door'): void {
    const t = 0.25;
    if (kind === 'solid') b.box(m, x0, y0, z - t / 2, x1, y1, z + t / 2);
    else if (kind === 'window') {
        b.box(m, x0, y0, z - t / 2, x1, y0 + 1, z + t / 2);
        b.box(m, x0, y0 + 2.8, z - t / 2, x1, y1, z + t / 2);
        b.box(m, x0, y0 + 1, z - t / 2, x0 + 1.5, y0 + 2.8, z + t / 2);
        b.box(m, x1 - 1.5, y0 + 1, z - t / 2, x1, y0 + 2.8, z + t / 2);
    } else {
        b.box(m, x0, y0 + 2.6, z - t / 2, x1, y1, z + t / 2);
        b.box(m, x0, y0, z - t / 2, x0 + 1.5, y0 + 2.6, z + t / 2);
        b.box(m, x1 - 1.5, y0, z - t / 2, x1, y0 + 2.6, z + t / 2);
    }
}

function wallZ(b: LevelBuilder, m: Material, z0: number, z1: number, x: number, y0: number, y1: number, kind: 'solid' | 'window' | 'door'): void {
    const t = 0.25;
    if (kind === 'solid') b.box(m, x - t / 2, y0, z0, x + t / 2, y1, z1);
    else if (kind === 'window') {
        b.box(m, x - t / 2, y0, z0, x + t / 2, y0 + 1, z1);
        b.box(m, x - t / 2, y0 + 2.8, z0, x + t / 2, y1, z1);
        b.box(m, x - t / 2, y0 + 1, z0, x + t / 2, y0 + 2.8, z0 + 1.5);
        b.box(m, x - t / 2, y0 + 1, z1 - 1.5, x + t / 2, y0 + 2.8, z1);
    } else {
        b.box(m, x - t / 2, y0 + 2.6, z0, x + t / 2, y1, z1);
        b.box(m, x - t / 2, y0, z0, x + t / 2, y0 + 2.6, z0 + 1.5);
        b.box(m, x - t / 2, y0, z1 - 1.5, x + t / 2, y0 + 2.6, z1);
    }
}

/**
 * A 60 x 24 m concrete frame of 5 storeys (3.6 m each, roof at 18 m): columns on a 6 m grid, beams
 * between them at every floor, floor panels per bay with some missing and a collapse through floors 3
 * and 4 (its beams gone too), an open shaft through every floor, exterior walls that are solid,
 * windowed or gone, and rubble under the collapse.
 */
function bando(b: LevelBuilder, r: Rng): void {
    const x0 = -280;
    const z0 = -12;
    const NX = 10;
    const NZ = 4;
    const storeys = 5;
    const shaft = (i: number, j: number): boolean => i === 8 && j === 1;
    const collapse = (k: number, i: number, j: number): boolean => (k === 3 || k === 4) && i >= 3 && i <= 4 && j >= 2;
    const keep = (k: number, i: number, j: number): boolean => k === storeys && i === 0 && j === 0; // the roof spawn
    // ground slab
    b.box('concrete-dark', x0 - 0.5, 0, z0 - 0.5, x0 + NX * BAY + 0.5, 0.1, z0 + NZ * BAY + 0.5);
    // columns: one piece from the ground slab to the roof, through every floor, as a cast frame is. Built
    // per storey they stopped under each slab and showed a gap wherever a panel was missing (owner,
    // 2026-10-17). A few interior ones are broken off at the top floor (the roof there sags onto the walls).
    for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
        const broken = i > 0 && i < NX && j > 0 && j < NZ && r.chance(1, 4);
        b.block('concrete', x0 + i * BAY, z0 + j * BAY, 0.5, 0.5, 0.1, (broken ? (storeys - 1) * H : storeys * H) - 0.1);
    }
    // beams on every column line at every floor, column face to column face; inside the collapse they fell
    // with the panels (a beam goes when every panel beside it has gone). The perimeter ones all stand.
    const inside = (i: number, j: number): boolean => i >= 0 && i < NX && j >= 0 && j < NZ;
    const fell = (k: number, sides: number[][]): boolean => sides.every(([i, j]) => inside(i, j) && collapse(k, i, j));
    const hb = BEAM_W / 2;
    for (let k = 1; k <= storeys; k++) {
        const y = k * H;
        for (let j = 0; j <= NZ; j++) for (let i = 0; i < NX; i++) {
            if (fell(k, [[i, j - 1], [i, j]])) continue;
            const z = z0 + j * BAY;
            b.box('concrete', x0 + i * BAY + 0.25, y - BEAM, z - hb, x0 + (i + 1) * BAY - 0.25, y, z + hb);
        }
        for (let i = 0; i <= NX; i++) for (let j = 0; j < NZ; j++) {
            if (fell(k, [[i - 1, j], [i, j]])) continue;
            const x = x0 + i * BAY;
            b.box('concrete', x - hb, y - BEAM, z0 + j * BAY + 0.25, x + hb, y, z0 + (j + 1) * BAY - 0.25);
        }
    }
    // floor panels, slab k's top at k * H
    for (let k = 1; k <= storeys; k++) {
        for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
            const missing = shaft(i, j) || collapse(k, i, j) || r.chance(k === storeys ? 28 : 16, 100);
            if (missing && !keep(k, i, j)) continue;
            b.box('concrete', x0 + i * BAY, k * H - SLAB, z0 + j * BAY, x0 + (i + 1) * BAY, k * H, z0 + (j + 1) * BAY);
        }
    }
    // exterior walls per bay and storey; the ground floor has more doorways
    const pickWall = (k: number): 'solid' | 'window' | 'door' | null => {
        const u = r.int(0, 99);
        if (k === 0) return u < 30 ? 'door' : u < 55 ? null : u < 80 ? 'window' : 'solid';
        return u < 45 ? 'window' : u < 70 ? null : 'solid';
    };
    for (let k = 0; k < storeys; k++) {
        // from the floor (or the ground slab) up to the underside of the beam above
        const y0 = k === 0 ? 0.1 : k * H;
        const y1 = (k + 1) * H - BEAM;
        const m: Material = k < 2 ? 'brick' : 'concrete';
        for (let i = 0; i < NX; i++) {
            const xa = x0 + i * BAY + 0.25;
            const xb = x0 + (i + 1) * BAY - 0.25;
            const s = pickWall(k);
            if (s) wallX(b, m, xa, xb, z0, y0, y1, s);
            const n = pickWall(k);
            if (n) wallX(b, m, xa, xb, z0 + NZ * BAY, y0, y1, n);
        }
        for (let j = 0; j < NZ; j++) {
            const za = z0 + j * BAY + 0.25;
            const zb = z0 + (j + 1) * BAY - 0.25;
            const w = pickWall(k);
            if (w) wallZ(b, m, za, zb, x0, y0, y1, w);
            const e = pickWall(k);
            if (e) wallZ(b, m, za, zb, x0 + NX * BAY, y0, y1, e);
        }
        // the shaft's side walls, with a door on the ground floor
        const sx0 = x0 + 8 * BAY;
        wallZ(b, 'concrete-dark', z0 + BAY + 0.25, z0 + 2 * BAY - 0.25, sx0, y0, y1, k === 0 ? 'door' : 'solid');
        wallZ(b, 'concrete-dark', z0 + BAY + 0.25, z0 + 2 * BAY - 0.25, sx0 + BAY, y0, y1, 'solid');
        // interior partitions on the lower floors
        if (k < 3) {
            for (let i = 1; i < NX - 1; i++) {
                if (!r.chance(1, 3) || i === 8 || i === 9) continue;
                wallZ(b, 'plaster', z0 + 2 * BAY + 0.25, z0 + 3 * BAY - 0.25, x0 + i * BAY, y0, y1, 'door');
            }
        }
    }
    // roof parapet with gaps (standing on the edge beams), a water tank on legs
    const top = storeys * H;
    for (let i = 0; i < NX; i++) {
        if (!r.chance(1, 4)) b.box('concrete', x0 + i * BAY, top, z0 - 0.15, x0 + (i + 1) * BAY, top + 1, z0 + 0.15);
        if (!r.chance(1, 4)) b.box('concrete', x0 + i * BAY, top, z0 + NZ * BAY - 0.15, x0 + (i + 1) * BAY, top + 1, z0 + NZ * BAY + 0.15);
    }
    // the tank's legs stand on two steel beams (dunnage) laid across the roof beams of column lines 7 and 8,
    // as rooftop tanks are set: it does not lean on the roof panels, which may be missing
    const DUN = 0.4;
    for (const dz of [16.5, 19.5]) b.box('rust', x0 + 7 * BAY - hb, top, z0 + dz - 0.15, x0 + 8 * BAY + hb, top + DUN, z0 + dz + 0.15);
    for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) b.block('rust', x0 + 43.5 + dx, z0 + 16.5 + dz, 0.3, 0.3, top + DUN, 4 - DUN);
    b.block('rust', x0 + 45, z0 + 18, 4.5, 4.5, top + 4, 3);
    // rubble under the collapse and scattered on the ground floor
    for (let n = 0; n < 40; n++) {
        const x = x0 + 18 + r.int(0, 120) / 10;
        const z = z0 + 12 + r.int(0, 110) / 10;
        const s = 0.4 + r.int(0, 12) / 10;
        b.block('rubble', x, z, s, s * (0.6 + r.int(0, 8) / 10), 0.1, 0.3 + r.int(0, 10) / 10);
    }
    // a loading dock on the south side: a 2-storey annex with an open front
    const ax = x0 + 6;
    const az = z0 + NZ * BAY;
    b.box('concrete', ax, 0, az, ax + 18, 1.2, az + 10); // dock platform
    b.box('concrete', ax, 7, az, ax + 18, 7.3, az + 10); // annex roof
    for (const dx of [0, 6, 12, 18]) b.block('concrete', ax + dx, az + 10, 0.4, 0.4, 1.2, 5.8);
    b.box('concrete', ax - 0.25, 1.2, az, ax, 7, az + 10);
}

// ---------------------------------------------------------------- city

const MATS_BUILDING: Material[] = ['facade-concrete', 'facade-brick', 'facade-plaster', 'facade-glass', 'facade-dark'];

/** City storey height, m. */
const STOREY = 3.5;
/**
 * How far the glass sits back from a building's face, m: the window reveal. 15 cm is a common depth for
 * windows in a masonry or precast wall [estimate]; it is real geometry, so the quad feels it too.
 */
const REVEAL = 0.15;

/** A row of windows up a storey: sill and head above the storey's floor, m, and the bay along the wall. */
interface WindowRow {
    sill: number;
    head: number;
    /** windows every `bay` m along the wall, each `width` wide; 0: one ribbon along the whole wall */
    bay: number;
    width: number;
    glass: Material;
}
/** Office windows: 1.4 m wide every 3 m, 0.9 m sill, 2.6 m head. */
const PUNCHED: WindowRow = { sill: 0.9, head: 2.6, bay: 3, width: 1.4, glass: 'window' };
/** Shop fronts on the ground floor: 2.5 m of glass every 3 m, from 0.3 to 3 m. */
const SHOP: WindowRow = { sill: 0.3, head: 3.0, bay: 3, width: 2.5, glass: 'window' };
/** A glass tower's ribbon windows: glass all along each storey from 0.8 to 3.2 m (mullions painted on). */
const RIBBON: WindowRow = { sill: 0.8, head: 3.2, bay: 0, width: 0, glass: 'window-ribbon' };

/** The street entrance of a building: which wall (0 -z, 1 +z, 2 -x, 3 +x: windowedBlock's order) and which ground-floor bay. */
interface DoorBay {
    wall: number;
    bay: number;
}

/** Where window `bay` of a row starts along a wall that starts at len0 and is len long (whole bays, centred). */
function doorStart(len0: number, len: number, row: WindowRow, bay: number): number {
    const n = Math.floor(len / row.bay);
    return len0 + (len - n * row.bay) / 2 + bay * row.bay + (row.bay - row.width) / 2;
}

/**
 * A building block with its windows set back REVEAL into the walls: a glass core REVEAL in from the
 * footprint, wrapped in the wall's outer skin of solid bands between the window rows and piers between
 * the windows. `storeys` rows from y0 up, each STOREY tall; `ground` is the street floor's row (shop
 * fronts), `upper` the rest. Faces against other solid geometry are left out (LevelBuilder.box skip).
 */
function windowedBlock(b: LevelBuilder, m: Material, x0: number, z0: number, x1: number, z1: number, y0: number, storeys: number,
    ground: WindowRow, upper: WindowRow, door?: DoorBay): void {
    const R = REVEAL;
    const y1 = y0 + storeys * STOREY;
    const rows: WindowRow[] = [];
    for (let s = 0; s < storeys; s++) rows.push(s === 0 ? ground : upper);
    // the roof, over the whole footprint
    b.floor(m, x0, z0, x1, z1, y1);
    // the glass core's walls, a quad per storey row (its glass may differ from row to row)
    const cx0 = x0 + R, cz0 = z0 + R, cx1 = x1 - R, cz1 = z1 - R;
    rows.forEach((row, s) => {
        const ya = y0 + s * STOREY, yb = ya + STOREY;
        b.quad(row.glass, [cx0, ya, cz0], [cx0, yb, cz0], [cx1, yb, cz0], [cx1, ya, cz0]); // -z
        b.quad(row.glass, [cx0, ya, cz1], [cx1, ya, cz1], [cx1, yb, cz1], [cx0, yb, cz1]); // +z
        b.quad(row.glass, [cx0, ya, cz0], [cx0, ya, cz1], [cx0, yb, cz1], [cx0, yb, cz0]); // -x
        b.quad(row.glass, [cx1, ya, cz0], [cx1, yb, cz0], [cx1, yb, cz1], [cx1, ya, cz1]); // +x
    });
    // the skin, one wall at a time. A wall along x covers the corners; a wall along z runs between them.
    // span(a, c, ya, yb, skip): the skin box from a to c along the wall, ya to yb up.
    const walls: { len0: number; len1: number; span: (a: number, c: number, ya: number, yb: number, skip: number) => void }[] = [
        { len0: x0, len1: x1, span: (a, c, ya, yb, k) => b.box(m, a, ya, z0, c, yb, cz0, k | FACE.pz) },
        { len0: x0, len1: x1, span: (a, c, ya, yb, k) => b.box(m, a, ya, cz1, c, yb, z1, k | FACE.nz) },
        { len0: z0, len1: z1, span: (a, c, ya, yb, k) => b.box(m, x0, ya, Math.max(a, cz0), cx0, yb, Math.min(c, cz1), k | FACE.px | (a <= cz0 ? FACE.nz : 0) | (c >= cz1 ? FACE.pz : 0)) },
        { len0: z0, len1: z1, span: (a, c, ya, yb, k) => b.box(m, cx1, ya, Math.max(a, cz0), x1, yb, Math.min(c, cz1), k | FACE.nx | (a <= cz0 ? FACE.nz : 0) | (c >= cz1 ? FACE.pz : 0)) }
    ];
    for (const w of walls) {
        const len = w.len1 - w.len0;
        // solid bands: under the first sill, between each head and the next sill, over the last head
        let y = y0;
        const wi = walls.indexOf(w);
        rows.forEach((row, s) => {
            const sill = y0 + s * STOREY + row.sill;
            if (s === 0 && door && door.wall === wi) {
                // the entrance bay: no sill, its glass (and the door in it) runs down to the sidewalk
                const da = doorStart(w.len0, len, row, door.bay);
                w.span(w.len0, da, y, sill, FACE.bottom);
                w.span(da + row.width, w.len1, y, sill, FACE.bottom);
            } else w.span(w.len0, w.len1, y, sill, y === y0 ? FACE.bottom : 0);
            y = y0 + s * STOREY + row.head;
            if (!row.bay) return; // a ribbon: glass the whole way along
            // piers between the windows: whole bays, centred on the wall, the spare length in the end piers
            const n = Math.floor(len / row.bay);
            const margin = (len - n * row.bay) / 2;
            const gap = (row.bay - row.width) / 2;
            let a = w.len0;
            for (let k = 0; k < n; k++) {
                const wa = w.len0 + margin + k * row.bay + gap;
                w.span(a, wa, sill, y, FACE.bottom | FACE.top);
                a = wa + row.width;
            }
            w.span(a, w.len1, sill, y, FACE.bottom | FACE.top);
        });
        w.span(w.len0, w.len1, y, y1, FACE.top);
    }
}

/** The city block a building stands in: its sidewalk's bounds and its index in Level.blocks. */
interface BlockRef {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    index: number;
}

function building(b: LevelBuilder, r: Rng, names: Rng, used: Set<string>, clutter: Rect[], blk: BlockRef, x0: number, z0: number, x1: number, z1: number, maxFloors: number): void {
    const floors = r.int(2, maxFloors);
    const h = floors * STOREY;
    const m = h > 40 && r.chance(1, 2) ? 'facade-glass' : r.pick(MATS_BUILDING);
    const upper = m === 'facade-glass' ? RIBBON : PUNCHED;
    // Its name and entrance come from their own Rng, so the city's shapes are drawn as before names existed.
    // The entrance is in the middle bay of a face that looks onto a street (within a set-back of the block's edge).
    const faces = [z0 - blk.z0 < 6, blk.z1 - z1 < 6, x0 - blk.x0 < 6, blk.x1 - x1 < 6];
    const mask = [FACE.nz, FACE.pz, FACE.nx, FACE.px];
    const street = faces.reduce((a, f, k) => a | (f ? mask[k] : 0), 0);
    const open = faces.map((f, k) => (f ? k : -1)).filter((k) => k >= 0);
    const wall = open.length ? names.pick(open) : 0;
    const len = wall < 2 ? x1 - x0 : z1 - z0;
    const bay = Math.floor(Math.floor(len / SHOP.bay) / 2);
    const door: DoorBay = { wall, bay };
    let t = [x0, z0, x1, z1];
    if (h > 30 && r.chance(1, 2)) {
        // podium and a set-back tower
        windowedBlock(b, m === 'facade-glass' ? 'facade-concrete' : m, x0, z0, x1, z1, 0.15, 3, SHOP, PUNCHED, door);
        const ix = Math.min(6, (x1 - x0) / 4);
        const iz = Math.min(6, (z1 - z0) / 4);
        windowedBlock(b, m, x0 + ix, z0 + iz, x1 - ix, z1 - iz, 0.15 + 3 * STOREY, floors - 3, upper, upper);
        t = [x0 + ix, z0 + iz, x1 - ix, z1 - iz];
    } else windowedBlock(b, m, x0, z0, x1, z1, 0.15, floors, SHOP, upper, door);
    // rooftop clutter: AC units, a stair head
    const top = 0.15 + h;
    const n = r.int(0, 3);
    for (let k = 0; k < n; k++) {
        const cx = x0 + 3 + r.int(0, Math.max(0, Math.floor(x1 - x0 - 6)));
        const cz = z0 + 3 + r.int(0, Math.max(0, Math.floor(z1 - z0 - 6)));
        if (h > 30) continue; // a set-back tower's roof is smaller; keep it clear
        b.block('metal', cx, cz, 2, 1.5, top, 1.2);
        clutter.push({ x0: cx - 1, z0: cz - 0.75, x1: cx + 1, z1: cz + 0.75 });
    }
    // the entrance: the middle of its opening on the outer face, and the face's outward normal
    const along = doorStart(wall < 2 ? x0 : z0, len, SHOP, bay) + SHOP.width / 2;
    const NX = [0, 0, -1, 1], NZ = [-1, 1, 0, 0];
    const dx = wall === 2 ? x0 : wall === 3 ? x1 : along;
    const dz = wall === 0 ? z0 : wall === 1 ? z1 : along;
    b.doors.push({
        x: dx, z: dz, y: 0.15, nx: NX[wall], nz: NZ[wall], width: SHOP.width, height: SHOP.head, depth: REVEAL,
        block: blk.index, building: b.buildings.length
    });
    const bld: Building = {
        name: buildingName(names, used, floors), look: names.u32(), x0, z0, x1, z1, y0: 0.15, top,
        tx0: t[0], tz0: t[1], tx1: t[2], tz1: t[3], storeys: floors, street, door: b.doors.length - 1
    };
    b.buildings.push(bld);
}

// Building names: made up (any likeness to a real business is chance), by what a building of that height
// usually is: shops and cafes in low ones, offices, flats and hotels in the middle, towers in the centre.
const NAME_WORDS = [
    'Maple', 'Cedar', 'Granite', 'Summit', 'Northgate', 'Riverside', 'Elm', 'Beacon', 'Meridian', 'Kestrel', 'Orchard',
    'Ironwood', 'Ashford', 'Linden', 'Copper', 'Juniper', 'Halcyon', 'Larkspur', 'Westbrook', 'Harbour', 'Bramble',
    'Foxglove', 'Hawthorn', 'Millstone', 'Oakridge', 'Pinecrest', 'Quarry', 'Rosewood', 'Saltmarsh', 'Thistle',
    'Wren', 'Alder', 'Bellweather', 'Cobalt', 'Driftwood', 'Emberly', 'Fairhaven', 'Glenmore', 'Highfield', 'Kingsley'
];
const SHOPS = [
    'Bakery', 'Books', 'Coffee', 'Deli', 'Florist', 'Hardware', 'Pharmacy', 'Barbers', 'Diner', 'Records', 'Toys',
    'Bikes', 'Pizza', 'Noodle Bar', 'Tailors', 'Laundry', 'Grocer', 'Bistro', 'Opticians', 'Pet Supplies', 'Gym',
    'Ice Cream', 'Tea Room', 'Hobby Shop', 'Electronics', 'Bagels'
];
const SURNAMES = ['Rosa', 'Patel', 'Novak', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Kowalski', 'Haddad', 'Murphy', 'Silva', 'Becker', 'Nguyen', 'Ivanova', 'Byrne', 'Costa'];
/** a few nods to FPV pilots among the shops */
const FPV_SHOPS = ['Prop Wash Laundry', 'Turtle Mode Tacos', 'Blackbox Coffee', 'Failsafe Insurance', 'Freestyle Bikes', 'Yaw Spin Yoga', 'Power Loop Cycles', 'Dive Bar'];
const MID = ['Apartments', 'House', 'Hotel', 'Offices', 'Medical Centre', 'Court', 'Lofts', 'Chambers', 'Library', 'Studios'];
const TALL = ['Tower', 'Plaza', 'Centre', 'Bank', 'Trust', 'Insurance', 'Exchange', 'Heights', 'House', 'Group'];

function buildingName(r: Rng, used: Set<string>, floors: number): string {
    let name = '';
    for (let k = 0; k < 20; k++) {
        if (floors <= 4) {
            const u = r.int(0, 99);
            name = u < 8 ? r.pick(FPV_SHOPS) : u < 50 ? `${r.pick(SURNAMES)}'s ${r.pick(SHOPS)}` : `${r.pick(NAME_WORDS)} ${r.pick(SHOPS)}`;
        } else if (floors <= 10) name = `${r.pick(NAME_WORDS)} ${r.pick(MID)}`;
        else name = `${r.pick(NAME_WORDS)} ${r.pick(TALL)}`;
        if (!used.has(name)) break;
    }
    used.add(name);
    return name;
}

/**
 * The garden in the lot by the city station (map v9; owner, 2026-10-19: "add some nice trees and a path to the normal
 * sidewalks"): four lawns raised 15 cm behind a kerb, with trees, and paved paths between them: one across the block
 * from the west sidewalk to the east one, one from the station's stair (railway.ts, its foot at x 36.2) south to the
 * south sidewalk, and benches along the cross path. The lawns keep 1.3 m clear of the kerbs, where people walk.
 * (map v16; owner, 2026-10-20: food carts "to the lot where we load and unload from the train") the south lawns start
 * STALLS m south of the cross path, leaving a paved strip where three food carts face the path (vendors.ts). Returns
 * where the carts go: their middles, facing north.
 */
const STALLS = 5;

function stationGarden(b: LevelBuilder, r: Rng, x0: number, z0: number, x1: number, z1: number): [number, number][] {
    const px = 36.2, pz = -205, hw = 1.5;
    const xs = [[x0 + 2.6, px - hw - 0.5], [px + hw + 0.5, x1 - 2.6]];
    const zs = [[z0 + 2.6, pz - hw - 0.2], [pz + STALLS, z1 - 2.6]];
    for (const [xa, xb] of xs) for (const [za, zb] of zs) {
        b.box('concrete', xa - 0.15, 0.15, za - 0.15, xb + 0.15, 0.3, zb + 0.15, FACE.bottom); // the kerb round the lawn
        b.box('grass', xa, 0.3, za, xb, 0.32, zb, FACE.bottom);
        // three trees on each lawn, kept off its edges
        for (let k = 0; k < 3; k++) {
            const tx = xa + 3 + r.int(0, Math.floor(xb - xa - 6));
            const tz = za + 3 + r.int(0, Math.floor(zb - za - 6));
            tree(b, r, tx, tz, 0.9);
        }
    }
    // the paths, painted on the paving
    b.decal('path', x0, pz - hw, x1, pz + hw, 0.15);
    b.decal('path', px - hw, pz + hw, px + hw, z1, 0.15);
    b.decal('path', px - hw, -217.4, px + hw, pz - hw, 0.15);
    // benches along the cross path, facing it
    for (const bx of [16, 26, 46, 56]) for (const side of [-1, 1]) {
        const bz = pz + side * (hw + 0.35);
        b.box('wood', bx - 1, 0.6, bz - 0.25, bx + 1, 0.7, bz + 0.25);
        for (const dx of [-0.9, 0.9]) b.box('metal', bx + dx - 0.05, 0.15, bz - 0.2, bx + dx + 0.05, 0.6, bz + 0.2);
    }
    // the food carts on the paved strip, between the benches and clear of the path to the south sidewalk, their fronts
    // 1.05 m off the cross path's edge, their vendors 0.65 m clear of the lawns' kerb
    const cz = pz + hw + 1.05 + 0.45;
    return [[21, cz], [31, cz], [41.5, cz]];
}

/** A plaza block (planters with trees), for the food carts: its index in Level.blocks and its planters' middles. */
export interface Plaza {
    block: number;
    planters: [number, number][];
}

/** A steel frame under construction: columns and beams, no walls, a crane. */
function construction(b: LevelBuilder, x0: number, z0: number): void {
    const levels = 6;
    for (let k = 0; k <= levels; k++) {
        const y = 0.15 + k * 4;
        for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) {
            if (k < levels) b.block('rust', x0 + 6 + i * 10, z0 + 6 + j * 10, 0.4, 0.4, y, 4);
        }
        if (k === 0) continue;
        for (let i = 0; i <= 5; i++) b.box('rust', x0 + 6 + i * 10 - 0.2, y - 0.5, z0 + 6, x0 + 6 + i * 10 + 0.2, y, z0 + 56);
        for (let j = 0; j <= 5; j++) b.box('rust', x0 + 6, y - 0.5, z0 + 6 + j * 10 - 0.2, x0 + 56, y, z0 + 6 + j * 10 + 0.2);
        // a few decks of planks, on the beams (map v14: 1 cm up, so the columns' feet do not flicker in their underside)
        if (k % 2 === 0) b.box('wood', x0 + 6, y + 0.01, z0 + 6, x0 + 26, y + 0.11, z0 + 26);
    }
    towerCrane(b, x0 + 31, z0 + 31);
}

/**
 * A flat-top tower crane, after the Liebherr 172 EC-B 8 Litronic (Liebherr's FEM technical data sheet,
 * "172 EC-B 8 Litronic", read 2026-10-18): a 16 EC tower of 1.6 x 1.6 m sections 3.9 m long, a 50 m jib (one of
 * its listed jib lengths), a 13.4 m counter-jib, and for that jib 7 ballast blocks of 3150 x 1180 x 280 mm
 * (2.5 t each). Member sizes, the jib's cross-section and the cab are estimates; the hoist rope is drawn 5 cm
 * thick (a real one is about 16 mm [estimate]) so it shows on screen and in the collision.
 * Every member is a real bar with gaps between, so the quad can fly through the lattice.
 */
function towerCrane(b: LevelBuilder, cx: number, cz: number): void {
    const SEC = 3.9; // tower section length, m
    const N = 12; // sections: the slewing unit sits at 0.65 + 46.8 m
    const HW = 0.8; // half the tower's width
    const CH = 0.14; // chord (corner post) size [estimate]
    const BR = 0.07; // bracing size [estimate]
    const base = 0.65;
    // the foundation block the tower is anchored in (4.5 m square, as the data sheet's foundation anchors)
    b.block('concrete', cx, cz, 4.5, 4.5, 0.15, base - 0.15);
    const top = base + N * SEC;
    const corners = [[-HW, -HW], [HW, -HW], [HW, HW], [-HW, HW]];
    for (const [dx, dz] of corners) b.block('crane', cx + dx, cz + dz, CH, CH, base, N * SEC);
    // each face: a strut at every section joint and one diagonal per section, zigzagging up the tower
    for (let s = 0; s <= N; s++) {
        const y = base + s * SEC;
        for (let f = 0; f < 4; f++) {
            const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
            if (s > 0 && s < N) b.bar('crane', [cx + ax, y, cz + az], [cx + bx, y, cz + bz], BR);
            if (s === N) continue;
            const up = (s + f) % 2 === 0;
            b.bar('crane', [cx + ax, up ? y : y + SEC, cz + az], [cx + bx, up ? y + SEC : y, cz + bz], BR);
        }
    }
    // the slewing unit, with the operator's cab on the jib's right: a painted box with a big front window looking
    // along the jib, side windows and a floor window, as tower crane cabs have
    b.block('crane', cx, cz, 2.4, 2.4, top, 1.0);
    const sy = top + 1.0;
    b.box('crane', cx + 0.3, top + 0.2, cz + 1.2, cx + 2.1, top + 2.6, cz + 2.9);
    b.box('glass', cx + 2.1, top + 0.5, cz + 1.3, cx + 2.16, top + 2.45, cz + 2.8, FACE.nx);
    b.box('glass', cx + 0.9, top + 1.2, cz + 2.9, cx + 1.95, top + 2.4, cz + 2.95, FACE.nz);
    b.box('crane', cx + 0.25, top + 2.6, cz + 1.15, cx + 2.3, top + 2.75, cz + 2.95);
    // the jib along +x: a triangular lattice 1.6 m wide and 1.8 m deep [estimates], panels of 2.5 m. The trolley
    // runs on the two bottom chords.
    const L = 50, P = 2.5, JW = 0.8, JD = 1.8;
    const j0 = cx + 1.2;
    const lo = (x: number, side: number): number[] => [x, sy, cz + side * JW];
    const hi = (x: number): number[] => [x, sy + JD, cz];
    b.bar('crane', lo(j0, -1), lo(cx + L, -1), CH);
    b.bar('crane', lo(j0, 1), lo(cx + L, 1), CH);
    b.bar('crane', hi(j0), hi(cx + L - 1), CH);
    // a Warren truss in each sloping face (bottom chord node, top chord node half a panel on, next bottom node),
    // a strut and a diagonal across the bottom face every panel
    const tip = cx + L;
    for (let x = j0; x < tip - 0.01; x += P) {
        const xn = Math.min(x + P, tip), xh = Math.min(x + P / 2, tip - 1);
        b.bar('crane', lo(x, -1), lo(x, 1), BR);
        b.bar('crane', lo(x, -1), lo(xn, 1), BR);
        for (const side of [-1, 1]) {
            b.bar('crane', lo(x, side), hi(xh), BR);
            b.bar('crane', hi(xh), lo(xn, side), BR);
        }
    }
    b.bar('crane', lo(tip, -1), lo(tip, 1), BR);
    b.bar('crane', lo(tip, -1), hi(tip - 1), BR);
    b.bar('crane', lo(tip, 1), hi(tip - 1), BR);
    // the counter-jib along -x: two box beams 2 m apart with a walkway between, the hoist winch, and the
    // ballast hanging at its end
    const C = 13.4;
    const c1 = cx - 1.2, c0 = cx - C;
    for (const side of [-1, 1]) b.box('crane', c0, sy, cz + side * 1.0 - 0.12, c1, sy + 0.45, cz + side * 1.0 + 0.12);
    for (let x = c0; x <= c1; x += 2.4) b.box('crane', x, sy, cz - 0.88, x + 0.12, sy + 0.2, cz + 0.88);
    b.box('metal', c0 + 1, sy + 0.2, cz - 0.4, c1 - 0.5, sy + 0.24, cz + 0.4); // walkway grating
    for (const side of [-1, 1]) b.box('crane', c0 + 1, sy + 1.1, cz + side * 1.0 - 0.03, c1, sy + 1.16, cz + side * 1.0 + 0.03); // hand rails
    for (let x = c0 + 1; x <= c1; x += 3) for (const side of [-1, 1]) b.box('crane', x, sy + 0.45, cz + side * 1.0 - 0.03, x + 0.06, sy + 1.1, cz + side * 1.0 + 0.03);
    b.box('metal', cx - 6.5, sy + 0.24, cz - 0.7, cx - 4.5, sy + 1.4, cz + 0.7); // hoist winch
    b.box('metal', cx - 3.8, sy + 0.24, cz - 0.7, cx - 2.6, sy + 2.0, cz - 0.1); // switch cabinet
    for (let k = 0; k < 7; k++) {
        const x = c0 + 0.1 + k * 0.29;
        b.box('concrete', x, sy + 0.45 - 3.15, cz - 0.59, x + 0.28, sy + 0.45, cz + 0.59);
    }
    // the trolley 20 m out on the jib, its hook block hanging on two falls of rope above the steel frame
    const tx = cx + 20, hook = 30;
    b.box('crane', tx - 0.9, sy - 0.5, cz - 0.95, tx + 0.9, sy, cz + 0.95);
    for (const dx of [-0.3, 0.3]) b.bar('metal', [tx + dx, sy - 0.5, cz], [tx + dx, hook + 1.1, cz], 0.05);
    b.box('crane', tx - 0.5, hook + 0.3, cz - 0.2, tx + 0.5, hook + 1.1, cz + 0.2);
    b.box('metal', tx - 0.06, hook - 0.3, cz - 0.06, tx + 0.06, hook + 0.3, cz + 0.06);
    b.box('metal', tx - 0.06, hook - 0.42, cz - 0.06, tx + 0.3, hook - 0.3, cz + 0.06);
    b.box('metal', tx + 0.24, hook - 0.42, cz - 0.06, tx + 0.3, hook - 0.15, cz + 0.06);
}

/**
 * An open multi-storey car park: slabs on columns, parapets all round, and a ramp up from each level to
 * the next. The ramps switch back: up northwards to level 1 in lane A, southwards to level 2 in lane B
 * beside it, and so on, each through an opening in the slab above it. 3.2 m up over 20 m is a 16 %
 * grade, near the 1:6 most design guides give as the steepest for a car-park ramp [estimate].
 */
function carPark(b: LevelBuilder, x0: number, z0: number): void {
    const lanes = [[49.5, 53], [53.5, 57]]; // between the column lines at 48.8 and 57.7
    const rz0 = 20, rz1 = 40;
    for (let k = 1; k <= 4; k++) {
        const y = 0.15 + k * 3.2;
        // the slab, open over the lane the ramp from the level below comes up
        const [la, lb] = lanes[(k - 1) % 2];
        b.box('concrete', x0 + 4, y - 0.3, z0 + 4, x0 + la, y, z0 + 58);
        b.box('concrete', x0 + lb, y - 0.3, z0 + 4, x0 + 58, y, z0 + 58);
        b.box('concrete', x0 + la, y - 0.3, z0 + 4, x0 + lb, y, z0 + rz0);
        b.box('concrete', x0 + la, y - 0.3, z0 + rz1, x0 + lb, y, z0 + 58);
        b.box('concrete', x0 + 4, y, z0 + 4, x0 + 58, y + 1, z0 + 4.3);
        b.box('concrete', x0 + 4, y, z0 + 57.7, x0 + 58, y + 1, z0 + 58);
        b.box('concrete', x0 + 4, y, z0 + 4.3, x0 + 4.3, y + 1, z0 + 57.7);
        b.box('concrete', x0 + 57.7, y, z0 + 4.3, x0 + 58, y + 1, z0 + 57.7);
        // the ramp up to this level from the one below: lane A rises southwards (+z), lane B northwards
        const up = (k - 1) % 2 === 0;
        b.rampZ('concrete', x0 + la, x0 + lb, z0 + (up ? rz0 : rz1), z0 + (up ? rz1 : rz0), y - 3.2, y, 0.3);
    }
    for (let k = 0; k < 4; k++) {
        const y0 = 0.15 + k * 3.2;
        for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) b.block('concrete', x0 + 4.3 + i * 8.9, z0 + 4.3 + j * 8.9, 0.5, 0.5, y0, 3.2 - 0.3);
    }
}

/** City grid: a block every PITCH m, roads ROAD m wide between them (kerb to kerb). */
const PITCH = 80;
const ROAD = 18;

/**
 * Road paint, drawn but not collided with (LevelBuilder.decal): a dashed centre line on every road
 * (3 m dashes, 6 m gaps, 15 cm wide, stopping short of the crossings), zebra crossings on each side
 * of every junction, and a stop line across each lane coming into a junction from another one. Road centres: x = -480 + 80a (a = 0..12) running north-south from the
 * park edge (z = -70) to the north edge, and z = -90 - 80c (c = 0..5) running east-west.
 */
function roadMarkings(b: LevelBuilder): void {
    const xs: number[] = [];
    for (let a = 0; a <= 12; a++) xs.push(-HALF + 20 + a * PITCH);
    const zs: number[] = [];
    for (let c = 0; c <= 5; c++) zs.push(-90 - c * PITCH);
    const nearAny = (v: number, list: number[], d: number): boolean => list.some((u) => Math.abs(u - v) < d);
    const W = 0.075; // half the line width
    const clear = ROAD / 2 + 4; // no centre line inside a junction or over its crossings
    // north-south roads
    // (map v11) only between the ring road's outer kerbs: the roads no longer run on past it
    const E = CITY_EDGE;
    for (const x of xs) for (let z = -HALF; z + 3 <= E.z1; z += 9) {
        if (nearAny(z, zs, clear) || nearAny(z + 3, zs, clear)) continue;
        b.decal('marking', x - W, z, x + W, z + 3);
    }
    // east-west roads
    for (const z of zs) for (let x = -HALF; x + 3 <= HALF; x += 9) {
        if (x < E.x0 || x + 3 > E.x1) continue;
        if (nearAny(x, xs, clear) || nearAny(x + 3, xs, clear)) continue;
        b.decal('marking', x, z - W, x + 3, z + W);
    }
    // stop lines: 0.4 m wide, 12.5-12.9 m before the junction's centre, across the right half of the road
    xs.forEach((x, ix) => zs.forEach((z, iz) => {
        if (ix > 0) b.decal('marking', x - 12.9, z + 0.2, x - 12.5, z + ROAD / 2 - 0.2); // heading east
        if (ix < xs.length - 1) b.decal('marking', x + 12.5, z - ROAD / 2 + 0.2, x + 12.9, z - 0.2); // heading west
        if (iz > 0) b.decal('marking', x + 0.2, z + 12.5, x + ROAD / 2 - 0.2, z + 12.9); // heading north (zs runs north)
        if (iz < zs.length - 1) b.decal('marking', x - ROAD / 2 + 0.2, z - 12.9, x - 0.2, z - 12.5); // heading south
    }));
    // zebra crossings: 0.5 m stripes, 0.5 m apart, 3 m long, just outside each junction
    const half = ROAD / 2 - 0.5;
    for (const x of xs) for (const z of zs) {
        for (let s = -half; s + 0.5 <= half; s += 1) {
            for (const side of [-1, 1]) {
                const zc = z + side * (ROAD / 2 + 1.5); // across the north-south road
                // (none across a road that does not go on past the ring road)
                if (zc - 1.5 >= E.z0 && zc + 1.5 <= E.z1) b.decal('marking', x + s, zc - 1.5, x + s + 0.5, zc + 1.5);
                const xc = x + side * (ROAD / 2 + 1.5); // across the east-west road
                if (xc - 1.5 >= E.x0 && xc + 1.5 <= E.x1) b.decal('marking', xc - 1.5, z + s, xc + 1.5, z + s + 0.5);
            }
        }
    }
}

function city(b: LevelBuilder, r: Rng, clutter: Rect[], plazas: Plaza[], stalls: [number, number][]): void {
    const BLOCK = PITCH - ROAD;
    const names = new Rng(7);
    const used = new Set<string>();
    roadMarkings(b);
    for (let a = 0; a < 12; a++) {
        for (let c = 0; c < 5; c++) {
            const x0 = -HALF + 20 + a * PITCH + ROAD / 2;
            const z1 = -70 - 20 - c * PITCH - ROAD / 2;
            const z0 = z1 - BLOCK;
            const x1 = x0 + BLOCK;
            b.box('sidewalk', x0, 0, z0, x1, 0.15, z1);
            b.blocks.push({ x0, z0, x1, z1, y: 0.15 });
            const blk: BlockRef = { x0, z0, x1, z1, index: b.blocks.length - 1 };
            // (not on the corners: they are for the signal poles and the people waiting at the crossings, traffic network.ts)
            // street lamps by the kerb, 4 m along from each corner: an arm out over the road and the lamp under it
            for (const [lx, lz, out] of [[x0 + 0.4, z0 + 4, -1], [x1 - 0.4, z0 + 4, 1], [x0 + 0.4, z1 - 4, -1], [x1 - 0.4, z1 - 4, 1]]) {
                b.prism('metal', lx, lz, 0.15, 7, 0.12, 4);
                b.box('metal', lx, 6.8, lz - 0.05, lx + out * 1.8, 6.92, lz + 0.05);
                b.box('metal', lx + out * 1.15, 6.62, lz - 0.16, lx + out * 1.85, 6.8, lz + 0.16);
            }
            // taller towards the middle of the city (x = 0, z = -290)
            const cx = (x0 + x1) / 2;
            const cz = (z0 + z1) / 2;
            const d = Math.sqrt(cx * cx + (cz + 290) * (cz + 290));
            const maxFloors = d < 150 ? 22 : d < 300 ? 12 : 6;
            if (a === 5 && c === 1) { construction(b, x0, z0); continue; }
            if (a === 7 && c === 0) { carPark(b, x0, z0); continue; }
            const u = r.int(0, 99);
            // (map v9) the lot by the city station becomes its garden; its old random draws still happen, drawn nowhere
            const lot = a === 6 && c === 1;
            if (lot) stalls.push(...stationGarden(b, new Rng(9), x0, z0, x1, z1));
            const g = lot ? new LevelBuilder() : b;
            if (u < 10) {
                // plaza: planters with trees
                const planters: [number, number][] = [];
                for (let k = 0; k < 6; k++) {
                    const tx = x0 + 8 + r.int(0, BLOCK - 16);
                    const tz = z0 + 8 + r.int(0, BLOCK - 16);
                    g.block('concrete', tx, tz, 3, 3, 0.15, 0.6);
                    tree(g, r, tx, tz, 0.8);
                    planters.push([tx, tz]);
                }
                if (!lot) plazas.push({ block: blk.index, planters });
                continue;
            }
            if (u < 18) {
                // surface parking: low walls only
                g.box('concrete', x0 + 2, 0.15, z0 + 2, x1 - 2, 1.0, z0 + 2.3);
                continue;
            }
            if (lot) throw new Error('the lot by the city station would have a building on it');
            const set = 2 + r.int(0, 3);
            const split = r.int(0, 2);
            if (split === 0) building(b, r, names, used, clutter, blk, x0 + set, z0 + set, x1 - set, z1 - set, maxFloors);
            else if (split === 1) {
                const mid = x0 + BLOCK / 2;
                building(b, r, names, used, clutter, blk, x0 + set, z0 + set, mid - 2, z1 - set, maxFloors);
                building(b, r, names, used, clutter, blk, mid + 2, z0 + set, x1 - set, z1 - set, maxFloors);
            } else {
                const mx = x0 + BLOCK / 2;
                const mz = z0 + BLOCK / 2;
                building(b, r, names, used, clutter, blk, x0 + set, z0 + set, mx - 2, mz - 2, maxFloors);
                building(b, r, names, used, clutter, blk, mx + 2, z0 + set, x1 - set, mz - 2, maxFloors);
                building(b, r, names, used, clutter, blk, x0 + set, mz + 2, mx - 2, z1 - set, maxFloors);
                building(b, r, names, used, clutter, blk, mx + 2, mz + 2, x1 - set, z1 - set, maxFloors);
            }
        }
    }
}

/**
 * The city's edge (map v11; owner, 2026-10-19: "the edges of the city dont really make sense (they are just weird edges
 * of asphalt)"): the ring road round the blocks ends at a kerb, with a 5 m sidewalk outside it at the blocks' kerb height
 * (the traffic lights' poles on the outer corners stand on it), street lamps along it over the road midway between the
 * junctions, a gap in it where the yard road leaves, and a row of street trees on the grass verge towards the park.
 */
function cityEdge(b: LevelBuilder, r: Rng): void {
    const E = CITY_EDGE, w = E.walk, y = 0.15, R = YARD_ROAD;
    const ox0 = E.x0 - w, ox1 = E.x1 + w;
    b.box('sidewalk', ox0, 0, E.z0 - w, ox1, y, E.z0, FACE.bottom); // north
    b.box('sidewalk', ox0, 0, E.z0, E.x0, y, E.z1, FACE.bottom); // west
    b.box('sidewalk', E.x1, 0, E.z0, ox1, y, E.z1, FACE.bottom); // east
    b.box('sidewalk', ox0, 0, E.z1, R.x - R.hw, y, E.z1 + w, FACE.bottom); // south, either side of the yard road
    b.box('sidewalk', R.x + R.hw, 0, E.z1, ox1, y, E.z1 + w, FACE.bottom);
    // lamps by the kerb, their arms out over the road, midway between junctions (junctions every 80 m from -480 / -90)
    const lamp = (lx: number, lz: number, ax: number, az: number): void => {
        b.prism('metal', lx, lz, y, 7, 0.12, 4);
        if (ax) {
            b.box('metal', lx, 6.8, lz - 0.05, lx + ax * 1.8, 6.92, lz + 0.05);
            b.box('metal', lx + ax * 1.15, 6.62, lz - 0.16, lx + ax * 1.85, 6.8, lz + 0.16);
        } else {
            b.box('metal', lx - 0.05, 6.8, lz, lx + 0.05, 6.92, lz + az * 1.8);
            b.box('metal', lx - 0.16, 6.62, lz + az * 1.15, lx + 0.16, 6.8, lz + az * 1.85);
        }
    };
    for (let x = -440; x <= 440; x += PITCH) {
        if (Math.abs(x - R.x) > 10) lamp(x, E.z1 + 0.4, 0, -1);
        lamp(x, E.z0 - 0.4, 0, 1);
    }
    for (let z = -130; z >= -450; z -= PITCH) {
        lamp(E.x0 - 0.4, z, 1, 0);
        lamp(E.x1 + 0.4, z, -1, 0);
    }
    // street trees on the verge south of the city, every 24 m, kept off the yard road, the park's path and the substation
    for (let x = -452; x <= 470; x += 24) {
        const tz = E.z1 + w + 8 + r.int(0, 3);
        if (Math.abs(x - R.x) < 12 || Math.abs(x) < 10) continue;
        tree(b, r, x + r.int(-2, 2), tz, 0.9);
    }
}

// ---------------------------------------------------------------- south-east fields

function southEast(b: LevelBuilder, r: Rng): WoodSpot[] {
    // water tower: four legs braced by two rings of girders between them, a tank
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.prism('metal', 250 + dx, 260 + dz, 0, 24, 0.4, 6);
    for (const y of [8, 16]) {
        for (const z of [256, 264]) b.box('metal', 246, y, z - 0.15, 254, y + 0.4, z + 0.15);
        for (const x of [246, 254]) b.box('metal', x - 0.15, y, 256, x + 0.15, y + 0.4, 264);
    }
    b.prism('metal', 250, 260, 24, 32, 7, 8);
    b.cone('metal', 250, 260, 32, 35, 7.2, 8);
    // (map v10) the tree line north of the water tower, wandering and broken, and the forest where the hay bales stood
    treeLine(b, r, 118, 482, 220);
    return forest(b, new Rng(10));
}

// ---------------------------------------------------------------- border

/** A belt of trees just outside the playable square, so its edge reads as a place, not a line (map v10: woods.ts). */
function border(b: LevelBuilder, r: Rng): void {
    borderBelt(b, r, HALF + 20);
}
