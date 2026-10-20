# Sound (§1l, §1m, §1n, 2026-10-19)

Owner: "add sounds, make them realistic, use open source sound sources (we're GPL 3)". Owner approved downloading
ten CC0 files (Freesound previews, Kenney Impact Sounds). Credits: `apps/fly/public/sounds/SOURCES.md` (~1 MB shipped).

## How it is built
- `apps/fly/src/audio/frame.ts`: the engine fills a Float32Array each frame (listener = camera, quad pose, rotor
  rad/s, blade strikes, fastest hit, time-trial toGo, city weight, height above ground, trains) and posts it as an
  `audio` message. Web Audio lives on the page only (`audio/audio.ts`, `AudioEngine`), started on the first click/key.
- `audio/quad-sound.ts`: the quad model, pure functions, tested in `apps/fly/test/sound.test.ts`.
  - Each rotor = one oscillator at the shaft rate playing a PeriodicWave: blade-pass harmonics (3-blade) at
    0, -2, -2, -4, -6, -9, -12, -15 dB, shaft tones -11/-17 dB, motor whine at 7 and 14 x shaft (XING2 2207 is 12N14P).
  - Tone amplitude ~ speed^2.75 (estimate: power ~ tip speed^5.5), idle floor 0.012. Broadband rush: high-pass at
    2 x BPF, low-pass 11 kHz, amplitude 4.8 x speed^4.65 (from the recordings: ~10 dB under tones near hover, level
    with them at 55 % speed).
  - Prop wash: descending at 0.25-2.2 x v_h (7.5 m/s at hover) the rotor gains are modulated by 14 Hz noise.
  - FPV camera: heard on board (equalpower, plus wind ~ airspeed^2). Other cameras: HRTF panner, 1/d, Doppler,
    air low-pass from ISO 9613-1 (formula matches the ISO table at 1, 2, 4, 8 kHz in the tests).
  - Hits: Kenney impacts (hard > 1.5 m/s, soft below), blade strikes: the real wall-strike clip, from the new read-only
    `Sim.bladeBrake(i)` (no trace change) collected per frame in `FlightSession.takeStrikes`.
- Trains: synthesised exhaust beats every pi x 1.524 / 4 m (as the smoke), loud with effort; rail-joint knocks every
  18.288 m per wheel set (`trainAxles`); rolling rumble; the standing hiss loop; whistle when pulling away.
- Ambience: city loop weighted by distance to blocks (fades over 150 m), park loop elsewhere, quieter with height.
- Game: countdown beeps at 3-2-1 (880 Hz), GO 1760 Hz, gate 1320 Hz, finish three notes up, false start buzz,
  golden-prop bell chime. Settings > Sound (on/off, master, quad, world, game volumes), M key mutes.
- Replays: track gained rotor speeds (`T.w0..w3`, T.size 20), so replays sound as flown; no hit sounds in replays yet.

## Evidence (browser, ?demo, Chrome pane)
- Rotor tones follow the sim: shaft 196 Hz -> BPF peak at ~588 Hz; climb at 55 % speed: BPF 928 Hz peak.
- Third-octave shape, game (55 % speed, 22 m/s, onboard) vs real 5" flyby (Freesound 524331, fast pass), dB re total:
  1 kHz -8 vs -5..-9; 2 kHz -10 vs -12..-18; 3.2 kHz -10 vs -6..-11; 4 kHz -11 vs -6..-14; 5-10 kHz -9..-12 vs
  -8..-18; 12.8 kHz -8 vs -11..-16 (then trimmed the top to 11 kHz, not re-measured).
- Levels (master 80 %): idle + ambience about -25 dBFS, climb at 55 % about -13 dBFS; compressor -12 dB 3:1 then a
  -3 dB limiter. `pnpm test`: 62 files, 549 tests pass; hashes unchanged.

## Not done / not checked
- Trains, hits, blade strikes, UI beeps, chase-camera Doppler not yet checked in the browser (counters exist:
  `__fly.sound.counts`; spectrum and rms: `__fly.sound.spectrum()`). Next step was `?spawn=station` and watch counts.
- Whistle is an American chime whistle (Big Boy); the model is a British Ivatt 2-6-0. No cars' own sounds (the city
  loop stands in), no hit sounds in replays, no sound for the level-crossing or people.
- Exponents and mix levels are estimates; the owner has to listen and fly.

## §1m The owner's first listen: late, tinny, echoey, static (2026-10-19)

Owner: sounds come in too late; the props sound tinny, a bit echoey, with a static sound; environmental sounds too loud.

- **Late, part 1: the strike clip.** `strike.ogg` opens on 0.11 s of the quad flying before its props hit the window
  (rms in 2 ms steps: -22 dB to 110 ms, then -10 dB). It now plays from 0.108 s with a 3 ms fade-in (`STRIKE_AT`).
  The Kenney hits start at once (peak within 2 ms); the whistle within 31 ms.
- **Late, part 2: the sound card buffer.** Chrome on Windows (the Claude browser pane, 2026-10-19) offers two buffers only:
  `latencyHint` 'interactive', 'balanced' or any number from 0.003 s: base 10 ms + output 56 ms = 66 ms; 0 or 0.001:
  2.7 + 16 = about 19 ms. But at 0, with the game running (19-23 fps here), even an empty graph ran dry 17 times in 8 s
  (`AudioContext.playbackStats.underrunEvents`), each a click; 'interactive': 0 in 10 s. HRTF or plain panning made no
  difference (22 vs 13 in 8 s). So the game starts at 0 and, if 4 or more underruns fall within 4 s (after the first 3 s),
  starts the sound over at 'interactive' (`watchCrackle`, `restart`: recordings kept) and saves Settings > Sound > Low
  latency sound off. Seen working here: 11 ms at start, switched within 6 s, 0 underruns after.
