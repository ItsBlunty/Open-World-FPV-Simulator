// Settings screen: FPV camera, flight mode without a mode switch, and the pilot's rates. The rates box
// offers Betaflight's two common rate types; field names, scales and limits are sim-core's
// rates-edit.ts (read from Betaflight Configurator 10.10.0 by sim-core's author), so values typed
// here mean what they mean in Configurator.

import { RATE_AXES, RATE_FIELDS, copyRates, fitRates, fullStickRates, readField, shownText, withField } from '@owfpv/sim-core';
import type { FlightMode, RateAxis, RateFieldName, RatesConfig, RatesType } from '@owfpv/sim-core';
import type { Settings } from '../settings';
import { h, clear } from './dom';

const FIELD_LABEL: Record<RateFieldName, string> = {
    rcRate: 'RC Rate', superRate: 'Super Rate', expo: 'Expo', rcCurve: 'RC Curve',
    centerSensitivity: 'Center Sensitivity', maxRate: 'Max Rate', rate: 'Rate', acroPlus: 'Acro+'
};
const TYPES: { type: RatesType; label: string }[] = [{ type: 'BETAFLIGHT', label: 'Betaflight' }, { type: 'ACTUAL', label: 'Actual' }];

export interface SettingsHost {
    settings: Settings;
    /** the preset's own rates, for "Preset default" */
    presetRates: RatesConfig;
    /** camera settings changed: apply at once */
    onCamera(): void;
    /** rates or mode changed: the flight model needs a new life */
    onFlight(): void;
    save(): void;
    close(): void;
}

export class SettingsUi {
    readonly el: HTMLElement;
    private body = h('div');
    private host: SettingsHost | null = null;
    /** the rates being edited, applied with Apply */
    private draft: RatesConfig | null = null;
    private msg = '';

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

    private slider(label: string, min: number, max: number, value: number, unit: string, set: (v: number) => void): HTMLElement {
        const out = h('span', {}, `${value}${unit}`);
        return h('div', { class: 'row' },
            h('span', { style: 'width:150px' }, label),
            h('input', { type: 'range', min, max, step: 1, value, oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = `${v}${unit}`; set(v); } }),
            out);
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
        clear(this.body,
            h('h1', {}, 'Settings'),
            h('h2', {}, 'FPV camera'),
            this.slider('Camera uptilt', 0, 60, s.uptiltDeg, '°', (v) => { s.uptiltDeg = v; host.onCamera(); host.save(); }),
            this.slider('Field of view', 80, 150, s.fovDeg, '°', (v) => { s.fovDeg = v; host.onCamera(); host.save(); }),
            h('h2', {}, 'Flight mode (when your radio has no mode switch)'),
            h('div', { class: 'row' }, h('select', { onchange: (e: Event) => { s.mode = (e.target as HTMLSelectElement).value as FlightMode; host.save(); } },
                ...(['acro', 'horizon', 'angle'] as FlightMode[]).map((m) => h('option', { value: m, selected: s.mode === m }, m[0].toUpperCase() + m.slice(1))))),
            h('h2', {}, 'Crashes and damage'),
            h('label', { class: 'row' },
                h('input', { type: 'checkbox', checked: s.damage, onchange: (e: Event) => { s.damage = (e.target as HTMLInputElement).checked; host.save(); host.onFlight(); } }),
                h('span', {}, 'Damage and crashes (off: every hit is a bounce and you keep flying). Changing it restarts at the spawn point.')),
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
            h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { onclick: () => host.close() }, 'Done'))
        );
    }
}
