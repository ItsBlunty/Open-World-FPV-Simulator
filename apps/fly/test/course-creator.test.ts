// The time trial creator (owner, 2026-10-20): gates placed at the camera's crosshair point facing the way it looks (flat
// when it looks steeply down), the pad on the ground under it with its arch square to the heading, edits that keep a
// valid course file; the browser store, course files and the propose-for-the-game link.

import { describe, expect, it } from 'vitest';
import { RACE_GATE, buildFirstMap, courseFromFile, courseProblem, padTop } from '@owfpv/maps';
import { CourseEditor, REACH } from '../src/course-editor';
import type { EditorCam } from '../src/course-editor';
import { blankCourse, courseFileName, courseText, newCourseId, parseCourses, proposeLink, putCourse, readCourseText, removeCourse } from '../src/course-store';

/** flat ground at 0 m, a 3 m roof over x 100-110 */
const ground = (x: number, y: number): number | null => (x >= 100 && x <= 110 && y >= 3 ? 3 : y >= 0 ? 0 : null);
const deg = Math.PI / 180;
/** standing at (x, 2, z), looking along heading h (deg: 0 north, 90 east), pitched p deg */
const cam = (x: number, z: number, h: number, p = 0): EditorCam => ({ x, y: 2, z, yaw: -h * deg, pitch: p * deg });
const fresh = (): CourseEditor => new CourseEditor(blankCourse('c1', 'mixed-1', 'Test', 'Park'), false, ground);

describe('the course editor', () => {
    it('needs a pad and a gate before it can be saved', () => {
        const e = fresh();
        expect(e.problem()).toMatch(/pad/);
        e.apply({ op: 'pad' }, cam(0, 0, 0));
        expect(e.problem()).toMatch(/gate/);
        e.apply({ op: 'add', kind: 'open' }, cam(0, -10, 0));
        expect(e.problem()).toBeNull();
        expect(courseProblem(e.course, 'mixed-1')).toBeNull();
    });

    it('puts a gate at the crosshair point facing the way the camera looks, and a flat one looking down', () => {
        const e = fresh();
        e.apply({ op: 'add', kind: 'open' }, cam(0, 0, 90));
        const g = e.course.gates[0];
        expect([g.x, g.y, g.z]).toEqual([REACH.start, 2, 0]);
        expect([g.nx, g.ny, g.nz]).toEqual([1, 0, 0]);
        e.apply({ op: 'reach', m: 10 }, cam(0, 0, 0));
        e.apply({ op: 'add', kind: 'open' }, cam(0, 0, 0, -70));
        const f = e.course.gates[1];
        expect([f.nx, f.ny, f.nz]).toEqual([0, 1, 0]);
        expect(f.y).toBeCloseTo(2 - 10 * Math.sin(70 * deg), 3);
        // added after the selected gate, which it becomes
        expect(e.selected).toBe(1);
    });

    it('stands a race gate on legs down to the ground, re-measured as it moves', () => {
        const e = fresh();
        e.apply({ op: 'add', kind: 'gate' }, cam(0, 0, 0));
        const g = e.course.gates[0];
        expect(g.hw).toBe(RACE_GATE.defaultHalf);
        expect(g.foot).toBe(0);
        e.apply({ op: 'nudge', f: 0, r: 0, u: 3 }, cam(0, 0, 0));
        expect(g.y).toBeCloseTo(5, 6);
        expect(g.foot).toBe(0);
        // over the roof (x 100-110): its legs reach the roof
        e.apply({ op: 'nudge', f: 0, r: 104, u: 0 }, cam(0, 0, 0));
        expect(g.x).toBeCloseTo(104, 6);
        expect(g.foot).toBe(3);
        e.apply({ op: 'set', i: 0, kind: 'open' }, cam(0, 0, 0));
        expect(g.foot).toBeUndefined();
    });

    it('places the pad on the ground under the crosshair, its heading to the nearest quarter turn', () => {
        const e = fresh();
        // under the roof at x 100-110 (the camera is 2 m up): the ground, not the roof
        e.apply({ op: 'pad' }, cam(102, -4, 100));
        expect(e.course.pad.x).toBeCloseTo(102 + REACH.start * Math.sin(100 * deg), 3);
        expect(e.course.pad.z).toBeCloseTo(-4 - REACH.start * Math.cos(100 * deg), 3);
        expect(e.course.pad.y).toBe(padTop(0));
        expect(e.course.pad.yawDeg).toBe(90);
        e.apply({ op: 'turn', deg: 15 }, cam(0, 0, 0));
        expect(e.course.pad.yawDeg).toBe(180);
        e.apply({ op: 'turn', deg: -15 }, cam(0, 0, 0));
        e.apply({ op: 'turn', deg: -15 }, cam(0, 0, 0));
        expect(e.course.pad.yawDeg).toBe(0);
    });

    it('turns, sizes, orders and deletes the selected gate, and keeps the file valid', () => {
        const e = fresh();
        e.apply({ op: 'pad' }, cam(0, 0, 0));
        e.apply({ op: 'add', kind: 'open' }, cam(0, -10, 0));
        e.apply({ op: 'add', kind: 'gate' }, cam(0, -20, 0));
        e.apply({ op: 'turn', deg: 90 }, cam(0, 0, 0));
        const g = e.course.gates[1];
        // facing north (0, 0, -1), a quarter turn right faces east
        expect(g.nx).toBeCloseTo(1, 6);
        expect(g.nz).toBeCloseTo(0, 6);
        e.apply({ op: 'size', dw: 1, dh: 0.4 }, cam(0, 0, 0));
        expect(g.hw).toBeCloseTo(RACE_GATE.defaultHalf + 0.5, 6);
        e.apply({ op: 'order', d: -1 }, cam(0, 0, 0));
        expect(e.course.gates[0]).toBe(g);
        expect(e.selected).toBe(0);
        e.apply({ op: 'set', i: 0, w: 200, h: 0.01, name: 'Big one', flat: true }, cam(0, 0, 0));
        expect([g.hw, g.hh, g.name, g.ny]).toEqual([15, 0.15, 'Big one', 1]);
        expect(courseProblem(e.course, 'mixed-1')).toBeNull();
        e.apply({ op: 'delete' }, cam(0, 0, 0));
        expect(e.course.gates.map((x) => x.name)).toEqual(['Gate 1']);
        e.apply({ op: 'meta', name: 'Renamed', area: '' }, cam(0, 0, 0));
        expect([e.course.name, e.course.area]).toEqual(['Renamed', 'Custom']);
    });
});

