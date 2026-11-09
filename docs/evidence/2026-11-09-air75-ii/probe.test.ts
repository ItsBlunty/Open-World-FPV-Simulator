// Derivation probe for the Air75 II presets: prints what the compiled model does with the preset numbers so the derived
// ones (twr, throttle fit, drag areas) could be settled; its output is probe-output.txt. Not a check: to run it again, copy
// it to packages/sim-core/test/ and run `pnpm vitest run packages/sim-core/test/probe.test.ts --silent=false`.
import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sim, attitude, compileParams, hoverSolve, setpointRate, throttleCurve } from '../src/index';
import type { ParamOverrides, PresetJson, SimParams } from '../src/index';
import { hovering, preset, rate } from './model-helpers';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'evidence', '2026-11-09-air75-ii', 'probe-output.txt');

const IDS = ['air75ii-freestyle-1s', 'air75ii-racing-1s', 'air75ii-champion-1s'];
// BetaFPV's bench at 100 % throttle: (V, g) and the BF 2026 throttle curve (thr_mid, thr_expo, thr_hover) or null
const BENCH: Record<string, { v: number; g: number; thr: [number, number, number] | null }> = {
    'air75ii-freestyle-1s': { v: 3.86, g: 47.7, thr: null },
    'air75ii-racing-1s': { v: 3.82, g: 55.0, thr: [28, 25, 17] },
    'air75ii-champion-1s': { v: 3.81, g: 58.2, thr: [25, 45, 16] }
};
const R2D = 180 / Math.PI;
const RPM = 60 / (2 * Math.PI);
const r = (x: number, d = 2) => Number(x.toFixed(d));

function hover(sp: SimParams, mode: 'acro' | 'angle', ms = 1500) {
    return hovering(sp, mode, ms);
}

function topSpeedKmh(pj: PresetJson, o: ParamOverrides): number {
    const sp0 = compileParams(pj, o);
    const tilt = Math.acos(1 / sp0.twr) * R2D;
    const { sim, ch } = hover(compileParams(pj, { ...o, level: { limitDeg: tilt } }), 'angle');
    ch[1] = 1; ch[2] = 1; sim.setChannels(ch);
    for (let i = 0; i < 20000; i++) sim.step();
    return Math.sqrt(sim.s[S.vx] ** 2 + sim.s[S.vz] ** 2) * 3.6;
}

function climb(sp: SimParams): number {
    const { sim, ch } = hover(sp, 'angle');
    ch[2] = 1; sim.setChannels(ch);
    for (let i = 0; i < 8000; i++) sim.step();
    return sim.s[S.vy];
}

function rollStep(sp: SimParams): { t63: number; at20: number; over: number } {
    const { sim, ch } = hover(sp, 'acro');
    const target = setpointRate(sp.rates.type, 1, sp.rates.roll, sp.rates.rateLimit);
    let t63 = -1, peak = 0, at20 = 0;
    for (let i = 0; i < 600; i++) {
        ch[0] = 1; sim.setChannels(ch); sim.step();
        const rr = Math.abs(rate(sim, 'roll'));
        if (i === 19) at20 = rr;
        if (t63 < 0 && rr >= 0.63 * target) t63 = i + 1;
        if (rr > peak) peak = rr;
    }
    return { t63, at20, over: (peak / target - 1) * 100 };
}

function yawStep(sp: SimParams): { at100: number; target: number } {
    const { sim, ch } = hover(sp, 'acro');
    const target = setpointRate(sp.rates.type, 1, sp.rates.yaw, sp.rates.rateLimit);
    for (let i = 0; i < 100; i++) { ch[3] = 1; sim.setChannels(ch); sim.step(); }
    return { at100: Math.abs(rate(sim, 'yaw')), target };
}

