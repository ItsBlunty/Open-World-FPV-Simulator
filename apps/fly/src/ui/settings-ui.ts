// Settings screen, in tabs as games have them (owner, 2026-10-19): the radio and controls, the camera, graphics, the world
// and physics, help and about. The page adds its own sections to some tabs (the radio connection, the
// key list, the report link, the data buttons: main.ts pageSections). The rates box
// offers Betaflight's two common rate types; field names, scales and limits are sim-core's
// rates-edit.ts (read from Betaflight Configurator 10.10.0 by sim-core's author), so values typed
// here mean what they mean in Configurator.

import { RATE_AXES, RATE_FIELDS, copyRates, fitRates, fullStickRates, readField, shownText, withField } from '@owfpv/sim-core';
import type { FlightMode, RateAxis, RateFieldName, RatesConfig, RatesType } from '@owfpv/sim-core';
import type { Settings } from '../settings';
import { TUNES } from '../tunes';
import type { TuneId } from '../tunes';
import { QUADS } from '../quads';
import type { QuadId } from '../quads';
import { LENSES, NO_LENS } from '../render/lenses';
import { lensFov } from '../render/lens';
import { h, clear } from './dom';
import type { Child } from './dom';
import { GRAPHICS_LEVELS, PRESET_NAMES, QUALITY_PRESETS, applyPreset, graphicsName, isLowSpec, presetOf, trafficAllowed } from '../graphics';
import type { GraphicsLevel, QualityPreset } from '../graphics';
import { SHADOW_REACH_IDS } from '../render/shadow-follow';
import type { ShadowReach } from '../render/shadow-follow';

const FIELD_LABEL: Record<RateFieldName, string> = {
    rcRate: 'RC Rate', superRate: 'Super Rate', expo: 'Expo', rcCurve: 'RC Curve',
    centerSensitivity: 'Center Sensitivity', maxRate: 'Max Rate', rate: 'Rate', acroPlus: 'Acro+'
};
const TYPES: { type: RatesType; label: string }[] = [{ type: 'BETAFLIGHT', label: 'Betaflight' }, { type: 'ACTUAL', label: 'Actual' }];

export interface SettingsHost {
    settings: Settings;
    /** the preset's own rates, for "Preset default" */
    presetRates: RatesConfig;
    /** dynamic idle's minimum the game picks for this quad (x 100 rpm, Betaflight's dyn_idle_min_rpm); null: not available */
    dynIdleMinRpm: number | null;
    /** camera settings changed: apply at once */
    onCamera(): void;
    /** rates or mode changed: the flight model needs a new life */
    onFlight(): void;
    /** cars, people, signals or the train changed: they are solid, so a new life with the new traffic */
    onTraffic(): void;
    /** resolution scale changed: apply at once */
    onGraphics(): void;
    /** sound on or off, or a volume changed: apply at once */
    onSound(): void;
    /** the shadow setting differs from what this page started with (it applies on reload) */
    shadowsPending(): boolean;
    /** the graphics level this page runs in (graphics.ts) */
    graphicsNow: GraphicsLevel;
    /** the graphics setting differs from what this page started with (it applies on reload) */
    graphicsPending(): boolean;
    save(): void;
    close(): void;
    /** the page's own sections for a tab, above (`top`) or below the screen's own */
    pageSections(tab: SettingsTab, where: 'top' | 'bottom'): Child[];
}

export type SettingsTab = 'radio' | 'camera' | 'graphics' | 'sound' | 'world' | 'about';

const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'radio', label: 'Radio and controls' },
    { id: 'camera', label: 'Camera' },
    { id: 'graphics', label: 'Graphics' },
    { id: 'sound', label: 'Sound' },
    { id: 'world', label: 'World and physics' },
    { id: 'about', label: 'Help and about' }
];

