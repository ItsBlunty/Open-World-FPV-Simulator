// What the city's buildings show that is not collision: a name sign over the street floor on every face that looks
// onto a street (and a big one near the top of each tower), and automatic sliding doors in each building's entrance
// that open as people walk in and out (packages/traffic network.ts). The doors sit in the entrance's glass, inside the
// 15 cm window reveal, and the signs 3 cm proud of the wall (like the road paint, thinner than half the quad's
// collision spheres), so what is drawn still matches what the quad can hit. Drawing never feeds back into the sim.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACE } from '@owfpv/maps';
import type { Building, Level } from '@owfpv/maps';
import type { Place, TrafficModel } from '@owfpv/traffic';

/** Sign panels: background and lettering, picked by a building's look. */
const SIGN_COLOURS: [string, string][] = [
    ['#1f4d3a', '#f3ead2'], ['#1d2f5c', '#ffffff'], ['#6b1f2a', '#f7e7c6'], ['#151515', '#ffd257'], ['#efe6d2', '#2a2a2a'],
    ['#0f5f66', '#ffffff'], ['#f4f4f0', '#c0392b'], ['#3b2a20', '#e9c98b'], ['#ffd84d', '#1a1a1a'], ['#5a2d82', '#ffffff']
];
/** Street-floor signs: on the band of wall between the shop fronts' heads (3 m) and the first floor's sills, m. */
const SIGN_Y0 = 3.25;
const SIGN_H = 0.9;
/** Towers (this many storeys or more) also carry their name across their top storey, this tall, m. */
const CROWN_STOREYS = 12;
const CROWN_H = 2.0;
/** how far a sign stands off its wall, m */
const SIGN_OFF = 0.03;
/** atlas: rows this many pixels high (the letters about 60 % of it) */
const ROW_PX = 96;
const ATLAS_W = 2048;

/**
 * The entrance (door.width 2.5 m, door.height 3 m above the sidewalk): two sliding leaves of DOOR_LEAF_W x DOOR_H in
 * the middle, fixed glass either side, a transom over them. Automatic doors open in about a second [estimate].
 */
const DOOR_H = 2.25;
const DOOR_LEAF_W = 0.95;
const DOOR_OPEN_S = 0.6;
/** a door opens for someone this near its middle (m), walking in or out */
const DOOR_NEAR = 2.2;
const FRAME = 0x2b2f33;
const LEAF_GLASS = 0x6f8fa3;

interface Atlas {
    tex: THREE.Texture;
    /** per building: its sign's u0, v0, u1, v1 and width over height */
    rect: number[][];
}

function canvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

