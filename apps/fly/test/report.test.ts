// Bug reports (report.ts): the issue's title and sections, the game state table, and a link GitHub accepts.

import { describe, expect, it } from 'vitest';
import { ErrorLog, MAX_URL, detailsBlock, issueTitle, newIssue, reportBody } from '../src/report';
import type { PageReport, ReportText } from '../src/report';
import type { EngineReport } from '../src/engine/protocol';

const REPO = 'https://github.com/ItsBlunty/Open-World-FPV-Simulator';

const page: PageReport = {
    build: { commit: 'abc1234', date: '2026-10-18' },
    url: 'https://itsblunty.github.io/Open-World-FPV-Simulator/?lowspec',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/155',
    screen: '1366 x 768 CSS px, 1x',
    gpu: 'ANGLE (Intel, Intel(R) HD Graphics 4000)',
    fps: 57.6,
    engineWhere: 'on the page',
    input: 'Radiomaster Boxer (USB HID), 500 Hz, stick mode 2',
    settings: { version: 1, lens: 'none', lowSpec: true, rates: null },
    savedFlight: 1760800000000,
    uptimeS: 312.4,
    errors: ['warn: something | odd']
};

const engine: EngineReport = {
    simCore: 'sim-core/0.6.0', mapId: 'mixed-1', mapVersion: 6, trafficVersion: 6, spawn: 'park',
    traffic: { cars: true, people: false, signals: true }, overrides: { crashOn: false },
    tick: 123456, lives: 3, hitches: 0, paused: true,
    pos: [12.34, 5.6, -78.9], vel: [10, 0, 0], roll: 5, pitch: -30, yaw: 90,
    armed: true, crashed: false, view: 'fpv', freeCam: false, replayTick: null,
    renderer: 'WebGL 2, low spec', lowSpec: true, drawCalls: 88, triangles: 127021
};

const bug: ReportText = { kind: 'bug', title: '  Fell through   the roof ', what: 'The quad went through the car park roof.', steps: '1. Start at Park.', expected: '' };

describe('bug reports', () => {
    it('titles say what kind of report they are', () => {
        expect(issueTitle(bug)).toBe('[Bug] Fell through the roof');
        expect(issueTitle({ ...bug, kind: 'suggestion', title: '' })).toBe('[Suggestion] An idea');
    });

    it('has the sections for its kind, and says when one was left empty', () => {
        const b = reportBody(bug, '');
        expect(b).toContain('### What happened\n\nThe quad went through the car park roof.');
        expect(b).toContain('### Steps to make it happen\n\n1. Start at Park.');
        expect(b).toContain('### What I expected\n\n_Not given._');
        const s = reportBody({ ...bug, kind: 'suggestion' }, '');
        expect(s).toContain('### The idea');
        expect(s).toContain('### Why it would help');
        expect(s).not.toContain('What I expected');
    });

    it('folds the game state into a table that can find and replay the problem', () => {
        const d = detailsBlock(page, engine);
        expect(d.startsWith('<details>')).toBe(true);
        expect(d).toContain('| Build | abc1234 (2026-10-18) |');
        expect(d).toContain('| GPU | ANGLE (Intel, Intel(R) HD Graphics 4000) |');
        expect(d).toContain('| Map | mixed-1 v6, spawn park, traffic cars, signals (traffic v6) |');
        expect(d).toContain('tick 123456 (123.5 s), life 3, hitches 0, paused');
        expect(d).toContain('armed; at 12.3, 5.6, -78.9 m; 36 km/h');
        expect(d).toContain('1760800000000 (Esc > Flights > Download');
        expect(d).toContain('WebGL 2, low spec, on the page, 58 fps, 88 draws, 127021 triangles');
        // the settings as JSON, and the errors as logged
        expect(d).toContain('```json\n{"version":1,"lens":"none","lowSpec":true,"rates":null}\n```');
        expect(d).toContain('warn: something | odd');
        expect(detailsBlock(null, null)).toBe('');
    });

    it('opens GitHub with the title, body and label filled in', () => {
        const issue = newIssue(REPO, bug, page, engine);
        expect(issue.cut).toBeNull();
        const u = new URL(issue.url);
        expect(u.origin + u.pathname).toBe(`${REPO}/issues/new`);
        expect(u.searchParams.get('title')).toBe('[Bug] Fell through the roof');
        expect(u.searchParams.get('labels')).toBe('bug');
        expect(u.searchParams.get('body')).toBe(issue.body);
        expect(new URL(newIssue(REPO, { ...bug, kind: 'suggestion' }, null, null).url).searchParams.get('labels')).toBe('enhancement');
    });

    it('keeps the link short enough for GitHub, and keeps the full report for the clipboard', () => {
        const long = { ...bug, what: 'x '.repeat(4000), steps: 'é'.repeat(3000) };
        const issue = newIssue(REPO, long, { ...page, errors: Array(12).fill('error: '.padEnd(300, 'e')) }, engine);
        expect(issue.url.length).toBeLessThanOrEqual(MAX_URL);
        expect(issue.cut).not.toBeNull();
        expect(issue.body).toContain(long.what.trim());
        const linked = new URL(issue.url).searchParams.get('body')!;
        expect(linked).toContain('| Build | abc1234');
        expect(linked).toContain('cut to fit');
        // a longer settings block alone is dropped first, the rest stays
        const big = newIssue(REPO, bug, { ...page, settings: { blob: 'z'.repeat(8000) } }, engine);
        expect(big.cut).toBe('the settings');
        expect(new URL(big.url).searchParams.get('body')).toContain('The quad went through');
    });

    it('remembers only the last few errors', () => {
        const log = new ErrorLog(3);
        for (let i = 0; i < 5; i++) log.add('error', [`e${i}`, new Error('boom'), { a: i }]);
        expect(log.lines).toEqual(['error: e2 Error: boom {"a":2}', 'error: e3 Error: boom {"a":3}', 'error: e4 Error: boom {"a":4}']);
    });
});