function angleStep(sp: SimParams, axis: 0 | 1, rampMs = 80): { peak: number; pastLevel: number } {
    const { sim, ch } = hover(sp, 'angle');
    const tilt = (): number => (axis === 0 ? attitude(sim.s).roll : attitude(sim.s).pitch);
    let peak = 0, held = 0;
    for (let i = 0; i < 1500; i++) {
        ch[axis] = Math.min(1, (i + 1) / rampMs);
        sim.setChannels(ch); sim.step();
        const a = Math.abs(tilt());
        if (a > peak) peak = a;
        held = tilt();
    }
    let pastLevel = 0;
    ch[axis] = 0; sim.setChannels(ch);
    for (let i = 0; i < 2500; i++) {
        sim.step();
        const back = -Math.sign(held) * tilt();
        if (back > pastLevel) pastLevel = back;
    }
    return { peak, pastLevel };
}

function steady(p: SimParams, rr: number, pt: number): [number, number] {
    const { sim, ch } = hovering(p, 'angle', 500);
    ch[0] = rr; ch[1] = pt; sim.setChannels(ch);
    for (let i = 0; i < 2000; i++) sim.step();
    const a = attitude(sim.s);
    return [a.roll, a.pitch];
}

function holdStick(p: SimParams, soc: number, stick: number, ms: number): Sim {
    const sim = new Sim(p, null);
    sim.setChannels([0, 0, -1, 0, 1, MODE_CHANNEL.angle, 0, 0]);
    sim.reset(0, 100, 0, 0, { keepArmed: true, soc });
    sim.setChannels([0, 0, stick * 2 - 1, 0, 1, MODE_CHANNEL.angle, 0, 0]);
    for (let i = 0; i < ms; i++) sim.step();
    return sim;
}

/** Betaflight 2026's throttle curve (src/main/fc/rc.c generateThrottleCurve): two quadratic Beziers through the hover point. */
function bfCurve(x: number, mid: number, expo: number, hoverY: number): number {
    const m = mid / 100, e = expo / 100, h = hoverY / 100;
    const cp1y = h * 0.5 * (1 + e);
    const cp2y = 1 + (h - 1) * 0.5 * (1 + e);
    if (x <= m) {
        const t = m > 0 ? x / m : 0; // Bx(t) = m t (cp1x = m / 2)
        return 2 * (1 - t) * t * cp1y + t * t * h;
    }
    const t = (x - m) / (1 - m); // Bx(t) = m (1 - t) + t (cp2x = (1 + m) / 2)
    return (1 - t) * (1 - t) * h + 2 * (1 - t) * t * cp2y + t * t;
}

