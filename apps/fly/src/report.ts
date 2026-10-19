// Bug reports and suggestions (owner, 2026-10-18): the menu's Report button opens GitHub's new-issue page with a title
// and a body filled in from here, and the pilot reads it and submits it there (nothing is sent from the game). The body
// has the pilot's words, then the game's state at the moment of the report (build, browser, renderer, radio, settings,
// where the quad was), so an issue can be matched to the code and replayed: the saved flight of the visit (Esc >
// Flights > Download) replays it exactly. No DOM here, so the tests build reports in Node.

import type { EngineReport } from './engine/protocol';
import { TRAIN_VERSION } from '@owfpv/traffic';

export type ReportKind = 'bug' | 'suggestion';

export interface ReportText {
    kind: ReportKind;
    title: string;
    /** bug: what happened; suggestion: the idea */
    what: string;
    /** bug: the steps to make it happen; suggestion: why it would help */
    steps: string;
    /** bug: what was expected instead (unused for a suggestion) */
    expected: string;
}

/** What the page knows for a report. */
export interface PageReport {
    build: { commit: string; date: string };
    url: string;
    userAgent: string;
    /** CSS pixels and device pixel ratio */
    screen: string;
    /** the GPU the browser names (WebGL's unmasked renderer), when it says */
    gpu: string | null;
    fps: number | null;
    engineWhere: string;
    /** the radio or gamepad in use, its report rate and stick mode, or what the pilot flies with instead */
    input: string;
    /** the pilot's settings (settings.ts), as kept in this browser */
    settings: object;
    /** this visit's saved flight id (flights.ts), when there is one to attach */
    savedFlight: number | null;
    /** seconds since the page loaded */
    uptimeS: number;
    /** the last errors and warnings the page logged */
    errors: string[];
}

/** GitHub answers a new-issue link longer than about 8 kB with an error page: stay well under it. */
export const MAX_URL = 7500;

const LABEL: Record<ReportKind, string> = { bug: 'bug', suggestion: 'enhancement' };
const PREFIX: Record<ReportKind, string> = { bug: '[Bug]', suggestion: '[Suggestion]' };

/** A table cell: one line, no column breaks. */
const cell = (v: unknown): string => String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const or = (s: string): string => (s.trim() ? s.trim() : '_Not given._');
const fixed = (v: readonly number[], d = 1): string => v.map((x) => x.toFixed(d)).join(', ');

export function issueTitle(t: ReportText): string {
    const title = t.title.trim().replace(/\s+/g, ' ') || (t.kind === 'bug' ? 'Something went wrong' : 'An idea');
    return `${PREFIX[t.kind]} ${title}`;
}

/** The game's state as a Markdown table (and blocks), folded away under a summary line. */
export function detailsBlock(page: PageReport | null, engine: EngineReport | null, parts: { settings: boolean; errors: boolean } = { settings: true, errors: true }): string {
    const rows: [string, string][] = [];
    if (page) {
        rows.push(
            ['Build', `${page.build.commit} (${page.build.date})`],
            ['Page', page.url],
            ['Browser', page.userAgent],
            ['Screen', page.screen],
            ['GPU', page.gpu ?? 'not reported by the browser'],
            ['Input', page.input]
        );
    }
    if (engine) {
        const speed = Math.hypot(...engine.vel) * 3.6;
        const traffic = [engine.traffic.cars && 'cars', engine.traffic.people && 'people', engine.traffic.signals && 'signals', engine.traffic.train && 'train'].filter(Boolean).join(', ') || 'off';
        rows.push(
            ['Renderer', `${engine.renderer}${page ? `, ${page.engineWhere}` : ''}${page?.fps != null ? `, ${Math.round(page.fps)} fps` : ''}, ${engine.drawCalls} draws, ${engine.triangles} triangles`],
            ['Map', `${engine.mapId} v${engine.mapVersion}, spawn ${engine.spawn}, traffic ${traffic} (traffic v${engine.trafficVersion}${engine.traffic.train ? `, train v${TRAIN_VERSION}` : ''})`],
            ['Flight', `${engine.simCore}, tick ${engine.tick} (${(engine.tick / 1000).toFixed(1)} s), life ${engine.lives}, hitches ${engine.hitches}${engine.paused ? ', paused' : ''}`],
            ['Quad', `${engine.armed ? 'armed' : 'disarmed'}${engine.crashed ? ', crashed' : ''}; at ${fixed(engine.pos)} m; ${speed.toFixed(0)} km/h (${fixed(engine.vel)} m/s); roll ${engine.roll}°, pitch ${engine.pitch}°, yaw ${engine.yaw}°`],
            ['Camera', `${engine.freeCam ? 'free camera' : engine.view.toUpperCase()}${engine.replayTick !== null ? `, replay viewer at tick ${engine.replayTick}` : ''}`]
        );
    }
    if (page) {
        rows.push(
            ['Saved flight', page.savedFlight !== null ? `${page.savedFlight} (Esc > Flight replay > Download, then attach the file here)` : 'none this visit'],
            ['Uptime', `${Math.round(page.uptimeS)} s`]
        );
    }
    if (!rows.length) return '';
    const out = [
        '<details><summary>Game state when reported (filled in by the game)</summary>',
        '',
        '| | |',
        '|---|---|',
        ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)
    ];
    if (page && parts.settings) out.push('', 'Settings:', '', '```json', JSON.stringify(page.settings), '```');
    if (engine && parts.settings) out.push('', 'Flight model overrides:', '', '```json', JSON.stringify(engine.overrides), '```');
    if (page && parts.errors && page.errors.length) out.push('', 'Recent errors and warnings:', '', '```', ...page.errors, '```');
    out.push('', '</details>');
    return out.join('\n');
}

