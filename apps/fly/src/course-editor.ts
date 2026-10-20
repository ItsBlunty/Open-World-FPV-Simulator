// The time trial creator's editing (owner, 2026-10-20): a course being made, changed from the free camera. Gates go where
// the camera's crosshair point is (`reach` m ahead of it), facing the way it looks: standing when it looks roughly
// level, lying flat (a hole in a floor, a gap between wires) when it looks steeply up or down. The pad goes on the
// ground under that point, its arch across the heading (to the nearest 90 deg). No DOM and no Three.js: the engine
// hands in the camera, the Node tests check the same code.

import { RACE_GATE, padTop } from '@owfpv/maps';
import type { CourseFile, CourseGateFile, GateKind } from '@owfpv/maps';

/** The camera as the editor needs it: where it is, its heading (three.js yaw: 0 looks along -z, + turns left) and pitch, rad. */
export interface EditorCam {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
}

/** The first surface straight down from (x, y, z): its height, or null when there is none. */
export type GroundRay = (x: number, y: number, z: number) => number | null;

export type EditorOp =
    /** a new gate at the crosshair point, after the selected one */
    | { op: 'add'; kind: GateKind }
    /** the pad on the ground under the crosshair point, its arch across the camera's heading */
    | { op: 'pad' }
    /** the selected gate (or the pad) to the crosshair point, facing the way the camera looks */
    | { op: 'here' }
    /** -1: the pad; 0 up: a gate */
    | { op: 'select'; i: number }
    | { op: 'delete' }
    /** the selected gate earlier (-1) or later (1) in the course */
    | { op: 'order'; d: -1 | 1 }
    /** move the selected gate, m: forward and right along the camera's heading, and up */
    | { op: 'nudge'; f: number; r: number; u: number }
    /** turn the selected gate (or the pad, by 90) about the vertical, deg */
    | { op: 'turn'; deg: number }
    /** grow (or shrink) the selected gate's width and height, m */
    | { op: 'size'; dw: number; dh: number }
    /** gate i's fields from the panel; w and h are full sizes, m */
    | { op: 'set'; i: number; name?: string; kind?: GateKind; w?: number; h?: number; flat?: boolean }
    | { op: 'meta'; name?: string; area?: string; author?: string }
    /** how far ahead of the camera the crosshair point is, m */
    | { op: 'reach'; m: number };

/** The crosshair point's distance, m: from REACH_MIN to REACH_MAX, 4 m to start [chosen: a window fills the view from there]. */
export const REACH = { min: 1, max: 40, start: 4 } as const;
/** Looking more than this far up or down places a flat gate, rad (50 deg). */
const FLAT_PITCH = (50 * Math.PI) / 180;
/** A new open gate: 3 m by 2 m [chosen: a little bigger than the bando's 2.3 x 1.6 m window gates]. */
const OPEN_HALF = { w: 1.5, h: 1.0 };
/** A gate's half size limits, m (maps COURSE_LIMITS.half is 30) */
const HALF_MIN = 0.15, HALF_MAX = 15;

/** rounded to d decimals (mm for places), never -0 (a file writes it as 0, so it would not read back the same) */
const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d || 0;

export class CourseEditor {
    course: CourseFile;
    /** the pad has been placed (a new course has none until then) */
    hasPad: boolean;
    /** -1: the pad; 0 up: that gate */
    selected = -1;
    reach: number = REACH.start;
    /** bumped on every change, so the view knows to redraw */
    rev = 0;

    constructor(course: CourseFile, hasPad: boolean, private readonly ground: GroundRay) {
        this.course = JSON.parse(JSON.stringify(course)) as CourseFile;
        this.hasPad = hasPad;
        this.selected = this.course.gates.length ? 0 : -1;
    }

    /** The crosshair point and the camera's look direction. */
    target(cam: EditorCam): { x: number; y: number; z: number; fx: number; fy: number; fz: number } {
        const c = Math.cos(cam.pitch);
        const fx = -Math.sin(cam.yaw) * c, fy = Math.sin(cam.pitch), fz = -Math.cos(cam.yaw) * c;
        return { x: cam.x + fx * this.reach, y: cam.y + fy * this.reach, z: cam.z + fz * this.reach, fx, fy, fz };
    }

    /** Would a gate placed now lie flat? */
    flatNow(cam: EditorCam): boolean {
        return Math.abs(cam.pitch) > FLAT_PITCH;
    }

    /** What is wrong with the course for saving, or null. */
    problem(): string | null {
        if (!this.hasPad) return 'Place the start pad (P): the race starts and ends there.';
        if (!this.course.gates.length) return 'Add at least one gate (G, or B for a race gate).';
        if (!this.course.name.trim()) return 'Give the course a name.';
        return null;
    }

