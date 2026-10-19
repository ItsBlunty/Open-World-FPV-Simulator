// The time trials drawn (owner, 2026-10-19): checks on each start arch's banner and flag, a glow on each landing pad
// that grows brighter over the 3 s the quad rests there, and over each pad a floating 3D arrow saying TIME TRIAL. While
// a race runs, the gates: the next one in a thick pulsing frame with a tinted pane and a floating arrow over it (the
// arrow and a faint frame seen through walls, so it can be found from anywhere), the one after it in a thin dim frame
// (owner, 2026-10-19: the gates must be much more obvious). Drawn only: none of it is solid (the arch, pad and flag are
// the level's own geometry), and drawing never feeds back into the sim.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHECKER_SLAB, checkerFaces, gateAxes } from '@owfpv/maps';
import type { Gate, TimeTrial } from '@owfpv/maps';
import type { TrialStatus } from '../trials';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

/** Check squares, m: the banner's (two rows on its 0.7 m) and the flag's. */
const SQUARE = { banner: 0.35, flag: 0.25 };
/** A gate's frame: bars this thick (the next gate's, the one after's), this far outside its opening, m. */
const BAR_NEXT = 0.16;
const BAR_AFTER = 0.06;
const OUT = 0.05;
/** the next gate's frame pulses between these, twice a second */
const NEXT_A = new THREE.Color(0xff8a00);
const NEXT_B = new THREE.Color(0xffe066);
const AFTER = 0x9a7a4a;
/** the floating arrows (over the next gate, over each pad): their colour, and how far and how often they bob */
const ARROW = 0xff8a00;
const BOB_M = 0.3;
const BOB_S = 1.4;
/** the gate's arrow keeps its size out to this far, m, then grows with the distance */
const BEACON_NEAR = 15;
/** the pad's glow: dim when idle, bright at the end of the hold, as colours */
const PAD_IDLE = new THREE.Color(0x1d4d57);
const PAD_FULL = new THREE.Color(0xc8fbff);

/** Two triangles per face, both sides of the slab, with the checks' uvs scaled to whole squares. */
function checkerGeometry(trials: readonly TimeTrial[]): THREE.BufferGeometry {
    const pos: number[] = [], uv: number[] = [], nor: number[] = [];
    for (const t of trials) {
        checkerFaces(t).forEach((f, k) => {
            const sq = k === 0 ? SQUARE.banner : SQUARE.flag;
            const half = (k === 0 ? CHECKER_SLAB.banner : CHECKER_SLAB.flag) / 2 + 0.004;
            const cols = Math.max(1, Math.round(f.w / sq)), rows = Math.max(1, Math.round(f.h / sq));
            for (const side of [-1, 1]) {
                // corners in (along, up), the face's normal along x or z
                const at = (a: number, b: number): number[] => f.alongX
                    ? [f.x + side * half, f.y + b * f.h / 2, f.z + a * f.w / 2]
                    : [f.x + a * f.w / 2, f.y + b * f.h / 2, f.z + side * half];
                const n = f.alongX ? [side, 0, 0] : [0, 0, side];
                // wound to face outwards
                const quad = side * (f.alongX ? -1 : 1) > 0 ? [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] : [[-1, -1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]];
                for (const [a, b] of quad) {
                    pos.push(...at(a, b));
                    nor.push(...n);
                    uv.push(((a + 1) / 2) * cols / 2, ((b + 1) / 2) * rows / 2);
                }
            }
        });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
}

/** A 2 x 2 check, repeated: one uv unit is two squares. */
function checkerTexture(): THREE.Texture {
    const w = 255, b = 22;
    const data = new Uint8Array([w, w, w, 255, b, b, b, 255, b, b, b, 255, w, w, w, 255]);
    const t = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
}

/** A gate's frame: four bars `bar` m thick round its opening, in the gate's plane. */
function frameGeometry(g: Gate, bar: number): THREE.BufferGeometry {
    const { u, v } = gateAxes(g);
    const W = g.hw + OUT + bar / 2, H = g.hh + OUT + bar / 2;
    const parts: THREE.BufferGeometry[] = [];
    const piece = (cu: number, cv: number, lu: number, lv: number): void => {
        parts.push(inGate(g, u, v, new THREE.BoxGeometry(lu, lv, bar), cu, cv));
    };
    piece(0, H, 2 * W + bar, bar);
    piece(0, -H, 2 * W + bar, bar);
    piece(W, 0, bar, 2 * H - bar);
    piece(-W, 0, bar, 2 * H - bar);
    return clean(parts);
}

/** The gate's opening as a pane (drawn from both sides), for a light tint over it. */
function paneGeometry(g: Gate): THREE.BufferGeometry {
    const { u, v } = gateAxes(g);
    return clean([inGate(g, u, v, new THREE.PlaneGeometry(2 * g.hw, 2 * g.hh), 0, 0)]);
}

/** A shape built in a gate's frame (x along u, y along v, z along its normal), moved to (cu, cv) on it. */
function inGate(g: Gate, u: number[], v: number[], geo: THREE.BufferGeometry, cu: number, cv: number): THREE.BufferGeometry {
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(u[0], u[1], u[2]), new THREE.Vector3(v[0], v[1], v[2]), new THREE.Vector3(g.nx, g.ny, g.nz));
    m.setPosition(g.x + u[0] * cu + v[0] * cv, g.y + u[1] * cu + v[1] * cv, g.z + u[2] * cu + v[2] * cv);
    return geo.applyMatrix4(m);
}