/** how far the shadows reach (render/shadow-follow.ts SHADOW_REACHES: the square's half side less up to 16 m) */
const SHADOW_REACH_LABELS: Record<ShadowReach, string> = {
    near: 'To about 110 m',
    far: 'To about 250 m (4x the shadow memory)',
    farthest: 'To about 500 m (softer up close, 4x the shadow memory)'
};

/** What each preset is, under the preset box */
const PRESET_NOTES: Record<QualityPreset | 'custom', string> = {
    high: 'Full lighting and fisheye lenses, shadows to about 250 m, full resolution.',
    medium: 'Full lighting and fisheye lenses, shadows to about 110 m, full resolution.',
    low: 'For a weak GPU: simple lighting, no shadows or fisheye lens, 650 m view.',
    verylow: 'Simple lighting at half resolution, 300 m view, no cars, people or traffic lights.',
    super: 'For no GPU at all: quarter resolution, 200 m view, no cars, people or traffic lights.',
    custom: 'Your own mix of the details below.'
};

/** The renderer levels (graphics.ts) as the Renderer box lists them */
const GRAPHICS_LABELS: Record<GraphicsLevel, string> = {
    full: 'Full (lit, shadows, fisheye lenses)',
    low: 'Simple (650 m view)',
    extra: 'Simple, half resolution (300 m view, no traffic)',
    super: 'Simple, quarter resolution (200 m view, no traffic)'
};

export class SettingsUi {
    readonly el: HTMLElement;
    private body = h('div');
    private host: SettingsHost | null = null;
    /** the rates being edited, applied with Apply */
    private draft: RatesConfig | null = null;
    private msg = '';
    /** the tab shown; kept between visits to the screen */
    private tab: SettingsTab = 'radio';

    constructor() {
        this.el = h('div', { class: 'overlay hidden' }, h('div', { class: 'panel' }, this.body));
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    show(host: SettingsHost): void {
        this.host = host;
        this.draft = copyRates(host.settings.rates ?? host.presetRates);
        this.msg = '';
        this.el.classList.remove('hidden');
        this.build();
    }

    hide(): void {
        this.el.classList.add('hidden');
    }

    /** Draw it again when what the page shows in it changed (a radio connected), keeping the tab. */
    refresh(): void {
        if (this.open && this.host) this.build();
    }

    /** Open on this tab next time (or now, when open). */
    showTab(tab: SettingsTab): void {
        this.tab = tab;
        this.refresh();
    }

    /** `done` runs when the drag ends (rebuilding the screen while dragging would drop the slider) */
    /** `show` writes the value for the label (default: the value and its unit) */
    private slider(label: string, min: number, max: number, value: number, unit: string, set: (v: number) => void, done?: () => void, show = (v: number) => `${v}${unit}`): HTMLElement {
        const out = h('span', {}, show(value));
        return h('div', { class: 'row' },
            h('span', { style: 'width:150px' }, label),
            h('input', { type: 'range', min, max, step: 1, value, oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = show(v); set(v); }, onchange: () => done?.() }),
            out);
    }

    /** Settings > World > Tune: the flight controller's tune (tunes.ts); picking one also sets its idle. */
    private tune(host: SettingsHost, s: Settings): HTMLElement[] {
        const ids = Object.keys(TUNES) as TuneId[];
        return [
            h('h2', {}, 'Tune'),
            this.field('Tune', this.select<TuneId>(s.tune, ids.map((id) => ({ value: id, label: TUNES[id].name })), (v) => {
                s.tune = v;
                const min = TUNES[v].dynIdleMinRpm;
                s.dynIdle = min !== null;
                if (min !== null) s.dynIdleMinRpm = min;
                host.save(); host.onFlight(); this.build();
            })),
            h('p', { class: 'note' }, `${TUNES[s.tune].note} Picking a tune also sets its motor idle below. Changing it restarts at the spawn point.`)
        ];
    }