describe('the course store and files', () => {
    const level = buildFirstMap();
    const made = (): ReturnType<typeof blankCourse> => {
        const e = fresh();
        e.apply({ op: 'pad' }, cam(0, 60, 90));
        e.apply({ op: 'add', kind: 'gate' }, cam(10, 60, 90));
        return e.course;
    };

    it('keeps courses by map, raises the version when the layout changes, and drops broken ones on reading', () => {
        const store = parseCourses({ 'mixed-1': [made(), { junk: true }], other: 'nope' });
        expect(store['mixed-1'].map((c) => c.id)).toEqual(['c1']);
        const c = { ...made(), name: 'Renamed' };
        expect(putCourse(store, c).version).toBe(1);
        const moved = made();
        moved.gates[0].x += 1;
        expect(putCourse(store, moved).version).toBe(2);
        removeCourse(store, 'mixed-1', 'c1');
        expect(store['mixed-1']).toEqual([]);
        expect(newCourseId(1000, [])).toBe('crs');
        expect(newCourseId(1000, ['crs'])).toBe('crs-2');
    });

    it('a course file reads back as it was, and a file may not take one of the game\'s own ids', () => {
        const c = made();
        const r = readCourseText(courseText(c), level.id, level.trials.map((t) => t.id));
        expect(r).toEqual({ course: c });
        expect(readCourseText(courseText({ ...c, id: 'park' }), level.id, ['park'])).toEqual({ error: expect.stringMatching(/game's own/) });
        expect(readCourseText('{', level.id, [])).toEqual({ error: expect.stringMatching(/not JSON/) });
        expect(courseFileName({ ...c, name: 'Über Gap #1!' })).toBe('uber-gap-1.owfpv-course.json');
        // it flies: the arch is added as the last gate
        expect(courseFromFile(c, true).gates).toHaveLength(2);
    });

    it('proposes a course as a new file in packages/maps/courses, filled in, or empty when too long for a link', () => {
        const c = made();
        const p = proposeLink('https://github.com/o/r', c);
        expect(p.fits).toBe(true);
        const u = new URL(p.url);
        expect(u.pathname).toBe('/o/r/new/main');
        expect(u.searchParams.get('filename')).toBe('packages/maps/courses/c1.json');
        expect(JSON.parse(u.searchParams.get('value')!)).toEqual(c);
        const long = { ...c, notes: 'x'.repeat(3999), gates: Array.from({ length: 60 }, () => c.gates[0]) };
        const q = proposeLink('https://github.com/o/r', long);
        expect(q.fits).toBe(false);
        expect(new URL(q.url).searchParams.has('value')).toBe(false);
    });
});