export function reportBody(t: ReportText, details: string): string {
    const sections = t.kind === 'bug'
        ? [['What happened', t.what], ['Steps to make it happen', t.steps], ['What I expected', t.expected]]
        : [['The idea', t.what], ['Why it would help', t.steps]];
    const body = sections.map(([h, v]) => `### ${h}\n\n${or(v)}`).join('\n\n');
    return details ? `${body}\n\n### Game details\n\n${details}\n` : `${body}\n`;
}

function link(repo: string, t: ReportText, body: string): string {
    const q = new URLSearchParams({ title: issueTitle(t), body, labels: LABEL[t.kind] });
    return `${repo}/issues/new?${q.toString()}`;
}

export interface Issue {
    url: string;
    /** the whole report, for the clipboard (the link may carry a shortened one) */
    body: string;
    /** what was left out of the link to fit it, if anything */
    cut: string | null;
}

/**
 * The new-issue link for a report. When it would be too long for GitHub, the settings, then the errors, then the end
 * of the pilot's text are left out of the link (`cut` says which); the full report is in `body` for the clipboard.
 */
export function newIssue(repo: string, t: ReportText, page: PageReport | null, engine: EngineReport | null): Issue {
    const body = reportBody(t, detailsBlock(page, engine));
    let url = link(repo, t, body);
    if (url.length <= MAX_URL) return { url, body, cut: null };
    url = link(repo, t, reportBody(t, detailsBlock(page, engine, { settings: false, errors: true })));
    if (url.length <= MAX_URL) return { url, body, cut: 'the settings' };
    const lean = detailsBlock(page, engine, { settings: false, errors: false });
    url = link(repo, t, reportBody(t, lean));
    if (url.length <= MAX_URL) return { url, body, cut: 'the settings and errors' };
    // the pilot wrote a lot: shorten each text field, longest first, until it fits
    const short = { ...t };
    const note = ' … (cut to fit; the full report was copied: paste it below)';
    for (let keep = 2000; keep >= 100; keep = Math.floor(keep * 0.7)) {
        for (const k of ['what', 'steps', 'expected'] as const) if (t[k].length > keep) short[k] = t[k].slice(0, keep) + note;
        url = link(repo, short, reportBody(short, lean));
        if (url.length <= MAX_URL) break;
    }
    return { url, body, cut: 'part of the text, the settings and errors' };
}

/** Keeps the last few errors and warnings the page logs (console.error, console.warn, uncaught errors), for reports. */
export class ErrorLog {
    readonly lines: string[] = [];
    constructor(private readonly keep = 12) {}

    add(kind: string, parts: readonly unknown[]): void {
        const text = parts.map((p) => (p instanceof Error ? `${p.name}: ${p.message}` : typeof p === 'string' ? p : safeJson(p))).join(' ');
        this.lines.push(`${kind}: ${text}`.slice(0, 300));
        if (this.lines.length > this.keep) this.lines.shift();
    }
}

function safeJson(v: unknown): string {
    try {
        return JSON.stringify(v) ?? String(v);
    } catch {
        return String(v);
    }
}
