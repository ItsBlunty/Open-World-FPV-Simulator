// The time trial times (owner, 2026-10-19: "you'll get shown your time, which is saved, compared to your old time if
// you have it, and all of the time trials will be logged in a Time Trials section"). Kept in this browser by map id,
// then by course id and version (a course whose gates change starts a fresh log). No DOM, so the Node tests check it.

/** One course's log. Times in ms. */
export interface CourseTimes {
    best: number;
    /** when the best was flown (Date.now(), ms) */
    bestAt: number;
    last: number;
    /** finished runs */
    runs: number;
    /** the last ten times, newest first */
    recent: number[];
}

export type TrialTimes = Record<string, Record<string, CourseTimes>>;

/** The key a course's times are kept under: its id and version. */
export const courseKey = (id: string, version: number): string => `${id}@${version}`;

const RECENT = 10;

/** A saved log read back: anything malformed is dropped (an old or hand-edited store must not break the page). */
export function parseTrialTimes(raw: unknown): TrialTimes {
    const out: TrialTimes = {};
    if (!raw || typeof raw !== 'object') return out;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    for (const [map, courses] of Object.entries(raw as Record<string, unknown>)) {
        if (!courses || typeof courses !== 'object') continue;
        for (const [key, t] of Object.entries(courses as Record<string, unknown>)) {
            const c = t as Partial<CourseTimes> | null;
            if (!c || !num(c.best) || !num(c.last) || !num(c.runs) || !num(c.bestAt)) continue;
            (out[map] ??= {})[key] = {
                best: c.best, bestAt: c.bestAt, last: c.last, runs: Math.floor(c.runs),
                recent: Array.isArray(c.recent) ? c.recent.filter(num).slice(0, RECENT) : [c.last]
            };
        }
    }
    return out;
}

/** What a finished run did against the log before it. */
export interface RunResult {
    ms: number;
    /** the best before this run (null: the first finished run of this course) */
    previous: number | null;
    /** a new best (the first run is one too) */
    best: boolean;
}

/** Log a finished run of `key` on map `map`, flown in `ms` at `now` (Date.now()). */
export function recordRun(times: TrialTimes, map: string, key: string, ms: number, now: number): RunResult {
    const courses = (times[map] ??= {});
    const c = courses[key];
    if (!c) {
        courses[key] = { best: ms, bestAt: now, last: ms, runs: 1, recent: [ms] };
        return { ms, previous: null, best: true };
    }
    const previous = c.best;
    c.last = ms;
    c.runs++;
    c.recent = [ms, ...c.recent].slice(0, RECENT);
    if (ms < c.best) {
        c.best = ms;
        c.bestAt = now;
    }
    return { ms, previous, best: ms < previous };
}

/** A time as a stopwatch shows it: 42.315 or 1:02.315. */
export function formatTime(ms: number): string {
    const m = Math.floor(ms / 60000);
    const s = (ms - m * 60000) / 1000;
    return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

/** The difference to the best, signed: +1.204 s (slower) or -0.317 s (faster). */
export function formatDelta(ms: number): string {
    return `${ms >= 0 ? '+' : '-'}${(Math.abs(ms) / 1000).toFixed(3)} s`;
}
