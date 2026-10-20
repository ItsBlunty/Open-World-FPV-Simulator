// Rotor inflow (sim-core/0.6.0, docs/physics-review.md G1): a prop's thrust follows the air through it (blade-element
// thrust of Gill and D'Andrea 2019, Glauert's momentum theory), on the presets with prop_pitch_in (the Nazgul only);
// classicPhysics brings back the 0.5.0 model bit for bit. Every check has a negative control.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sim, compileParams, hoverSolve } from '../src/index';
import type { ParamOverrides, PresetJson, RotorInflow, SimParams } from '../src/index';
import { preset, tracer } from './model-helpers';

const FREE = 'nazgulf5v3-6s';
const p = (o: ParamOverrides = {}): SimParams => compileParams(preset(FREE), o);

type Loads = { propLoads(f: RotorInflow, i: number, omega: number, ...v: number[]): number; propQ: number };
/** Thrust (N) and torque (N m) of motor 0 at rotor speed fraction w (nominal pack), air at the hub (body frame) and body rates. */
function loads(sp: SimParams, w: number, air: [number, number, number], rates: [number, number, number] = [0, 0, 0]): [number, number] {
    const sim = new Sim(sp, null) as unknown as Loads;
    const t = sim.propLoads(sp.inflow!, 0, w * sp.omegaMaxPerVolt * sp.vNom, ...air, ...rates);
    return [t, sim.propQ];
}
const thrust = (sp: SimParams, w: number, air: [number, number, number], rates: [number, number, number] = [0, 0, 0]): number => loads(sp, w, air, rates)[0];
/** the prop's pitch speed at rotor speed fraction w: pitch x revolutions per second, m/s */
const pitchSpeed = (sp: SimParams, w: number): number => (3.5 * 0.0254 * w * sp.omegaMaxPerVolt * sp.vNom) / (2 * Math.PI);
const share = (sp: SimParams, w: number, air: [number, number, number]): number => thrust(sp, w, air) / (sp.tmaxMotorNom * w * w);

/** Full throttle from a hover, held at `tiltDeg` from vertical (rates zeroed each tick), speed after `ms`, m/s. */
function punch(sp: SimParams, tiltDeg: number, ms: number): number {
    const sim = new Sim(sp, null);
    sim.reset(0, 1000, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    if (!sim.armed) throw new Error('did not arm');
    ch[2] = 1; sim.setChannels(ch);
    const h = (-tiltDeg * Math.PI) / 360;
    for (let i = 0; i < ms; i++) {
        sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
        sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0;
        sim.step();
    }
    return Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]);
}

/** A hashed 3 s flight: arm, punch, roll, pitch, a dive. */
function flightHash(sp: SimParams): string {
    const sim = new Sim(sp, null);
    sim.reset(0, 100, 0, 0);
    const t = tracer(sim);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
    for (let i = 0; i < 3000; i++) {
        ch[4] = i > 5 ? 1 : -1;
        ch[2] = i < 10 ? -1 : i < 800 ? 0.6 : i < 1600 ? -0.2 : -0.9;
        ch[0] = i > 900 && i < 1100 ? 1 : 0;
        ch[1] = i > 1700 && i < 1900 ? 0.8 : 0;
        sim.setChannels(ch);
        t.step();
    }
    if (!sim.armed) throw new Error('did not arm');
    return t.hex();
}