    /** Settings > World > Motor idle: Betaflight's static idle, or its dynamic idle with its minimum rpm. */
    private idle(host: SettingsHost, s: Settings): HTMLElement[] {
        const apply = (): void => { host.save(); host.onFlight(); };
        const tenths = (v: number): string => `${(v / 10).toFixed(1)} %`;
        const min = host.dynIdleMinRpm;
        const out: HTMLElement[] = [
            h('h2', {}, 'Motor idle'),
            this.check('Dynamic idle (Betaflight: keeps the slowest motor above a minimum rpm instead of a fixed idle). Changing it restarts at the spawn point.', s.dynIdle && min !== null, (v) => { s.dynIdle = v; apply(); this.build(); })
        ];
        if (min === null) {
            out.push(h('p', { class: 'note' }, 'This quad has no prop size, so the game cannot pick its minimum rpm: dynamic idle is not available.'));
        }
        if (s.dynIdle && min !== null) {
            out.push(
                this.slider('Minimum rpm', 10, 100, s.dynIdleMinRpm, '', (v) => { s.dynIdleMinRpm = v; }, apply, (v) => `${v * 100} rpm`),
                h('p', { class: 'note' }, `Betaflight's dyn_idle_min_rpm (here ${s.dynIdleMinRpm}). The tune sets it: SupaflyFPV's preset uses 3000 rpm; Betaflight suggests 3000-4000 for a 5-inch; the game's own estimate from this quad's props is ${min * 100} rpm. On a real quad you find it by testing for desyncs, which the simulator does not have. The fixed idle is not used while dynamic idle is on, as in Betaflight 4.3 and later.`),
                this.slider('Max increase', 10, 255, s.dynIdleMaxIncrease, '', (v) => { s.dynIdleMaxIncrease = v; }, apply, tenths),
                this.slider('Start increase', 10, 255, s.dynIdleStartIncrease, '', (v) => { s.dynIdleStartIncrease = v; }, apply, tenths),
                h('p', { class: 'note' }, "How far dynamic idle may raise the motors' floor in flight (dyn_idle_max_increase, default 15 %) and before airmode is active, until the throttle first passes 25 % after arming (dyn_idle_start_increase, default 5 %)."),
                this.slider('P gain', 1, 250, s.dynIdleP, '', (v) => { s.dynIdleP = v; }, apply),
                this.slider('I gain', 1, 250, s.dynIdleI, '', (v) => { s.dynIdleI = v; }, apply),
                this.slider('D gain', 0, 250, s.dynIdleD, '', (v) => { s.dynIdleD = v; }, apply),
                h('p', { class: 'note' }, "How hard it corrects the rpm (dyn_idle_p_gain, _i_gain, _d_gain, Betaflight's default 50 each). Betaflight's notes: strong 6S quads may want less P (about 40); if the rpm wobbles, lower P.")
            );
        } else {
            out.push(
                this.slider('Motor idle', 0, 200, s.motorIdle, '', (v) => { s.motorIdle = v; }, apply, tenths),
                h('p', { class: 'note' }, "The motors' lowest output while armed (Betaflight's dshot_idle_value, motor_idle in 2025.12): 5.5 % is Betaflight's default and this quad's. Changing it restarts at the spawn point.")
            );
        }
        return out;
    }

    private check(label: string, value: boolean, set: (v: boolean) => void): HTMLElement {
        return h('label', { class: 'row' },
            h('input', { type: 'checkbox', checked: value, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }),
            h('span', {}, label));
    }

    /** A setting's row: its name in a column on the left, the control on the right. */
    private field(label: string, control: HTMLElement): HTMLElement {
        return h('div', { class: 'row' }, h('span', { style: 'width:150px' }, label), control);
    }

    private select<T extends string>(value: T, options: readonly { value: T; label: string; disabled?: boolean }[], set: (v: T) => void): HTMLElement {
        return h('select', { onchange: (e: Event) => set((e.target as HTMLSelectElement).value as T) },
            ...options.map((o) => h('option', { value: o.value, selected: o.value === value, disabled: o.disabled ?? false }, o.label)));
    }

