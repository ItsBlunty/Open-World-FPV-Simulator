// The time trial offer (owner, 2026-10-19): after resting 3 s on a course's pad, a popup asks whether to race it. It
// takes the drone's controls (the engine holds the sticks centred: trials.ts filter) and is answered with the sticks:
// yaw right and roll left held for 1 s to race, yaw left and roll right to decline, a circle filling over the choice
// while it is held. Enter and Esc, or a click, answer it too. The sim keeps running under it.

import type { StickMode } from '@owfpv/input';
import { h } from './dom';

/** How long a stick answer must be held, ms (owner: one second). */
export const HOLD_MS = 1000;
/** How far yaw and roll must be pushed to count, of full travel. */
const PUSH = 0.6;

export type Answer = 'race' | 'decline';

/** Which answer the sticks are giving: race (yaw right, roll left), decline (yaw left, roll right), or none. */
export function stickAnswer(ch: ArrayLike<number>): Answer | null {
    const roll = ch[0], yaw = ch[3];
    if (yaw > PUSH && roll < -PUSH) return 'race';
    if (yaw < -PUSH && roll > PUSH) return 'decline';
    return null;
}

/** The sticks' answer held over time: the one being held and how far through HOLD_MS it is, or the answer once held. */
export class StickHold {
    private choice: Answer | null = null;
    private since = 0;
    /** an answer only counts once the sticks have let go of both after the offer came up */
    private ready = false;

    reset(): void {
        this.choice = null;
        this.ready = false;
    }

    /** A stick frame at page time `t` (ms): the answer once it has been held HOLD_MS, else null. */
    feed(ch: ArrayLike<number>, t: number): Answer | null {
        const a = stickAnswer(ch);
        if (!this.ready) {
            this.ready = a === null;
            return null;
        }
        if (a !== this.choice) {
            this.choice = a;
            this.since = t;
            return null;
        }
        return a !== null && t - this.since >= HOLD_MS ? a : null;
    }

    /** The answer being held and how far along (0-1) at time t. */
    progress(t: number): { choice: Answer | null; k: number } {
        return { choice: this.choice, k: this.choice ? Math.min(1, (t - this.since) / HOLD_MS) : 0 };
    }
}

export interface PromptInfo {
    name: string;
    area: string;
    gates: number;
    /** the best time so far, as shown, or null */
    best: string | null;
    stickMode: StickMode;
}

/** How the two answers look on the pilot's sticks: yaw is on the left stick in modes 1 and 2, the right in 3 and 4. */
export function stickHint(mode: StickMode): { race: string; decline: string } {
    const yawLeftStick = mode === 1 || mode === 2;
    return yawLeftStick
        ? { race: 'both sticks in', decline: 'both sticks out' }
        : { race: 'both sticks out', decline: 'both sticks in' };
}

export class TrialPrompt {
    readonly el: HTMLElement;
    private readonly body = h('div');
    private readonly hold = new StickHold();
    private rings: Record<Answer, HTMLElement> | null = null;
    private onAnswer: ((a: Answer) => void) | null = null;

    constructor() {
        this.el = h('div', { class: 'trial-prompt hidden' }, h('div', { class: 'panel' }, this.body));
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    show(info: PromptInfo, onAnswer: (a: Answer) => void): void {
        this.onAnswer = onAnswer;
        this.hold.reset();
        const hint = stickHint(info.stickMode);
        const choice = (a: Answer, label: string, sticks: string, how: string): HTMLElement => {
            const ring = h('div', { class: 'ring' }, h('span', {}, label));
            this.rings![a] = ring;
            return h('button', { class: `trial-choice ${a}`, onclick: () => this.answer(a) },
                ring, h('div', { class: 'how' }, sticks), h('div', { class: 'note' }, how));
        };
        this.rings = {} as Record<Answer, HTMLElement>;
        this.body.replaceChildren(
            h('div', { class: 'kicker' }, 'TIME TRIAL'),
            h('h1', {}, info.name),
            h('p', { class: 'muted' }, `${info.area} · ${info.gates} gates, the last back through this arch`),
            h('p', { class: 'muted' }, info.best ? `Your best: ${info.best}` : 'No time yet.'),
            h('div', { class: 'trial-choices' },
                choice('race', 'Race', 'Yaw right + roll left', `${hint.race}, hold 1 s · Enter`),
                choice('decline', 'Not now', 'Yaw left + roll right', `${hint.decline}, hold 1 s · Esc`)),
            h('p', { class: 'note' }, 'You land back on the pad for a 3, 2, 1, GO! countdown. Leave the pad before GO and it starts over.'));
        this.el.classList.remove('hidden');
        this.draw(performance.now());
    }

    hide(): void {
        this.el.classList.add('hidden');
        this.onAnswer = null;
    }

    /** a mapped stick frame (sim-core channels) */
    feed(ch: ArrayLike<number>): void {
        if (!this.open) return;
        const a = this.hold.feed(ch, performance.now());
        if (a) this.answer(a);
    }

    answer(a: Answer): void {
        const f = this.onAnswer;
        this.hide();
        f?.(a);
    }

    /** every page frame while open: the circle over the choice being held */
    draw(t: number): void {
        if (!this.open || !this.rings) return;
        const p = this.hold.progress(t);
        for (const a of ['race', 'decline'] as Answer[]) {
            const k = p.choice === a ? p.k : 0;
            this.rings[a].style.setProperty('--k', `${Math.round(k * 360)}deg`);
        }
    }
}
