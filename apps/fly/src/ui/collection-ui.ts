// The collection screen (owner, 2026-10-18): how many golden props the pilot has found, each by its number. A found
// one shows where it was; one still to find shows only its area, so the hunt stays a hunt.

import type { PropInfo } from '../engine/protocol';
import { h, clear } from './dom';
import { closeButton } from './settings-ui';

export interface CollectionHost {
    props: readonly PropInfo[];
    isTaken(n: number): boolean;
    /** forget every prop found (asked twice first) */
    reset(): void;
    close(): void;
}

export class CollectionUi {
    readonly el: HTMLElement;
    private body = h('div');
    private host: CollectionHost | null = null;
    private confirmReset = false;

    constructor() {
        this.el = h('div', { class: 'overlay hidden' }, h('div', { class: 'panel wide' }, this.body));
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    show(host: CollectionHost): void {
        this.host = host;
        this.confirmReset = false;
        this.el.classList.remove('hidden');
        this.build();
    }

    hide(): void {
        this.el.classList.add('hidden');
    }

    /** a prop was found while the screen is open: show it */
    refresh(): void {
        if (this.open) this.build();
    }

    private build(): void {
        const host = this.host!;
        const props = host.props;
        const found = props.filter((p) => host.isTaken(p.n)).length;
        const areas = [...new Set(props.map((p) => p.area))];
        const pct = props.length ? Math.round((found / props.length) * 100) : 0;
        clear(this.body,
            h('div', { class: 'title' }, h('h1', {}, 'Collection'), closeButton(() => host.close())),
            h('p', { class: 'muted' }, `${found} of ${props.length} found. They are hidden all over the map: fly through one to take it.`),
            h('div', { class: 'prog gold' }, h('div', { style: `width:${pct}%` })),
            ...areas.flatMap((a) => {
                const mine = props.filter((p) => p.area === a);
                const got = mine.filter((p) => host.isTaken(p.n)).length;
                return [
                    h('h2', {}, `${a} · ${got} / ${mine.length}`),
                    h('div', { class: 'props' }, ...mine.map((p) => {
                        const taken = host.isTaken(p.n);
                        return h('div', { class: `prop ${taken ? 'got' : ''}`, title: taken ? p.spot : `Not found yet (${p.area})` },
                            h('span', { class: 'num' }, `#${p.n}`),
                            h('span', { class: 'where' }, taken ? p.spot : '?'));
                    }))
                ];
            }),
            h('div', { class: 'row footer' },
                h('span', { class: 'note' }, 'Your collection is kept in this browser.'),
                h('span', { class: 'spacer' }),
                found === 0 ? null : h('button', {
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
                }, this.confirmReset ? 'Click again to forget every prop found' : 'Reset collection'),
                h('button', { class: 'primary', onclick: () => host.close() }, 'Done'))
        );
    }
}
