// How the airport's movers sound, as numbers (docs/notes/sound.md §2e): the page's AudioEngine builds its voices from
// these. No DOM and no Web Audio here, so the Node tests check it.
//
// Owner (2026-10-20): "just give me some sounds that are close and have acceptable volume" — so this is a light model,
// not a certification-grade one. Each voice is one tone at its shaft rate (the prop's blade-pass series, a piston's
// exhaust beats, a rotor's blade slap), a second tone (a twin's other prop, the helicopter's Fenestron), a turbine's
// whine and a band of broadband noise. Prop speeds and blade counts are the real types' where a source was found
// (named on each); levels and spectra are estimates, marked so.

/** The movers that make a sound, in the audio frame's kind code order (frame.ts putAir). */
export const AIR_SOUNDS = ['cub', 'c172', 'sr22', 'baron', 'caravan', 'pc12', 'kingair', 'twinotter', 'phenom', 'atr72', 'heli', 'tug'] as const;
export type AirSoundKind = (typeof AIR_SOUNDS)[number];

export interface AirRecipe {
    /** the tone's fundamental: the shaft's rpm at the lowest running power and at full */
    rpm0: number;
    rpm1: number;
    /** the power (Leg e) by which the shaft reaches rpm1: 1 for a fixed-pitch prop (rpm follows the throttle), lower
     * for a governed prop or rotor (it holds its speed once the power is up) */
    eGov: number;
    /** the tone's shaft harmonics' amplitudes (index n, 0 unused), rms 1 (toneWave); empty: no tone (a jet) */
    wave: Float32Array;
    /** a second tone: another prop (`ratio` 1.004: unsynchronised twins beat) or the Fenestron (its own shaft) */
    second: { ratio: number; wave: Float32Array } | null;
    /** a turbine's whine, Hz at no power and at full, dB from the tone */
    whine: { hz0: number; hz1: number; db: number } | null;
    /** broadband noise: a band from hz0 (no power) to hz1 (full), its Q, dB from the tone */
    noise: { hz0: number; hz1: number; q: number; db: number };
    /** how loud the whole mover is at full power, dB(A) at 1 m equivalent [estimate unless noted] */
    level: number;
}

/**
 * The quad's level the others are set against, dB(A) at 1 m in a hover [estimate: a vendor's 88-92 dB at 3 m for a
 * 5-inch quad at half throttle, UAVMODEL's noise reduction guide, not a documented test].
 */
export const QUAD_LEVEL = 99.5;

/** Amplitudes 10^(dB/20) for shaft harmonics 1..n from `db(n)`, scaled to rms 1. */
export function toneWave(n: number, db: (k: number) => number): Float32Array {
    const out = new Float32Array(n + 1);
    let ss = 0;
    for (let k = 1; k <= n; k++) {
        const d = db(k);
        out[k] = d > -90 ? 10 ** (d / 20) : 0;
        ss += out[k] * out[k] / 2;
    }
    const s = ss > 0 ? 1 / Math.sqrt(ss) : 0;
    for (let k = 1; k <= n; k++) out[k] *= s;
    return out;
}

/**
 * A prop on a piston engine (direct drive, so the crank turns at the prop's rpm): the blade-pass series falling about
 * 5 dB a harmonic and the exhaust's beats (a four-stroke fires cyl / 2 times a turn), rasping on through many harmonics,
 * over a rough bed of every shaft harmonic (cylinders not alike) [levels: estimates].
 */
export function pistonWave(blades: number, cyl: number): Float32Array {
    const fire = cyl / 2;
    return toneWave(48, (k) => {
        let d = -26;
        if (k % blades === 0) d = Math.max(d, -5 * (k / blades - 1));
        if (k % fire === 0) d = Math.max(d, -2 - 3 * (k / fire - 1));
        if (k === 1) d = Math.max(d, -14);
        return d;
    });
}

/** A turboprop's prop (geared from its free turbine): the blade-pass series alone, falling about 4 dB a harmonic [estimate]. */
export function turbopropWave(blades: number): Float32Array {
    return toneWave(blades * 10, (k) => {
        if (k % blades === 0) return -4 * (k / blades - 1);
        return k === 1 ? -18 : -36;
    });
}

