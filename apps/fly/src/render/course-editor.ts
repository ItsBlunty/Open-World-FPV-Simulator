// The time trial creator drawn (owner, 2026-10-20): the course being made, with every gate's number over it, the
// selected one in yellow, the course's order as a line from the pad through the gates and back to the arch, the
// pad and its arch, and where the next gate would go (a white frame at the crosshair point). Seen through walls
// faintly, so a gate inside a building can still be found. The flown line: where the quad went while flying in the
// creator, coloured by speed like the replay's path, so gates can be put on it. Drawing only.

import * as THREE from 'three/webgpu';
import { courseFromFile, customArches, gateAxes } from '@owfpv/maps';
import type { CourseFile, Gate } from '@owfpv/maps';
import { levelGroup } from './world';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';
import { RACE_GATE_COLOR, frameGeometry, paneGeometry, raceGateGeometry, textGeometry } from './trials';

const SELECTED = 0xffe066;
const OTHER = 0xff8a00;
const PREVIEW = 0xffffff;
const ORDER = 0x46d7ff;
/** the flown line: hue from blue (slow) to red at this speed, m/s, as the replay's path (replay-view.ts) */
const RED_AT = 30;
/** the flown line's points: one every this many ms of flying, and at most this many (40 min) */
const LINE_EVERY_MS = 50;
const LINE_MAX = 48000;

/** Seen through walls: drawn last, over everything, faint. */
function through(m: THREE.Material, opacity: number): THREE.Material {
    m.transparent = true;
    m.opacity = opacity;
    m.depthTest = false;
    m.depthWrite = false;
    return m;
}

export class EditorView {
    readonly group = new THREE.Group();
    private readonly built = new THREE.Group();
    private readonly preview: THREE.Mesh;
    private readonly labels: THREE.Mesh[] = [];
    private rev = -1;
    private readonly mats: { sel: THREE.Material; other: THREE.Material; ghost: THREE.Material; pane: THREE.Material; race: THREE.Material; label: THREE.Material; order: THREE.Material };

    constructor(private readonly kit: Kit = FULL_KIT) {
        this.group.name = 'course-editor';
        this.group.add(this.built);
        const pane = kit.flat({ color: SELECTED });
        pane.transparent = true;
        pane.opacity = 0.18;
        pane.depthWrite = false;
        pane.side = THREE.DoubleSide;
        this.mats = {
            sel: kit.flat({ color: SELECTED }),
            other: kit.flat({ color: OTHER }),
            ghost: through(kit.flat({ color: OTHER }), 0.3),
            pane,
            race: kit.lit({ color: RACE_GATE_COLOR, roughness: 0.7 }),
            label: kit.lit({ color: 0xffd84a, emissive: 0x8a6200, roughness: 0.6 }),
            order: through(kit.lines(), 0.8)
        };
        this.preview = new THREE.Mesh(new THREE.BufferGeometry(), through(kit.flat({ color: PREVIEW }), 0.7));
        this.preview.frustumCulled = false;
        this.preview.renderOrder = 12;
        this.group.add(this.preview);
    }

    /**
     * Draw `course` (rebuilt when `rev` changes); `selected` -1 is the pad. `next`: where a gate placed now would go
     * (null: none, as while flying). `eye`: the camera, which the numbers turn to face.
     */
    update(course: CourseFile, hasPad: boolean, selected: number, rev: number, next: Gate | null, eye: THREE.Vector3): void {
        if (rev !== this.rev) {
            this.rev = rev;
            this.rebuild(course, hasPad, selected);
        }
        for (const l of this.labels) l.rotation.y = Math.atan2(eye.x - l.position.x, eye.z - l.position.z);
        this.preview.visible = next !== null;
        if (next) {
            this.preview.geometry.dispose();
            this.preview.geometry = frameGeometry(next, 0.04);
        }
    }

