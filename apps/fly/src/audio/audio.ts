// The game's sound (docs/notes/sound.md), on the page: Web Audio only exists there, not in the engine's worker. Each
// frame the engine posts an audio frame (audio/frame.ts); this turns it into sound:
//
// - the quad: four rotors, each an oscillator playing the measured blade-pass recipe (quad-sound.ts) at its rotor speed,
//   plus the broadband rush, prop wash's throb, blade strikes (a real FPV quad's props clattering on a window frame) and
//   hits (Kenney's impact sounds). On the FPV camera it is heard from on board, with the wind on the camera's
//   microphone; from the chase, free or spotter camera it is out in the world: panned, fading with distance, dulled
//   by the air (ISO 9613-1) and Doppler-shifted.
// - the steam trains: an exhaust beat four times a turn of the coupled wheels, loud with the regulator open (as the
//   smoke), soft when drifting; wheels knocking on the rail joints; the safety valve's hiss while standing at a
//   station; the whistle as one pulls away.
// - the places: a city street's traffic among the blocks, a spring park's birds elsewhere, quieter high up.
// - the game: a time trial's countdown beeps, gates, finish and false start, as a race timer beeps; a chime for a
//   golden prop.
//
// The recordings are CC0 (sounds/SOURCES.md); everything else is made here. Nothing here feeds back into the sim.

import { A, BEAT_M, RAIL_M, TF, MAX_TRAINS } from './frame';
import {
    airCornerHz, doppler, noiseCornerHz, noiseGain, rotorWave, toneGain, washOf
} from './quad-sound';

/** The volume settings (settings.ts): on or off, then each part 0-100. */
export interface SoundLevels {
    on: boolean;
    master: number;
    quad: number;
    /** the trains */
    world: number;
    /** the city and the park */
    ambience: number;
    effects: number;
    /** the sound card's smallest buffer (about 20 ms to the ears instead of 65 in Chrome on Windows) */
    lowLatency: boolean;
}

/** underruns within 4 s that count as crackle at low latency [estimate: a click a second is plainly audible] */
const CRACKLES = 4;

export interface SoundOptions {
    /** blades per prop (quad-sound.ts bladesOf) */
    blades: number;
    /** a hover's share of top rotor speed (1 / sqrt(thrust-to-weight)) */
    hoverShare: number;
    /** the trains' wheel sets, m back from the front (frame.ts trainAxles) */
    axles: number[];
    /** where the sound files are: a base URL ending in / */
    base: string;
    /** low latency crackled and was turned off */
    onCrackle?: () => void;
}

/**
 * Where the prop strike starts in strike.ogg, s: the clip opens on 0.11 s of the quad flying before its props hit the
 * frame, which made every strike sound late.
 */
const STRIKE_AT = 0.108;

/** The recordings (sounds/SOURCES.md) */
const FILES = {
    strike: 'strike', whistle: 'whistle', standing: 'standing', park: 'park', city: 'city',
    hard: ['hit-hard-000', 'hit-hard-001', 'hit-hard-002', 'hit-hard-003', 'hit-hard-004'],
    soft: ['hit-soft-000', 'hit-soft-001', 'hit-soft-002', 'hit-soft-003', 'hit-soft-004']
} as const;

/**
 * Mix levels of the parts against each other [tuned by ear: the owner's to judge]. The quad at full throttle comes to
 * about -6 dBFS rms (master 100 %), so the compressor only rounds off the loudest moments: driven hard, it pumped the
 * other sounds and its fast limiter crackled.
 */
const MIX = {
    quad: 10, rotor: 0.075, rush: 0.05, wind: 0.5,
    hit: 0.9, strike: 0.8,
    chuff: 0.9, roll: 0.25, click: 0.25, standing: 0.5, whistle: 0.9,
    park: 0.9, city: 1.0,
    ui: 0.25
};

interface Rotor {
    osc: OscillatorNode;
    gain: GainNode;
    wash: GainNode;
}

interface TrainVoice {
    chimney: PannerNode;
    middle: PannerNode;
    air: BiquadFilterNode;
    roll: GainNode;
    stand: GainNode;
    standSrc: AudioBufferSourceNode | null;
    lastRun: number;
    lastV: number;
    seen: boolean;
}

/**
 * Smoothing of every per-frame change, s: setTargetAtTime with a 10 ms time constant (Chrome's own dezippering was
 * an exponential of about 10 ms). It starts from wherever the parameter is when the audio thread gets to it, so it
 * never steps; ramps scheduled from currentTime do, because the audio thread has often rendered past that time
 * already (the crackle of §1n, docs/notes/sound.md §1s). 20 ms was smoother still but slower to arrive.
 */
