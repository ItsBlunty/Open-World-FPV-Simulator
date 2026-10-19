// The Time Trials screen (owner, 2026-10-19: "all of the time trials will be logged in a Time Trials section just like
// the collectibles section"): every course by area, its gates, and the pilot's best, last and recent times.

import type { TrialInfo } from '../engine/protocol';
import type { CourseTimes } from '../trial-times';
import { formatTime } from '../trial-times';
import { h, clear } from './dom';
import { closeButton } from './settings-ui';

export interface TrialsHost {
    trials: readonly TrialInfo[];
    times(t: TrialInfo): CourseTimes | null;
    /** forget every time (asked twice first) */
    reset(): void;
    close(): void;
}

export class TrialsUi {
    readonly el: HTMLElement;
    private body = h('div');
    private host: TrialsHost | null = null;
    private confirmReset = false;

    constructor() {
        this.el = h('div', { class: 'overlay hidden' }, h('div', { class: 'panel wide' }, this.body));
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    show(host: TrialsHost): void {
        this.host = host;
        this.confirmReset = false;
        this.el.classList.remove('hidden');
        this.build();
    }

    hide(): void {
        this.el.classList.add('hidden');
    }

    /** a race was finished while the screen is open: show it */
    refresh(): void {
        if (this.open) this.build();
    }

    private build(): void {
        const host = this.host!;
        const flown = host.trials.filter((t) => host.times(t) !== null).length;
        clear(this.body,
            h('div', { class: 'title' }, h('h1', {}, 'Time trials'), closeButton(() => host.close())),
            h('p', { class: 'muted' }, `${flown} of ${host.trials.length} flown. Find a checkered flag and arch, land on the pad under it and stay there 3 s to be offered the race.`),
            h('div', { class: 'trials' }, ...host.trials.map((t) => {
                const c = host.times(t);
                return h('div', { class: `trial ${c ? 'got' : ''}` },
                    h('div', { class: 'trial-head' },
                        h('strong', {}, t.name),
                        h('span', { class: 'muted' }, ` · ${t.area} · ${t.gates.length} gates`),
                        h('span', { class: 'spacer' }),
                        h('span', { class: 'best' }, c ? formatTime(c.best) : 'not flown')),
                    c ? h('div', { class: 'note' },
                        `Best ${formatTime(c.best)} on ${new Date(c.bestAt).toLocaleDateString()} · last ${formatTime(c.last)} · ${c.runs} ${c.runs === 1 ? 'run' : 'runs'}`,
                        c.recent.length > 1 ? ` · recent: ${c.recent.map(formatTime).join(', ')}` : '') : null,
                    h('ol', { class: 'gates' }, ...t.gates.map((g) => h('li', {}, g))));
            })),
            h('div', { class: 'row footer' },
                h('span', { class: 'note' }, 'Your times are kept in this browser.'),
                h('span', { class: 'spacer' }),
                flown === 0 ? null : h('button', {
                    class: this.confirmReset ? 'danger' : '',
                    onclick: () => {
                        if (!this.confirmReset) {
                            this.confirmReset = true;
                            return this.build();
                        }
                        this.confirmReset = false;
                        host.reset();
                        this.build();
                    }
                }, this.confirmReset ? 'Click again to forget every time' : 'Reset times'),
                h('button', { class: 'primary', onclick: () => host.close() }, 'Done'))
        );
    }
}