/** Pieces merged into one geometry with positions and normals only. */
function clean(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const out = mergeGeometries(parts.map((p) => {
        const n = p.index ? p.toNonIndexed() : p;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', n.getAttribute('position'));
        g.setAttribute('normal', n.getAttribute('normal'));
        return g;
    }));
    out.computeBoundingSphere();
    return out;
}

/** A 3D arrow pointing down, its tip at the origin: 1.8 m tall, 1.2 m across its head, 0.3 m thick. */
function arrowGeometry(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.6, 0.8);
    s.lineTo(0.22, 0.8);
    s.lineTo(0.22, 1.8);
    s.lineTo(-0.22, 1.8);
    s.lineTo(-0.22, 0.8);
    s.lineTo(-0.6, 0.8);
    s.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    g.translate(0, 0, -0.12);
    return clean([g]);
}

/**
 * Block letters for the markers, as strokes on a 4 x 6 grid (x right, y up), each drawn as a bar: a font of our own,
 * so there is no font file to license. Only the letters the markers spell.
 */
const STROKES: Record<string, number[][]> = {
    T: [[0, 6, 4, 6], [2, 0, 2, 6]],
    I: [[2, 0, 2, 6], [1, 6, 3, 6], [1, 0, 3, 0]],
    M: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 6, 2, 3], [2, 3, 4, 6]],
    E: [[0, 0, 0, 6], [0, 6, 4, 6], [0, 3, 3, 3], [0, 0, 4, 0]],
    R: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [3, 3, 0, 3], [2, 3, 4, 0]],
    A: [[0, 0, 2, 6], [2, 6, 4, 0], [0.85, 2.5, 3.15, 2.5]],
    L: [[0, 0, 0, 6], [0, 0, 4, 0]]
};