/** Every building's sign painted once into one texture, rows of ROW_PX. */
function paintSigns(buildings: readonly Building[]): Atlas {
    const font = `600 ${Math.round(ROW_PX * 0.58)}px "Trebuchet MS", "Segoe UI", Helvetica, Arial, sans-serif`;
    const measure = canvas(8, 8).getContext('2d') as CanvasRenderingContext2D;
    measure.font = font;
    const pad = ROW_PX * 0.45;
    const widths = buildings.map((b) => Math.min(ATLAS_W, Math.ceil(measure.measureText(b.name).width + 2 * pad)));
    // shelf packing in the order given
    const pos: number[][] = [];
    let x = 0, y = 0;
    for (const w of widths) {
        if (x + w > ATLAS_W) { x = 0; y += ROW_PX; }
        pos.push([x, y]);
        x += w;
    }
    let H = 64;
    while (H < y + ROW_PX) H *= 2;
    const c = canvas(ATLAS_W, H);
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const rect: number[][] = [];
    buildings.forEach((b, i) => {
        const [px, py] = pos[i], w = widths[i];
        const [bg, fg] = SIGN_COLOURS[b.look % SIGN_COLOURS.length];
        g.fillStyle = bg;
        g.fillRect(px, py, w, ROW_PX);
        g.strokeStyle = fg;
        g.globalAlpha = 0.6;
        g.lineWidth = 3;
        g.strokeRect(px + 6, py + 6, w - 12, ROW_PX - 12);
        g.globalAlpha = 1;
        g.fillStyle = fg;
        g.fillText(b.name, px + w / 2, py + ROW_PX / 2 + 2);
        // the texture's v runs up from the canvas's bottom row (flipY)
        rect.push([(px + 0.5) / ATLAS_W, 1 - (py + ROW_PX - 0.5) / H, (px + w - 0.5) / ATLAS_W, 1 - (py + 0.5) / H, w / ROW_PX]);
    });
    const tex = new THREE.CanvasTexture(c as HTMLCanvasElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return { tex, rect };
}

export class BuildingsView {
    readonly group = new THREE.Group();
    private readonly level: Level;
    private readonly leaves: THREE.InstancedMesh[] = [];
    /** per door: how far open (0-1), and its frame (x along the face to the viewer's right, y up, z out) */
    private readonly open: Float64Array;
    private readonly frames: THREE.Matrix4[] = [];
    private readonly users: Float64Array;
    private lastTick = NaN;
    private readonly p: Place = { x: 0, y: 0, z: 0, hx: 1, hz: 0 };
    private readonly m = new THREE.Matrix4();

    constructor(level: Level) {
        this.level = level;
        this.group.name = 'buildings';
        this.open = new Float64Array(level.doors.length);
        this.users = new Float64Array(level.doors.length);
        if (level.buildings.length) this.buildSigns();
        if (level.doors.length) this.buildDoors();
    }

    private buildSigns(): void {
        const { tex, rect } = paintSigns(this.level.buildings);
        const pos: number[] = [], nor: number[] = [], uv: number[] = [];
        // a sign: centred at (cx, cz) on the face with outward normal (nx, nz), from y up h, w wide
        const sign = (r: number[], cx: number, cz: number, nx: number, nz: number, y: number, w: number, h: number): void => {
            const tx = nz, tz = -nx; // the viewer's right, facing the wall
            const ox = cx + nx * SIGN_OFF, oz = cz + nz * SIGN_OFF;
            const a = [ox - tx * w / 2, y, oz - tz * w / 2], b = [ox + tx * w / 2, y, oz + tz * w / 2];
            const c = [b[0], y + h, b[2]], d = [a[0], y + h, a[2]];
            for (const v of [a, b, c, a, c, d]) pos.push(v[0], v[1], v[2]);
            for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
            uv.push(r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[1], r[2], r[3], r[0], r[3]);
        };
        const NX = [0, 0, -1, 1], NZ = [-1, 1, 0, 0], MASK = [FACE.nz, FACE.pz, FACE.nx, FACE.px];
        this.level.buildings.forEach((bd, i) => {
            const r = rect[i], aspect = r[4];
            const door = this.level.doors[bd.door];
            for (let f = 0; f < 4; f++) {
                if (!(bd.street & MASK[f])) continue;
                const nx = NX[f], nz = NZ[f];
                const len = f < 2 ? bd.x1 - bd.x0 : bd.z1 - bd.z0;
                const fx = f === 2 ? bd.x0 : f === 3 ? bd.x1 : (bd.x0 + bd.x1) / 2;
                const fz = f === 0 ? bd.z0 : f === 1 ? bd.z1 : (bd.z0 + bd.z1) / 2;
                // over the entrance on its face, else in the middle; never past the face's ends
                const onDoor = door.nx === nx && door.nz === nz;
                const w = Math.min(SIGN_H * aspect, len - 2);
                let cx = onDoor ? door.x : fx, cz = onDoor ? door.z : fz;
                const along = f < 2 ? cx : cz, lo = (f < 2 ? bd.x0 : bd.z0) + w / 2 + 0.5, hi = (f < 2 ? bd.x1 : bd.z1) - w / 2 - 0.5;
                const at = Math.min(hi, Math.max(lo, along));
                if (f < 2) cx = at; else cz = at;
                sign(r, cx, cz, nx, nz, bd.y0 + SIGN_Y0, w, w / aspect);
                // a tower's name across its top storey
                if (bd.storeys >= CROWN_STOREYS) {
                    const tl = f < 2 ? bd.tx1 - bd.tx0 : bd.tz1 - bd.tz0;
                    const cw = Math.min(CROWN_H * aspect, tl * 0.8);
                    const tx = f === 2 ? bd.tx0 : f === 3 ? bd.tx1 : (bd.tx0 + bd.tx1) / 2;
                    const tz = f === 0 ? bd.tz0 : f === 1 ? bd.tz1 : (bd.tz0 + bd.tz1) / 2;
                    const ch = cw / aspect;
                    sign(r, tx, tz, nx, nz, bd.top - 1.75 - ch / 2, cw, ch);
                }
            }
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.computeBoundingSphere();
        const mat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.55 });
        // a little light of their own, as lit signs have, so they read in the shade
        mat.emissiveMap = tex;
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveIntensity = 0.25;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'buildings:signs';
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
    }

    private buildDoors(): void {
        const doors = this.level.doors;
        const n = doors.length;
        // the frame in the door's own frame (x to the viewer's right, y up, z out of the glass)
        const W = doors[0].width, top = doors[0].height;
        const bar = (w: number, h: number, x: number, y: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, 0.06).translate(x, y, 0.03);
        const fixedW = W / 2 - DOOR_LEAF_W;
        const frame = mergeGeometries([
            bar(0.08, top, -W / 2 + 0.04, top / 2), bar(0.08, top, W / 2 - 0.04, top / 2), // jambs
            bar(W, 0.1, 0, DOOR_H + 0.05), // transom
            bar(0.05, DOOR_H, -W / 2 + fixedW, DOOR_H / 2), bar(0.05, DOOR_H, W / 2 - fixedW, DOOR_H / 2), // fixed panels' edges
            bar(W, 0.04, 0, 0.02) // threshold
        ]);
        // a leaf, its middle edge at x = 0 and reaching to -x (the left leaf; the right one is it turned round)
        const leafFrame = mergeGeometries([
            new THREE.BoxGeometry(0.06, DOOR_H, 0.04).translate(-0.03, DOOR_H / 2, 0),
            new THREE.BoxGeometry(0.06, DOOR_H, 0.04).translate(-DOOR_LEAF_W + 0.03, DOOR_H / 2, 0),
            new THREE.BoxGeometry(DOOR_LEAF_W, 0.1, 0.04).translate(-DOOR_LEAF_W / 2, 0.05, 0),
            new THREE.BoxGeometry(DOOR_LEAF_W, 0.06, 0.04).translate(-DOOR_LEAF_W / 2, DOOR_H - 0.03, 0)
        ]);
        const leafGlass = new THREE.PlaneGeometry(DOOR_LEAF_W - 0.1, DOOR_H - 0.14).translate(-DOOR_LEAF_W / 2, DOOR_H / 2 + 0.02, 0);
        const frameMat = new THREE.MeshStandardNodeMaterial({ color: FRAME, roughness: 0.5, metalness: 0.4 });
        const frames = new THREE.InstancedMesh(frame, frameMat, n);
        const lf = new THREE.InstancedMesh(leafFrame, frameMat, 2 * n);
        const lg = new THREE.InstancedMesh(leafGlass, new THREE.MeshStandardNodeMaterial({ color: LEAF_GLASS, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide }), 2 * n);
        for (const [mesh, name] of [[frames, 'doorFrame'], [lf, 'leafFrame'], [lg, 'leafGlass']] as const) {
            mesh.name = `buildings:${name}`;
            mesh.frustumCulled = false;
            mesh.receiveShadow = true;
            this.group.add(mesh);
        }
        doors.forEach((d, i) => {
            // on the glass, 2 cm out from it, inside the reveal
            const ox = d.x - d.nx * (d.depth - 0.02), oz = d.z - d.nz * (d.depth - 0.02);
            const f = new THREE.Matrix4().set(d.nz, 0, d.nx, ox, 0, 1, 0, d.y, -d.nx, 0, d.nz, oz, 0, 0, 0, 1);
            this.frames.push(f);
            frames.setMatrixAt(i, f);
        });
        frames.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        lf.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        lg.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.leaves.push(lf, lg);
        this.placeLeaves();
    }

    /** Each leaf where its door's opening puts it: slid apart behind the fixed glass, 4 cm out from it. */
    private placeLeaves(): void {
        if (!this.leaves.length) return;
        const slide = DOOR_LEAF_W - 0.1;
        this.frames.forEach((f, i) => {
            const s = this.open[i] * slide;
            // left leaf: middle edge at -s; right leaf: turned round (x -> -x), middle edge at +s
            this.m.makeTranslation(-s, 0, 0.06).premultiply(f);
            for (const l of this.leaves) l.setMatrixAt(2 * i, this.m);
            this.m.makeRotationY(Math.PI).setPosition(s, 0, 0.06).premultiply(f);
            for (const l of this.leaves) l.setMatrixAt(2 * i + 1, this.m);
        });
        for (const l of this.leaves) l.instanceMatrix.needsUpdate = true;
    }

    /** Open the doors people are walking through at `tick` (after the traffic model was brought to it); others close. */
    update(model: TrafficModel | null, tick: number): void {
        if (!this.leaves.length) return;
        const dt = Number.isNaN(this.lastTick) ? 0 : Math.min(0.1, Math.max(0, (tick - this.lastTick) / 1000));
        this.lastTick = tick;
        this.users.fill(0);
        if (model?.doorUse) {
            for (let i = 0; i < model.movers.length; i++) {
                const d = model.doorUse(i);
                if (d < 0) continue;
                const door = this.level.doors[d];
                model.place(i, tick, this.p);
                if (Math.hypot(this.p.x - door.x, this.p.z - door.z) < DOOR_NEAR) this.users[d] = 1;
            }
        }
        let moved = false;
        for (let d = 0; d < this.open.length; d++) {
            const want = this.users[d], was = this.open[d];
            if (want === was) continue;
            const step = dt / DOOR_OPEN_S;
            this.open[d] = want > was ? Math.min(1, was + step) : Math.max(0, was - step);
            moved = true;
        }
        if (moved) this.placeLeaves();
    }
}
