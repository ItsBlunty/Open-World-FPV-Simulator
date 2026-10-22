// Dynamic inflow (ParamOverrides.dynamicInflow, sim-core/0.8.0, review G13): each prop's induced velocity lags its steady
// value (Pitt and Peters' uniform mode, tau = 0.42 R / V_m). Off keeps every flight bit for bit (the pinned hashes); on,
// a step of rotor speed overshoots the thrust by about what rotor theory gives and settles in a few ms, the steady loads
// are unchanged, a windmilling prop sped up leads its steady thrust, and flights replay to the same state.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sim, compileParams } from '../src/index';
import type { ParamOverrides } from '../src/index';
import { plainPreset } from './model-helpers';

const NAZGUL = plainPreset('nazgulf5v3-6s');

/**
 * Prop 0's thrust each ms with the body held still in an axial airflow V (m/s, from in front), rotor speeds set to rpm(t)
 * every loop; 300 ms of settling at rpm(0) first (t = 0 is the end of it).
 */
function thrustTrace(o: ParamOverrides, V: number, rpm: (tMs: number) => number, ms: number): number[] {
    const p = compileParams(NAZGUL, { loopHz: 4000, batteryDrain: false, ...o });
    const sim = new Sim(p, null);
    sim.reset(0, 500, 0, 0);
    const c = new Float64Array(4);
    const out: number[] = [];
    const physics = (sim as unknown as { physics(c: Float64Array): void }).physics.bind(sim);
    for (let k = -1200; k < ms * 4; k++) {
        const s = sim.s;
        s[S.qw] = 1; s[S.qx] = s[S.qy] = s[S.qz] = 0; s[S.wx] = s[S.wy] = s[S.wz] = 0;
        s[S.vx] = 0; s[S.vz] = 0; s[S.vy] = V; s[S.py] = 500; s[S.soc] = 0.85;
        const w = (rpm(k < 0 ? 0 : k / 4) * Math.PI) / 30 / (p.omegaMaxPerVolt * s[S.volt]);
        for (let i = 0; i < 4; i++) s[S.m0 + i] = w;
        physics(c);
        if (k >= 0 && k % 4 === 3) out.push(sim.thrust[0]);
    }
    return out;
}

describe('dynamic inflow (Pitt-Peters uniform mode)', () => {
    it('adds four state slots only when on, and never with classic physics', () => {
        const off = new Sim(compileParams(NAZGUL), null).s.length;
        expect(new Sim(compileParams(NAZGUL, { dynamicInflow: true }), null).s.length).toBe(off + 4);
        expect(compileParams(NAZGUL, { dynamicInflow: true, classicPhysics: true }).dynamicInflow).toBe(false);
    });

    it('a quick rotor-speed step in hover overshoots the thrust about as rotor theory says, then settles in a few ms', () => {
        const step = (t: number) => (t < 2 ? 11000 : 15000);
        const qs = thrustTrace({}, 0, step, 30);
        const dy = thrustTrace({ dynamicInflow: true }, 0, step, 30);
        const before = qs[0], after = qs[29];
        expect(dy[0]).toBeCloseTo(before, 6); // settled: the steady induced velocity
        // the closed form at the new rotor speed with the old induced velocity (the inflow frozen) over the steady change:
        // li 0.109 in hover, T ~ w^2 (theta - v / (w R)) gives 1.54 for 11 -> 15 k rpm at once; the lag starts at once, so a
        // little less
        const peak = Math.max(...dy);
        const over = (peak - before) / (after - before);
        expect(over).toBeGreaterThan(1.35);
        expect(over).toBeLessThan(1.6);
        // tau = 0.42 R / v about 3-4 ms: within 1 % of the steady thrust 15 ms after the step
        expect(Math.abs(dy[17] - after) / after).toBeLessThan(0.01);
        expect(dy[29]).toBeCloseTo(after, 3);
        // without it the thrust follows the rotor speed at once
        expect(Math.max(...qs)).toBeCloseTo(after, 6);
    });

    it('a windmilling prop sped up in the chop leads its steady thrust (the induced flow lags), and ends where it would', () => {
        const ramp = (t: number) => 14000 + 7600 * Math.min(Math.max((t - 5) / 10, 0), 1);
        const qs = thrustTrace({}, 37, ramp, 30);
        const dy = thrustTrace({ dynamicInflow: true }, 37, ramp, 30);
        expect(qs[0]).toBeLessThan(0); // a drag: the windmill state
        for (let j = 7; j < 14; j++) expect(dy[j]).toBeGreaterThan(qs[j]);
        expect(dy[29]).toBeCloseTo(qs[29], 3);
    });

    it('escDelayMs overrides the preset ESC dead time (the game switch); absent keeps the preset one', () => {
        expect(compileParams(NAZGUL, { loopHz: 4000 }).escDelayLoops).toBe(0);
        expect(compileParams(NAZGUL, { loopHz: 4000, escDelayMs: 4 }).escDelayLoops).toBe(16);
        const withField = plainPreset('nazgulf5v3-6s');
        withField.fields.esc_delay_ms = { value: 4, source: 'test' } as never;
        expect(compileParams(withField, { loopHz: 4000 }).escDelayLoops).toBe(16);
        expect(compileParams(withField, { loopHz: 4000, escDelayMs: 0 }).escDelayLoops).toBe(0);
        expect(() => compileParams(NAZGUL, { escDelayMs: 25 })).toThrow();
    });

    it('flights with it replay to the same state', () => {
        const fly = () => {
            const sim = new Sim(compileParams(NAZGUL, { loopHz: 4000, dynamicInflow: true }), null);
            sim.reset(0, 500, 0, 0);
            const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0];
            sim.setChannels(ch);
            sim.step();
            ch[4] = 1;
            for (let t = 0; t < 3000; t++) {
                const p = t % 1000;
                ch[2] = p < 400 ? 0.7 : p < 450 ? -1 : -0.5;
                ch[0] = p > 600 && p < 700 ? 0.5 : 0;
                sim.setChannels(ch);
                sim.step();
            }
            return Array.from(sim.s);
        };
        const a = fly();
        expect(fly()).toEqual(a);
        expect(a.every((x) => Number.isFinite(x))).toBe(true);
    });
});