/** A main rotor: the blade-pass thump and its many harmonics, the blade slap's buzz [estimate: falls slowly]. */
export function rotorWave(blades: number): Float32Array {
    return toneWave(blades * 24, (k) => {
        if (k % blades === 0) return -2.5 * (k / blades - 1) ** 0.85;
        return k === 1 ? -12 : -40;
    });
}

/**
 * A Fenestron: ten blades unequally spaced (Airbus's, to spread the blade-pass tone), so each blade-pass harmonic comes
 * with side tones at the neighbouring shaft harmonics [levels: estimates; the sidebands are the papers' point, Vialle and
 * Arnaud, ERF 1993, as cited by the EC135 aeromechanics paper below].
 */
export function fenestronWave(blades: number): Float32Array {
    return toneWave(blades * 4 + 2, (k) => {
        const near = Math.round(k / blades), off = Math.abs(k - near * blades);
        if (near < 1) return -100;
        const base = -5 * (near - 1);
        return off === 0 ? base : off === 1 ? base - 7 : off === 2 ? base - 13 : -100;
    });
}

/** A four-cylinder diesel: two firings a turn, a hard clatter through many harmonics [estimate]. */
export function dieselWave(): Float32Array {
    return toneWave(40, (k) => (k % 2 === 0 ? -1.5 * (k / 2 - 1) : -16));
}

const NONE = new Float32Array(1);

/**
 * The recipes. Prop speeds: the Cub's Continental A-65 2350 rpm (its FAA engine data sheet's continuous rating); the
 * 172's, SR22's and Baron's 2700 rpm red lines (POH and data sheet figures from searches); the Caravan's PT6A-114A 1900
 * rpm (EASA TCDS IM.E.094's output speed); the PC-12's PT6A-67P 1700 rpm [not found: as the -67R's 1700 on FAA TCDS
 * A19SW]; the King Air 350's 1700 rpm (its limits, 1050 at minimum on the ground); the Twin Otter's PT6A-27 2200 rpm
 * (100 % on TCDS A9EA as quoted); the ATR 72's 1200 rpm at 100 % Np, 82 % in cruise (ATR training material). Blades:
 * air-shapes.ts. The EC135 (Kampa et al., "Aeromechanic aspects in the design of the EC135", ERF, read in full): main
 * rotor 5.1 m radius, 4 blades, 211 m/s tip speed (395 rpm, blade-pass 26 Hz); Fenestron 1.0 m across, 10 blades,
 * 188 m/s (3590 rpm, blade-pass 598 Hz).
 *
 * Levels: the 172R's certified take-off 76-78 dB(A) (EASA TCDSN IM.A.051), with it some 220 m up over the microphone
 * [estimate], is about 124 dB(A) at 1 m; the EC135's overflight SEL 80-81 dB(A) at 150 m (EASA TCDSN R.009) is about
 * 72 dB(A) at its loudest, 116 at 1 m; the others are set from those by power [estimates].
 */
