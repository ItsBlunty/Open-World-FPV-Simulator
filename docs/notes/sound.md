# Sound (§1l, 2026-10-19)

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