    /** Settings > Graphics: the quality preset, then its details, as saved (the renderer and shadows on/off apply on reload). */
    private graphics(host: SettingsHost, s: Settings): (HTMLElement | null)[] {
        const changed = (): void => { host.onGraphics(); host.save(); this.build(); };
        const preset = presetOf(s);
        const shadow: ShadowReach | 'off' = s.shadows ? s.shadowReach : 'off';
        return [
            this.field('Quality preset', this.select<QualityPreset | 'custom'>(preset, [
                ...QUALITY_PRESETS.map((p) => ({ value: p, label: PRESET_NAMES[p] })),
                ...(preset === 'custom' ? [{ value: 'custom' as const, label: PRESET_NAMES.custom, disabled: true }] : [])
            ], (v) => { if (v !== 'custom') applyPreset(s, v); changed(); })),
            h('p', { class: 'note' }, PRESET_NOTES[preset]),
            h('div', { class: 'subhead' }, 'Details'),
            this.field('Renderer', this.select<GraphicsLevel>(s.graphics, GRAPHICS_LEVELS.map((g) => ({ value: g, label: GRAPHICS_LABELS[g] })),
                (v) => { s.graphics = v; changed(); })),
            s.graphics === 'extra' || s.graphics === 'super'
                ? this.field('Resolution', h('span', { class: 'note' }, `${s.graphics === 'extra' ? 'Half' : 'A quarter'}, set by this renderer`))
                : this.slider('Resolution', 50, 100, Math.round(s.renderScale * 100), '%', (v) => { s.renderScale = v / 100; host.onGraphics(); host.save(); }, () => this.build()),
            isLowSpec(s.graphics)
                ? this.field('Shadows', h('span', { class: 'note' }, 'None with this renderer'))
                : this.field('Shadows', this.select<ShadowReach | 'off'>(shadow, [
                    { value: 'off', label: 'Off' },
                    ...SHADOW_REACH_IDS.map((r) => ({ value: r, label: SHADOW_REACH_LABELS[r] }))
                ], (v) => { s.shadows = v !== 'off'; if (v !== 'off') s.shadowReach = v; changed(); })),
            host.graphicsNow !== s.graphics && !host.graphicsPending()
                ? h('p', { class: 'note' }, `This visit runs in ${graphicsName(host.graphicsNow)} mode: the page address says so (?lowspec).`)
                : null,
            host.graphicsPending() || host.shadowsPending()
                ? h('div', { class: 'row' }, h('span', { class: 'hint' }, 'A new renderer, or shadows on or off, applies when the page reloads.'), h('button', { onclick: () => location.reload() }, 'Reload now'))
                : null,
            h('p', { class: 'note' }, 'The physics is the same at every setting.')
        ];
    }