describe('air75 ii probe', () => {
    it('prints the derivation', () => {
        writeFileSync(OUT, '');
        for (const id of IDS) {
            const pj = preset(id);
            const b = BENCH[id];
            const m = (pj.fields.auw_g.value as number) / 1000;
            let twr = pj.fields.twr.value as number;
            let sp = compileParams(pj, { twr });
            for (let i = 0; i < 40; i++) {
                sp = compileParams(pj, { twr });
                twr = (4 * (b.g / 1000) * (sp.vNom / b.v) ** 2) / m;
            }
            sp = compileParams(pj, { twr });
            const iFull = (4.2 - sp.vNom) / sp.rPack;
            const h = hoverSolve(sp, 1);
            const iHover = (4.2 - h.volts) / sp.rPack;
            const rows = [
                `== ${id}: auw ${m * 1000} g, bench ${b.g} g at ${b.v} V`,
                `twr fixed point ${r(twr, 3)} at vNom ${r(sp.vNom, 3)} V (full current ${r(iFull, 1)} A, ${r(iFull / 4, 2)} A per motor; bench ${pj.fields.twr.note?.match(/(\d+\.\d+) A/)?.[1]} A at ${b.v} V)`,
                `  thrust per motor at vNom ${r((twr * m * 9.81) / 4 / 9.81 * 1000, 1)} g; rpm full ${r(sp.omegaMaxPerVolt * sp.vNom * RPM, 0)}`,
                `  hover: motor ${r(h.motor, 3)}, throttle ${r(h.throttle, 3)}, stick ${r(h.stick, 3)}, ${r(h.volts, 3)} V, ${r(iHover, 2)} A, rpm ${r(h.motor * sp.omegaMaxPerVolt * h.volts * RPM, 0)}, hover time on 85 % ${r((sp.capacityAs * 0.85) / iHover / 60, 1)} min`
            ];
            const spT = compileParams(pj, { twr });
            for (const scale of [0.7, 1, 1.4]) rows.push(`  classic top speed, cda x${scale}: ${r(topSpeedKmh(pj, { twr, classicPhysics: true, cdaScale: scale }), 1)} km/h`);
            for (const scale of [0.75, 1, 1.25]) rows.push(`  inflow  top speed, cda x${scale}: ${r(topSpeedKmh(pj, { twr, cdaScale: scale }), 1)} km/h`);
            rows.push(`  climb after 8 s full throttle: ${r(climb(spT), 1)} m/s (classic ${r(climb(compileParams(pj, { twr, classicPhysics: true })), 1)})`);
            const rs = rollStep(spT);
            rows.push(`  roll: t63 ${rs.t63} ms, ${r(rs.at20, 0)} deg/s at 20 ms, overshoot ${r(rs.over, 1)} %`);
            const ys = yawStep(spT);
            rows.push(`  yaw: ${r(ys.at100, 0)} deg/s at 100 ms of a full stick (target ${r(ys.target, 0)})`);
            for (const axis of [0, 1] as const) {
                const a = angleStep(spT, axis);
                rows.push(`  angle ${axis === 0 ? 'roll' : 'pitch'}: peak ${r(a.peak, 2)} deg (limit ${spT.level.limitDeg}), past level ${r(a.pastLevel, 2)} deg`);
            }
            const want = (60 * setpointRate(spT.rates.type, 0.5, spT.rates.roll, spT.rates.rateLimit)) / setpointRate(spT.rates.type, 1, spT.rates.roll, spT.rates.rateLimit);
            const [l] = steady(spT, -0.5, 0);
            const [dr, dp] = steady(spT, 0.5, 0.5);
            rows.push(`  angle table: left ${r(l, 2)}, diagonal ${r(dr, 2)} / ${r(dp, 2)}, want ${r(want, 2)}`);
            for (const [gravity, soc] of [[9.81, 1], [9.81, 0.5], [9.81, 0.2], [1.62, 0.2]] as [number, number][]) {
                const pa = compileParams(pj, { twr, gravityMode: 'auto-throttle', gravity });
                const sim = holdStick(pa, soc, hoverSolve(pa, soc).stick, 3000);
                rows.push(`  hover hold g ${gravity} soc ${soc}: vy ${r(sim.s[S.vy], 3)} (motor ${r(hoverSolve(pa, soc).motor, 3)})`);
            }
            if (b.thr) {
                const [bm, be, bh] = b.thr;
                let best = { mid: 50, expo: 0, sse: Infinity, maxErr: 0 };
                for (let mid = 1; mid <= 99; mid++) for (let expo = 0; expo <= 100; expo++) {
                    let sse = 0, maxErr = 0;
                    for (let i = 0; i <= 100; i++) {
                        const x = i / 100;
                        const d = throttleCurve(x, { mid, expo }) - bfCurve(x, bm, be, bh);
                        sse += d * d;
                        if (Math.abs(d) > maxErr) maxErr = Math.abs(d);
                    }
                    if (sse < best.sse) best = { mid, expo, sse, maxErr };
                }
                rows.push(`  throttle fit of BF mid ${bm} expo ${be} hover ${bh}: mid ${best.mid} expo ${best.expo}, rms ${r(Math.sqrt(best.sse / 101) * 100, 2)} %, max ${r(best.maxErr * 100, 1)} %`);
                const pts = [0.2, 0.28, 0.4, 0.5, 0.6, 0.8].map((x) => `${x}: bf ${r(bfCurve(x, bm, be, bh), 3)} fit ${r(throttleCurve(x, { mid: best.mid, expo: best.expo }), 3)}`);
                rows.push(`    ${pts.join(' | ')}`);
                // the hover stick on the real curve for the model's hover throttle
                let lo = 0, hi = 1;
                for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (bfCurve(mid, bm, be, bh) < h.throttle) lo = mid; else hi = mid; }
                rows.push(`    hover throttle ${r(h.throttle, 3)} sits at stick ${r(lo, 3)} on BF's curve, ${r(h.stick, 3)} on the preset's`);
            }
            console.log(rows.join('\n'));
        }
        expect(true).toBe(true);
    });
});
