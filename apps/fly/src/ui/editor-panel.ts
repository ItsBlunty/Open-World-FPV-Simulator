// The time trial creator's panel (owner, 2026-10-20), beside the scene while a course is laid out: its name, the
// camera or flying, the pad and gates in order (click one to select it), the selected gate's settings, and save or
// leave. Every change goes to the engine as an edit (course-editor.ts), which sends the course back.

import type { EditorOp } from '../course-editor';
import type { EditorMode, EditorState } from '../engine/protocol';
import { h, clear } from './dom';

export interface EditorHost {
    op(o: EditorOp): void;
    mode(m: EditorMode): void;
    clearLine(): void;
    /** flying needs a radio (without one the mouse and keys fly the camera) */
    canFly(): boolean;
    /** save the course (and set the quad down on its pad to race it) */
    save(race: boolean): void;
    /** leave without saving */
    discard(): void;
}

export class EditorPanel {
    readonly el: HTMLElement;
    private body = h('div');
    private host: EditorHost | null = null;
    private st: EditorState | null = null;
    private sure = false;
    private msg = '';

    constructor() {
        this.el = h('div', { class: 'editor-panel hidden' }, this.body);
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    show(host: EditorHost): void {
        this.host = host;
        this.st = null;
        this.sure = false;
        this.msg = '';
        this.el.classList.remove('hidden');
        this.build();
    }

    hide(): void {
        this.el.classList.add('hidden');
    }

    say(m: string): void {
        this.msg = m;
        this.build();
    }

    /** The engine's state after an edit: redrawn unless the pilot is typing in one of the panel's fields. */
    update(st: EditorState): void {
        const typing = this.el.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type !== 'checkbox';
        const same = this.st !== null && this.st.selected === st.selected && this.st.course.gates.length === st.course.gates.length;
        this.st = st;
        if (typing && same) return;
        this.build();
    }

    private build(): void {
        const host = this.host, st = this.st;
        if (!host) return;
        if (!st) return clear(this.body, h('p', { class: 'muted' }, 'Opening the creator…'));
        const c = st.course;
        const num = (v: number): string => String(Math.round(v * 100) / 100);
        const sel = st.selected >= 0 ? c.gates[st.selected] : undefined;
        const field = (label: string, input: HTMLElement): HTMLElement => h('label', { class: 'ed-field' }, h('span', {}, label), input);
        const text = (value: string, on: (v: string) => void, max = 80): HTMLInputElement =>
            h('input', { type: 'text', value, maxlength: max, onchange: (e: Event) => on((e.target as HTMLInputElement).value) }) as HTMLInputElement;
        const metres = (value: number, on: (v: number) => void): HTMLInputElement =>
            h('input', { type: 'number', step: 0.1, min: 0.3, max: 30, value: num(value), onchange: (e: Event) => on(Number((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
        const b = (label: string, act: () => void, cls = '', title = ''): HTMLElement => h('button', { class: cls, onclick: act, title: title || null }, label);
        const items = [
            h('li', { class: st.selected === -1 ? 'sel' : '', onclick: () => host.op({ op: 'select', i: -1 }) },
                h('strong', {}, 'P'), st.hasPad ? ` Start pad, facing ${['north', 'east', 'south', 'west'][c.pad.yawDeg / 90]}` : ' Start pad: not placed yet (P)'),
            ...c.gates.map((g, i) => h('li', { class: i === st.selected ? 'sel' : '', onclick: () => host.op({ op: 'select', i }) },
                h('strong', {}, String(i + 1)), ` ${g.name}`, g.kind === 'gate' ? h('span', { class: 'muted' }, ' · race gate') : null))
        ];
        clear(this.body,
            h('div', { class: 'title' }, h('h1', {}, 'Course creator')),
            field('Name', text(c.name, (v) => host.op({ op: 'meta', name: v }))),
            field('Area', text(c.area, (v) => host.op({ op: 'meta', area: v }))),
            h('div', { class: 'row tight' },
                b('Camera', () => host.mode('camera'), st.mode === 'camera' ? 'primary' : '', 'Tab'),
                b('Fly the quad', () => host.mode('fly'), st.mode === 'fly' ? 'primary' : '', 'Tab'),
                st.line > 0 ? b(`Clear line (${st.line})`, () => host.clearLine()) : null),
            !host.canFly() ? h('p', { class: 'note' }, 'Connect a radio to fly a line first; the mouse and keys fly the camera.') : null,
            st.mode === 'fly' ? h('p', { class: 'note' }, 'Flying: the line shows where you went. Tab (or Camera) stops the quad and lays gates out.') : null,
            h('div', { class: 'row tight' },
                b('Add gate (G)', () => host.op({ op: 'add', kind: 'open' }), '', 'A window, a gap, the space between things: marked only while racing'),
                b('Add race gate (B)', () => host.op({ op: 'add', kind: 'gate' }), '', 'A 1.5 m race gate standing there: solid only while its race runs'),
                b('Place pad (P)', () => host.op({ op: 'pad' }))),
            h('p', { class: 'note' }, `The white frame ${Math.round(st.reach * 10) / 10} m ahead is where it goes (mouse wheel: nearer, farther).`),
            h('ol', { class: 'ed-list' }, ...items),
            sel ? h('div', { class: 'ed-sel' },
                field('Gate', text(sel.name, (v) => host.op({ op: 'set', i: st.selected, name: v }))),
                field('Kind', h('select', { onchange: (e: Event) => host.op({ op: 'set', i: st.selected, kind: (e.target as HTMLSelectElement).value as 'open' | 'gate' }) },
                    h('option', { value: 'open', selected: sel.kind !== 'gate' }, 'Opening (window, gap)'),
                    h('option', { value: 'gate', selected: sel.kind === 'gate' }, 'Race gate'))),
                h('div', { class: 'row tight' },
                    field('Width, m', metres(2 * sel.hw, (v) => host.op({ op: 'set', i: st.selected, w: v }))),
                    field('Height, m', metres(2 * sel.hh, (v) => host.op({ op: 'set', i: st.selected, h: v })))),
                h('label', { class: 'row tight' }, h('input', { type: 'checkbox', checked: Math.abs(sel.ny) > 0.5, onchange: (e: Event) => host.op({ op: 'set', i: st.selected, flat: (e.target as HTMLInputElement).checked }) }), 'Lying flat (fly up or down through it)'),
                h('div', { class: 'row tight' },
                    b('Move to frame (F)', () => host.op({ op: 'here' })),
                    b('⟲ (,)', () => host.op({ op: 'turn', deg: -15 })),
                    b('⟳ (.)', () => host.op({ op: 'turn', deg: 15 })),
                    b('Earlier', () => host.op({ op: 'order', d: -1 })),
                    b('Later', () => host.op({ op: 'order', d: 1 })),
                    b('Delete', () => host.op({ op: 'delete' }), 'danger'))) : st.hasPad && st.selected === -1 ? h('div', { class: 'row tight' },
                b('Move pad to frame (F)', () => host.op({ op: 'here' })),
                b('Turn a quarter (.)', () => host.op({ op: 'turn', deg: 90 }))) : null,
            st.problem ? h('p', { class: 'hint' }, st.problem) : null,
            this.msg ? h('p', { class: 'hint' }, this.msg) : null,
            h('div', { class: 'row footer' },
                b('Save', () => host.save(false), 'primary'),
                b('Save and race it', () => host.save(true)),
                h('span', { class: 'spacer' }),
                b(this.sure ? 'Click again: leave unsaved' : 'Leave', () => {
                    if (!this.sure) {
                        this.sure = true;
                        return this.build();
                    }
                    host.discard();
                }, this.sure ? 'danger' : '')),
            h('p', { class: 'note' }, 'G gate · B race gate · P pad · F move here · [ ] select · arrows nudge · , . turn · - = size · Delete · Tab camera / fly · Esc menu')
        );
    }
}
