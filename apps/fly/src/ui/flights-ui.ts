// The saved flights screen (owner, 2026-10-18: save flights first, so graded attempts can be replayed and re-scored).
// Lists what this browser keeps, newest first, and per flight: check it (replay it and compare every life's state
// hash with the one saved while flying), download it as a file, or delete it. A downloaded file comes back with
// Open a flight file, or by dropping it on the screen.

import type { CheckResult, FlightSummary } from '../flights';
import { h, clear } from './dom';

export interface FlightsHost {
    list(): Promise<FlightSummary[]>;
    check(id: number): Promise<CheckResult | null>;
    /** open the replay viewer on it */
    watch(id: number): void;
    download(id: number): Promise<void>;
    /** read a downloaded flight file and keep it here: the flight's id, or why it was refused */
    open(file: File): Promise<{ id: number } | { error: string }>;
    remove(id: number): Promise<void>;
    /** the flight of this visit (still being flown), not deleted from here */
    currentId: number;
    close(): void;
}

const when = (id: number): string =>
    new Date(id).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const length = (s: number): string => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);

export class FlightsUi {
    readonly el: HTMLElement;
    private body = h('div');
    private host: FlightsHost | null = null;
    private flights: FlightSummary[] = [];
    /** per flight: a check running, or its result */
    private checks = new Map<number, CheckResult | 'running'>();
    private confirmDelete: number | null = null;
    /** what the last opened files did */
    private opened: { ok: boolean; text: string } | null = null;
    private picker = h('input', { type: 'file', accept: '.json,application/json', multiple: true, style: 'display: none' });

    constructor() {
        this.el = h('div', { class: 'overlay hidden' }, h('div', { class: 'panel wide' }, this.body, this.picker));
        this.picker.onchange = () => {
            void this.openFiles([...(this.picker.files ?? [])]);
            this.picker.value = '';
        };
        this.el.addEventListener('dragover', (e) => {
            if (!this.open || !e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        this.el.addEventListener('drop', (e) => {
            if (!this.open || !e.dataTransfer?.files.length) return;
            e.preventDefault();
            void this.openFiles([...e.dataTransfer.files]);
        });
    }

    private async openFiles(files: File[]): Promise<void> {
        const host = this.host;
        if (!host || !files.length) return;
        const added: string[] = [];
        const refused: string[] = [];
        for (const file of files) {
            const r = await host.open(file);
            if ('id' in r) added.push(when(r.id));
            else refused.push(`${file.name}: ${r.error}.`);
        }
        const text = [added.length ? `Added the flight of ${added.join(', ')}.` : '', ...refused].filter(Boolean).join(' ');
        this.opened = { ok: refused.length === 0, text };
        this.flights = await host.list();
        this.build(false);
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    async show(host: FlightsHost): Promise<void> {
        this.host = host;
        this.confirmDelete = null;
        this.opened = null;
        this.el.classList.remove('hidden');
        this.flights = [];
        this.build(true);
        this.flights = await host.list();
        this.build(false);
    }

    hide(): void {
        this.el.classList.add('hidden');
    }

    private status(id: number): HTMLElement | null {
        const c = this.checks.get(id);
        if (!c) return null;
        if (c === 'running') return h('span', { class: 'muted' }, 'Replaying…');
        if (c.ok) return h('span', { class: 'status-ok' }, `Replay matches (${c.lives.length} ${c.lives.length === 1 ? 'life' : 'lives'})`);
        const bad = c.lives.filter((l) => !l.ok).map((l) => l.index + 1);
        return h('span', { class: 'status-bad' }, c.problem ?? `Replay differs in life ${bad.join(', ')}`);
    }

    private build(loading: boolean): void {
        const host = this.host!;
        const rows = this.flights.map((f) => h('div', { class: 'flight' },
            h('div', { class: 'flight-main' },
                h('strong', {}, when(f.id)), f.id === host.currentId ? h('span', { class: 'muted' }, ' · this visit') : null,
                f.imported ? h('span', { class: 'muted' }, ' · from a file') : null,
                h('div', { class: 'muted' },
                    `${length(f.seconds)} · ${f.lives} ${f.lives === 1 ? 'life' : 'lives'} · ${f.props} golden ${f.props === 1 ? 'prop' : 'props'} · ` +
                    `${(f.bytes / 1024 / 1024).toFixed(1)} MB · ${f.mapId} v${f.mapVersion}, ${f.simCore}`),
                this.status(f.id)),
            h('div', { class: 'row' },
                h('button', { class: 'primary', onclick: () => host.watch(f.id) }, 'Watch'),
                h('button', {
                    disabled: this.checks.get(f.id) === 'running',
                    onclick: async () => {
                        this.checks.set(f.id, 'running');
                        this.build(false);
                        const r = await host.check(f.id);
                        this.checks.set(f.id, r ?? { ok: false, lives: [], problem: 'The flight could not be read.' });
                        this.build(false);
                    }
                }, 'Check replay'),
                h('button', { onclick: () => void host.download(f.id) }, 'Download'),
                f.id === host.currentId ? null : h('button', {
                    class: this.confirmDelete === f.id ? 'danger' : '',
                    onclick: async () => {
                        if (this.confirmDelete !== f.id) {
                            this.confirmDelete = f.id;
                            return this.build(false);
                        }
                        this.confirmDelete = null;
                        await host.remove(f.id);
                        this.flights = await host.list();
                        this.build(false);
                    }
                }, this.confirmDelete === f.id ? 'Click again to delete' : 'Delete'))));
        clear(this.body,
            h('div', { class: 'title' }, h('h1', {}, 'Saved flights'), h('button', { onclick: () => host.close() }, 'Done')),
            h('p', { class: 'muted' },
                'Every visit you fly with a radio is saved here as your stick inputs, so it can be replayed exactly: Watch plays ',
                'it back from any camera and lists the tricks flown, with their marks. Saved when you open the menu, and every minute while flying. The 30 saved most recently are kept. ',
                'Download keeps a flight as a file; Open a flight file (or drop the file here) brings it back, in this browser or another.'),
            this.opened ? h('p', { class: this.opened.ok ? 'status-ok' : 'status-bad' }, this.opened.text) : null,
            loading ? h('p', { class: 'muted' }, 'Loading…') : rows.length ? h('div', {}, ...rows) : h('p', { class: 'muted' }, 'No saved flights yet.'),
            h('div', { class: 'row footer' },
                h('span', { class: 'note' }, 'Kept in this browser only.'), h('span', { class: 'spacer' }),
                h('button', { onclick: () => this.picker.click() }, 'Open a flight file…'),
                h('button', { class: 'primary', onclick: () => host.close() }, 'Done')));
    }
}