const TAU = 0.01;

export class AudioEngine {
    private ctx: AudioContext | null = null;
    private levels: SoundLevels;
    private opts: SoundOptions;
    private buffers = new Map<string, AudioBuffer>();
    private noise: AudioBuffer | null = null;

    private master!: GainNode;
    /** how many of each one-off sound have played, for checks from the console (__fly.sound.counts) */
    readonly counts = { chuff: 0, click: 0, whistle: 0, hit: 0, strike: 0, beep: 0, chime: 0 };
    /** what comes out, for checks from the console (__fly.sound.spectrum()) */
    private analyser: AnalyserNode | null = null;
    private quadBus!: GainNode;
    private worldBus!: GainNode;
    private uiBus!: GainNode;
    private ambBus!: GainNode;
    /**
     * the quad's sounds go in here, then the air's dulling, then either straight out (on board: the microphone rides on
     * the quad) or through the panner (out in the world)
     */
    private quadIn!: GainNode;
    private quadAir!: BiquadFilterNode;
    private quadPan!: PannerNode;
    private onboard!: GainNode;
    private outside!: GainNode;
    private rotors: Rotor[] = [];
    private rushSrc!: AudioBufferSourceNode;
    private rushFilter!: BiquadFilterNode;
    private rushGain!: GainNode;
    /** the rush comes in bursts as each blade passes: a tone at the blade-pass rate swings its level */
    private chop!: OscillatorNode;
    private washDepth!: GainNode;
    private windGain!: GainNode;
    private trains: TrainVoice[] = [];
    private parkGain!: GainNode;
    private cityGain!: GainNode;

    /** the listener's last place and when, for its velocity (Doppler) */
    private lastL: [number, number, number] | null = null;
    private lastT = 0;
    private lv: [number, number, number] = [0, 0, 0];
    private lastHitAt = -1;
    private lastHit = 0;
    private lastStrikeAt = -1;
    private lastCount = -1;
    /** the time since the last frame, s */
    private frameDt = 0;
    /** whether this context has the small buffer; the underrun counts of the last seconds; when they were last read */
    private lowNow = false;
    private underruns: number[] = [];
    private crackleAt = 0;

    constructor(levels: SoundLevels, opts: SoundOptions) {
        this.levels = { ...levels };
        this.opts = opts;
    }

    /** For checks: the mix's spectrum now (dB per bin, bin width sampleRate / fftSize) and its state. */
    spectrum(): { state: string; sampleRate: number; binHz: number; rmsDb: number; latencyMs: number; db: number[] } | null {
        const c = this.ctx, an = this.analyser;
        if (!c || !an) return null;
        const d = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(d);
        const w = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(w);
        let ss = 0;
        for (const x of w) ss += x * x;
        // what the browser and the sound card add between a change here and the ears
        const latencyMs = 1000 * (c.baseLatency + (c.outputLatency || 0));
        return { state: c.state, sampleRate: c.sampleRate, binHz: c.sampleRate / an.fftSize, rmsDb: 10 * Math.log10(ss / w.length + 1e-12), latencyMs, db: Array.from(d) };
    }

    /** The trains' wheel sets (the engine says once it is ready). */
    setAxles(axles: number[]): void {
        this.opts.axles = axles.slice();
    }

    /** True once the browser lets the page play sound (after a click or key press). */
    get running(): boolean {
        return this.ctx?.state === 'running';
    }

