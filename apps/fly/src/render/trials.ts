// The time trials drawn (owner, 2026-10-19): checks on each start arch's banner and flag, a glow on each landing pad
// that grows brighter over the 3 s the quad rests there, and while a race runs, the gates: the next one in bright
// outline (and faintly through walls, so it can be found), the one after it dim. Drawn only: none of it is solid
// (the arch, pad and flag are the level's own geometry), and drawing never feeds back into the sim.

import * as THREE from 'three/webgpu';
import { CHECKER_SLAB, checkerFaces, gateAxes } from '@owfpv/maps';
import type { Gate, TimeTrial } from '@owfpv/maps';
import type { TrialStatus } from '../trials';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

/** Check squares, m: the banner's (two rows on its 0.7 m) and the flag's. */
const SQUARE = { banner: 0.35, flag: 0.25 };
/** A gate's outline: bars this thick, this far outside its opening, m. */
const BAR = 0.06;
const OUT = 0.05;
const NEXT = 0xffa31a;
const AFTER = 0x8a6a3a;
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

/** A gate's outline: four bars round its opening, in the gate's plane. */
function outlineGeometry(g: Gate): THREE.BufferGeometry {
    const { u, v } = gateAxes(g);
    const n = [g.nx, g.ny, g.nz];
    const W = g.hw + OUT + BAR / 2, H = g.hh + OUT + BAR / 2;
    const parts: THREE.BufferGeometry[] = [];
    const bar = (cu: number, cv: number, lu: number, lv: number): void => {
        const box = new THREE.BoxGeometry(lu, lv, BAR);
        // box axes: x along u, y along v, z along n
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
        m.setPosition(g.x + u[0] * cu + v[0] * cv, g.y + u[1] * cu + v[1] * cv, g.z + u[2] * cu + v[2] * cv);
        box.applyMatrix4(m);
        parts.push(box.toNonIndexed());
    };
    bar(0, H, 2 * W + BAR, BAR);
    bar(0, -H, 2 * W + BAR, BAR);
    bar(W, 0, BAR, 2 * H - BAR);
    bar(-W, 0, BAR, 2 * H - BAR);
    const pos: number[] = [];
    for (const p of parts) pos.push(...(p.getAttribute('position').array as Float32Array));
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.computeBoundingSphere();
    return out;
}

export class TrialsView {
    readonly group = new THREE.Group();
    private readonly pads: { mesh: THREE.Mesh; mat: THREE.Material & { color: THREE.Color } }[] = [];
    /** per course, per gate: its outline geometry (shared by the three meshes below) */
    private readonly outlines: THREE.BufferGeometry[][];
    private readonly next: THREE.Mesh;
    private readonly ghost: THREE.Mesh;
    private readonly after: THREE.Mesh;
    private shown = '';

    constructor(trials: readonly TimeTrial[], kit: Kit = FULL_KIT) {
        this.group.name
 = 'time-trials';
        const checks = new THREE.Mesh(checkerGeometry(trials), kit.lit({ map: checkerTexture(), roughness: 0.8 }));
        checks.name = 'trial-checks';
        checks.receiveShadow = true;
        this.group.add(checks);
        for (const t of trials) {
            const p = t.pad;
            const mat = kit.flat({ color: PAD_IDLE.getHex() }) as THREE.Material & { color: THREE.Color };
            const geo = new THREE.PlaneGeometry(2 * p.half - 0.1, 2 * p.half - 0.1);
            geo.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(p.x, p.y + 0.005, p.z);
            mesh.name = `trial-pad:${t.id}`;
            this.group.add(mesh);
            this.pads.push({ mesh, mat });
        }
        this.outlines = trials.map((t) => t.gates.map(outlineGeometry));
        const mk = (color: number, through: boolean): THREE.Mesh => {
            const mat = kit.flat({ color });
            if (through) {
                // seen through walls, faintly: drawn last, over everything
                mat.transparent = true;
                mat.opacity = 0.3;
                mat.depthTest = false;
                mat.depthWrite = false;
            }
            const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
            m.visible = false;
            m.frustumCulled = false;
            if (through) m.renderOrder = 10;
            this.group.add(m);
            return m;
        };
        this.next = mk(NEXT, false);
        this.ghost = mk(NEXT, true);
        this.after = mk(AFTER, false);
    }

    /** Show the time trials as they stand (null: none, as in the replay viewer). `t` is the page's clock, s. */
    update(st: TrialStatus | null, t: number): void {
        this.pads.forEach((p, c) => {
            let k = 0;
            if (st && st.course === c) {
                if (st.phase === 'free' || st.phase === 'asking') k = st.hold;
                // during the countdown it pulses once a second; while racing it stays lit as the finish
                else if (st.phase === 'countdown') k = 0.6 + 0.4 * Math.cos(t * 2 * Math.PI);
                else k = 0.5;
            }
            p.mat.color.copy(PAD_IDLE).lerp(PAD_FULL, k * k);
        });
        const racing = st !== null && (st.phase === 'racing' || st.phase === 'countdown') && st.course >= 0;
        const gate = racing ? (st.phase === 'racing' ? st.gate : 0) : -1;
        const key = racing ? `${st.course}:${gate}` : '';
        if (key === this.shown) return;
        this.shown = key;
        const set = (m: THREE.Mesh, g: THREE.BufferGeometry | undefined): void => {
            m.visible = g !== undefined;
            if (g) m.geometry = g;
        };
        const gs = racing ? this.outlines[st.course] : [];
        set(this.next, gs[gate]);
        set(this.ghost, gs[gate]);
        set(this.after, gs[gate + 1]);
    }
}