/** `text` in 3D block letters `h` m tall, centred on the origin in the x-y plane, facing +z. */
export function textGeometry(text: string, h: number): THREE.BufferGeometry {
    const k = h / 6, stroke = 1.1 * k, depth = 0.12;
    const advance = 5.6, space = 3.5;
    const width = [...text].reduce((w, c) => w + (c === ' ' ? space : advance), 0) - (advance - 4);
    const parts: THREE.BufferGeometry[] = [];
    let x0 = -width / 2;
    for (const c of text) {
        if (c === ' ') {
            x0 += space;
            continue;
        }
        for (const [ax, ay, bx, by] of STROKES[c] ?? []) {
            const dx = (bx - ax) * k, dy = (by - ay) * k, len = Math.hypot(dx, dy);
            const bar = new THREE.BoxGeometry(len + stroke, stroke, depth);
            bar.rotateZ(Math.atan2(dy, dx));
            bar.translate((x0 + (ax + bx) / 2) * k, ((ay + by) / 2 - 3) * k, 0);
            parts.push(bar);
        }
        x0 += advance;
    }
    return clean(parts);
}

type Coloured = THREE.Material & { color: THREE.Color };

export class TrialsView {
    readonly group = new THREE.Group();
    private readonly trials: readonly TimeTrial[];
    private readonly pads: { mat: Coloured; marker: THREE.Group }[] = [];
    /** per course, per gate: the next gate's thick frame, its pane, and the thin frame the one after it gets */
    private readonly frames: THREE.BufferGeometry[][];
    private readonly panes: THREE.BufferGeometry[][];
    private readonly thin: THREE.BufferGeometry[][];
    private readonly next: THREE.Mesh;
    private readonly ghost: THREE.Mesh;
    private readonly pane: THREE.Mesh;
    private readonly after: THREE.Mesh;
    /** the arrow over the next gate (seen through walls), and where it hangs */
    private readonly beacon: THREE.Mesh;
    private readonly beaconAt = new THREE.Vector3();
    private shown = '';

    constructor(trials: readonly TimeTrial[], kit: Kit = FULL_KIT) {
        this.trials = trials;
        this.group.name = 'time-trials';
        const checks = new THREE.Mesh(checkerGeometry(trials), kit.lit({ map: checkerTexture(), roughness: 0.8 }));
        checks.name = 'trial-checks';
        checks.receiveShadow = true;
        this.group.add(checks);
        const arrow = arrowGeometry();
        const word = textGeometry('TIME TRIAL', 0.9);
        const arrowMat = kit.lit({ color: ARROW, emissive: 0xc05000, roughness: 0.5 });
        const wordMat = kit.lit({ color: 0xffd84a, emissive: 0x8a6200, roughness: 0.6 });
        for (const t of trials) {
            const p = t.pad;
            const mat = kit.flat({ color: PAD_IDLE.getHex() }) as Coloured;
            const geo = new THREE.PlaneGeometry(2 * p.half - 0.1, 2 * p.half - 0.1);
            geo.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(p.x, p.y + 0.005, p.z);
            mesh.name = `trial-pad:${t.id}`;
            this.group.add(mesh);
            // the marker, 1.5 times the gate arrow's size: its tip about 1 m over the arch's banner, the words over the arrow; it turns to face the camera
            const marker = new THREE.Group();
            marker.name = `trial-marker:${t.id}`;
            const a = new THREE.Mesh(arrow, arrowMat);
            a.scale.setScalar(1.5);
            a.castShadow = true;
            const w = new THREE.Mesh(word, wordMat);
            w.position.y = 3.4;
            w.castShadow = true;
            marker.add(a, w);
            marker.position.set(p.x, p.y + 5, p.z);
            this.group.add(marker);
            this.pads.push({ mat, marker });
        }
        this.frames = trials.map((t) => t.gates.map((g) => frameGeometry(g, BAR_NEXT)));
        this.panes = trials.map((t) => t.gates.map(paneGeometry));
        this.thin = trials.map((t) => t.gates.map((g) => frameGeometry(g, BAR_AFTER)));
        const mk = (mat: THREE.Material, order = 0): THREE.Mesh => {
            const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
            m.visible = false;
            m.frustumCulled = false;
            m.renderOrder = order;
            this.group.add(m);
            return m;
        };
        /** seen through walls: drawn last, over everything */
        const through = (m: THREE.Material, opacity: number): THREE.Material => {
            m.transparent = true;
            m.opacity = opacity;
            m.depthTest = false;
            m.depthWrite = false;
            return m;
        };
        this.next = mk(kit.flat({ color: NEXT_A.getHex() }));
        this.ghost = mk(through(kit.flat({ color: NEXT_A.getHex() }), 0.35), 10);
        const paneMat = kit.flat({ color: NEXT_B.getHex() });
        paneMat.transparent = true;
        paneMat.opacity = 0.14;
        paneMat.depthWrite = false;
        paneMat.side = THREE.DoubleSide;
        this.pane = mk(paneMat, 5);
        this.after = mk(kit.flat({ color: AFTER }));
        this.beacon = mk(through(kit.flat({ color: ARROW }), 0.85), 11);
        this.beacon.geometry = arrow;
    }

