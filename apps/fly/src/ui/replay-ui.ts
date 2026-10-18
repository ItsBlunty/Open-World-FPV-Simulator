// The replay viewer's screen (owner, 2026-10-18): play / pause, a scrub bar with marks for crashes, respawns and
// golden props, speeds 0.1x to 2x, the four cameras, the path line, and the sticks, speed, height and throttle at the
// playhead. Steering it with the radio is an option that starts off. The engine plays the track; this screen draws
// what it reads from its own copy of the track at the tick the engine says.

import { STICK_MODES } from '@owfpv/input';
import type { StickMode } from '@owfpv/input';
import { T, poseAt } from '../replay';
import type { Mark, Track } from '../replay';
import type { PathMode, ReplayCam } from '../engine/protocol';
import { h, clear } from './dom';

export interface ReplayCtl {
    playing?: boolean;
    speed?: number;
    seek?: number;
    cam?: ReplayCam;
    path?: PathMode;
    shuttle?: number;
}

export interface ReplayHost {
    ctl(m: ReplayCtl): void;
    exit(): void;
    /** a radio is set up, so it can steer the replay */
    hasRadio: boolean;
    /** the pilot's stick mode: where each stick is drawn */
    stickMode: StickMode;
}

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2];
export const CAMS: { id: ReplayCam; label: string }[] = [
    { id: 'fpv', label: 'FPV' }, { id: 'chase', label: 'Chase' }, { id: 'free', label: 'Free' }, { id: 'spotter', label: 'Spotter' }
];
const PATHS: { id: PathMode; label: string }[] = [{ id: 'whole', label: 'Whole flight' }, { id: 'trail', label: 'Trail' }, { id: 'off', label: 'Off' }];
/** a mark jumps this far ahead of what it marks, ms, so you see it happen */
const LEAD_MS = 1000;
/** arrow keys jump this far, ms */
const JUMP_MS = 5000;

