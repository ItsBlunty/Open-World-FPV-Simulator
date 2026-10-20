// The sound's numbers (docs/notes/sound.md): the rotor waveform from the measured 5-inch recording, loudness, prop wash,
// Doppler, the air's absorption against ISO 9613-1's table, the city's reach, and the audio frame the engine fills.
// The Web Audio graph itself (audio/audio.ts) only runs in a browser.

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { S } from '@owfpv/sim-core';
import type { PresetJson, SimEvent } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { makeTrains } from '@owfpv/traffic';
import { A, BEAT_M, TF, cityWeight, fastestHit, putQuad, putTrains, trainAxles } from '../src/audio/frame';
import {
    BPF_DB, HARMONICS, MOTOR_DB, SHAFT_DB, airAbsorptionDbPerM, airCornerHz, bladesOf, doppler, noiseCornerHz, noiseGain,
    IDLE_FLOOR, TONE_EXP, rotorSpectrum, rotorWave, toneGain, washOf
} from '../src/audio/quad-sound';
import { FlightSession } from '../src/session';
import { selftestSticks } from '../src/selftest';
import { captureFlight } from '../src/flights';
import { T, buildTrack } from '../src/replay';

const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
const db = (x: number): number => 20 * Math.log10(x);

describe('the rotor waveform', () => {
    const w = rotorSpectrum(3);

    it('reads the blade count from the preset', () => {
        expect(bladesOf('Nazgul F5 5.1x3.5, 3-blade')).toBe(3);
        expect(bladesOf('HQ 5x4.3x3 tri blade')).toBe(2);
        expect(bladesOf(undefined)).toBe(2);
    });

    it('puts the blade-pass series on every third shaft harmonic, at the measured levels', () => {
        expect(w.length).toBe(HARMONICS + 1);
        for (let m = 1; m <= 8; m++) expect(db(w[3 * m])).toBeCloseTo(BPF_DB[m - 1], 4);
    });

    it('has the shaft-rate tones and the motor whine (7 pole pairs) under the blade-pass tone', () => {
        expect(db(w[1])).toBeCloseTo(SHAFT_DB[0], 4);
        expect(db(w[2])).toBeCloseTo(SHAFT_DB[1], 4);
        expect(db(w[7])).toBeCloseTo(MOTOR_DB[0], 4);
        expect(db(w[14])).toBeCloseTo(MOTOR_DB[1], 4);
        for (let n = 1; n <= HARMONICS; n++) if (n % 3 !== 0) expect(w[n]).toBeLessThan(w[3]);
    });

    it('gives each rotor the same levels at its own phases, so four rotors do not comb-filter as one', () => {
        const waves = [0, 1, 2, 3].map((i) => rotorWave(3, i));
        for (const { real, imag } of waves) {
            for (let n = 1; n <= HARMONICS; n++) expect(Math.hypot(real[n], imag[n])).toBeCloseTo(w[n], 6);
        }
        // any two rotors' waveforms are far from alike (correlation over one turn; 1 would be the same wave)
        const corr = (a: number, b: number): number => {
            let s = 0, e = 0;
            for (let n = 1; n <= HARMONICS; n++) {
                s += waves[a].real[n] * waves[b].real[n] + waves[a].imag[n] * waves[b].imag[n];
                e += w[n] * w[n];
            }
            return s / e;
        };
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(Math.abs(corr(a, b))).toBeLessThan(0.9);
        // the same seed, the same wave
        expect(Array.from(rotorWave(3, 2).real)).toEqual(Array.from(waves[2].real));
    });
});

