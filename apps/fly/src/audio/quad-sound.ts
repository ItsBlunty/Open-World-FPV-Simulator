// How the quad sounds, as numbers (docs/notes/sound.md): the page's AudioEngine builds its Web Audio graph from these.
// No DOM and no Web Audio here, so the Node tests check it.
//
// A spinning prop is heard mostly as tones: the blade-pass frequency (rotor speed x blades) and its harmonics, plus the
// shaft rate itself (no two blades are quite alike), the motor's own magnetic whine (rotor speed x pole pairs) and
// broadband rush from the turbulent air at the blades (Intaratep et al., AIAA 2016-2873: tones at the blade-pass and
// shaft rates and their harmonics dominate a quadcopter's spectrum). Four rotors a little apart in speed beat against
// each other: the warble of a real quad. All four come straight from sim-core's rotor speeds, so a punch-out, a flip's
// throttle cut, prop wash and turtle mode sound as they fly.
//
// The harmonic levels are measured from a recording of a 5-inch quad doing flybys (Freesound 524331 by 5deMayo, CC0;
// sounds/SOURCES.md): the blade-pass tone's 2nd to 5th harmonics 9-21 dB under it, the shaft-rate tone about 15 dB under
// (docs/notes/sound.md has the analysis).

/** Shaft-rate harmonics in each rotor's waveform: 8 blade-pass harmonics of a tri-blade. */
export const HARMONICS = 24;

/**
 * Levels of the blade-pass harmonics, dB from the first: the flyby recording's peaks against the blade-pass peak (2nd to
 * 5th: -15, -16, -21, -21 dB in a slow pass at 662 Hz; -9, -14, -15, -16 dB in a fast one at 1249 Hz), then rolling off
 * [estimate: above the 5th the recording's peaks are lost in the broadband]. (The first pass at this, 2026-10-19, used
 * how far each peak stood over the noise around it instead: 0 to -4 dB, a buzzy, tinny tone the owner heard.)
 */
export const BPF_DB = [0, -12, -15, -18, -20, -23, -26, -29];
/** the shaft rate and its second harmonic: blades not quite alike (the recording: 15 dB under the blade-pass tone) */
export const SHAFT_DB = [-15, -20];
/** every other shaft harmonic [estimate: a little of the blade-to-blade difference spread over them] */
export const OTHER_DB = -36;

/** iFlight XING2 2207: 12 stator slots, 14 magnets (12N14P, retailers' listings of the motor): 7 pole pairs */
export const POLE_PAIRS = 7;
/** the motor's magnetic whine at the electrical frequency and twice it [estimate: a faint thin tone under the props] */
export const MOTOR_DB = [-30, -34];

/** Blades per prop from the preset's prop description ("Nazgul F5 5.1x3.5, 3-blade"); 2 if it does not say. */
export function bladesOf(prop: string | undefined): number {
    const m = /(\d)\s*-?\s*blade/i.exec(prop ?? '');
    const n = m ? Number(m[1]) : 2;
    return n >= 2 && n <= 6 ? n : 2;
}

/**
 * One rotor's waveform, as the sine amplitudes of its shaft-rate harmonics 1..HARMONICS (index 0 is DC, unused): the
 * blade-pass series, the shaft-rate tones and the motor whine, by the levels above.
 */
export function rotorSpectrum(blades: number, polePairs = POLE_PAIRS): Float32Array {
    const out = new Float32Array(HARMONICS + 1);
    for (let n = 1; n <= HARMONICS; n++) {
        let db = OTHER_DB;
        if (n % blades === 0) db = BPF_DB[n / blades - 1] ?? -40;
        else if (n <= SHAFT_DB.length) db = SHAFT_DB[n - 1];
        if (n === polePairs) db = Math.max(db, MOTOR_DB[0]);
        if (n === 2 * polePairs) db = Math.max(db, MOTOR_DB[1]);
        out[n] = 10 ** (db / 20);
    }
    return out;
}

/**
 * One rotor's waveform for a PeriodicWave (real: cosine, imag: sine terms), the rotorSpectrum's amplitudes at phases
 * drawn from `seed`. Each rotor gets its own: four rotors with the same phases and nearly the same speed add up as one
 * comb filter sweeping slowly through the sound (a flanger's hollow, echoey swish); with their own phases each harmonic
 * beats on its own, as four real props do. The phases spread the waveform's peaks too, so it is not a buzzy pulse train.
 */
