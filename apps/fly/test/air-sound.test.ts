// The airport's sounds as numbers (audio/air-sound.ts, docs/notes/sound.md §2e): the waveforms, prop and rotor speeds,
// levels against the quad, which movers the voices play, and the audio frame's airport block.

import { describe, expect, it } from 'vitest';
import { buildFirstMap } from '@owfpv/maps';
import { makeAir } from '@owfpv/traffic';
import { A, AF, putAir } from '../src/audio/frame';
import {
    AIR_RECIPES, AIR_SOUNDS, QUAD_LEVEL, airGain, dieselWave, fenestronWave, pickVoices, pistonWave, rotorWave, rpmAt,
    turbopropWave
} from '../src/audio/air-sound';

const rms = (w: Float32Array): number => {
    let ss = 0;
    for (let n = 1; n < w.length; n++) ss += w[n] * w[n] / 2;
    return Math.sqrt(ss);
};
const loudest = (w: Float32Array): number => {
    let k = 1;
    for (let n = 1; n < w.length; n++) if (w[n] > w[k]) k = n;
    return k;
};

describe('the airport waveforms', () => {
    it('are each scaled to rms 1', () => {
        for (const w of [pistonWave(2, 4), pistonWave(3, 6), turbopropWave(6), rotorWave(4), fenestronWave(10), dieselWave()]) {
            expect(rms(w)).toBeCloseTo(1, 5);
        }
    });

    it('put the most into the blade-pass tone or the firing beat', () => {
        expect(loudest(turbopropWave(6))).toBe(6);
        expect(loudest(turbopropWave(4))).toBe(4);
        expect(loudest(rotorWave(4))).toBe(4);
        expect(loudest(fenestronWave(10))).toBe(10);
        // a 172: two blades, four cylinders firing twice a turn, both on the 2nd shaft harmonic
        expect(loudest(pistonWave(2, 4))).toBe(2);
        expect(loudest(dieselWave())).toBe(2);
    });

    it('spreads the Fenestron tone into side tones (unequal blade spacing)', () => {
        const w = fenestronWave(10);
        expect(20 * Math.log10(w[9] / w[10])).toBeCloseTo(-7, 5);
        expect(20 * Math.log10(w[12] / w[10])).toBeCloseTo(-13, 5);
        expect(w[5]).toBe(0);
    });
});

describe('prop and rotor speeds', () => {
    const bpf = (k: keyof typeof AIR_RECIPES, blades: number, e: number): number => (rpmAt(AIR_RECIPES[k], e) / 60) * blades;

    it('are the real types at full power', () => {
        // ATR 72: six blades at 1200 rpm (100 % Np); EC135: four blades at 395 rpm, the Fenestron's ten at 3590
        expect(bpf('atr72', 6, 1)).toBeCloseTo(120, 6);
        expect(bpf('heli', 4, 1)).toBeCloseTo(26.33, 2);
        expect(bpf('heli', 10, 1) * AIR_RECIPES.heli.second!.ratio).toBeCloseTo(598.3, 1);
        expect(bpf('c172', 2, 1)).toBeCloseTo(90, 6);
        expect(bpf('kingair', 4, 1)).toBeCloseTo(113.3, 1);
    });

    it('stop with the engine, idle low, and a governed prop holds its speed from 40 % power', () => {
        expect(rpmAt(AIR_RECIPES.c172, 0)).toBe(0);
        expect(rpmAt(AIR_RECIPES.c172, 0.01)).toBeGreaterThan(690);
        expect(rpmAt(AIR_RECIPES.c172, 0.5)).toBeCloseTo(1700, 6);
        expect(rpmAt(AIR_RECIPES.atr72, 0.45)).toBe(1200);
        expect(rpmAt(AIR_RECIPES.atr72, 0.2)).toBeCloseTo(995, 6);
        // the helicopter's rotor spins up from rest with the power
        expect(rpmAt(AIR_RECIPES.heli, 0.35)).toBeCloseTo(197.5, 6);
    });
});

