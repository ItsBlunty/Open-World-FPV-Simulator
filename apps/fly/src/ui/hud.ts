// The flight HUD (owner's choice for M1, 2026-10-17): battery voltage, armed / flight mode, throttle
// and speed, plus crash and arming prompts; the craft's health since the damage model (owner,
// 2026-10-17; sim-core/0.3.0); turtle mode and the tilted-arming prompt (sim-core/0.4.0). Reads the sim state;
// changes nothing. Since the engine left the page (2026-10-18) it reads a copy the engine sends (HUD_HZ a second).

import { S, modeFromChannel } from '@owfpv/sim-core';
import { h } from './dom';

/** What the HUD reads of a sim: its state, channels and two params (a Sim, or the engine's snapshot of one). */
export interface HudSim {
    s: ArrayLike<number>;
    ch: ArrayLike<number>;
    p: { cells: number; crashOn: boolean };
}

export interface HudExtra {
    /** ticks until the automatic respawn, or null */
    respawnIn: number | null;
    hasRadio: boolean;
    /** the prompt without a radio (the free-fly camera's keys) */
    noRadioHint: string;
    armHint: string;
    /** what to do when the craft is too tilted to arm (Betaflight's small_angle): use turtle mode */
    turtleHint: string;
    footer: string;
    /** golden props found, e.g. "12 / 51" (owner, 2026-10-18) */
    props: string;
    /** a time trial (owner, 2026-10-19): the race line at the top, the countdown big in the middle, the pad's hint */
    race: { clock: string; line: string; next: string } | null;
    count: { text: string; kind: '' | 'go' | 'small' } | null;
    padHint: string;
}

export class Hud {
    readonly el: HTMLElement;
    private readonly tl = h('div', { class: 'tl' });
    private readonly tr = h('div', { class: 'tr' });
    private readonly mid = h('div', { class: 'mid' });
    private readonly bottom = h('div', { class: 'bottom' });
    private readonly toastEl = h('div', { class: 'toast' });
    private toastTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly raceEl = h('div', { class: 'race' });
    private readonly countEl = h('div', { class: 'count' });
    private readonly padEl = h('div', { class: 'pad-hint' });
    private readonly resultEl = h('div', { class: 'result' });
    private resultTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.el = h('div', { id: 'hud' }, this.tl, this.tr, this.mid, this.toastEl, this.raceEl, this.countEl, this.padEl, this.resultEl, h('div', { class: 'cross' }), this.bottom);
    }

    /** A time trial finished: the course, the time big, and how it compares with the best before it, for a few seconds. */
    result(name: string, time: string, vs: string, kind: 'best' | 'slower' | ''): void {
        this.resultEl.replaceChildren(h('div', { class: 'name' }, name), h('div', { class: 'time' }, time), h('div', { class: `vs ${kind}` }, vs));
        this.resultEl.classList.add('show');
        if (this.resultTimer) clearTimeout(this.resultTimer);
        this.resultTimer = setTimeout(() => this.resultEl.classList.remove('show'), 7000);
    }

    /** A golden prop taken: its number and the count big, where it was under them, for a few seconds. */
    toast(big: string, small: string): void {
        this.toastEl.replaceChildren(h('div', { class: 'big' }, big), h('div', { class: 'small' }, small));
        this.toastEl.classList.add('show');
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 3000);
    }

    update(sim: HudSim, x: HudExtra): void {
        const s = sim.s;
        const cells = sim.p.cells;
        const v = s[S.volt];
        const low = v / cells < 3.5;
        const armed = s[S.armed] > 0;
        const turtle = armed && s[S.flip] > 0;
        // body up along world up: arming needs within 25 deg of level (sim-core arming(), Betaflight small_angle)
        const upY = 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]);
        const mode = modeFromChannel(sim.ch[5]).toUpperCase();
        const health = Math.ceil(s[S.health] * 100);
        this.tl.innerHTML = '';
        this.tl.append(
            h('div', { class: low ? 'warn' : '' }, `${v.toFixed(1)} V  (${(v / cells).toFixed(2)} V/cell)`),
            // without a radio the mode channel has never been set: no mode to show
            h('div', { class: turtle ? 'warn' : armed ? 'status-ok' : 'warn' }, turtle ? 'ARMED  TURTLE' : `${armed ? 'ARMED' : 'DISARMED'}${x.hasRadio ? `  ${mode}` : ''}`),
            // only with damage on (settings); rounded up, so a scratched craft never reads 0 % before it is down
            ...(sim.p.crashOn ? [h('div', { class: health <= 30 ? 'warn' : '' }, `HEALTH ${String(health).padStart(3)}%`)] : [])
        );
        const thr = Math.round(((sim.ch[2] + 1) / 2) * 100);
        const spd = Math.sqrt(s[S.vx] * s[S.vx] + s[S.vy] * s[S.vy] + s[S.vz] * s[S.vz]) * 3.6;
        this.tr.innerHTML = '';
        this.tr.append(h('div', {}, `THR ${String(thr).padStart(3)}%`), h('div', {}, `${spd.toFixed(0).padStart(3)} km/h`));
        if (x.props) this.tr.append(h('div', { class: 'gold-text' }, `PROPS ${x.props}`));
        let msg = '';
        if (!x.hasRadio) msg = x.noRadioHint;
        else if (s[S.crashed] > 0) msg = x.respawnIn !== null ? `CRASHED — respawn in ${(x.respawnIn / 1000).toFixed(1)} s` : 'CRASHED';
        else if (!armed) msg = upY < 0.9063 ? x.turtleHint : x.armHint;
        else if (turtle) msg = 'TURTLE — push a stick to flip over, then turtle switch off';
        this.mid.textContent = msg;
        this.bottom.textContent = x.footer;
        if (x.race) {
            this.raceEl.replaceChildren(h('div', { class: 'clock' }, x.race.clock), h('div', { class: 'line' }, x.race.line), h('div', { class: 'next' }, x.race.next));
        } else if (this.raceEl.firstChild) this.raceEl.replaceChildren();
        this.countEl.textContent = x.count?.text ?? '';
        this.countEl.className = `count ${x.count?.kind ?? ''}`;
        this.padEl.textContent = x.padHint;

    }
}