export function rotorWave(blades: number, seed: number, polePairs = POLE_PAIRS): { real: Float32Array; imag: Float32Array } {
    const amp = rotorSpectrum(blades, polePairs);
    const real = new Float32Array(amp.length), imag = new Float32Array(amp.length);
    let r = Math.imul(seed + 1, 0x9e3779b9) >>> 0;
    for (let n = 1; n < amp.length; n++) {
        // mulberry32: the sound's own randomness, nothing of the sim
        r = (r + 0x6d2b79f5) >>> 0;
        let t = Math.imul(r ^ (r >>> 15), r | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        const phase = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 * Math.PI;
        real[n] = amp[n] * Math.sin(phase);
        imag[n] = amp[n] * Math.cos(phase);
    }
    return { real, imag };
}

/**
 * Sound pressure of a prop's tones against its speed: amplitude ~ (rotor speed)^TONE_EXP. Rotor loading noise power grows
 * with about the 5th to 6th power of tip speed at these tip Mach numbers [estimate, to check against a measured sweep];
 * 2.75 is the middle of that, as an amplitude.
 */
export const TONE_EXP = 2.75;
/**
 * The broadband rush grows faster than the tones. In the recordings it was about 10 dB under the tones near a hover (the
 * FPV quad's approach before it hits the window, Freesound 854351) and level with them in fast flight at about 55 % of
 * top rotor speed (the 5-inch flyby): 10 dB more over that speed range is 1.9 more in the exponent. NOISE_AT_FULL is
 * set so the game's rush matches the flyby's bands above 5 kHz at 55 % (measured in the browser: docs/notes/sound.md).
 */
export const NOISE_EXP = 4.65;
export const NOISE_AT_FULL = 4.8;
/** an armed quad's idle whirr stays audible [estimate]: the tones never go under this share of full while turning */
export const IDLE_FLOOR = 0.012;

/** A rotor's tone amplitude (0-1) at `share` of its top speed (|rad/s| / top rad/s). */
export function toneGain(share: number): number {
    const s = share < 0 ? -share : share;
    if (s < 0.005) return 0;
    const g = s > 1 ? 1 : s ** TONE_EXP;
    return g < IDLE_FLOOR ? IDLE_FLOOR * Math.min(1, s / 0.03) : g;
}

/** The broadband rush (0-1) of four rotors at these shares of top speed. */
export function noiseGain(shares: ArrayLike<number>): number {
    let p = 0;
    for (let i = 0; i < 4; i++) {
        const s = Math.min(1, Math.abs(shares[i]));
        p += s ** (2 * NOISE_EXP);
    }
    // the rotors' rush adds as power
    return NOISE_AT_FULL * Math.sqrt(p / 4);
}

/**
 * Where the rush starts, Hz (a high-pass corner): the flyby's broadband ran flat from a few kHz up to 12.8 kHz in fast
 * flight, the tones standing out below it [estimate: twice the blade-pass frequency, kept in 500-4000 Hz].
 */
export function noiseCornerHz(meanRadS: number, blades: number): number {
    const bpf = (Math.abs(meanRadS) / (2 * Math.PI)) * blades;
    return Math.min(4000, Math.max(500, 2 * bpf));
}

/**
 * Prop wash, 0-1: descending into the rotors' own wake (the vortex-ring band of momentum theory, from about a quarter
 * to twice the induced velocity in a hover, v_h) the props chop through recirculating air and their sound throbs and
 * roughens. v_h = sqrt(T / (2 rho A)) is about 7.5 m/s for the Nazgul in a hover (1.8 N a rotor, 5.1-inch disc); it grows
 * with rotor speed. `descent`: m/s of air coming up through the props (minus the airspeed along the body's up axis).
 */
export function washOf(descent: number, speedShare: number, hoverShare: number): number {
    if (descent <= 0 || speedShare < 0.05) return 0;
    const vh = 7.5 * Math.max(0.3, speedShare / hoverShare);
    const ss = (a: number, b: number, x: number): number => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    return ss(0.25 * vh, 0.6 * vh, descent) * (1 - ss(1.5 * vh, 2.2 * vh, descent));
}

/** Speed of sound, m/s, in air at 20 °C */
export const SOUND_SPEED = 343;

/**
 * The Doppler shift of a moving source heard by a moving listener: the frequency ratio. r runs from the listener to
 * the source; a source moving away (positive along r) sounds lower, a listener moving towards it higher.
 */
export function doppler(lx: number, ly: number, lz: number, lvx: number, lvy: number, lvz: number,
    sx: number, sy: number, sz: number, svx: number, svy: number, svz: number): number {
    const dx = sx - lx, dy = sy - ly, dz = sz - lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-3) return 1;
    const vl = (lvx * dx + lvy * dy + lvz * dz) / d, vs = (svx * dx + svy * dy + svz * dz) / d;
    // never through the sound barrier: the formula's pole
    const c = SOUND_SPEED;
    const f = (c + Math.max(-0.9 * c, Math.min(0.9 * c, vl))) / (c + Math.max(-0.9 * c, Math.min(0.9 * c, vs)));
    return f;
}

/**
 * Air absorption, dB per metre, at frequency f (Hz): ISO 9613-1's pure-tone formula (as reproduced by Sengpiel Audio,
 * sengpielaudio.com/AirdampingFormula.htm) at sea-level pressure, temperature tC (°C) and relative humidity rh (%).
 */
export function airAbsorptionDbPerM(f: number, tC = 20, rh = 70): number {
    const T = tC + 273.15, T0 = 293.15, T01 = 273.16;
    const psat = 10 ** (-6.8346 * (T01 / T) ** 1.261 + 4.6151);
    const h = rh * psat;
    const frO = 24 + 4.04e4 * h * (0.02 + h) / (0.391 + h);
    const frN = (T / T0) ** -0.5 * (9 + 280 * h * Math.exp(-4.170 * ((T / T0) ** (-1 / 3) - 1)));
    const f2 = f * f;
    return 8.686 * f2 * (1.84e-11 * (T / T0) ** 0.5
        + (T / T0) ** -2.5 * (0.01275 * Math.exp(-2239.1 / T) / (frO + f2 / frO) + 0.1068 * Math.exp(-3352 / T) / (frN + f2 / frN)));
}

/** The frequency the air over `d` m takes 3 dB off (a low-pass filter's corner for distant sounds), Hz, at most 20 kHz. */
export function airCornerHz(d: number): number {
    if (airAbsorptionDbPerM(20000) * d < 3) return 20000;
    let lo = 200, hi = 20000;
    for (let i = 0; i < 24; i++) {
        const mid = Math.sqrt(lo * hi);
        if (airAbsorptionDbPerM(mid) * d > 3) hi = mid;
        else lo = mid;
    }
    return lo;
}