    /**
     * Starts the sound on a click or key press: browsers only let a page play sound after the person did something on
     * it. Call it from those events; it builds everything the first time.
     */
    unlock(): void {
        if (!this.levels.on) return;
        if (!this.ctx) {
            try {
                // low latency: the smallest buffer the sound card takes. In Chrome on Windows (2026-10-19) 'interactive'
                // left 66 ms between the sim and the ears, 0 about 19 ms; but a busy computer can't always refill so small
                // a buffer in time, and each miss is a click (watchCrackle) (docs/notes/sound.md)
                this.ctx = new AudioContext({ latencyHint: this.levels.lowLatency ? 0 : 'interactive' });
            } catch (err) {
                console.warn('No sound: this browser could not start Web Audio.', err);
                return;
            }
            this.lowNow = this.levels.lowLatency;
            this.underruns = [];
            this.build(this.ctx);
            void this.load(this.ctx);
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume();
    }

    /** Starts the sound over in a new AudioContext (a new buffer size), keeping the loaded recordings. */
    private restart(): void {
        const old = this.ctx;
        if (!old) return;
        this.ctx = null;
        this.analyser = null;
        this.rotors = [];
        this.trains = [];
        this.lastL = null;
        void old.close();
        this.unlock();
    }

    /**
     * Low latency: Chrome counts the times the sound card ran dry (AudioContext.playbackStats). More than a few in a few
     * seconds is audible crackle: the sound starts over with the browser's ordinary buffer and says so (onCrackle).
     */
    private watchCrackle(c: AudioContext): void {
        const stats = (c as AudioContext & { playbackStats?: { underrunEvents: number; totalDuration: number } }).playbackStats;
        if (!this.lowNow || !stats) return;
        const t = stats.totalDuration;
        // once a second, after the first three (starting up has a few of its own)
        if (t < 3 || t - this.crackleAt < 1) return;
        this.crackleAt = t;
        this.underruns.push(stats.underrunEvents);
        if (this.underruns.length > 5) this.underruns.shift();
        if (this.underruns.length < 2 || this.underruns[this.underruns.length - 1] - this.underruns[0] < CRACKLES) return;
        console.info(`Sound: ${this.underruns[this.underruns.length - 1] - this.underruns[0]} buffer underruns in ${this.underruns.length - 1} s at low latency; back to the ordinary buffer.`);
        this.levels.lowLatency = false;
        this.opts.onCrackle?.();
        this.restart();
    }

    /** The page is hidden or shown: the sound stops with it. */
    visible(on: boolean): void {
        if (!this.ctx) return;
        if (on && this.levels.on) void this.ctx.resume();
        else void this.ctx.suspend();
    }

    setLevels(l: SoundLevels): void {
        const restart = l.lowLatency !== this.levels.lowLatency;
        this.levels = { ...l };
        if (!this.ctx) {
            return;
        }
        if (restart && l.on) {
            this.restart();
            return;
        }
        if (!l.on) {
            void this.ctx.suspend();
            return;
        }
        void this.ctx.resume();
        this.applyLevels();
    }

    private applyLevels(): void {
        const c = this.ctx!, l = this.levels, t = c.currentTime;
        // a volume slider feels even in dB: 0-100 as -40..0 dB, 0 off
        const vol = (v: number): number => (v <= 0 ? 0 : 10 ** ((v - 100) * 0.4 / 20));
        this.master.gain.setTargetAtTime(vol(l.master), t, 0.05);
        this.quadBus.gain.setTargetAtTime(vol(l.quad), t, 0.05);
        this.worldBus.gain.setTargetAtTime(vol(l.world), t, 0.05);
        this.uiBus.gain.setTargetAtTime(vol(l.effects), t, 0.05);
        this.ambBus.gain.setTargetAtTime(vol(l.ambience), t, 0.05);
    }

    private build(c: AudioContext): void {
        this.noise = whiteNoise(c, 3);
        // a gentle compressor on the mix, as a camera's automatic gain: a full-throttle punch-out is loud, not clipped. Its
        // attack is slower than a period of the props' tones (2-5 ms), so it follows their level, not their waveform
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 8;
        comp.ratio.value = 2.5;
        comp.attack.value = 0.012;
        comp.release.value = 0.3;
        // then a limiter, so nothing ever clips
        const limit = c.createDynamicsCompressor();
        limit.threshold.value = -1.5;
        limit.knee.value = 0;
        limit.ratio.value = 20;
        limit.attack.value = 0.004;
        limit.release.value = 0.15;
        comp.connect(limit).connect(c.destination);
        this.analyser = c.createAnalyser();
        this.analyser.fftSize = 8192;
        this.analyser.smoothingTimeConstant = 0.6;
        limit.connect(this.analyser);
        this.master = c.createGain();
        this.master.connect(comp);
        this.quadBus = gainTo(c, this.master, 1);
        this.worldBus = gainTo(c, this.master, 1);
        this.uiBus = gainTo(c, this.master, 1);
        this.ambBus = gainTo(c, this.master, 1);
        this.applyLevels();

        // the quad
        this.quadPan = panner(c, 1, 3000);
        this.outside = gainTo(c, this.quadBus, 0);
        this.quadPan.connect(this.outside);
        this.onboard = gainTo(c, this.quadBus, 1);
        this.quadAir = c.createBiquadFilter();
        this.quadAir.type = 'lowpass';
        this.quadAir.frequency.value = 20000;
        this.quadAir.Q.value = 0.5;
        this.quadAir.connect(this.quadPan);
        this.quadAir.connect(this.onboard);
        this.quadIn = gainTo(c, this.quadAir, 0);
        // prop wash: the rotors' sound throbs with the recirculating air, a slow random swell (about 4-20 Hz)
        const washLfo = c.createBufferSource();
        washLfo.buffer = this.noise;
        washLfo.loop = true;
        const washLp = c.createBiquadFilter();
        washLp.type = 'lowpass';
        washLp.frequency.value = 14;
        washLp.Q.value = 0.7;
        this.washDepth = c.createGain();
        this.washDepth.gain.value = 0;
        washLfo.connect(washLp).connect(this.washDepth);
        washLfo.start();
        // a real motor's speed never holds still: the flight controller corrects it all the time. A slow random wander of
        // about 0.2 % (3 cents rms) [estimate] keeps the four props from locking into one steady, synthetic tone
        const jitterLp = c.createBiquadFilter();
        jitterLp.type = 'lowpass';
        jitterLp.frequency.value = 6;
        jitterLp.Q.value = 0.7;
        const jitter = c.createGain();
        // white noise low-passed at 6 Hz is about 0.011 rms
        jitter.gain.value = 3 / 0.011;
        washLfo.connect(jitterLp).connect(jitter);
        for (let i = 0; i < 4; i++) {
            const osc = c.createOscillator();
            // each rotor its own phases (quad-sound.ts rotorWave), at the measured levels (no normalising)
            const w = rotorWave(this.opts.blades, i);
            osc.setPeriodicWave(c.createPeriodicWave(w.real, w.imag, { disableNormalization: true }));
            osc.frequency.value = 0;
            const jd = c.createDelay(2);
            jd.delayTime.value = 0.31 + i * 0.37;
            jitter.connect(jd).connect(osc.detune);
            const gain = c.createGain();
            gain.gain.value = 0;
            const wash = c.createGain();
            wash.gain.value = 1;
            // each rotor swells a little differently: the same noise, read from another place
            const d = c.createDelay(1);
            d.delayTime.value = 0.05 + i * 0.13;
            this.washDepth.connect(d).connect(wash.gain);
            osc.connect(gain).connect(wash).connect(this.quadIn);
            osc.start();
            this.rotors.push({ osc, gain, wash });
        }
        // the broadband rush of the blades
        this.rushSrc = c.createBufferSource();
        this.rushSrc.buffer = this.noise;
        this.rushSrc.loop = true;
        this.rushFilter = c.createBiquadFilter();
        this.rushFilter.type = 'highpass';
        this.rushFilter.Q.value = 0.7;
        this.rushFilter.frequency.value = 2000;
        const rushTop = c.createBiquadFilter();
        rushTop.type = 'lowpass';
        rushTop.frequency.value = 8000;
        rushTop.Q.value = 0.5;
        this.rushGain = c.createGain();
        this.rushGain.gain.value = 0;
        // steady white noise sounds like a radio's static; a blade's rush swells as it passes [estimate: half its level
        // swinging at the blade-pass rate]
        const chopped = c.createGain();
        chopped.gain.value = 1;
        this.chop = c.createOscillator();
        this.chop.frequency.value = 0;
        const depth = c.createGain();
        depth.gain.value = 0.5;
        this.chop.connect(depth).connect(chopped.gain);
        this.chop.start();
        this.rushSrc.connect(this.rushFilter).connect(rushTop).connect(chopped).connect(this.rushGain).connect(this.quadIn);
        this.rushSrc.start();
        // the wind on the quad's own camera microphone (FPV only): low rumble growing with airspeed
        const windSrc = c.createBufferSource();
        windSrc.buffer = this.noise;
        windSrc.loop = true;
        windSrc.playbackRate.value = 0.7;
        const windLp = c.createBiquadFilter();
        windLp.type = 'lowpass';
        windLp.frequency.value = 450;
        windLp.Q.value = 0.9;
        this.windGain = c.createGain();
        this.windGain.gain.value = 0;
        windSrc.connect(windLp).connect(this.windGain).connect(this.quadBus);
        windSrc.start();

        // the trains
        for (let k = 0; k < MAX_TRAINS; k++) {
            const air = c.createBiquadFilter();
            air.type = 'lowpass';
            air.frequency.value = 20000;
            air.Q.value = 0.5;
            const chimney = panner(c, 8, 4000);
            const middle = panner(c, 8, 4000);
            air.connect(chimney).connect(this.worldBus);
            middle.connect(this.worldBus);
            const rollSrc = c.createBufferSource();
            rollSrc.buffer = this.noise;
            rollSrc.loop = true;
            rollSrc.playbackRate.value = 0.5;
            const rollLp = c.createBiquadFilter();
            rollLp.type = 'lowpass';
            rollLp.frequency.value = 280;
            const roll = gainTo(c, middle, 0);
            rollSrc.connect(rollLp).connect(roll);
            rollSrc.start();
            this.trains.push({ chimney, middle, air, roll, stand: gainTo(c, air, 0), standSrc: null, lastRun: 0, lastV: 0, seen: false });
        }

        // the places
        this.parkGain = gainTo(c, this.ambBus, 0);
        this.cityGain = gainTo(c, this.ambBus, 0);
    }

    private async load(c: AudioContext): Promise<void> {
        // a restart (a new buffer size) keeps what was loaded: AudioBuffers belong to no one context
        const names = [FILES.strike, FILES.whistle, FILES.standing, FILES.park, FILES.city, ...FILES.hard, ...FILES.soft]
            .filter((n) => !this.buffers.has(n));
        await Promise.all(names.map(async (n) => {
            try {
                const r = await fetch(`${this.opts.base}${n}.ogg`);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                this.buffers.set(n, await c.decodeAudioData(await r.arrayBuffer()));
            } catch (err) {
                console.warn(`Sound ${n} did not load:`, err);
            }
        }));
        if (this.ctx !== c) return;
        this.loop(FILES.park, this.parkGain);
        this.loop(FILES.city, this.cityGain);
        for (const t of this.trains) t.standSrc = this.loop(FILES.standing, t.stand);
    }

    /** Plays a loaded recording on a loop into `to`, starting at a random point (two loops never line up). */
    private loop(name: string, to: AudioNode): AudioBufferSourceNode | null {
        const b = this.buffers.get(name);
        if (!b || !this.ctx) return null;
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.loop = true;
        s.connect(to);
        s.start(0, Math.random() * b.duration);
        return s;
    }

    /** Plays a recording once into `to` at `gain`, speed `rate`, from `from` s into it (faded in over 3 ms there). */
    private shot(name: string, to: AudioNode, gain: number, rate = 1, from = 0): void {
        const b = this.buffers.get(name);
        const c = this.ctx;
        if (!b || !c) return;
        const s = c.createBufferSource();
        s.buffer = b;
        s.playbackRate.value = rate;
        const g = gainTo(c, to, gain);
        const t = c.currentTime;
        if (from > 0) {
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(gain, t + 0.003);
        }
        s.connect(g);
        s.start(t, from);
        s.onended = () => g.disconnect();
    }

    /** One audio frame from the engine (frame.ts). */
    frame(a: Float32Array): void {
        const c = this.ctx;
        if (!c || c.state !== 'running') return;
        this.watchCrackle(c);
        if (this.ctx !== c) return;
        const t = c.currentTime;
        const on = a[A.on] > 0;
        const external = a[A.external] > 0;

        // the listener: the camera, its velocity from its last place
        const lx = a[A.lx], ly = a[A.ly], lz = a[A.lz];
        const dt = t - this.lastT;
        this.frameDt = dt > 0 && dt < 0.25 ? dt : 0;
        if (this.lastL && dt > 0 && dt < 0.25) {
            const k = Math.min(1, dt / 0.08);
            for (let i = 0; i < 3; i++) this.lv[i] += (([lx, ly, lz][i] - this.lastL[i]) / dt - this.lv[i]) * k;
        } else this.lv = [0, 0, 0];
        this.lastL = [lx, ly, lz];
        this.lastT = t;
        const L = c.listener;
        const [fx, fy, fz] = rotate(a[A.lqx], a[A.lqy], a[A.lqz], a[A.lqw], 0, 0, -1);
        const [ux, uy, uz] = rotate(a[A.lqx], a[A.lqy], a[A.lqz], a[A.lqw], 0, 1, 0);
        set(L.positionX, lx, t); set(L.positionY, ly, t); set(L.positionZ, lz, t);
        set(L.forwardX, fx, t); set(L.forwardY, fy, t); set(L.forwardZ, fz, t);
        set(L.upX, ux, t); set(L.upY, uy, t); set(L.upZ, uz, t);

        this.quad(a, on, external, t);
        this.trainsFrame(a, on, t);

        // the places: the city's traffic among the blocks, the park's birds elsewhere, both quieter high up
        const high = 1 / (1 + Math.max(0, a[A.agl]) / 60);
        const city = a[A.city];
        const amb = on ? 1 : 0.6;
        set(this.cityGain.gain, MIX.city * city * high * amb, t, 0.4);
        set(this.parkGain.gain, MIX.park * (1 - 0.8 * city) * high * amb, t, 0.4);

        // the time trial countdown: a short beep at 3, 2 and 1 s to GO (GO itself comes as its event)
        const toGo = a[A.toGo];
        const count = toGo >= 0 ? Math.ceil(toGo / 1000) : -1;
        if (count !== this.lastCount && count >= 1 && count <= 3) this.beep(880, 0.16);
        this.lastCount = count;
    }

    private quad(a: Float32Array, on: boolean, external: boolean, t: number): void {
        const c = this.ctx!;
        const wRef = a[A.wRef] > 0 ? a[A.wRef] : 1;
        const px = a[A.px], py = a[A.py], pz = a[A.pz];
        const lx = a[A.lx], ly = a[A.ly], lz = a[A.lz];
        // on board: the microphone rides on the quad, heard straight, with no panner (a source kept just ahead of a fast
        // camera swung from ear to ear as their smoothing lagged); out in the world, HRTF places it
        set(this.onboard.gain, external ? 0 : 1, t, 0.03);
        set(this.outside.gain, external ? 1 : 0, t, 0.03);
        set(this.quadPan.positionX, px, t); set(this.quadPan.positionY, py, t); set(this.quadPan.positionZ, pz, t);
        const dx = px - lx, dy = py - ly, dz = pz - lz;
        const d = external ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0;
        set(this.quadAir.frequency, airCornerHz(d), t, 0.05);
        const dop = external ? doppler(lx, ly, lz, this.lv[0], this.lv[1], this.lv[2], px, py, pz, a[A.vx], a[A.vy], a[A.vz]) : 1;
        set(this.quadIn.gain, on ? MIX.quad : 0, t, on ? 0.03 : 0.15);

        const shares = [0, 0, 0, 0];
        let mean = 0;
        for (let i = 0; i < 4; i++) {
            const w = a[A.w0 + i];
            shares[i] = w / wRef;
            mean += Math.abs(w) / 4;
            const r = this.rotors[i];
            set(r.osc.frequency, (Math.abs(w) / (2 * Math.PI)) * dop, t);
            set(r.gain.gain, MIX.rotor * toneGain(shares[i]), t);
        }
        set(this.rushGain.gain, MIX.rush * noiseGain(shares), t);
        set(this.rushFilter.frequency, noiseCornerHz(mean, this.opts.blades) * dop, t);
        set(this.chop.frequency, (mean / (2 * Math.PI)) * this.opts.blades * dop, t);
        set(this.rushSrc.playbackRate, dop, t);

        // prop wash: air coming up through the props (minus the airspeed along the body's up axis)
        const descent = -(a[A.vx] * a[A.ux] + a[A.vy] * a[A.uy] + a[A.vz] * a[A.uz]);
        const wash = washOf(descent, mean / wRef, this.opts.hoverShare);
        // the noise low-passed to 14 Hz is about 0.015 rms: 35 x that swings the rotors' level by about half
        set(this.washDepth.gain, 35 * wash, t, 0.1);
        set(this.rushFilter.Q, 0.7 + wash * 0.5, t, 0.1);

        // the wind on the onboard microphone grows with the square of the airspeed, up to full at 30 m/s [estimate]
        const v2 = a[A.vx] * a[A.vx] + a[A.vy] * a[A.vy] + a[A.vz] * a[A.vz];
        set(this.windGain.gain, on && !external ? MIX.wind * Math.min(1, v2 / 900) : 0, t, 0.1);

        if (!on) return;
        const now = c.currentTime;
        // a hit: Kenney's impacts, a hard one above a walking pace, louder with the speed (full at 8 m/s [estimate])
        const hit = a[A.hit];
        if (hit > 0.35 && (now - this.lastHitAt > 0.09 || hit > this.lastHit * 2)) {
            const g = MIX.hit * Math.min(1, hit / 8) ** 0.8 * (a[A.crash] > 0 ? 1.3 : 1);
            const pool = hit > 1.5 ? FILES.hard : FILES.soft;
            this.shot(pool[Math.floor(Math.random() * pool.length)], this.quadAir, g, 0.9 + Math.random() * 0.2);
            this.counts.hit++;
            this.lastHitAt = now;
            this.lastHit = hit;
        } else if (now - this.lastHitAt > 0.3) this.lastHit = 0;
        // blade strikes: the real props on a window frame, faster and higher when the rotor turns faster
        let k = 0;
        for (let i = 0; i < 4; i++) k = Math.max(k, a[A.k0 + i]);
        if (k > 0.04 && now - this.lastStrikeAt > 0.07) {
            this.shot(FILES.strike, this.quadAir, MIX.strike * Math.min(1, k * 1.5) ** 0.7, 0.8 + 0.4 * Math.min(1, k) + Math.random() * 0.06, STRIKE_AT);
            this.lastStrikeAt = now;
            this.counts.strike++;
        }
    }

    private trainsFrame(a: Float32Array, on: boolean, t: number): void {
        const c = this.ctx!;
        const n = a[A.nTrains];
        const lx = a[A.lx], ly = a[A.ly], lz = a[A.lz];
        for (let k = 0; k < MAX_TRAINS; k++) {
            const tv = this.trains[k];
            if (k >= n) {
                set(tv.roll.gain, 0, t, 0.2);
                set(tv.stand.gain, 0, t, 0.2);
                tv.seen = false;
                continue;
            }
            const o = A.trains + k * TF.size;
            const x = a[o + TF.x], y = a[o + TF.y], z = a[o + TF.z];
            set(tv.chimney.positionX, x, t); set(tv.chimney.positionY, y, t); set(tv.chimney.positionZ, z, t);
            set(tv.middle.positionX, a[o + TF.mx], t); set(tv.middle.positionY, a[o + TF.my], t); set(tv.middle.positionZ, a[o + TF.mz], t);
            const d = Math.sqrt((x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2);
            set(tv.air.frequency, airCornerHz(d), t, 0.1);
            const v = a[o + TF.v], effort = a[o + TF.effort], run = a[o + TF.run];
            const moving = v >= 0.05;
            set(tv.roll.gain, on ? MIX.roll * Math.min(1, v / 20) ** 1.5 : 0, t, 0.2);
            set(tv.stand.gain, on && !moving ? MIX.standing : 0, t, moving ? 1.5 : 0.8);
            if (!on || !tv.seen) {
                tv.lastRun = run;
                tv.lastV = v;
                tv.seen = true;
                continue;
            }
            const ran = run - tv.lastRun;
            // a jump (a replay seeking, a new life) is not a run: nothing to knock or exhaust
            if (ran > 0 && ran < 20) {
                const now = c.currentTime;
                const span = this.frameDt;
                // exhaust beats: one each BEAT_M of running, spread over the frame as they fell
                const b0 = Math.floor(tv.lastRun / BEAT_M), b1 = Math.floor(run / BEAT_M);
                for (let b = b0 + 1; b <= b1; b++) {
                    const when = now + ((b * BEAT_M - tv.lastRun) / ran) * Math.min(span, 0.05);
                    const strength = effort > 0.02 ? Math.min(1, 0.35 + effort * 1.1) : 0.18;
                    this.chuff(tv, when, strength, BEAT_M / Math.max(0.3, v));
                }
                // the rail joints under each wheel set
                for (const ax of this.opts.axles) {
                    const j0 = Math.floor((tv.lastRun - ax) / RAIL_M), j1 = Math.floor((run - ax) / RAIL_M);
                    if (j1 !== j0) this.click(tv, now, Math.min(1, v / 12));
                }
            }
            if (tv.lastV < 0.05 && moving) {
                this.shot(FILES.whistle, tv.air, MIX.whistle);
                this.counts.whistle++;
            }
            tv.lastRun = run;
            tv.lastV = v;
        }
    }

    /**
     * One exhaust beat: steam through the blast pipe, a burst of broad noise with a chesty low thump, sharp at the start and
     * dying away over most of the gap to the next beat (at speed the beats run together, as a real engine's do).
     */
    private chuff(tv: TrainVoice, when: number, strength: number, gap: number): void {
        const c = this.ctx!;
        this.counts.chuff++;
        const src = c.createBufferSource();
        src.buffer = this.noise;
        src.playbackRate.value = 0.8 + Math.random() * 0.15;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 500 + 500 * strength;
        bp.Q.value = 0.7;
        const g = c.createGain();
        const peak = MIX.chuff * strength;
        const decay = Math.min(0.35, Math.max(0.05, gap * 0.45));
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(peak, when + 0.012);
        g.gain.setTargetAtTime(0, when + 0.02, decay / 3);
        src.connect(bp).connect(g).connect(tv.air);
        // the thump
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 160;
        src.connect(lp).connect(g);
        const off = Math.random() * 2;
        src.start(when, off, decay * 3 + 0.05);
        src.onended = () => g.disconnect();
    }

    /** A wheel set on a rail joint: a short metallic knock. */
    private click(tv: TrainVoice, when: number, strength: number): void {
        if (strength < 0.02) return;
        const c = this.ctx!;
        this.counts.click++;
        const src = c.createBufferSource();
        src.buffer = this.noise;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1100 + Math.random() * 300;
        bp.Q.value = 3;
        const g = c.createGain();
        g.gain.setValueAtTime(MIX.click * strength, when);
        g.gain.setTargetAtTime(0, when + 0.004, 0.012);
        src.connect(bp).connect(g).connect(tv.middle);
        src.start(when, Math.random() * 2, 0.08);
        src.onended = () => g.disconnect();
    }

    // ------------------------------------------------------------ the game's own sounds

    /** A race timer's beep: a square tone through a soft filter. */
    private beep(f: number, dur: number, when = 0, type: OscillatorType = 'square', level = 1): void {
        const c = this.ctx;
        if (!c || c.state !== 'running') return;
        const t0 = when || c.currentTime;
        this.counts.beep++;
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3500;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(MIX.ui * level, t0 + 0.005);
        g.gain.setValueAtTime(MIX.ui * level, t0 + dur - 0.02);
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.connect(lp).connect(g).connect(this.uiBus);
        o.start(t0);
        o.stop(t0 + dur + 0.01);
        o.onended = () => g.disconnect();
    }

    /** What a time trial says (trials.ts TrialEvent types). */
    trial(type: string): void {
        const c = this.ctx;
        if (!c) return;
        const t = c.currentTime;
        if (type === 'go') this.beep(1760, 0.6);
        else if (type === 'gate') this.beep(1320, 0.08);
        else if (type === 'finish') {
            this.beep(1320, 0.12, t);
            this.beep(1760, 0.12, t + 0.15);
            this.beep(2349, 0.35, t + 0.3);
        } else if (type === 'false-start') this.beep(196, 0.6, t, 'sawtooth', 1.2);
    }

    /** A golden prop taken: a bright chime, three bell-like notes up. */
    collect(): void {
        const c = this.ctx;
        if (!c || c.state !== 'running') return;
        const t = c.currentTime;
        this.counts.chime++;
        [1047, 1319, 1568].forEach((f, i) => {
            const t0 = t + i * 0.09;
            // a bell's partials: 1, 2.76, 5.4 of the note, the upper ones dying faster
            for (const [m, lvl, dec] of [[1, 1, 0.5], [2.76, 0.35, 0.2], [5.4, 0.15, 0.1]] as const) {
                const o = c.createOscillator();
                o.frequency.value = f * m;
                const g = c.createGain();
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(MIX.ui * 1.4 * lvl, t0 + 0.004);
                g.gain.setTargetAtTime(0, t0 + 0.01, dec / 3);
                o.connect(g).connect(this.uiBus);
                o.start(t0);
                o.stop(t0 + dec * 2 + 0.05);
                o.onended = () => g.disconnect();
            }
        });
    }
}

function gainTo(c: AudioContext, to: AudioNode, v: number): GainNode {
    const g = c.createGain();
    g.gain.value = v;
    g.connect(to);
    return g;
}

/** A source out in the world: HRTF panning (best on headphones), level falling as 1 / distance beyond `ref` m. */
function panner(c: AudioContext, ref: number, max: number): PannerNode {
    return new PannerNode(c, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, maxDistance: max, rolloffFactor: 1 });
}

/** Moves a parameter smoothly towards v. */
function set(p: AudioParam, v: number, t: number, tau = TAU): void {
    if (!Number.isFinite(v)) return;
    p.setTargetAtTime(v, t, tau);
}

/** White noise, `s` seconds (the sound's own randomness: nothing of the sim uses it). */
function whiteNoise(c: AudioContext, s: number): AudioBuffer {
    const b = c.createBuffer(1, Math.floor(c.sampleRate * s), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
}

/** v rotated by the quaternion (x, y, z, w). */
function rotate(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number): [number, number, number] {
    const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
    return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}
