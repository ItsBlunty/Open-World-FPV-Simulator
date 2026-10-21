// Flight-controller tunes the pilot can pick (Settings > World and physics > Tune). Each sets the built-in Betaflight
// controller's gains and tuning features through sim-core's ParamOverrides; saved flights keep the overrides they were
// flown with, so changing the tune never breaks a replay.

import type { ParamOverrides, TpaConfig } from '@owfpv/sim-core';

export type TuneId = 'supafly5' | 'betaflight' | 'original';

export interface Tune {
    name: string;
    note: string;
    /** PID gains [P, I, D, F]; absent: the quad preset's own */
    pid?: { roll: number[]; pitch: number[]; yaw: number[] };
    tpa?: TpaConfig;
    thrustLinear?: number;
    itermRelaxCutoff?: number;
    antiGravityGain?: number;
    /** dynamic idle minimum (x 100 rpm) the tune turns on when picked; null: it turns dynamic idle off */
    dynIdleMinRpm: number | null;
}

export const DEFAULT_TUNE: TuneId = 'supafly5';

export const TUNES: Readonly<Record<TuneId, Tune>> = {
    // SupaflyFPV Freestyle 5 Inch, betaflight/firmware-presets presets/4.5/tune/supafly_fpv (GPL-3.0), its default
    // option "Flying with Action Camera". The preset sets Betaflight's simplified-tuning sliders (master 115, PI 110,
    // I 85, D 105, FF 85, pitch PI 120, pitch D 120, dmax 0); the gains below are what Betaflight 4.5.1's
    // simplified_tuning.c makes of them on the 4.5 defaults. Owner's pick, 2026-10-21.
    supafly5: {
        name: 'SupaflyFPV Freestyle 5"',
        note: 'The official Betaflight preset by SupaflyFPV for 5-inch freestyle quads (Betaflight 4.5, action-camera option): stronger pitch, thrust linear 30, TPA on P and D, dynamic idle 3000 rpm, anti-gravity 120, I-term relax cutoff 10.',
        pid: { roll: [56, 86, 36, 117], pitch: [71, 108, 49, 146], yaw: [56, 86, 0, 117] },
        tpa: { mode: 'PD', rate: 50, breakpoint: 1250, lowRate: 20, lowBreakpoint: 1100, lowAlways: true },
        thrustLinear: 30,
        itermRelaxCutoff: 10,
        antiGravityGain: 120,
        dynIdleMinRpm: 30
    },
    // Betaflight 4.5's defaults (pid.c resetPidProfile): TPA on D, 65 % from 1350, the low-throttle part until the first
    // take-off; anti-gravity 80, relax 15, no thrust linear, dynamic idle off. Betaflight's D moves between 30 and 40
    // (dynamic D); the built-in controller has fixed D, so it runs at the peak, 40 (46 on pitch), as before.
    betaflight: {
        name: 'Betaflight defaults',
        note: "Betaflight 4.5's own default tune, with its default TPA (on D, from 35 % throttle). D is fixed at its peak: the simulator has no dynamic D yet.",
        tpa: { mode: 'D', rate: 65, breakpoint: 1350, lowRate: 20, lowBreakpoint: 1050, lowAlways: false },
        dynIdleMinRpm: null
    },
    // the quad preset's own gains, no TPA, no thrust linear: on the Nazgul the simulator's tune before 2026-10-21 (Betaflight's
    // defaults), on the UZH Kingfisher its logged Betaflight 4.2 tune
    original: {
        name: "The quad's own tune",
        note: "The gains the quad comes with, no TPA: on the Nazgul Betaflight's default gains (the simulator's tune before the presets), on the UZH Kingfisher the tune from its own flight logs.",
        dynIdleMinRpm: null
    }
};

export function isTuneId(v: unknown): v is TuneId {
    return v === 'supafly5' || v === 'betaflight' || v === 'original';
}

/** The tune's part of the flight model's overrides (the idle comes from the idle settings, which the tune sets when picked). */
export function tuneOverrides(id: TuneId, o: ParamOverrides): void {
    const t = TUNES[id];
    if (t.pid) o.pid = { roll: [...t.pid.roll], pitch: [...t.pid.pitch], yaw: [...t.pid.yaw] };
    if (t.tpa) o.tpa = { ...t.tpa };
    if (t.thrustLinear !== undefined) o.thrustLinear = t.thrustLinear;
    if (t.itermRelaxCutoff !== undefined) o.itermRelaxCutoff = t.itermRelaxCutoff;
    if (t.antiGravityGain !== undefined) o.antiGravityGain = t.antiGravityGain;
}