    private rebuild(course: CourseFile, hasPad: boolean, selected: number): void {
        for (const o of [...this.built.children]) {
            this.built.remove(o);
            o.traverse((x) => { if (x instanceof THREE.Mesh || x instanceof THREE.Line) x.geometry.dispose(); });
        }
        this.labels.length = 0;
        const add = (geo: THREE.BufferGeometry, mat: THREE.Material, order = 0): THREE.Mesh => {
            const m = new THREE.Mesh(geo, mat);
            m.renderOrder = order;
            this.built.add(m);
            return m;
        };
        const gates = course.gates.length ? courseFromFile({ ...course, gates: course.gates }).gates.slice(0, -1) : [];
        gates.forEach((g, i) => {
            const sel = i === selected;
            if (g.kind === 'gate') {
                const geo = raceGateGeometry([g]);
                if (geo) add(geo, this.mats.race);
            }
            add(frameGeometry(g, sel ? 0.12 : 0.05), sel ? this.mats.sel : this.mats.other);
            add(frameGeometry(g, 0.05), this.mats.ghost, 10);
            if (sel) add(paneGeometry(g), this.mats.pane, 5);
            const label = add(textGeometry(String(i + 1), sel ? 0.8 : 0.6), sel ? this.mats.sel : this.mats.label);
            const { v } = gateAxes(g);
            // over a standing gate's top, or 1.2 m over a flat one
            label.position.set(g.x + v[0] * (g.hh + 0.7), g.y + (Math.abs(g.ny) > 0.5 ? 1.2 : g.hh + 0.7), g.z + v[2] * (g.hh + 0.7));
            this.labels.push(label);
        });
        if (hasPad) {
            const t = courseFromFile({ ...course, gates: course.gates.length ? course.gates : [{ name: 'x', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, hw: 1, hh: 1 }] }, true);
            const arch = levelGroup(customArches([t]), this.kit);
            this.built.add(arch);
            const p = t.pad;
            const padSel = selected === -1;
            const ring = new THREE.PlaneGeometry(2 * p.half, 2 * p.half);
            ring.rotateX(-Math.PI / 2);
            ring.translate(p.x, p.y + 0.01, p.z);
            add(ring, padSel ? this.mats.pane : this.mats.ghost, 5);
            const label = add(textGeometry('P', padSel ? 0.8 : 0.6), padSel ? this.mats.sel : this.mats.label);
            label.position.set(p.x, p.y + 5, p.z);
            this.labels.push(label);
            // the order: from the pad, through each gate, back through the arch
            const pts = [new THREE.Vector3(p.x, p.y + 1.5, p.z), ...gates.map((g) => new THREE.Vector3(g.x, g.y, g.z)), new THREE.Vector3(p.x, p.y + 1.5, p.z)];
            this.orderLine(pts);
        } else if (gates.length > 1) this.orderLine(gates.map((g) => new THREE.Vector3(g.x, g.y, g.z)));
    }

    /** The course's order as a line through `pts` (the kit's per-vertex-coloured lines, all one colour). */
    private orderLine(pts: THREE.Vector3[]): void {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const c = new THREE.Color(ORDER);
        geo.setAttribute('color', new THREE.Float32BufferAttribute(pts.flatMap(() => [c.r, c.g, c.b]), 3));
        const line = new THREE.Line(geo, this.mats.order);
        line.renderOrder = 11;
        line.frustumCulled = false;
        this.built.add(line);
    }

    dispose(): void {
        this.rebuild({ ...EMPTY }, false, -1);
        this.preview.geometry.dispose();
    }
}

const EMPTY: CourseFile = { format: 'owfpv-course/1', id: 'x', name: 'x', area: 'x', version: 1, map: 'x', pad: { x: 0, z: 0, y: 0, yawDeg: 0 }, gates: [] };

/** Where the quad went while flying in the creator: a line coloured by speed, grown as it flies. */
export class FlownLine {
    readonly line: THREE.LineSegments;
    private readonly pos = new Float32Array(LINE_MAX * 6);
    private readonly col = new Float32Array(LINE_MAX * 6);
    private n = 0;
    private last: [number, number, number] | null = null;
    private lastT = -Infinity;
    private readonly c = new THREE.Color();

    constructor(kit: Kit = FULL_KIT) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
        g.setDrawRange(0, 0);
        this.line = new THREE.LineSegments(g, kit.lines());
        this.line.name = 'flown-line';
        this.line.frustumCulled = false;
    }

    /** The quad at (x, y, z) moving at `speed` m/s at page time `ms`; `jump`: it was respawned (no segment to here). */
    add(x: number, y: number, z: number, speed: number, ms: number, jump: boolean): void {
        if (ms - this.lastT < LINE_EVERY_MS) return;
        this.lastT = ms;
        const a = this.last;
        this.last = [x, y, z];
        if (!a || jump || this.n >= LINE_MAX) return;
        const k = this.n * 6;
        this.pos.set([a[0], a[1], a[2], x, y, z], k);
        this.c.setHSL(0.62 * (1 - Math.min(1, speed / RED_AT)), 0.9, 0.55);
        this.col.set([this.c.r, this.c.g, this.c.b, this.c.r, this.c.g, this.c.b], k);
        this.n++;
        const g = this.line.geometry;
        (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
        g.setDrawRange(0, this.n * 2);
    }

    clear(): void {
        this.n = 0;
        this.last = null;
        this.line.geometry.setDrawRange(0, 0);
    }

    get segments(): number {
        return this.n;
    }
}