describe('loudness', () => {
    it('is silent stopped, quiet but there at idle, and grows steeply with rotor speed', () => {
        expect(toneGain(0)).toBe(0);
        expect(toneGain(0.055)).toBeGreaterThan(0);
        expect(toneGain(1)).toBe(1);
        expect(toneGain(-0.5)).toBe(toneGain(0.5));
        // hover (1 / sqrt(8) of top speed) to full throttle: about 25 dB, sound power ~ speed^5.5
        expect(db(toneGain(1) / toneGain(1 / Math.sqrt(8)))).toBeCloseTo(24.8, 0);
        for (let s = 0.25; s < 1; s += 0.1) expect(toneGain(s + 0.05)).toBeGreaterThan(toneGain(s));
        for (let s = 0.01; s < 0.5; s += 0.01) expect(toneGain(s + 0.01)).toBeGreaterThan(toneGain(s));
        // a zero-throttle roll revs a 5-inch's motors from idle (5.5 %) to about 20 %: it must be heard (owner, 2026-10-20)
        expect(toneGain(0.055)).toBeCloseTo(IDLE_FLOOR, 6);
        expect(db(toneGain(0.2) / toneGain(0.055))).toBeGreaterThan(4);
        // a hover keeps its calibrated level: the speed^TONE_EXP law
        expect(toneGain(0.53)).toBe(0.53 ** TONE_EXP);
    });

    it('lets the rush catch up with the tones as the props speed up', () => {
        const hover = [0.35, 0.35, 0.35, 0.35], full = [1, 1, 1, 1];
        expect(noiseGain(hover) / toneGain(0.35)).toBeLessThan(noiseGain(full) / toneGain(1));
        expect(noiseCornerHz(0, 3)).toBe(500);
        expect(noiseCornerHz(3500, 3)).toBeCloseTo(2 * 3 * 3500 / (2 * Math.PI), 6);
        expect(noiseCornerHz(9000, 3)).toBe(4000);
    });

    it('throbs with prop wash only descending into the wake', () => {
        const hover = 1 / Math.sqrt(8);
        expect(washOf(-5, hover, hover)).toBe(0);
        expect(washOf(1, hover, hover)).toBe(0);
        expect(washOf(6, hover, hover)).toBe(1);
        expect(washOf(30, hover, hover)).toBe(0);
        expect(washOf(6, 0.02, hover)).toBe(0);
    });
});

describe('sound in the air', () => {
    it('shifts pitch by Doppler: a source coming at a tenth of the speed of sound is 11 % higher, going away 9 % lower', () => {
        expect(doppler(0, 0, 0, 0, 0, 0, 100, 0, 0, -34.3, 0, 0)).toBeCloseTo(343 / (343 - 34.3), 6);
        expect(doppler(0, 0, 0, 0, 0, 0, 100, 0, 0, 34.3, 0, 0)).toBeCloseTo(343 / (343 + 34.3), 6);
        expect(doppler(0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 34.3, 0)).toBe(1);
    });

    it('absorbs as ISO 9613-1 tabulates (20 °C, 70 % humidity, dB/km)', () => {
        // ISO 9613-1:1993 Table 1 at 20 °C, 70 %: 1 kHz 4.98, 2 kHz 9.02, 4 kHz 22.9, 8 kHz 76.6 dB/km, the table's bands
        // being the exact base-ten midband frequencies (1995, 3981, 7943 Hz for the nominal 2, 4 and 8 kHz)
        expect(airAbsorptionDbPerM(1000) * 1000).toBeCloseTo(4.98, 1);
        expect(airAbsorptionDbPerM(1995) * 1000).toBeCloseTo(9.02, 1);
        expect(airAbsorptionDbPerM(3981) * 1000).toBeCloseTo(22.9, 1);
        expect(airAbsorptionDbPerM(7943) * 1000).toBeCloseTo(76.6, 1);
    });

    it('dulls far sounds: no filtering close up, under 5 kHz past 100 m', () => {
        expect(airCornerHz(0)).toBe(20000);
        expect(airCornerHz(100)).toBeLessThan(5000);
        expect(airCornerHz(100)).toBeGreaterThan(airCornerHz(400));
    });
});