- **Tinny: harmonic levels re-measured.** §1l took each blade-pass harmonic's height over the noise around it as its
  level. Against the blade-pass peak itself, the flyby (5deMayo 524331) gives 2nd-5th harmonics -15, -16, -21, -21 dB
  (slow pass, BPF 662 Hz) and -9, -14, -15, -16 dB (fast, 1249 Hz); the shaft tone -15 dB. Now `BPF_DB` 0, -12, -15, -18,
  -20, -23, -26, -29; shaft -15, -20; motor whine -30, -34 (estimate); others -36. (The onboard wall-hit clip, 854351, has
  stronger harmonics, -2 to -7 dB: a camera microphone among the props is brighter. The flyby's balance was taken, as heard
  by a person.)
- **Echoey: four identical waves.** All four rotors played the same PeriodicWave, all harmonics in sine phase, at nearly
  the same speed: they sum as a slowly sweeping comb filter (a flanger). Now each rotor has its own random phases
  (`rotorWave(blades, seed)`, unnormalised so the measured levels hold; tested), and its speed wanders about 3 cents rms
  (noise low-passed at 6 Hz into `detune`, estimate) as a flight controller's corrections do. The pulse-train crest factor
  fell from 3.6 to 1.7. On the FPV camera the quad no longer goes through a panner at all: a source kept 0.2 m ahead of a
  camera, both smoothed, could swing between the ears at speed.
- **Static: the rush and the compressor.** The broadband rush was steady white noise as loud as the tones (measured in
  flight: 2.5-10 kHz third-octaves at -29..-33 dB against the tone bands at -29..-37). Now 9 dB lower relative to the
  tones, 8 kHz top instead of 11, and chopped at the blade-pass rate (half its level swinging, estimate). In flight
  (62 % rotor speed, 21 m/s) the 1 kHz octave now leads at -22..-33 dB and 2-8 kHz sits 12-20 dB under it. The mix was
  driven about 14 dB over the compressor's -12 dB threshold at full throttle into a 1 ms limiter; levels now come to about
  -12 dBFS rms at 55-62 % rotor speed (master 80 %), compressor -10 dB 2.5:1 with a 12 ms attack, limiter -1.5 dB 4 ms
  (both slower than a tone's period, so they follow its level, not its waveform).
- **Ambience:** city and park on their own bus and slider, Settings > Sound > Ambience, default 50 % (-20 dB, 12 dB under
  before; up to 20 dB of room). The World slider is now Trains.
- Not checked: trains, hits, strikes, beeps and chase Doppler by ear or counter in the browser (one whistle counted);
  whether the owner's PC holds low latency without crackle; Edge. `pnpm test`: 62 files, 550 tests pass, hashes unchanged.

## §1n Latency: what Chrome allows, where the owner's delay is (2026-10-19)

Owner: low latency can't stay on in Chrome on a high-end PC; is there no other way?

- **Chrome's own rule** (Chromium source, `media/base/audio_latency.cc`, main branch): on Windows a Web Audio
  context gets "either exactly the minimum buffer size (using IAudioClient3) or multiples of the default buffer size";
  nothing in between. IAudioClient3 is on by default (`kAllowIAudioClient3`, `media/audio/audio_features.cc`).
  'interactive' maps to the default size. So a page has two choices: the device's minimum or its default period.
- **Launch switches tried** (headless Chrome, throwaway profile, silence, `scratchpad/scripts/latency.mjs`):
  none (min 2.7 + 16 ms, 9 underruns in 4 s idle; default 10 + 56 ms, 0); `--enable-exclusive-audio` (5.3 + 128 ms:
  worse); `--audio-buffer-size=256` (5.3 + 48 ms, 0: about 10 ms better, a switch on Chrome's shortcut, not the game's
  to set); `--audio-buffer-size=128` (2.7 + 16 ms, crackles again).
- **The owner's PC:** the Windows default output is "Voicemeeter Input" (VB-Audio Voicemeeter VAIO, a virtual mixer);
  also a ZEDi-10 USB mixer, Bose AE2 SoundLink (Bluetooth), NVIDIA Broadcast. Per output (`setSinkId`, latencyHint 0
  then 'interactive', 3 s each): only the Voicemeeter inputs offer the small buffer, and all of them run dry with it
  (4-9 underruns in 3 s, with nothing else playing); ZEDi-10, Bose and NVIDIA Broadcast only the default (about 52 ms,
  0 underruns). Chrome's figure stops at the device it plays to: Voicemeeter's own buffering and its output (if the Bose,
  Bluetooth adds well over 100 ms, not measured) come on top. That is the larger part of the delay, outside the game.
- **What the game did:** every per-frame change now ramps straight to its new value over one frame (`RAMP`, the frames'
  mean spacing from `performance.now()`), not a 20 ms exponential (about 60 ms to arrive). Measured in the browser:
  rotor 0's pitch follows the sim's rotor speed with a 7 ms best-fit lag, 0.04 Hz rms error. The low-latency switch
  stays (it works where the device takes it); Settings > Sound says what adds delay outside the game.
- **Not done:** an output-device picker (Chrome only gives device names after a microphone permission; ask the owner);
  predicting rotor speed ahead from the motor command (sim-core `motorCmd`, `p.tau` 15 ms) would gain at most the motor
  lag and expose the PID's command noise.
- **Browser check of the rest** (?demo&spawn=station, chase camera): the quad goes through the panner (outside 1,
  onboard 0), Doppler ratio within 0.98-1.01 while the chase camera trails; a train pulling away: 2 chuffs, 1 rail click
  (a whistle counted earlier); the demo's crash: 2 hits, 1 prop strike; race beeps and the prop chime fire (called
  directly). Heard by ear: not by Claude.