    /**
     * Show the time trials as they stand (null: none, as in the replay viewer). `t` is the page's clock, s; `eye` the
     * camera's position (the arrows and words turn to face it).
     */
    update(st: TrialStatus | null, t: number, eye: THREE.Vector3 | null = null): void {
        const bob = Math.sin((t / BOB_S) * 2 * Math.PI) * BOB_M;
        const face = (o: THREE.Object3D): void => {
            if (eye) o.rotation.y = Math.atan2(eye.x - o.position.x, eye.z - o.position.z);
        };
        this.pads.forEach((p, c) => {
            let k = 0;
            const mine = st !== null && st.course === c;
            if (mine) {
                if (st.phase === 'free' || st.phase === 'asking') k = st.hold;
                // during the countdown it pulses once a second; while racing it stays lit as the finish
                else if (st.phase === 'countdown') k = 0.6 + 0.4 * Math.cos(t * 2 * Math.PI);
                else k = 0.5;
            }
            p.mat.color.copy(PAD_IDLE).lerp(PAD_FULL, k * k);
            // the marker is for finding the pad: gone while its course is offered or raced, and in the replay viewer
            p.marker.visible = st !== null && !(mine && st.phase !== 'free');
            p.marker.position.y = this.trials[c].pad.y + 5 + bob;
            face(p.marker);
        });
        // the next gate's frame pulses twice a second
        (this.next.material as Coloured).color.copy(NEXT_A).lerp(NEXT_B, 0.5 + 0.5 * Math.sin(t * 4 * Math.PI));
        const racing = st !== null && (st.phase === 'racing' || st.phase === 'countdown') && st.course >= 0;
        const gate = racing ? (st.phase === 'racing' ? st.gate : 0) : -1;
        const key = racing ? `${st.course}:${gate}` : '';
        if (key !== this.shown) {
            this.shown = key;
            const c = racing ? st.course : 0;
            const set = (m: THREE.Mesh, g: THREE.BufferGeometry | undefined): void => {
                m.visible = g !== undefined;
                if (g) m.geometry = g;
            };
            set(this.next, racing ? this.frames[c][gate] : undefined);
            set(this.ghost, racing ? this.frames[c][gate] : undefined);
            set(this.pane, racing ? this.panes[c][gate] : undefined);
            set(this.after, racing ? this.thin[c][gate + 1] : undefined);
            const g = racing ? this.trials[c].gates[gate] : undefined;
            this.beacon.visible = g !== undefined;
            // over a standing gate, its tip 1.2 m over the frame; over a flat one (a hole, the wires), 2 m over its middle
            if (g) this.beaconAt.set(g.x, g.y + (Math.abs(g.ny) > 0.9 ? 2 : g.hh + 1.2), g.z);
        }
        if (this.beacon.visible) {
            this.beacon.position.copy(this.beaconAt);
            this.beacon.position.y += bob;
            face(this.beacon);
            // life size within BEACON_NEAR m, then growing with the distance, so it stays as big on screen and can be
            // found from across the map
            this.beacon.scale.setScalar(eye ? Math.max(1, eye.distanceTo(this.beaconAt) / BEACON_NEAR) : 1);
        }
    }
}
