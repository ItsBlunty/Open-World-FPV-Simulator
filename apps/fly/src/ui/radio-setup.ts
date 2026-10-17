// Radio setup screen: pick the stick mode, then the calibration wizard (@owfpv/input wizard.ts) step
// by step. This file only draws what the wizard's view says and turns buttons into its commands.

import { CalibrationWizard, STICK_MODES, mapFrame } from '@owfpv/input';
import type { Fn, RadioProfile, RawFrame, StickAxis, StickMode, WizardView } from '@owfpv/input';
import type { FlightMode } from '@owfpv/sim-core';
import { h, clear } from './dom';

const FN_NAME: Record<Fn, string> = { throttle: 'Throttle', yaw: 'Yaw', pitch: 'Pitch', roll: 'Roll' };
/** The channel a step found (0 for a button). */
function axisOf(v: WizardView): number {
    return v.found?.kind === 'axis' ? v.found.index : 0;
}

const STICK_NAME: Record<StickAxis, string> = { 'left-h': 'LEFT', 'left-v': 'LEFT', 'right-h': 'RIGHT', 'right-v': 'RIGHT' };
const MODE_HELP: Record<StickMode, string> = {
    1: 'Mode 1: throttle and roll on the right stick',
    2: 'Mode 2: throttle and yaw on the left stick (most FPV pilots)',
    3: 'Mode 3: throttle and yaw on the right stick',
    4: 'Mode 4: throttle and roll on the left stick'
};
const HINTS: Record<NonNullable<WizardView['hint']>, string> = {
    'move-more': 'Keep going: every stick to all its ends, every switch through all its positions.',
    'hold-still': 'Hands off the sticks for a moment…',
    'two-axes': 'Two channels moved at once. Move only the stick that is asked for, straight along its axis.',
    release: 'Now let the stick go back to its rest position.',
    'switch-off': 'Now flip the switch back.',
    'more-positions': 'Flip through every position of the switch (a 2-position switch is fine too).'
};

export interface DeviceInfo {
    key: string;
    name: string;
    nAxes: number;
}

export class RadioSetup {
    readonly el: HTMLElement;
    private wiz: CalibrationWizard | null = null;
    private dev: DeviceInfo | null = null;
    private onDone: ((p: RadioProfile) => void) | null = null;
    private onCancel: (() => void) | null = null;
    private stickMode: StickMode = 2;
    private last: RawFrame | null = null;
    private body = h('div');
    private lastKey = '';

