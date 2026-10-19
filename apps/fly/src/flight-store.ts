// Saved flights in this browser (IndexedDB: a minute of stick records at 500 Hz is about 1 MB, too much for
// localStorage). Each flight is stored with a small summary beside it, so the list loads without the records. Every
// call is guarded: a private window or blocked storage means flights are not kept, never an error in the sim.

import { summary } from './flights';
import type { Flight, FlightSummary } from './flights';

const DB = 'owfpv';
const FLIGHTS = 'flights';
const SUMMARIES = 'flight-summaries';
/** the newest flights kept, and the bytes of records kept over all of them */
export const KEEP_FLIGHTS = 30;
export const KEEP_BYTES = 256 * 1024 * 1024;

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
    opening ??= new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(FLIGHTS)) db.createObjectStore(FLIGHTS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: 'id' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return opening;
}

function done(t: IDBTransaction): Promise<boolean> {
    return new Promise((resolve) => {
        t.oncomplete = () => resolve(true);
        t.onerror = () => resolve(false);
        t.onabort = () => resolve(false);
    });
}

function result<T>(r: IDBRequest<T>): Promise<T | null> {
    return new Promise((resolve) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
    });
}

/** Save (or replace: the same visit is saved again as it goes on) a flight, then drop the oldest beyond the limits. */
export async function putFlight(f: Flight, imported = false): Promise<boolean> {
    const db = await open();
    if (!db) return false;
    try {
        const t = db.transaction([FLIGHTS, SUMMARIES], 'readwrite');
        t.objectStore(FLIGHTS).put(f);
        // an imported flight counts as saved when it was opened, so an old file is not dropped at once
        t.objectStore(SUMMARIES).put({ ...summary(f), savedAt: Date.now(), ...(imported ? { imported } : {}) });
        if (!(await done(t))) return false;
        await prune(db);
        return true;
    } catch {
        return false;
    }
}

/** Every saved flight's summary, newest first. */
export async function listFlights(): Promise<FlightSummary[]> {
    const db = await open();
    if (!db) return [];
    try {
        const all = await result(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll() as IDBRequest<FlightSummary[]>);
        return (all ?? []).sort((a, b) => b.id - a.id);
    } catch {
        return [];
    }
}

export async function getFlight(id: number): Promise<Flight | null> {
    const db = await open();
    if (!db) return null;
    try {
        return await result(db.transaction(FLIGHTS).objectStore(FLIGHTS).get(id) as IDBRequest<Flight>);
    } catch {
        return null;
    }
}

export async function deleteFlight(id: number): Promise<void> {
    const db = await open();
    if (!db) return;
    try {
        const t = db.transaction([FLIGHTS, SUMMARIES], 'readwrite');
        t.objectStore(FLIGHTS).delete(id);
        t.objectStore(SUMMARIES).delete(id);
        await done(t);
    } catch {
        // nothing to undo
    }
}

async function prune(db: IDBDatabase): Promise<void> {
    // most recently saved first; flights saved before savedAt existed count as saved when they were flown
    const all = (await listFlights()).sort((a, b) => (b.savedAt ?? b.id) - (a.savedAt ?? a.id));
    let bytes = 0;
    const drop: number[] = [];
    all.forEach((s, i) => {
        bytes += s.bytes;
        // the last saved is always kept
        if (i > 0 && (i >= KEEP_FLIGHTS || bytes > KEEP_BYTES)) drop.push(s.id);
    });
    if (!drop.length) return;
    const t = db.transaction([FLIGHTS, SUMMARIES], 'readwrite');
    for (const id of drop) {
        t.objectStore(FLIGHTS).delete(id);
        t.objectStore(SUMMARIES).delete(id);
    }
    await done(t);
}