const clock = (ms: number): string => {
    const s = Math.max(0, ms) / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

export class ReplayUi {
    readonly el: HTMLElement;
    private host: ReplayHost | null = null;
    private track: Track | null = null;
    private readonly pose = new Float32Array(T.size);
    private tick = 0;
    playing = true;
    speed = 1;
    cam: ReplayCam = 'fpv';
    path: PathMode = 'whole';
    /** the radio steers the replay (starts off: owner, 2026-10-18) */
    radioOn = false;
    private dragging = false;
    // parts redrawn at the playhead
    private readonly info = h('div', { class: 'replay-info' });
    private readonly left = h('div', { class: 'stick' }, h('div', { class: 'dot' }));
    private readonly right = h('div', { class: 'stick' }, h('div', { class: 'dot' }));
    private readonly time = h('span', { class: 'replay-time' });
    private readonly bar = h('div', { class: 'replay-bar' });
    private readonly scrub = h('input', { type: 'range', class: 'replay-scrub', 'aria-label': 'Position in the flight' });
    private readonly playBtn = h('button', { class: 'primary replay-play' });
    private readonly status = h('div', { class: 'replay-status' });

    constructor() {
        this.el = h('div', { class: 'replay hidden' });
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    /** "Preparing the replay": the flight is being flown again from its sticks (share done, 0..1). */
    loading(done: number, title: string): void {
        this.el.classList.remove('hidden');
        clear(this.el, h('div', { class: 'replay-loading' },
            h('strong', {}, title),
            h('div', { class: 'muted' }, `Flying it again from your sticks… ${Math.round(done * 100)} %`),
            h('div', { class: 'prog' }, h('div', { style: `width: ${(done * 100).toFixed(0)}%` })),
            h('button', { onclick: () => this.host?.exit() }, 'Cancel')));
    }

    /** A problem: the flight cannot be watched on this build. */
    failed(why: string): void {
        this.el.classList.remove('hidden');
        clear(this.el, h('div', { class: 'replay-loading' },
            h('strong', { class: 'status-bad' }, 'This flight cannot be replayed'),
            h('div', { class: 'muted' }, why),
            h('button', { onclick: () => this.host?.exit() }, 'Back')));
    }

    /** Opened for a flight being prepared (before the track exists). */
    begin(host: ReplayHost): void {
        this.host = host;
        this.track = null;
        this.radioOn = false;
    }

    show(track: Track, title: string): void {
        const host = this.host!;
        this.track = track;
        this.tick = track.startTick;
        this.playing = true;
        this.speed = 1;
        this.el.classList.remove('hidden');
        this.scrub.min = String(track.startTick);
        this.scrub.max = String(track.endTick);
        this.scrub.step = '1';
        this.scrub.value = String(track.startTick);
        this.scrub.oninput = () => host.ctl({ seek: Number(this.scrub.value) });
        this.scrub.onpointerdown = () => { this.dragging = true; };
        this.scrub.onpointerup = () => { this.dragging = false; };
        this.playBtn.onclick = () => this.togglePlay();
        this.status.replaceChildren(
            h('strong', {}, title), ' · ',
            track.ok ? h('span', { class: 'status-ok' }, 'replay matches the flight') : h('span', { class: 'status-bad' }, 'replay differs from the flight in some lives'));
        clear(this.bar, ...track.marks.map((m) => this.markEl(m, track)), this.scrub);
        this.buildControls();
        this.at(track.startTick, true);
    }

    private markEl(m: Mark, track: Track): HTMLElement {
        const span = Math.max(1, track.endTick - track.startTick);
        return h('button', {
            class: `replay-mark ${m.kind}`, style: `left: ${(((m.tick - track.startTick) / span) * 100).toFixed(3)}%`,
            title: `${clock(m.tick - track.startTick)} ${m.label}`, 'aria-label': m.label,
            onclick: () => this.host?.ctl({ seek: Math.max(track.startTick, m.tick - LEAD_MS) })
        });
    }

    private buildControls(): void {
        const host = this.host!;
        const pick = <V extends string | number>(cur: V, items: { id: V; label: string }[], set: (v: V) => void): HTMLElement =>
            h('div', { class: 'seg' }, ...items.map((it) => h('button', { class: it.id === cur ? 'on' : '', onclick: () => { set(it.id); this.buildControls(); } }, it.label)));
        const radio = host.hasRadio
            ? h('label', { class: 'muted', title: 'Roll past half way winds the replay (right forward, left back). Pitch pushed past 80 % plays or pauses.' },
                h('input', { type: 'checkbox', checked: this.radioOn, onchange: (e: Event) => { this.radioOn = (e.target as HTMLInputElement).checked; if (!this.radioOn) host.ctl({ shuttle: 0 }); } }),
                ' Radio controls')
            : null;
        clear(this.el,
            this.info,
            h('div', { class: 'replay-sticks' }, this.left, this.right),
            h('div', { class: 'replay-panel' },
                this.status,
                h('div', { class: 'row tight' }, this.playBtn, this.time, this.bar),
                h('div', { class: 'row tight' },
                    h('span', { class: 'muted' }, 'Speed'), pick(this.speed, SPEEDS.map((s) => ({ id: s, label: `${s}x` })), (v) => { this.speed = v; host.ctl({ speed: v }); }),
                    h('span', { class: 'muted' }, 'Camera'), pick(this.cam, CAMS, (v) => this.setCam(v)),
                    h('span', { class: 'muted' }, 'Path'), pick(this.path, PATHS, (v) => { this.path = v; host.ctl({ path: v }); }),
                    radio, h('span', { class: 'spacer' }),
                    h('button', { onclick: () => host.exit() }, 'Back to flights')),
                h('div', { class: 'note' }, this.cam === 'free'
                    ? 'Free camera: click to steer with the mouse, W A S D move, Space / E up, Q down, Shift faster.'
                    : 'Space play / pause · ← → 5 s · C camera · Esc back. The spotter stands behind the quad, or where the free camera was.')));
        this.playBtn.textContent = this.playing ? 'Pause' : 'Play';
    }

    setCam(c: ReplayCam): void {
        this.cam = c;
        this.host?.ctl({ cam: c });
        this.buildControls();
    }

    togglePlay(): void {
        this.playing = !this.playing;
        this.host?.ctl({ playing: this.playing });
        this.playBtn.textContent = this.playing ? 'Pause' : 'Play';
    }

    /** A key while the viewer is open; true if it was the viewer's. */
    key(code: string): boolean {
        const t = this.track;
        if (!t) return false;
        if (code === 'Space' && this.cam !== 'free') this.togglePlay();
        else if (code === 'ArrowLeft') this.host?.ctl({ seek: Math.max(t.startTick, this.tick - JUMP_MS) });
        else if (code === 'ArrowRight') this.host?.ctl({ seek: Math.min(t.endTick, this.tick + JUMP_MS) });
        else if (code === 'KeyC') this.setCam(CAMS[(CAMS.findIndex((c) => c.id === this.cam) + 1) % CAMS.length].id);
        else return false;
        return true;
    }

    /** The engine's playhead: redraw the sticks, numbers and the scrub bar. */
    at(tick: number, playing: boolean): void {
        const t = this.track;
        if (!t) return;
        this.tick = tick;
        if (playing !== this.playing) {
            this.playing = playing;
            this.playBtn.textContent = playing ? 'Pause' : 'Play';
        }
        if (!this.dragging) this.scrub.value = String(Math.round(tick));
        this.time.textContent = `${clock(tick - t.startTick)} / ${clock(t.endTick - t.startTick)}`;
        const p = poseAt(t, tick, this.pose);
        const v = Math.sqrt(p[T.vx] * p[T.vx] + p[T.vy] * p[T.vy] + p[T.vz] * p[T.vz]);
        const thr = Math.round(((p[T.thr] + 1) / 2) * 100);
        this.info.replaceChildren(
            h('div', {}, `${(v * 3.6).toFixed(0).padStart(3)} km/h`),
            h('div', {}, `HEIGHT ${p[T.py].toFixed(1)} m`),
            h('div', {}, `THR ${String(thr).padStart(3)}%`),
            h('div', { class: p[T.crashed] ? 'warn' : p[T.armed] ? 'status-ok' : 'warn' }, p[T.crashed] ? 'CRASHED' : p[T.armed] ? 'ARMED' : 'DISARMED'));
        // each stick axis drives what the pilot's stick mode says (EdgeTX's table, @owfpv/input)
        const m = STICK_MODES[this.host?.stickMode ?? 2];
        const val = { roll: p[T.roll], pitch: p[T.pitch], throttle: p[T.thr], yaw: p[T.yaw] };
        place(this.left, val[m['left-h']], val[m['left-v']]);
        place(this.right, val[m['right-h']], val[m['right-v']]);
    }

    hide(): void {
        this.el.classList.add('hidden');
        this.track = null;
        this.host = null;
        this.dragging = false;
    }
}

/** A stick's dot at x, y (each -1..1, up is +1). */
function place(stick: HTMLElement, x: number, y: number): void {
    const dot = stick.firstElementChild as HTMLElement;
    dot.style.left = `${((x + 1) / 2) * 100}%`;
    dot.style.top = `${((1 - y) / 2) * 100}%`;
}
