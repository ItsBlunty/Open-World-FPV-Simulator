// BetaFPV's Air75 II (2026-11-09): three presets (Freestyle 22000KV, Racing 25000KV, Champion 28000KV) built from
// BetaFPV's pages, its bench of the 0802 (2026) motors on the Gemfan 1614 prop and its Betaflight 2026.6 CLI files
// (docs/notes/physics.md §2w, docs/evidence/2026-11-09-air75-ii). Checks the ducted-whoop collider, that the
// thrust-to-weight is the bench thrust carried to the model's own sagged voltage, the stock tunes, the throttle-curve
// fit, and that the three fly as a 1S whoop should. Every check has a control that fails the same predicate.
import { describe, expect, it } from 'vitest';
import { S, compileParams, hoverSolve, setpointRate, throttleCurve } from '../src/index';
import type { ParamOverrides, PresetJson, SimParams } from '../src/index';
import { hovering, params, preset, rate } from './model-helpers';

const F = 'air75ii-freestyle-1s', R = 'air75ii-racing-1s', C = 'air75ii-champion-1s';
const IDS = [F, R, C] as const;
/** BetaFPV's bench at 100 % throttle on the GF 1614-3P: supply volts, grams, amps (the motor page's load table). */
const BENCH: Record<string, { v: number; g: number; a: number }> = {
    [F]: { v: 3.86, g: 47.7, a: 5.9 },
    [R]: { v: 3.82, g: 55.0, a: 8.15 },
    [C]: { v: 3.81, g: 58.2, a: 9.0 }
};
/** Betaflight 2026's throttle curve in BetaFPV's CLI files: thr_mid, thr_expo, thr_hover. */
const BF_THR: Record<string, [number, number, number]> = { [R]: [28, 25, 17], [C]: [25, 45, 16] };
const R2D = 180 / Math.PI;

/** The fixed point the preset's twr should sit on: the bench thrust x (V_loaded / V_bench)^2, x4, over the weight. */
function benchTwr(id: string, sp: SimParams): number {
    const b = BENCH[id];
    return (4 * (b.g / 1000) * (sp.vNom / b.v) ** 2) / sp.mass;
}

/**
 * Betaflight 2026's throttle curve (src/main/fc/rc.c generateThrottleCurve, read 2026-11-09): two quadratic Beziers
 * through the hover point (thr_mid, thr_hover), their control points between the diagonal and the hover height by expo.
 * With cp1x = mid / 2 and cp2x = (1 + mid) / 2 the x-parameter is linear, so the curve is explicit.
 */
function bfCurve(x: number, mid: number, expo: number, hoverY: number): number {
    const m = mid / 100, e = expo / 100, h = hoverY / 100;
    const cp1y = h * 0.5 * (1 + e);
    const cp2y = 1 + (h - 1) * 0.5 * (1 + e);
    if (x <= m) {
        const t = x / m;
        return 2 * (1 - t) * t * cp1y + t * t * h;
    }
    const t = (x - m) / (1 - m);
    return (1 - t) * (1 - t) * h + 2 * (1 - t) * t * cp2y + t * t;
}

function maxCurveGap(tc: { mid: number; expo: number }, bf: [number, number, number]): number {
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
        const x = i / 100;
        worst = Math.max(worst, Math.abs(throttleCurve(x, tc) - bfCurve(x, bf[0], bf[1], bf[2])));
    }
    return worst;
}

/** deg/s reached 20 ms after a full roll stick from an acro hover, and the stick's target */
function rollAt20ms(sp: SimParams): { rate: number; target: number } {
    const { sim, ch } = hovering(sp, 'acro');
    ch[0] = 1; sim.setChannels(ch);
    for (let i = 0; i < 20; i++) sim.step();
    return { rate: Math.abs(rate(sim, 'roll')), target: setpointRate(sp.rates.type, 1, sp.rates.roll, sp.rates.rateLimit) };
}

/** Level top speed, km/h: full throttle at the tilt where thrust just carries the weight, 20 s (as model-drones-v08). */
function topSpeedKmh(pj: PresetJson, o: ParamOverrides = {}): number {
    const tilt = Math.acos(1 / compileParams(pj, o).twr) * R2D;
    const { sim, ch } = hovering(compileParams(pj, { ...o, level: { limitDeg: tilt } }), 'angle');
    ch[1] = 1; ch[2] = 1; sim.setChannels(ch);
    for (let i = 0; i < 20000; i++) sim.step();
    return Math.sqrt(sim.s[S.vx] ** 2 + sim.s[S.vz] ** 2) * 3.6;
}