export const AIR_RECIPES: Record<AirSoundKind, AirRecipe> = {
    cub: { rpm0: 650, rpm1: 2350, eGov: 1, wave: pistonWave(2, 4), second: null, whine: null, noise: { hz0: 500, hz1: 1200, q: 0.6, db: -14 }, level: 116 },
    c172: { rpm0: 700, rpm1: 2700, eGov: 1, wave: pistonWave(2, 4), second: null, whine: null, noise: { hz0: 500, hz1: 1300, q: 0.6, db: -14 }, level: 124 },
    sr22: { rpm0: 750, rpm1: 2700, eGov: 0.4, wave: pistonWave(3, 6), second: null, whine: null, noise: { hz0: 500, hz1: 1400, q: 0.6, db: -13 }, level: 125 },
    baron: { rpm0: 750, rpm1: 2700, eGov: 0.4, wave: pistonWave(3, 6), second: { ratio: 1.004, wave: pistonWave(3, 6) }, whine: null, noise: { hz0: 500, hz1: 1400, q: 0.6, db: -13 }, level: 126 },
    caravan: { rpm0: 1250, rpm1: 1900, eGov: 0.4, wave: turbopropWave(3), second: null, whine: { hz0: 2400, hz1: 3800, db: -14 }, noise: { hz0: 600, hz1: 1600, q: 0.5, db: -11 }, level: 125 },
    pc12: { rpm0: 1100, rpm1: 1700, eGov: 0.4, wave: turbopropWave(4), second: null, whine: { hz0: 2400, hz1: 3800, db: -14 }, noise: { hz0: 600, hz1: 1600, q: 0.5, db: -11 }, level: 124 },
    kingair: { rpm0: 1100, rpm1: 1700, eGov: 0.4, wave: turbopropWave(4), second: { ratio: 1.004, wave: turbopropWave(4) }, whine: { hz0: 2400, hz1: 3800, db: -14 }, noise: { hz0: 600, hz1: 1600, q: 0.5, db: -11 }, level: 126 },
    twinotter: { rpm0: 1450, rpm1: 2200, eGov: 0.4, wave: turbopropWave(3), second: { ratio: 1.004, wave: turbopropWave(3) }, whine: { hz0: 2300, hz1: 3600, db: -14 }, noise: { hz0: 600, hz1: 1700, q: 0.5, db: -10 }, level: 128 },
    // a turbofan: no prop tone, its roar and its fan's whine [estimates]
    phenom: { rpm0: 0, rpm1: 0, eGov: 1, wave: NONE, second: null, whine: { hz0: 1600, hz1: 4200, db: -12 }, noise: { hz0: 250, hz1: 700, q: 0.45, db: 0 }, level: 128 },
    atr72: { rpm0: 790, rpm1: 1200, eGov: 0.4, wave: turbopropWave(6), second: { ratio: 1.003, wave: turbopropWave(6) }, whine: { hz0: 2800, hz1: 4600, db: -16 }, noise: { hz0: 500, hz1: 1300, q: 0.5, db: -10 }, level: 130 },
    // the rotor stops with the power; the Fenestron turns 9.09 times the main rotor (3590 / 395 rpm)
    heli: { rpm0: 0, rpm1: 395, eGov: 0.7, wave: rotorWave(4), second: { ratio: 3590 / 395, wave: fenestronWave(10) }, whine: { hz0: 3600, hz1: 5200, db: -14 }, noise: { hz0: 400, hz1: 1000, q: 0.5, db: -9 }, level: 116 },
    // an airport tug's diesel: idling to working revs [estimate]
    tug: { rpm0: 800, rpm1: 2200, eGov: 1, wave: dieselWave(), second: null, whine: null, noise: { hz0: 300, hz1: 700, q: 0.7, db: -12 }, level: 100 }
};

/** The shaft's rpm at power e (0-1): 0 when stopped, rising from rpm0 to rpm1 by eGov. */
export function rpmAt(r: AirRecipe, e: number): number {
    if (e <= 0.005) return 0;
    const k = Math.min(1, e / r.eGov);
    // a rotor or engine starting from rest (rpm0 0) spins up with the power
    return r.rpm0 + (r.rpm1 - r.rpm0) * k;
}

/** The mover's loudness against the quad's in a hover at the same distance, as an amplitude, at power e. */
export function airGain(r: AirRecipe, e: number): number {
    if (e <= 0.005) return 0;
    // the sound falls with the power, though a taxiing plane still roars [estimate: e^0.9, about 13 dB down at 20 %]
    return 10 ** ((r.level - QUAD_LEVEL) / 20) * Math.min(1, e) ** 0.9;
}

/**
 * Which movers the voices play: the `n` loudest heard now (gain / distance), above `floor`, keeping each voice's mover
 * while it is still among them so a voice never jumps from one plane to another mid-sound. `was[k]` is voice k's mover,
 * -1 free, -2 still fading out (not free yet). A voice that loses its mover comes back -1 and is only given a new one
 * on a later call, once the caller has let it fade.
 */
export function pickVoices(loud: ArrayLike<number>, was: readonly number[], floor: number): number[] {
    const n = was.length;
    const order: number[] = [];
    for (let i = 0; i < loud.length; i++) if (loud[i] > floor) order.push(i);
    order.sort((a, b) => loud[b] - loud[a]);
    const top = new Set(order.slice(0, n));
    const out = was.map((m) => (m >= 0 && !top.has(m) ? -1 : m));
    // only voices free before this call take a new mover
    const free: number[] = [];
    was.forEach((m, k) => { if (m === -1) free.push(k); });
    for (const m of order.slice(0, n)) {
        if (out.includes(m)) continue;
        const k = free.shift();
        if (k === undefined) break;
        out[k] = m;
    }
    return out;
}