    constructor() {
        this.el = h('div', { class: 'overlay hidden' }, h('div', { class: 'panel' }, this.body));
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    show(dev: DeviceInfo, stickMode: StickMode, onDone: (p: RadioProfile) => void, onCancel: () => void): void {
        this.dev = dev;
        this.stickMode = stickMode;
        this.onDone = onDone;
        this.onCancel = onCancel;
        this.wiz = null;
        this.lastKey = '';
        this.el.classList.remove('hidden');
        this.pickMode();
    }

    hide(): void {
        this.el.classList.add('hidden');
        this.wiz = null;
    }

    feed(f: RawFrame): void {
        this.last = f;
        this.wiz?.feed(f);
    }

    private pickMode(): void {
        const radios = ([1, 2, 3, 4] as StickMode[]).map((m) =>
            h('label', {}, h('input', { type: 'radio', name: 'stickmode', checked: m === this.stickMode, onchange: () => (this.stickMode = m) }), ` Mode ${m}`));
        clear(this.body,
            h('h1', {}, 'Radio setup'),
            h('p', { class: 'muted' }, `Device: ${this.dev?.name ?? '?'}`),
            h('h2', {}, 'Your stick mode'),
            h('div', { class: 'row modes' }, ...radios),
            h('div', { class: 'note' }, ...([1, 2, 3, 4] as StickMode[]).map((m) => h('div', {}, MODE_HELP[m]))),
            h('p', { class: 'note' }, 'The wizard asks you to move one stick at a time and works out which channel is which, so your radio\'s channel order does not matter.'),
            h('div', { class: 'row' },
                h('button', { onclick: () => { this.hide(); this.onCancel?.(); } }, 'Cancel'),
                h('span', { class: 'spacer' }),
                h('button', { class: 'primary', onclick: () => this.start() }, 'Start'))
        );
    }

    private start(): void {
        this.wiz = new CalibrationWizard(this.dev?.nAxes ?? 8, this.stickMode);
        if (this.last) this.wiz.feed(this.last);
        this.lastKey = '';
        this.render();
    }

    /** Redraw from the wizard's view (call once per animation frame while open). */
    render(): void {
        const w = this.wiz;
        if (!w || !this.open) return;
        const v = w.view();
        // the step's frame is rebuilt only when the step changes; live parts update every frame
        const key = `${v.step}:${v.stage}:${v.modeLevels.length}`;
        if (key !== this.lastKey) {
            this.lastKey = key;
            this.build(v);
        }
        this.live(v);
    }

    private say(v: WizardView): string {
        const p = v.prompt;
        const ch = (i: number): string => `channel ${i + 1}`;
        switch (v.step) {
            case 'range': return 'Move both sticks around their full circles a few times, and flip every switch through all its positions. Then press Next.';
            case 'centre': return 'Let the sticks spring back to the centre, put the throttle all the way DOWN, and take your hands off. Then press Next.';
            case 'arm': return v.stage === 'done' ? `Arm switch found on ${v.found?.kind === 'button' ? `button ${v.found.bit + 1}` : ch(axisOf(v))}. Flip it back to OFF, then press Next.` : 'Flip your ARM switch to ON and leave it there for a moment. (No arm switch? Skip: the Space key arms.)';
            case 'mode': return v.stage === 'done' ? `Flight-mode switch on ${ch(axisOf(v))}. Flip through all its positions, choose what each does, then press Next.` : 'Optional: flip your flight-mode switch to another position. (Skip: the mode from Settings is used.)';
            case 'reset': return v.stage === 'done' ? 'Respawn switch found. Flip it back, then press Next.' : 'Optional: flip or press the switch you want for "back to the spawn point". (Skip: the R key does it.)';
            case 'check': return 'Move your sticks: the dots should follow them exactly. If anything moves the wrong way, go Back. Then Save.';
            default: {
                if (!p) return '';
                const dir = p.dir === 'up' ? (p.fn === 'pitch' ? 'all the way UP (forward)' : 'all the way UP') : 'all the way RIGHT';
                if (v.stage === 'done') return `${FN_NAME[p.fn]} is ${ch(axisOf(v))}${v.found?.kind === 'axis' && v.found.invert ? ' (reversed, handled)' : ''}. ${p.fn === 'throttle' ? 'Bring the throttle back DOWN' : 'Let the stick go back to centre'}, then press Next.`;
                return `${FN_NAME[p.fn]}: push the ${STICK_NAME[p.stick]} stick ${dir} and hold it.`;
            }
        }
    }

    private build(v: WizardView): void {
        const w = this.wiz!;
        const btn = (label: string, f: () => boolean, primary = false): HTMLButtonElement =>
            h('button', { class: primary ? 'primary' : '', 'data-cmd': label, onclick: () => { f(); this.render(); } }, label);
        const buttons = h('div', { class: 'row' },
            btn('Back', () => w.back()),
            btn('Redo', () => w.redo()),
            btn('Skip', () => w.skip()),
            h('span', { class: 'spacer' }),
            h('button', { onclick: () => { this.hide(); this.onCancel?.(); } }, 'Cancel'),
            v.step === 'check' ? h('button', { class: 'primary', onclick: () => this.save() }, 'Save') : btn('Next', () => w.next(), true));
        const modeRows = v.step === 'mode' && v.modeLevels.length > 0
            ? h('div', { id: 'modes' }, ...v.modeLevels.map((l, i) =>
                h('div', { class: 'row', 'data-level': i },
                    h('span', { class: 'muted' }, `Position ${i + 1}`),
                    h('select', { onchange: (e: Event) => w.setLevelMode(i, (e.target as HTMLSelectElement).value as FlightMode) },
                        ...(['acro', 'horizon', 'angle'] as FlightMode[]).map((m) => h('option', { value: m, selected: m === l.mode }, m[0].toUpperCase() + m.slice(1)))))))
            : null;
        clear(this.body,
            h('h1', {}, 'Radio setup'),
            h('p', { class: 'muted' }, `Step ${v.index} of ${v.count} · Mode ${v.stickMode} · ${this.dev?.name ?? ''}`),
            h('div', { class: 'say' }, this.say(v)),
            h('div', { class: 'prog' }, h('div', { id: 'prog', style: 'width:0%' })),
            h('div', { class: 'hint', id: 'hint' }),
            h('div', { class: 'sticks', id: 'sticks' }),
            modeRows,
            h('h2', {}, 'Channels'),
            h('div', { class: 'chans', id: 'chans' }),
            buttons);
    }

    private live(v: WizardView): void {
        const b = this.body;
        const prog = b.querySelector<HTMLElement>('#prog');
        if (prog) prog.style.width = `${Math.round(v.progress * 100)}%`;
        const hint = b.querySelector('#hint');
        if (hint) hint.textContent = v.hint ? HINTS[v.hint] : '';
        for (const btn of b.querySelectorAll<HTMLButtonElement>('button[data-cmd]')) {
            const c = btn.dataset.cmd!.toLowerCase() as keyof WizardView['can'];
            btn.disabled = !v.can[c];
        }
        for (const row of b.querySelectorAll<HTMLElement>('[data-level]')) row.style.color = Number(row.dataset.level) === v.modeNow ? 'var(--accent)' : '';
        const chans = b.querySelector('#chans');
        if (chans) {
            const pct = (x: number): number => ((Math.max(-1, Math.min(1, x)) + 1) / 2) * 100;
            clear(chans, ...v.axes.flatMap((a, i) => {
                const lo = Number.isFinite(a.min) ? pct(a.min) : 50;
                const hi = Number.isFinite(a.max) ? pct(a.max) : 50;
                return [
                    h('span', { class: 'muted' }, `CH${i + 1}`),
                    h('div', { class: 'bar' },
                        h('div', { class: 'range', style: `left:${lo}%;width:${Math.max(0, hi - lo)}%` }),
                        a.rest !== null ? h('div', { class: 'rest', style: `left:${pct(a.rest)}%` }) : null,
                        h('div', { class: 'val', style: `left:${pct(a.v)}%` })),
                    h('span', {}, a.use ? a.use[0].toUpperCase() + a.use.slice(1) : '')
                ];
            }));
        }
        const sticks = b.querySelector('#sticks');
        if (sticks) clear(sticks, ...this.stickBoxes(v));
    }

    /** The two sticks: on a stick step, the one to push with an arrow; on the check step, dots where the mapped sticks are. */
    private stickBoxes(v: WizardView): HTMLElement[] {
        const m = STICK_MODES[v.stickMode];
        let dots: Record<'left' | 'right', [number, number]> | null = null;
        if (v.step === 'check' && this.last && this.wiz) {
            const p = this.wiz.profile('-', '-', '-');
            const ch = mapFrame(p, this.last, new Float32Array(8));
            const val: Record<Fn, number> = { roll: ch[0], pitch: ch[1], throttle: ch[2], yaw: ch[3] };
            dots = { left: [val[m['left-h']], val[m['left-v']]], right: [val[m['right-h']], val[m['right-v']]] };
        }
        return (['left', 'right'] as const).map((side) => {
            const active = v.prompt && v.stage === 'active' && v.prompt.stick.startsWith(side);
            const box = h('div', { class: `stick${active ? ' active' : ''}` });
            if (active && v.prompt) box.append(h('div', { class: 'arrow' }, v.prompt.dir === 'up' ? '↑' : '→'));
            if (dots) {
                const [x, y] = dots[side];
                box.append(h('div', { class: 'dot', style: `left:${(x + 1) * 50}%;top:${(1 - y) * 50}%` }));
            }
            const hv = `${m[`${side}-h`]}/${m[`${side}-v`]}`;
            return h('div', {}, box, h('div', { class: 'stick-label' }, `${side === 'left' ? 'Left' : 'Right'}: ${hv}`));
        });
    }

    private save(): void {
        if (!this.wiz || !this.dev) return;
        const p = this.wiz.profile(this.dev.key, this.dev.name, new Date().toISOString());
        this.hide();
        this.onDone?.(p);
    }
}