describe('Air75 II: a ducted 75 mm whoop in the collider', () => {
    it('a 23 mm sphere on each motor (26.5 mm out on both axes) and a 25 mm body: 99 mm over the ducts, resting 25 mm up', () => {
        for (const id of IDS) {
            const p = params(id);
            expect(p.spheres.length, id).toBe(20);
            const arm = 75 / 2000 / Math.SQRT2;
            expect(Array.from(p.motorPos)).toEqual([arm, 0, arm, arm, 0, -arm, -arm, 0, arm, -arm, 0, -arm]);
            for (let i = 0; i < 4; i++) {
                expect(Math.abs(p.spheres[i * 4])).toBeCloseTo(0.0265, 6);
                expect(Math.abs(p.spheres[i * 4 + 2])).toBeCloseTo(0.0265, 6);
                expect(p.spheres[i * 4 + 3]).toBe(0.023);
            }
            expect(p.spheres[19]).toBe(0.025);
            expect(p.boundRadius * 1000).toBeCloseTo(26.5 * Math.SQRT2 + 23, 6);
            expect(p.bodyBottom).toBe(0.025);
            expect(p.mass).toBeLessThan(0.035);
        }
    });

    it('control: the 65 mm whoop presets are one sphere, no ducts', () => {
        expect(params('air65-1s').spheres.length).toBe(4);
        expect(params('meteor65pro-1s').spheres.length).toBe(4);
    });
});

describe('Air75 II: thrust-to-weight from BetaFPV\'s bench at the model\'s own sagged voltage', () => {
    it('each twr is the fixed point of the bench thrust x (V_loaded / V_bench)^2 within 3 %, Champion > Racing > Freestyle', () => {
        for (const id of IDS) {
            const p = params(id);
            expect(Math.abs(benchTwr(id, p) - p.twr) / p.twr, id).toBeLessThan(0.03);
            // the loaded pack is well under the bench's supply voltage: the sag is the point
            expect(p.vNom, id).toBeLessThan(BENCH[id].v - 0.3);
            expect(p.vNom, id).toBeGreaterThan(3.1);
            // the model's full-throttle current per motor: below the bench's at its higher voltage, not far below
            const perMotor = (4.2 - p.vNom) / p.rPack / 4;
            expect(perMotor, id).toBeLessThan(BENCH[id].a);
            expect(perMotor, id).toBeGreaterThan(0.7 * BENCH[id].a);
        }
        expect(params(C).twr).toBeGreaterThan(params(R).twr);
        expect(params(R).twr).toBeGreaterThan(params(F).twr);
        expect(params(F).twr).toBeGreaterThan(4);
    });

    it('control: with no pack resistance the fixed point is the bench\'s own number, more than 10 % off the preset\'s', () => {
        for (const id of IDS) {
            const pj = preset(id);
            pj.fields.pack_resistance_per_cell_ohm = { value: 1e-9, source: 'estimate' };
            const p = compileParams(pj);
            expect(Math.abs(benchTwr(id, p) - p.twr) / p.twr, id).toBeGreaterThan(0.1);
        }
    });
});

