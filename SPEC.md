# FPV Practice Sim: Specification

What the project must be. Where the work stands: `HANDOFF.md`. Owner answers: `docs/decisions.md`.
Items marked **[proposed]** are not yet confirmed by the owner.

## 1. Goal

An open-source, browser-based FPV drone simulator with realistic physics, whose game design rewards deliberate
practice. Existing sims mostly offer race times, combat or ungraded freestyle; this one adds structured, scored
practice on top of a sound flight model.

## 2. Platform

- Desktop browser, static hosting, no install. Chrome / Edge (WebHID for EdgeTX radios), Gamepad API as fallback.
  Firefox is shelved until the rest is complete (owner).
- GPL-3.0-or-later. Included MIT code (sim-core, Three.js) keeps its notices.
- Three.js, WebGPU with a WebGL 2 fallback. Playtest builds on GitHub Pages.

## 3. Architecture requirements (owner-mandated)

- **R1. sim-core is a separate component** (`packages/sim-core`, from ShramkoGSFPV, MIT © Andrii Shramko) with its
  own tests, version and changelog. No dependency on rendering, UI, game or browser; the game uses only its public
  interface (parameters and sticks in, state and events out, plus `ContactWorld`). It must be replaceable without
  touching game code. The flight controller and physics are split at the mixer: four motor commands in [0, 1], as in
  Betaflight SITL's motor packet.
- **R2. Physics review:** `docs/physics-review.md` lists each modelled effect (equation, source, assumptions,
  fidelity, feel, improvement path), the unmodelled ones, and improvements ranked by impact vs effort.
- **R3. Pluggable worlds:** a world = something to render + a `ContactWorld`. Mesh levels now; Gaussian-splat scans
  (ShramkoGSFPV's MIT voxel collision) must stay possible.
- **R4. Two flight controllers:** the built-in one (default), and later real Betaflight SITL through a small companion
  app bridging UDP to WebSocket (if it ships a Betaflight binary, the source must be offered, GPL).
- **R5. Determinism:** bit-identical replays from stick inputs, for scoring, ghosts and leaderboards.

## 4. Game design

### 4.1 Player
- The target player already flies acro. Beginners still get an introduction that teaches the basics up to acro.

### 4.2 What is decided
- One open world, about 1 km x 1 km: a 5-storey bando with broken floors, a park, a city. Free flight with
  challenges placed around it. Levels first, content after.
- Art: blockout geometry first, tuned by flying; then CC0 assets (Kenney, Quaternius, Poly Haven).
- Radio setup wizard: move each stick and switch, stick modes 1-4, calibration saved per device.
- Rates: the preset's, or the pilot's own Betaflight / Actual rates.
- FPV camera: 20° uptilt, adjustable. Real fisheye lenses from Gyroflow profiles (short list, Caddx Ratel 2 default),
  black bars where the picture is narrower than the screen; flat lens with a FOV slider (120° default).
- HUD: battery voltage, armed / flight mode, throttle, speed.
- Default drone: 5" freestyle, `nazgulf5v3-6s` preset (several values are estimates, see
  `packages/sim-core/docs/research/drones-v08.md`).
- Contacts: the quad must never stick to or shake inside surfaces; fixed in the physics, never by respawning.
  A quad left on its back uses turtle mode (Betaflight's default exit). No automatic rewind of a flipped quad; the
  rewind of a quad wedged with the throttle up for 3 s stays.
- Damage: shelved. Off by default, every hit a bounce; the "Damage and crashes" toggle brings back sim-core's
  health model. Landing on the underside does no harm unless very fast. **[proposed thresholds]** in sim-core/0.3.0.
- Crashes: quick respawn where you are; nothing costs the pilot in normal flight, no penalties for now (owner).
- Collectibles: numbered golden props hidden around the map, a collection screen with the count (owner).
- Time trials: courses of gates through what the map has (windows, gaps), started from a pad under a checkered arch
  after resting on it 3 s and accepting with the sticks; a 3-2-1-GO countdown with false starts; the arch is the last
  gate; times saved and listed in a Time Trials screen (owner).

- Solid stylised cars and people, traffic lights and crossings, each with a toggle in the settings.
- Challenge types, progression and rewards: to design after a playable prototype.

### 4.3 Freestyle grading: open
Owner's direction: recognise specific tricks, then grade each on how it was flown (a power loop on how circular it
is). Candidates: trick recognition + execution metrics (circle-fit error, plane flatness, rate consistency, exit
heading and height, throttle smoothness); line-based accuracy along gaps; or both. R5 means saved replays can be
re-scored when the method changes.

### 4.4 Social
Not at launch. Leaderboards, ghosts and sharing later (R5 keeps them possible).

## 5. Milestones

- **M0 Foundation:** done 2026-10-17.
- **M1 First flight:** done (map, mesh collision, radio input, FPV camera, HUD, respawn), flown by the owner.
- **M2 Physics review:** review done 2026-10-18; first fix (rotor inflow, G1) built, waiting for the owner to fly.
- **M3 Prototype content:** started 2026-10-18 with golden props to collect; then challenges; research freestyle
  grading (owner: a write-up now).
- **M4+:** progression, beginner introduction, social features.

## 6. Out of scope for now

Gaussian-splat worlds, Betaflight SITL, multiplayer. Each is kept possible by R1-R4.