describe('rotor inflow (sim-core/0.6.0)', () => {
    it('only the Nazgul has it, and classicPhysics turns it off', () => {
        expect(p().inflow).not.toBeNull();
        expect(p({ classicPhysics: true }).inflow).toBeNull();
        expect(compileParams(preset('machr5sport-6s')).inflow).toBeNull();
        expect(compileParams(preset('pavo20pro-3s')).inflow).toBeNull();
    });

    it('classic physics flies the 0.5.0 model bit for bit (the preset without its inflow fields); the new model differs', () => {
        const pj = preset(FREE);
        const { prop_pitch_in: _p, cda_vertical_inflow_cm2: _c, ...fields } = pj.fields;
        void _p; void _c;
        const old: PresetJson = { ...pj, fields };
        const ref = flightHash(compileParams(old));
        expect(flightHash(p({ classicPhysics: true }))).toBe(ref);
        expect(flightHash(p())).not.toBe(ref);
    });

    it('at rest a prop makes exactly the preset thrust and kappa x it as torque, so hover and thrust-to-weight stay', () => {
        for (const w of [1, 0.5, 0.29]) {
            expect(share(p(), w, [0, 0, 0])).toBeCloseTo(1, 8);
            const [t, q] = loads(p(), w, [0, 0, 0]);
            expect(q / t).toBeCloseTo(p().kappa, 10);
        }
        expect(hoverSolve(p(), 1).share).toBe(hoverSolve(p({ classicPhysics: true }), 1).motor);
    });

    it('climbing along the thrust axis the thrust falls to zero near the pitch speed, as measured 5-inch props do; sinking it grows', () => {
        const c10 = share(p(), 1, [0, 10, 0]), c20 = share(p(), 1, [0, 20, 0]);
        expect(c10).toBeLessThan(0.9); expect(c10).toBeGreaterThan(0.75);
        expect(c20).toBeLessThan(0.7); expect(c20).toBeGreaterThan(0.55);
        // UIUC volume 2 (docs/evidence/2026-10-20-motor-model/prop_fit.py): five 5-inch props reach zero thrust at
        // 0.93-1.09 x their pitch speed
        for (const w of [1, 0.6]) {
            const ps = pitchSpeed(p(), w);
            expect(share(p(), w, [0, 0.9 * ps, 0]), `${w} at 0.9`).toBeGreaterThan(0);
            expect(share(p(), w, [0, 1.1 * ps, 0]), `${w} at 1.1`).toBeLessThan(0);
        }
        // control: Gill and D'Andrea's own blade angle (1.25 P / 2 pi R) would still push hard at 1.1 x the pitch speed
        const old = { ...p(), inflow: { ...p().inflow!, theta: (1.25 / 1.025) * p().inflow!.theta } };
        expect(share(old, 1, [0, 1.1 * pitchSpeed(p(), 1), 0])).toBeGreaterThan(0.1);
        expect(share(p(), 1, [0, -10, 0])).toBeGreaterThan(1.05);
    });

    it('a slow prop in a fast axial airflow: the blade-element model past the edge, joined without a step', () => {
        // a nearly stopped prop is a drag on its blades: about the same at 1 % and 3 % of full speed, scaling with the
        // airspeed squared, of the order of a flat plate's (1.2) times its blade area (1.6 x solidity x disk area)
        const q = (v: number) => 0.5 * p().rho * p().inflow!.area * v * v;
        const [t1, q1] = loads(p(), 0.01, [0, 25, 0]), [t3] = loads(p(), 0.03, [0, 25, 0]);
        expect(t3 / t1).toBeGreaterThan(0.9); expect(t3 / t1).toBeLessThan(1.1);
        expect(-t1 / q(25)).toBeGreaterThan(0.1); expect(-t1 / q(25)).toBeLessThan(0.3);
        expect(thrust(p(), 0.01, [0, 30, 0]) / t1).toBeCloseTo(1.44, 1);
        // the air turns it: a negative torque, the windmill's start
        expect(q1).toBeLessThan(0);
        // falling, the air from below pushes it up
        expect(thrust(p(), 0.03, [0, -15, 0])).toBeGreaterThan(0);
        // between, the windmill-brake state: faster, more drag, until the prop pushes again (standard blade theory: the
        // measured thrust slope past zero thrust, extrapolated, turns this way past twice the zero-thrust speed)
        const om = (rpm: number) => rpm / (60 / (2 * Math.PI)) / (p().omegaMaxPerVolt * p().vNom);
        expect(thrust(p(), om(8000), [0, 25, 0])).toBeLessThan(thrust(p(), om(3000), [0, 25, 0]));
        expect(thrust(p(), om(20000), [0, 25, 0])).toBeGreaterThan(0);
        // no step where the blade model takes over (axial ratio 0.3 and 0.45)
        for (const ratio of [0.3, 0.45]) {
            const w = 25 / ratio / p().inflow!.radius / (p().omegaMaxPerVolt * p().vNom);
            const below = thrust(p(), w * 1.0001, [0, 25, 0]), above = thrust(p(), w * 0.9999, [0, 25, 0]);
            expect(Math.abs(above - below), `${ratio}`).toBeLessThan(0.01);
        }
    });

    it('the props still damp a rotation when the airflow outruns them (idle in a 25 m/s climb)', () => {
        const still = thrust(p(), 0.07, [0, 25, 0]);
        const rolling = thrust(p(), 0.07, [0, 25, 0], [0, 0, 10]); // the rear-right prop rises into the air
        expect(sp0(rolling - still)).toBeLessThan(0);
        // control: no rotation, no change
        expect(thrust(p(), 0.07, [0, 25, 0], [0, 0, 0])).toBe(still);
    });
    const sp0 = (dT: number) => p().motorPos[0] * dT;

    it('air across the disk adds thrust (translational lift), more at a slower prop', () => {
        const full = share(p(), 1, [0, 0, -20]), hover = share(p(), 0.29, [0, 0, -10]);
        expect(full).toBeGreaterThan(1.05); expect(full).toBeLessThan(1.2);
        expect(hover).toBeGreaterThan(full);
        // control: the direction across the disk does not matter
        expect(share(p(), 1, [20, 0, 0])).toBeCloseTo(full, 12);
    });

    it('rotor damping: rolling right, the props on the rising side lose thrust, so the thrust moment resists the roll', () => {
        // body z is roll (w.z > 0 rolls left: pilot roll = -w.z); motor 0 sits at +x (rear right)
        const sp = p();
        const still = thrust(sp, 0.5, [0, 0, 0]);
        const rolling = thrust(sp, 0.5, [0, 0, 0], [0, 0, 10]); // w x r at +x is +y: that side rises into the air
        expect(rolling).toBeLessThan(still);
        // the change in thrust moment about z, x * dT, opposes w.z = +10
        expect(sp.motorPos[0] * (rolling - still)).toBeLessThan(0);
        // control: no rotation, no change
        expect(thrust(sp, 0.5, [0, 0, 0], [0, 0, 0])).toBe(still);
    });

    it('punch-outs build up more gradually and top out lower than the classic model', () => {
        const nNew = punch(p(), 0, 500), nOld = punch(p({ classicPhysics: true }), 0, 500);
        expect(nNew).toBeLessThan(nOld - 2);
        expect(nNew).toBeGreaterThan(20);
        const top = punch(p(), 0, 4000);
        expect(top).toBeGreaterThan(33); expect(top).toBeLessThan(42);
        // control: the classic model reaches its old 43 m/s
        expect(punch(p({ classicPhysics: true }), 0, 4000)).toBeGreaterThan(42);
    });

    it('a preset with prop_pitch_in must give the frame drag cda_vertical_inflow_cm2', () => {
        const pj = preset(FREE);
        const { cda_vertical_inflow_cm2: _c, ...fields } = pj.fields;
        void _c;
        expect(() => compileParams({ ...pj, fields })).toThrow(/cda_vertical_inflow_cm2/);
        // control: classic physics does not need it
        expect(compileParams({ ...pj, fields }, { classicPhysics: true }).inflow).toBeNull();
    });
});