describe('the audio frame', () => {
    it('hears the city among the blocks and not out in the fields', () => {
        const b = level.blocks[0];
        expect(cityWeight(level.blocks, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)).toBe(1);
        expect(cityWeight(level.blocks, 0, 400)).toBeLessThan(cityWeight(level.blocks, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2));
        expect(cityWeight([], 0, 0)).toBe(0);
    });

    it('takes the fastest hit since the last frame', () => {
        const ev: SimEvent[] = [
            { type: 'contact', tick: 1, speed: 2, regime: 'bounce', damage: 0 },
            { type: 'arm', tick: 2 },
            { type: 'contact', tick: 3, speed: 4, regime: 'bounce', damage: 0 }
        ];
        expect(fastestHit(ev, 0)).toEqual({ speed: 4, crash: false });
        expect(fastestHit(ev, 3)).toEqual({ speed: 0, crash: false });
    });

    it('carries the quad: its up axis and its rotor speeds in rad/s', () => {
        const s = new FlightSession({ preset, level });
        const a = new Float32Array(A.size);
        const sim = s.sim;
        putQuad(a, sim.s, sim.p.omegaMaxPerVolt);
        expect(a[A.ux]).toBeCloseTo(0, 6);
        expect(a[A.uy]).toBeCloseTo(1, 6);
        expect(a[A.uz]).toBeCloseTo(0, 6);
        sim.s[S.m0] = 0.5;
        putQuad(a, sim.s, sim.p.omegaMaxPerVolt);
        expect(a[A.w0]).toBeCloseTo(0.5 * sim.p.omegaMaxPerVolt * sim.s[S.volt], 2);
        // 1750 KV x 6S x 0.8 loaded: the top speed is about 3500 rad/s (33 600 rpm)
        expect(sim.p.omegaMaxPerVolt * sim.p.cells * 4.2).toBeGreaterThan(3000);
        expect(sim.p.omegaMaxPerVolt * sim.p.cells * 4.2).toBeLessThan(4000);
        // no blade strikes in free air
        const k = new Float32Array(4);
        s.takeStrikes(k);
        expect([...k]).toEqual([0, 0, 0, 0]);
    });

    it('carries the trains: the chimney ahead of the middle, running a beat each 1.2 m', () => {
        const trains = makeTrains(level, true);
        const a = new Float32Array(A.size);
        putTrains(a, trains, 120000);
        expect(a[A.nTrains]).toBe(2);
        const o = A.trains;
        expect(Math.hypot(a[o + TF.x] - a[o + TF.mx], a[o + TF.z] - a[o + TF.mz])).toBeGreaterThan(5);
        expect(BEAT_M).toBeCloseTo((Math.PI * 1.524) / 4, 6);
        const ax = trainAxles(trains[0]);
        expect(ax.length).toBeGreaterThan(10);
        for (let i = 1; i < ax.length; i++) expect(ax[i]).toBeGreaterThanOrEqual(ax[i - 1]);
    });
});

describe('a replay sounds as it flew', () => {
    it('keeps each rotor\'s speed in the track, as the live flight had it', () => {
        const mesh = new MeshContactWorld(level.collision);
        const s = new FlightSession({ preset, level, world: mesh, traceHash: true });
        const r = s.runner, ch = new Float32Array(8);
        const live = new Map<number, number>();
        while (r.sim.tick < 4000) {
            const t = r.sim.tick;
            if (t % 4 === 0) r.enqueue({ tUs: (t + 1) * 1000, ch: selftestSticks(t, ch) });
            r.stepOnce();
            const x = r.sim.s;
            if (r.sim.tick % 1000 === 0) live.set(r.sim.tick, x[S.m0 + 2] * r.sim.p.omegaMaxPerVolt * x[S.volt]);
        }
        const track = buildTrack(captureFlight(s, 1, []), level, mesh);
        let spinning = 0;
        for (const [tick, w] of live) {
            const i = track.ticks.indexOf(tick);
            expect(i).toBeGreaterThanOrEqual(0);
            expect(track.data[i * T.size + T.w2]).toBe(Math.fround(w));
            if (Math.abs(w) > 100) spinning++;
        }
        expect(spinning).toBeGreaterThan(0);
    });
});