    apply(o: EditorOp, cam: EditorCam): void {
        const gates = this.course.gates;
        const sel = this.selected >= 0 ? gates[this.selected] : undefined;
        switch (o.op) {
            case 'add': {
                const n = gates.length + 1;
                const race = o.kind === 'gate';
                const g: CourseGateFile = {
                    name: race ? `Race gate ${n}` : `Gate ${n}`, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1,
                    hw: race ? RACE_GATE.defaultHalf : OPEN_HALF.w, hh: race ? RACE_GATE.defaultHalf : OPEN_HALF.h, kind: o.kind
                };
                this.placeGate(g, cam);
                gates.splice(this.selected + 1, 0, g);
                this.selected++;
                break;
            }
            case 'pad':
                this.placePad(cam);
                this.selected = -1;
                break;
            case 'here':
                if (sel) this.placeGate(sel, cam);
                else this.placePad(cam);
                break;
            case 'select':
                this.selected = Math.max(-1, Math.min(gates.length - 1, Math.round(o.i)));
                break;
            case 'delete':
                if (!sel) return;
                gates.splice(this.selected, 1);
                this.selected = Math.min(this.selected, gates.length - 1);
                break;
            case 'order': {
                const j = this.selected + o.d;
                if (!sel || j < 0 || j >= gates.length) return;
                [gates[this.selected], gates[j]] = [gates[j], gates[this.selected]];
                this.selected = j;
                break;
            }
            case 'nudge': {
                const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
                const dx = fx * o.f - fz * o.r, dz = fz * o.f + fx * o.r;
                if (sel) {
                    sel.x = round(sel.x + dx);
                    sel.y = round(sel.y + o.u);
                    sel.z = round(sel.z + dz);
                    this.footOf(sel);
                } else if (this.hasPad) {
                    const p = this.course.pad;
                    p.x = round(p.x + dx);
                    p.z = round(p.z + dz);
                    p.y = round(padTop(this.ground(p.x, p.y + 2, p.z) ?? 0));
                }
                break;
            }
            case 'turn':
                if (sel) {
                    if (Math.abs(sel.ny) > 0.5) return;
                    const a = (o.deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
                    // positive turns right (clockwise seen from above), as a heading does
                    const nx = sel.nx * c - sel.nz * s, nz = sel.nx * s + sel.nz * c;
                    const l = Math.hypot(nx, nz);
                    sel.nx = round(nx / l, 6);
                    sel.nz = round(nz / l, 6);
                } else if (this.hasPad) {
                    const p = this.course.pad;
                    p.yawDeg = (((p.yawDeg + (o.deg >= 0 ? 90 : -90)) % 360) + 360) % 360;
                }
                break;
            case 'size':
                if (!sel) return;
                sel.hw = clampHalf(sel.hw + o.dw / 2);
                sel.hh = clampHalf(sel.hh + o.dh / 2);
                this.footOf(sel);
                break;
            case 'set': {
                const g = gates[o.i];
                if (!g) return;
                if (o.name !== undefined) g.name = o.name.slice(0, 80) || g.name;
                if (o.kind !== undefined) g.kind = o.kind;
                if (o.w !== undefined && Number.isFinite(o.w)) g.hw = clampHalf(o.w / 2);
                if (o.h !== undefined && Number.isFinite(o.h)) g.hh = clampHalf(o.h / 2);
                if (o.flat !== undefined && o.flat !== Math.abs(g.ny) > 0.5) {
                    if (o.flat) Object.assign(g, { nx: 0, ny: 1, nz: 0 });
                    else {
                        const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
                        Object.assign(g, { nx: round(fx, 6), ny: 0, nz: round(fz, 6) });
                    }
                }
                this.footOf(g);
                break;
            }
            case 'meta':
                if (o.name !== undefined) this.course.name = o.name.slice(0, 80);
                if (o.area !== undefined) this.course.area = o.area.slice(0, 80) || 'Custom';
                if (o.author !== undefined) {
                    if (o.author.trim()) this.course.author = o.author.slice(0, 80);
                    else delete this.course.author;
                }
                break;
            case 'reach':
                this.reach = Math.max(REACH.min, Math.min(REACH.max, o.m));
                return;
        }
        this.rev++;
    }

    private placeGate(g: CourseGateFile, cam: EditorCam): void {
        const t = this.target(cam);
        g.x = round(t.x);
        g.y = round(t.y);
        g.z = round(t.z);
        if (this.flatNow(cam)) Object.assign(g, { nx: 0, ny: 1, nz: 0 });
        else {
            const l = Math.hypot(t.fx, t.fz);
            Object.assign(g, { nx: round(t.fx / l, 6), ny: 0, nz: round(t.fz / l, 6) });
        }
        this.footOf(g);
    }

    /** A race gate's legs reach the first surface under its bottom bar; an open gate has none. */
    private footOf(g: CourseGateFile): void {
        if (g.kind !== 'gate' || Math.abs(g.ny) > 0.5) {
            delete g.foot;
            return;
        }
        const below = this.ground(g.x, g.y - g.hh - RACE_GATE.bar - 0.01, g.z);
        if (below === null) delete g.foot;
        else g.foot = round(Math.min(below, g.y - g.hh - RACE_GATE.bar));
    }

    private placePad(cam: EditorCam): void {
        const t = this.target(cam);
        const ground = this.ground(t.x, Math.max(t.y, cam.y) + 0.5, t.z) ?? 0;
        // three.js yaw turns left; a heading turns right, from north (-z)
        const heading = (-cam.yaw * 180) / Math.PI;
        this.course.pad = { x: round(t.x), z: round(t.z), y: round(padTop(ground)), yawDeg: ((Math.round(heading / 90) * 90) % 360 + 360) % 360 };
        this.hasPad = true;
    }
}

function clampHalf(v: number): number {
    return round(Math.max(HALF_MIN, Math.min(HALF_MAX, v)));
}
