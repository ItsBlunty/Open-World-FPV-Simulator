// Course files (owner, 2026-10-20: a time trial creator; courses as files, made by hand or by Claude): the game's own
// courses read back exactly as they were built before they were files (the map's pinned hash is unchanged:
// first-map.test.ts), a file round-trips, the checks catch a broken or hostile file, and a race gate frames its opening.

import { describe, expect, it } from 'vitest';
import { MeshContactWorld } from '@owfpv/world-mesh';
import {
    COURSE_FILES, COURSE_FORMAT, RACE_GATE, buildFirstMap, courseFromFile, courseProblem, courseSolids, courseToFile,
    customArches, padTop, raceGateBoxes
} from '../src/index';
import type { CourseFile, Gate } from '../src/index';

const level = buildFirstMap();

const sample = (): CourseFile => ({
    format: COURSE_FORMAT, id: 'my-course_1', name: 'My course', area: 'Park', version: 1, map: level.id,
    pad: { x: 20, z: 60, y: padTop(0), yawDeg: 90 },
    gates: [
        { name: 'A race gate', x: 30, y: 1.6, z: 60, nx: 1, ny: 0, nz: 0, hw: RACE_GATE.defaultHalf, hh: RACE_GATE.defaultHalf, kind: 'gate', foot: 0 },
        { name: 'A hole', x: 40, y: 5, z: 60, nx: 0, ny: 1, nz: 0, hw: 2, hh: 2, kind: 'open' }
    ]
});

describe('course files', () => {
    it('the game\'s own courses are valid files for this map, in order, ending at their arch', () => {
        expect(COURSE_FILES.map((f) => f.id)).toEqual(['park', 'bando', 'yard']);
        for (const f of COURSE_FILES) expect(courseProblem(f, level.id)).toBeNull();
        expect(level.trials.map((t) => t.gates.length)).toEqual([6, 8, 8]);
        expect(level.trials.every((t) => t.gates[t.gates.length - 1].name === 'Back through the start arch')).toBe(true);
    });

    it('a course round-trips through its file', () => {
        for (const f of [...COURSE_FILES, sample()]) {
            const back = courseToFile(courseFromFile(f), f.map, { notes: f.notes });
            expect(back).toEqual({ ...f, gates: f.gates.map((g) => ({ ...g, kind: g.kind ?? 'open' })) });
        }
    });

    it('catches broken and hostile files', () => {
        const bad = (edit: (f: CourseFile) => void): string | null => {
            const f = sample();
            edit(f);
            return courseProblem(f, level.id);
        };
        expect(courseProblem(sample(), level.id)).toBeNull();
        expect(courseProblem('nope')).toMatch(/not a course/);
        expect(bad((f) => { (f as { format: string }).format = 'x'; })).toMatch(/not a course file/);
        expect(bad((f) => { f.id = '../evil'; })).toMatch(/id/);
        expect(bad((f) => { f.map = 'other'; })).toMatch(/map other/);
        expect(bad((f) => { f.pad.yawDeg = 45; })).toMatch(/yawDeg/);
        expect(bad((f) => { f.gates = []; })).toMatch(/at least one gate/);
        expect(bad((f) => { f.gates[0].hw = 500; })).toMatch(/half sizes/);
        expect(bad((f) => { f.gates[0].nx = 0.5; })).toMatch(/unit vector/);
        expect(bad((f) => { Object.assign(f.gates[0], { nx: 0.6, ny: 0.8 }); })).toMatch(/stand .* or lie flat/);
        expect(bad((f) => { f.gates[0].x = Number.NaN; })).toMatch(/x, y and z/);
        expect(bad((f) => { (f.gates[0] as { kind: string }).kind = 'wall'; })).toMatch(/kind/);
        expect(bad((f) => { f.gates[0].foot = 10; })).toMatch(/foot/);
        expect(bad((f) => { f.name = ''; })).toMatch(/name/);
    });
});

describe('the solids of custom courses and race gates', () => {
    it('a race gate frames its opening: the middle is clear, the bars are solid, its legs reach the ground', () => {
        const t = courseFromFile(sample(), true);
        const s = courseSolids([...level.trials, t]);
        // the map's own courses have no race gates; the custom one's pad and arch are solid always
        expect(s.race.slice(0, 3)).toEqual([null, null, null]);
        expect(s.always).not.toBeNull();
        const race = new MeshContactWorld(s.race[3]!);
        const g = t.gates[0];
        const o = { x: 0, y: 0, z: 0 };
        expect(race.querySphere(g.x, g.y, g.z, 0.5, o)).toBe(false);
        expect(race.querySphere(g.x, g.y + g.hh + RACE_GATE.bar / 2, g.z, 0.05, o)).toBe(true);
        expect(race.querySphere(g.x, 0.1, g.z + g.hw + RACE_GATE.bar / 2, 0.05, o)).toBe(true);
        const always = new MeshContactWorld(s.always!);
        expect(always.querySphere(20, 0.23, 60, 0.05, o)).toBe(true);
        expect(customArches([t]).collision.length).toBe(s.always!.length);
    });

    it('a flat race gate has no legs, and a standing one none when its bottom sits on its foot', () => {
        const flat: Gate = { x: 0, y: 3, z: 0, nx: 0, ny: 1, nz: 0, hw: 1, hh: 1, name: 'f', kind: 'gate', foot: 0 };
        expect(raceGateBoxes(flat)).toHaveLength(4);
        const low: Gate = { x: 0, y: 1 + RACE_GATE.bar, z: 0, nx: 1, ny: 0, nz: 0, hw: 1, hh: 1, name: 'l', kind: 'gate', foot: 0 };
        expect(raceGateBoxes(low)).toHaveLength(4);
        expect(raceGateBoxes({ ...low, y: 3 })).toHaveLength(6);
    });
});