describe('levels', () => {
    it('are set against the quad in a hover', () => {
        const db = (x: number): number => 20 * Math.log10(x);
        expect(db(airGain(AIR_RECIPES.c172, 1))).toBeCloseTo(124 - QUAD_LEVEL, 6);
        expect(airGain(AIR_RECIPES.atr72, 0)).toBe(0);
        // taxiing at 20 % power: about 13 dB under full
        expect(db(airGain(AIR_RECIPES.atr72, 0.2) / airGain(AIR_RECIPES.atr72, 1))).toBeCloseTo(-12.6, 1);
        // the quietest is the tug, the loudest the ATR
        const full = AIR_SOUNDS.map((k) => AIR_RECIPES[k].level);
        expect(Math.min(...full)).toBe(AIR_RECIPES.tug.level);
        expect(Math.max(...full)).toBe(AIR_RECIPES.atr72.level);
    });
});

describe('the voices', () => {
    it('go to the loudest movers above the floor', () => {
        expect(pickVoices([0.1, 0.5, 0.001, 0.3], [-1, -1], 0.01)).toEqual([1, 3]);
        expect(pickVoices([0.1, 0.5, 0.001, 0.3], [-1, -1, -1, -1], 0.01)).toEqual([1, 3, 0, -1]);
    });

    it('keep their mover while it is still among the loudest', () => {
        expect(pickVoices([0.4, 0.5, 0.3], [0, 1], 0.01)).toEqual([0, 1]);
        expect(pickVoices([0.4, 0.5, 0.6], [1, 0], 0.01)).toEqual([1, -1]);
    });

    it('never give a voice a new mover in the call it lost its last one (it fades first)', () => {
        const out = pickVoices([0.1, 0.5, 0.6], [0, 1], 0.2);
        expect(out).toEqual([-1, 1]);
        // fading voices (-2) are not free either; a free one is
        expect(pickVoices([0.5, 0.6], [-2, -1], 0.2)).toEqual([-2, 1]);
    });
});

describe('the audio frame\'s airport block', () => {
    const level = buildFirstMap();
    const air = makeAir(level, true)!;

    it('carries the planes, the helicopter and the tugs, and nothing when the airport is off', () => {
        const a = new Float32Array(A.size);
        putAir(a, air, 0);
        const kinds = Array.from({ length: a[A.nAir] }, (_, i) => AIR_SOUNDS[a[A.air + i * AF.size + AF.kind]]);
        expect(kinds.filter((k) => k === 'tug').length).toBe(3);
        expect(kinds.filter((k) => k === 'heli').length).toBe(1);
        expect(new Set(kinds.filter((k) => k !== 'tug' && k !== 'heli')).size).toBe(10);
        putAir(a, null, 0);
        expect(a[A.nAir]).toBe(0);
    });

    it('has an arriving ATR under power, flying east at its approach speed', () => {
        const ev = air.events.find((x) => x.kind === 'atr72')!;
        const a = new Float32Array(A.size);
        putAir(a, air, (ev.touchdown - 8) * 1000);
        let o = -1;
        for (let i = 0; i < a[A.nAir]; i++) if (AIR_SOUNDS[a[A.air + i * AF.size + AF.kind]] === 'atr72') o = A.air + i * AF.size;
        expect(a[o + AF.e]).toBeGreaterThan(0.1);
        // Vref 113 kn is 58 m/s; landings are eastbound (+x)
        expect(a[o + AF.vx]).toBeGreaterThan(50);
        expect(a[o + AF.vx]).toBeLessThan(65);
        expect(Math.abs(a[o + AF.vz])).toBeLessThan(1);
        expect(a[o + AF.vy]).toBeLessThan(0);
    });

    it('makes a hidden mover silent', () => {
        // the day's first seconds: the King Air (due at 1200 s) is still away (the Cub tours the city all day)
        const a = new Float32Array(A.size);
        putAir(a, air, 1000);
        for (let i = 0; i < a[A.nAir]; i++) {
            const o = A.air + i * AF.size;
            if (AIR_SOUNDS[a[o + AF.kind]] === 'kingair') expect(a[o + AF.e]).toBe(0);
        }
    });
});