    private build(): void {
        const host = this.host!;
        const s = host.settings;
        const d = this.draft!;
        const using = s.rates ? 'yours' : 'the preset\'s';
        const max = fullStickRates(d);
        const fields = RATE_FIELDS[d.type];
        const table = h('table', { class: 'rates' },
            h('tr', {}, h('th', {}), ...fields.map((f) => h('th', {}, FIELD_LABEL[f.name])), h('th', {}, 'Max °/s')),
            ...RATE_AXES.map((axis: RateAxis) => h('tr', {},
                h('td', {}, axis[0].toUpperCase() + axis.slice(1)),
                ...fields.map((f) => h('td', {}, h('input', {
                    value: shownText(f, d[axis][f.key]),
                    onchange: (e: Event) => {
                        const r = readField(f, (e.target as HTMLInputElement).value);
                        if (r.ok) {
                            this.draft = withField(this.draft!, axis, f.key, r.stored);
                            this.msg = r.adjusted ? 'A value was moved into Betaflight\'s allowed range.' : '';
                        } else this.msg = 'That is not a number.';
                        this.build();
                    }
                }))),
                h('td', {}, String(Math.round(max[axis]))))));
        const own: Record<SettingsTab, Child[]> = {
            radio: [
                h('h2', {}, 'Flight mode (when your radio has no mode switch)'),
                h('div', { class: 'row' }, h('select', { onchange: (e: Event) => { s.mode = (e.target as HTMLSelectElement).value as FlightMode; host.save(); } },
                    ...(['acro', 'horizon', 'angle'] as FlightMode[]).map((m) => h('option', { value: m, selected: s.mode === m }, m[0].toUpperCase() + m.slice(1))))),
                h('h2', {}, 'Rates'),
                h('p', { class: 'note' }, `Flying with ${using} rates. Type your Betaflight rates as Configurator shows them, then Apply.`),
                h('div', { class: 'row' }, h('span', {}, 'Rates type'),
                    h('select', { onchange: (e: Event) => {
                        const t = (e.target as HTMLSelectElement).value as RatesType;
                        // switching type keeps the feel: the closest curves of the new type (sim-core fitRates)
                        this.draft = fitRates(this.draft!, t).config;
                        this.msg = `Converted to ${t === 'ACTUAL' ? 'Actual' : 'Betaflight'} rates with the closest curves.`;
                        this.build();
                    } }, ...TYPES.map((t) => h('option', { value: t.type, selected: d.type === t.type }, t.label)),
                    ...(TYPES.some((t) => t.type === d.type) ? [] : [h('option', { value: d.type, selected: true }, d.type)]))),
                table,
                h('div', { class: 'hint' }, this.msg),
                h('div', { class: 'row' },
                    h('button', { onclick: () => { s.rates = null; this.draft = copyRates(host.presetRates); this.msg = 'Back to the preset\'s rates.'; host.save(); host.onFlight(); this.build(); } }, 'Preset default'),
                    h('button', { class: 'primary', onclick: () => { s.rates = copyRates(this.draft!); this.msg = 'Applied: your quad is back at the spawn point with these rates.'; host.save(); host.onFlight(); this.build(); } }, 'Apply rates')),
            ],
            camera: [
                h('h2', {}, 'FPV camera'),
                this.slider('Camera uptilt', 0, 60, s.uptiltDeg, '°', (v) => { s.uptiltDeg = v; host.onCamera(); host.save(); }),
                isLowSpec(host.graphicsNow)
                    ? h('p', { class: 'note' }, 'Low spec modes draw a flat camera (a fisheye lens draws the city up to five times a frame).')
                    : h('div', { class: 'row' }, h('span', { style: 'width:150px' }, 'Lens'),
                    h('select', { onchange: (e: Event) => { s.lens = (e.target as HTMLSelectElement).value; host.onCamera(); host.save(); this.build(); } },
                        h('option', { value: NO_LENS, selected: s.lens === NO_LENS }, 'Flat (no fisheye), field of view below'),
                        ...LENSES.map((l) => {
                            const f = lensFov(l);
                            return h('option', { value: l.id, selected: s.lens === l.id }, `${l.label}: ${Math.round(f.h)}° x ${Math.round(f.v)}°`);
                        }))),
                // a real lens sets its own field of view (owner, 2026-10-18: hide the slider then)
                s.lens === NO_LENS || isLowSpec(host.graphicsNow)
                    ? this.slider('Field of view', 80, 150, s.fovDeg, '°', (v) => { s.fovDeg = v; host.onCamera(); host.save(); })
                    : h('p', { class: 'note' }, `Lens calibrations from Gyroflow's lens profile database (CC0). The picture keeps the camera's shape, with black bars where it is narrower than the screen.`),
            ],
            graphics: [
                // what is drawn and how, laid out as games do (owner, 2026-10-19): a quality preset, then the details it sets;
                // changing a detail makes it "Custom". The physics is the same at every setting.
                h('h2', {}, 'Graphics'),
                ...this.graphics(host, s),
            ],
            sound: [
                h('h2', {}, 'Sound'),
                this.check('Sound on (M turns it on and off while flying)', s.sound, (v) => { s.sound = v; host.save(); host.onSound(); this.build(); }),
                this.slider('Volume', 0, 100, s.volume, '%', (v) => { s.volume = v; host.onSound(); host.save(); }),
                this.slider('Quad', 0, 100, s.quadVolume, '%', (v) => { s.quadVolume = v; host.onSound(); host.save(); }),
                this.slider('Trains and airport', 0, 100, s.worldVolume, '%', (v) => { s.worldVolume = v; host.onSound(); host.save(); }),
                this.slider('Ambience', 0, 100, s.ambienceVolume, '%', (v) => { s.ambienceVolume = v; host.onSound(); host.save(); }),
                this.slider('Game sounds', 0, 100, s.effectsVolume, '%', (v) => { s.effectsVolume = v; host.onSound(); host.save(); }),
                this.check('Low latency sound (about 45 ms sooner, on sound devices that offer it; turns itself off if it crackles)', s.soundLowLatency, (v) => { s.soundLowLatency = v; host.save(); host.onSound(); }),
                h('p', { class: 'note' }, 'Quad: the motors and props from the physics (each rotor\'s speed), hits and prop strikes. Trains and airport: the steam trains, the planes, the helicopter and the tugs. Ambience: the city\'s traffic and the park\'s birds (low by default: turn it up here). Game sounds: the time trial beeps and the golden prop chime.'),
                h('p', { class: 'note' }, 'Sound late? Chrome on Windows adds about 50-65 ms; a virtual mixer (such as Voicemeeter) or Bluetooth headphones add more after it. Wired headphones on a device the browser plays to directly are quickest.'),
                h('p', { class: 'note' }, 'On the FPV camera you hear the quad from on board, wind on the camera\'s microphone included; on the chase camera from behind it, as someone standing there would. Headphones place the sounds best.'),
            ],
            world: [
                // the quad (quads.ts): its weight, props and sound are set up at start, so a change reloads the game
                h('h2', {}, 'Quad'),
                this.field('Quad', this.select<QuadId>(s.quad, (Object.keys(QUADS) as QuadId[]).map((id) => ({ value: id, label: QUADS[id].name })), (v) => {
                    if (v === s.quad) return;
                    s.quad = v;
                    s.tune = QUADS[v].tune;
                    const min = TUNES[s.tune].dynIdleMinRpm;
                    s.dynIdle = min !== null;
                    if (min !== null) s.dynIdleMinRpm = min;
                    host.save();
                    location.reload();
                })),
                h('p', { class: 'note' }, `${QUADS[s.quad].note} Picking a quad sets its own tune and reloads the game.`),
                // what moves in the world: all of it is solid (you can hit it and land on it), so a change restarts the flight
                h('h2', {}, 'Traffic and train'),
                ...(trafficAllowed(host.graphicsNow)
                    ? [
                        this.check('Cars (solid: you can hit them and land on them)', s.cars, (v) => { s.cars = v; host.save(); host.onTraffic(); }),
                        this.check('People (solid too)', s.people, (v) => { s.people = v; host.save(); host.onTraffic(); }),
                        this.check('Traffic lights and realistic driving (off: cars and people just circle their block)', s.signals, (v) => { s.signals = v; host.save(); host.onTraffic(); })
                    ]
                    : [h('p', { class: 'note' }, `No cars, people or traffic lights in ${graphicsName(host.graphicsNow)} mode.`)]),
                this.check('Steam trains (two, solid: round the whole map, stopping at the fields and city stations; people ride them)', s.train, (v) => { s.train = v; host.save(); host.onTraffic(); }),
                this.check('Airport traffic (ten planes landing, taxiing, towed into the hangars and taking off; the air ambulance to the hospital roof; all solid)', s.air, (v) => { s.air = v; host.save(); host.onTraffic(); }),
                h('p', { class: 'note' }, 'Changing any of these restarts at the spawn point (what you can hit changes).'),
                h('h2', {}, 'Physics'),
                this.check('Classic physics (the flight model before the airflow update, to compare). Changing it restarts at the spawn point.', s.classicPhysics, (v) => { s.classicPhysics = v; host.save(); host.onFlight(); }),
                h('p', { class: 'note' }, 'Off: each prop feels the air through it, so thrust fades as you climb fast and grows as you fly forward, as measured on real 5-inch quads.'),
                this.check('Battery simulation (the pack drains as you fly and the quad gets weaker; off: always a full pack). Changing it restarts at the spawn point.', s.battery, (v) => { s.battery = v; host.save(); host.onFlight(); }),
                h('p', { class: 'note' }, 'With it on, the pack is full again whenever you go back to the start point or onto a time trial pad.'),
                this.slider('Arming angle', 0, 180, s.armAngle, '°', (v) => { s.armAngle = v; }, () => { host.save(); host.onFlight(); }),
                h('p', { class: 'note' }, "Arming needs the quad within this tilt of level (Betaflight's small_angle). 180° (the default here) arms at any tilt; 25° is Betaflight's own default. Changing it restarts at the spawn point."),
                this.field('Gyro / PID loop', this.select<string>(String(s.loopHz), [{ value: '4000', label: '4 kHz' }, { value: '8000', label: '8 kHz' }], (v) => {
                    s.loopHz = v === '8000' ? 8000 : 4000; host.save(); host.onFlight();
                })),
                h('p', { class: 'note' }, "How often the flight controller reads the gyro and runs its PID loop, as on a real Betaflight board (pid_process_denom): most run 4 kHz, some 8 kHz. The physics steps at the same rate. Changing it restarts at the spawn point."),
                this.check('ESC delay (the motors answer 4 ms late, as measured on a real quad). Changing it restarts at the spawn point.', s.escDelay, (v) => { s.escDelay = v; host.save(); host.onFlight(); }),
                this.check('Dynamic inflow (the air through each prop takes a moment to follow a change of rpm). Changing it restarts at the spawn point.', s.dynamicInflow, (v) => { s.dynamicInflow = v; host.save(); host.onFlight(); }),
                h('p', { class: 'note' }, 'Both are real effects, here as switches to compare. With the ESC delay on, a hard throttle chop at speed shakes more; dynamic inflow calms it. Classic physics has no dynamic inflow.'),
                ...this.tune(host, s),
                ...this.idle(host, s),
                h('h2', {}, 'Crashes and damage'),
                this.check('Damage and crashes (off: every hit is a bounce and you keep flying). Changing it restarts at the spawn point.', s.damage, (v) => { s.damage = v; host.save(); host.onFlight(); }),
            ],
            about: []
        };
        clear(this.body,
            h('div', { class: 'title' }, h('h1', {}, 'Settings'), closeButton(() => host.close())),
            h('div', { class: 'tabs', role: 'tablist' }, ...TABS.map((t) => h('button', {
                class: t.id === this.tab ? 'on' : '', role: 'tab', 'aria-selected': String(t.id === this.tab),
                onclick: () => { this.tab = t.id; this.build(); }
            }, t.label))),
            ...host.pageSections(this.tab, 'top'),
            ...own[this.tab],
            ...host.pageSections(this.tab, 'bottom'),
            h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { onclick: () => host.close() }, 'Done'))
        );
    }
}

/** A close button (an X), top right of a screen; Esc does the same. */
export function closeButton(onclick: () => void): HTMLButtonElement {
    return h('button', { class: 'icon-btn close-btn', onclick, title: 'Close (Esc)', 'aria-label': 'Close' }, '\u00d7');
}
