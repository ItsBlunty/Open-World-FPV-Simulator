// The Course creator screen (owner, 2026-10-20: "a time trial creator, so that people by hand OR you have a simplified
// system to create time trials"): the pilot's own courses on this map, a new one, and for each: change it, fly it, save
// it as a file, propose it for the game (a pull request on GitHub), delete it; a course file opened from disk.

import type { CourseFile } from '@owfpv/maps';
import { h, clear } from './dom';
import { closeButton } from './settings-ui';

export interface CreatorHost {
    courses(): readonly CourseFile[];
    /** a new course: the creator opens on it where the camera is now */
    create(): void;
    edit(c: CourseFile): void;
    /** set the quad down on its pad */
    fly(c: CourseFile): void;
    download(c: CourseFile): void;
    /** the GitHub page that proposes it for the game: its link and whether the course fits in it */
    propose(c: CourseFile): { url: string; fits: boolean; text: string };
    remove(c: CourseFile): void;
    /** a course file from disk: an error message, or null when it was added */
    open(file: File): Promise<string | null>;
    close(): void;
}

export class CreatorUi {
    readonly el: HTMLElement;
    private body = h('div');
    private host: CreatorHost | null = null;
    private confirmDelete: string | null = null;
    private msg = '';

    constructor() {
        this.el = h('div', { class: 'overlay hidden' }, h('div', { class: 'panel wide' }, this.body));
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    show(host: CreatorHost, msg = ''): void {
        this.host = host;
        this.confirmDelete = null;
        this.msg = msg;
        this.el.classList.remove('hidden');
        this.build();
    }

    hide(): void {
        this.el.classList.add('hidden');
    }

    refresh(): void {
        if (this.open) this.build();
    }

    private say(m: string): void {
        this.msg = m;
        this.build();
    }

    private build(): void {
        const host = this.host!;
        const list = host.courses();
        const picker = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: async (e: Event) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (!f) return;
            const err = await host.open(f);
            this.say(err ? `Could not open ${f.name}: ${err}` : `Opened ${f.name}.`);
        } }) as HTMLInputElement;
        clear(this.body,
            h('div', { class: 'title' }, h('h1', {}, 'Course creator'), closeButton(() => host.close())),
            h('p', { class: 'muted' }, 'Make your own time trials anywhere on the map. Lay the gates out with the free camera; fly the line first if you like, and it is drawn so you can put gates on it. Each course starts and ends at its own checkered arch and pad.'),
            h('div', { class: 'row' },
                h('button', { class: 'primary', onclick: () => host.create() }, 'New course'),
                h('button', { onclick: () => picker.click() }, 'Open a course file…'),
                picker),
            this.msg ? h('p', { class: 'hint' }, this.msg) : null,
            h('h2', {}, `Your courses (${list.length})`),
            list.length === 0 ? h('p', { class: 'note' }, 'None yet. "New course" opens the creator where you are now.') : null,
            h('div', { class: 'trials' }, ...list.map((c) => {
                const sure = this.confirmDelete === c.id;
                const race = c.gates.filter((g) => g.kind === 'gate').length;
                return h('div', { class: 'trial' },
                    h('div', { class: 'trial-head' },
                        h('strong', {}, c.name),
                        h('span', { class: 'muted' }, ` · ${c.area} · ${c.gates.length} gates${race ? ` (${race} race gates)` : ''} · version ${c.version}`)),
                    h('div', { class: 'row tight' },
                        h('button', { onclick: () => host.edit(c) }, 'Change'),
                        h('button', { onclick: () => host.fly(c) }, 'Fly it'),
                        h('button', { onclick: () => host.download(c) }, 'Save as file'),
                        h('button', { onclick: () => this.propose(c) }, 'Propose for the game'),
                        h('span', { class: 'spacer' }),
                        h('button', {
                            class: sure ? 'danger' : '',
                            onclick: () => {
                                if (!sure) {
                                    this.confirmDelete = c.id;
                                    return this.build();
                                }
                                this.confirmDelete = null;
                                host.remove(c);
                                this.say(`Deleted ${c.name}.`);
                            }
                        }, sure ? 'Click again to delete it' : 'Delete')));
            })),
            h('h2', {}, 'How it works'),
            h('dl', { class: 'keys' }, ...([
                ['Mouse, W A S D, Space / E, Q, Shift', 'fly the camera (drag or click to steer)'],
                ['Mouse wheel', 'move the white crosshair frame nearer or farther'],
                ['G', 'add a gate at the frame: a window, a gap, the space between things (marked only while racing)'],
                ['B', 'add a race gate at the frame: a real 1.5 m gate, solid only while its race runs'],
                ['P', 'put the start pad and arch on the ground under the frame'],
                ['F', 'move the selected gate (or the pad) to the frame'],
                ['[ and ]', 'select the previous or next gate'],
                ['Arrows, Page Up / Down', 'nudge the selected gate (Shift: 1 m steps)'],
                [', and .', 'turn it (the pad by a quarter turn)'],
                ['- and =', 'make it smaller or bigger'],
                ['Delete', 'remove it'],
                ['Tab', 'switch between the camera and flying the quad (with a radio): the flown line shows where you went']
            ] as [string, string][]).flatMap(([k, w]) => [h('dt', {}, k), h('dd', {}, w)])),
            h('p', { class: 'note' }, 'Look steeply up or down to add a gate lying flat (a hole in a floor, a gap between wires). Gates count either way through. Your courses are kept in this browser; save one as a file to keep it or share it, and "Propose for the game" opens GitHub with it filled in, so it can be added for everyone (a free GitHub account is needed).'),
            h('div', { class: 'row footer' }, h('span', { class: 'spacer' }), h('button', { class: 'primary', onclick: () => host.close() }, 'Done'))
        );
    }

    private propose(c: CourseFile): void {
        const p = this.host!.propose(c);
        if (p.fits) {
            open(p.url, '_blank', 'noopener');
            this.say(`GitHub opened in a new tab with ${c.name} filled in. Sign in, then "Commit changes…" offers to propose it as a pull request.`);
            return;
        }
        void navigator.clipboard?.writeText(p.text).catch(() => undefined);
        open(p.url, '_blank', 'noopener');
        this.say(`${c.name} is too long for a link: it was copied instead. Paste it into the file on the GitHub page that opened, then propose it.`);
    }
}