describe('Air75 II: BetaFPV\'s stock tunes (CLI files of 2026-05-15, Betaflight 2026.6.0)', () => {
    it('rates: ACTUAL, 70 deg/s centre, Freestyle 750 / 750 / 700 deg/s with expo, Racing and Champion 580 / 580 / 500 without', () => {
        const max = (p: SimParams, ax: 'roll' | 'pitch' | 'yaw') => setpointRate(p.rates.type, 1, p.rates[ax], p.rates.rateLimit);
        for (const id of IDS) {
            const p = params(id);
            expect(p.rates.type, id).toBe('ACTUAL');
            expect(p.rates.roll.rcRate, id).toBe(7);
        }
        const f = params(F), r = params(R), c = params(C);
        expect([max(f, 'roll'), max(f, 'pitch'), max(f, 'yaw')]).toEqual([750, 750, 700]);
        expect([f.rates.roll.expo, f.rates.yaw.expo]).toEqual([10, 5]);
        for (const p of [r, c]) {
            expect([max(p, 'roll'), max(p, 'pitch'), max(p, 'yaw')]).toEqual([580, 580, 500]);
            expect(p.rates.roll.expo).toBe(0);
        }
    });

    it('PIDs (P, I, D, F) and motor idle as the files say', () => {
        expect(params(F).pid).toEqual({ roll: [33, 60, 21, 35], pitch: [33, 59, 21, 35], yaw: [33, 60, 0, 35] });
        expect(params(R).pid).toEqual({ roll: [35, 76, 21, 43], pitch: [31, 68, 25, 38], yaw: [35, 76, 0, 43] });
        expect(params(C).pid).toEqual({ roll: [33, 60, 22, 31], pitch: [33, 59, 22, 31], yaw: [33, 60, 0, 31] });
        expect([params(F).idle, params(R).idle, params(C).idle]).toEqual([0.055, 0.06, 0.035]);
        expect(params(F).throttle).toEqual({ mid: 50, expo: 0 });
    });

    it('Racing and Champion: the two-parameter curve sits within 3 % of throttle of Betaflight 2026\'s three-point curve', () => {
        for (const id of [R, C]) expect(maxCurveGap(params(id).throttle, BF_THR[id]), id).toBeLessThan(0.031);
        // the real curve passes under the diagonal at the hover point (28 % stick -> 17 % throttle)
        expect(bfCurve(0.28, 28, 25, 17)).toBeCloseTo(0.17, 9);
        expect(bfCurve(1, 28, 25, 17)).toBeCloseTo(1, 9);
    });

    it('control: Betaflight\'s default curve (50 / 0) misses it by more than 8 %', () => {
        for (const id of [R, C]) expect(maxCurveGap({ mid: 50, expo: 0 }, BF_THR[id]), id).toBeGreaterThan(0.08);
    });
});

describe('Air75 II flies as a 1S whoop', () => {
    it('hovers at 33-42 % motor on a fresh pack, with rotor inflow and prop wash on (the first whoops with them)', () => {
        for (const id of IDS) {
            const p = params(id);
            const h = hoverSolve(p, 1);
            expect(h.motor, id).toBeGreaterThan(0.33);
            expect(h.motor, id).toBeLessThan(0.42);
            expect(p.inflow, id).not.toBeNull();
            expect(p.wakeLoss, id).toBe(0.25);
            expect(p.wakeArea, id).toBeCloseTo(4 * Math.PI * 0.02 * 0.02, 9);
        }
    });

    it('the pack lasts 12-16 min hovering on 85 % of 480 mAh: about twice BetaFPV\'s 6:50-7:30 flights (a known gap, constant kappa / eta)', () => {
        for (const id of IDS) {
            const p = params(id);
            const h = hoverSolve(p, 1);
            const minutes = (p.capacityAs * 0.85) / ((4.2 - h.volts) / p.rPack) / 60;
            expect(minutes, id).toBeGreaterThan(12);
            expect(minutes, id).toBeLessThan(16);
        }
    });

    it('a full roll stick reaches at least 60 % of its rate within 20 ms (little inertia), 50-70 km/h level top speed', () => {
        for (const id of IDS) {
            const r20 = rollAt20ms(params(id));
            expect(r20.rate / r20.target, id).toBeGreaterThan(0.6);
            const v = topSpeedKmh(preset(id));
            expect(v, id).toBeGreaterThan(50);
            expect(v, id).toBeLessThan(70);
        }
    });

    it('control: the cinelifter takes over 35 ms to 63 % and the 5-inch race quad tops 160 km/h', () => {
        const cine = rollAt20ms(params('taurusx8-komodo-6s'));
        expect(cine.rate / cine.target).toBeLessThan(0.6);
        expect(topSpeedKmh(preset('machr5sport-6s'))).toBeGreaterThan(160);
    });

    it('each is its own drone with the fields the picker shows, from the maker', () => {
        for (const id of IDS) {
            const pj = preset(id);
            expect(pj.name).toContain('Air75 II');
            expect(pj.class).toBe('75 mm brushless tiny whoop');
            for (const k of ['motor', 'prop', 'battery', 'dry_mass_g', 'flight_time', 'motor_kv', 'wheelbase_mm']) {
                expect(pj.fields[k].source, `${id} ${k}`).toBe('manufacturer');
                expect(pj.fields[k].ref, `${id} ${k}`).toMatch(/^https:\/\/betafpv\.com\//);
            }
            for (const k of ['rates', 'pid_roll', 'pid_pitch', 'pid_yaw']) expect(pj.fields[k].ref, `${id} ${k}`).toMatch(/support\.betafpv\.com/);
        }
        expect(new Set(IDS.map((id) => params(id).twr)).size).toBe(3);
    });
});
