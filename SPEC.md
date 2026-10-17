# FPV Practice Sim — Specification (DRAFT)

Status: architecture requirements recorded 2026-10-17. Game design pending owner interview.
Items marked **[proposed]** are not yet confirmed by the owner.

## 1. Goal

An open-source, browser-based FPV drone simulator with realistic physics, whose game
design rewards deliberate practice. Existing sims mainly offer racing times, combat, or
ungraded freestyle; this project adds structured, scored practice on top of a sound flight model.

## 2. Platform

- Runs in a desktop browser from static hosting; no install for the default mode.
- Primary browsers: Chrome / Edge (WebHID for EdgeTX radios). Gamepad API as fallback input.
- License: GPL-3.0-or-later for the project (owner's choice, 2026-10-17). Included MIT code (sim-core, Three.js)
  keeps its original copyright and license notices. Betaflight (GPL-3.0) code and the Betaflight SITL bridge
  are license-compatible with the project.
- Renderer **[proposed]**: Three.js, using WebGPU where available with a WebGL fallback for wider browser reach.

## 3. Architecture requirements (owner-mandated)

### R1. The sim core is a separate, independently workable component
- Based on `sim-core` from [ShramkoGSFPV](https://github.com/AndriiShramko/ShramkoGSFPV) (MIT, © Andrii Shramko).
  Vendored with its LICENSE and a provenance note crediting the author.
- Lives in its own package (`packages/sim-core`) with its own tests, version and changelog.
- License of our changes to it: GPL-3.0-or-later (owner, 2026-10-17); the original files keep their MIT notice.
- No dependency on rendering, UI, game modes or the browser. The game talks to it only through its
  public interface: parameters in, stick channels in, state and events out, plus the `ContactWorld`
  collision interface.
- Must be replaceable or substantially reworked later without touching game code.
- Flight controller and physics are split at the mixer: the FC outputs four motor commands in [0, 1],
  the same shape as Betaflight SITL's motor packet, so a different controller can drive the physics (R4).

### R2. Mechanical review of the sim core against real physics
A dedicated milestone producing `docs/physics-review.md`. For each modelled effect: the equation used,
its source, assumptions, a fidelity rating, its impact on flight feel, and an improvement path.
It also lists unmodelled effects and ranks future improvements by impact vs effort.

Initial gaps found in a first survey of the source (to be confirmed in the review, not yet verified):
- No ground effect.
- Rotor thrust does not vary with airspeed through the rotor (inflow / advance ratio).
- No blade flapping; to check how much rotor drag the existing duct/rotor momentum-drag term covers.
- Gyro is an ideal sensor (no noise or frame vibration), and there are no RPM / notch filters.
- No motor or ESC thermal effects.

Validation sources to use: real Betaflight blackbox logs (owner can supply), published thrust-stand data,
and the review's own physics test cases. Note the author's own preset values are partly estimates.

### R3. Pluggable world layer; Gaussian splats possible later
- A world = something to render + a `ContactWorld` for collision.
- Default and only planned world type: 3D mesh levels (e.g. glTF).
- Optional future world type: Gaussian splat scans, reusing ShramkoGSFPV's MIT voxel-collision package
  and a splat renderer. Not built now, but no design choice may preclude it.

### R4. Two flight controller modes
- Built-in controller (from sim-core): default, runs fully in the browser.
- Real Betaflight in SITL mode: later, via a small companion app that bridges SITL's UDP to the browser
  over WebSocket. If it ships a Betaflight binary, Betaflight's source must be offered with it (GPL).

### R5. Determinism
- Bit-identical replays from stick inputs, as sim-core already guarantees. Required for trustworthy scoring,
  ghosts and any future leaderboards. Game code must not break it.

## 4. Game design

### 4.1 Player
- Target player can already fly acro and uses that skill to complete the game's challenges.
- Beginners must still be able to play: include an introduction that teaches the basics up to acro.

### 4.2 Structure
- Open world: a free-fly map with challenges placed around it.
- First map: one mixed map with a small bando, next to a park and a city area.
- Challenge types: a variety, to be designed once levels work. Levels first, content added into them after.
- Progression / rewards: undecided; decide after a playable prototype.
- Crashes (to prototype): quick respawn where you are; inside a challenge area, respawn at that
  challenge's start. Final behaviour decided by playtesting.

### 4.3 Freestyle grading: OPEN, not committed
Owner's direction: capture specific tricks, then grade each on factors of its execution
(e.g. a power loop scored on how evenly circular it is, not oval). Candidate approaches to evaluate:
- **Trick recognition + execution metrics:** detect tricks from the flight trace (attitude, rates,
  trajectory), then score per-trick qualities: loop circularity (circle-fit error), flatness of the
  loop plane, rotation-rate consistency, altitude/heading held on exit, smoothness of throttle.
- **Line-based:** score accuracy and smoothness along a set line or gap sequence.
- **Hybrid** of both.
Determinism (R5) means scoring can be re-run on any saved replay, so the method can change later
and old flights re-scored.

### 4.4 Social
- Not at launch. Leaderboards, ghosts and sharing come later (R5 keeps them possible).

## 5. Milestones (draft)

- **M0 Foundation:** repo, vendored sim-core with provenance, its tests passing standalone
  (port the bot-pilot test helper; replace splat-voxel collision tests with mesh-collision ones);
  split the flight controller from the physics at the mixer (R1), proven trace-identical by the hash tests.
- **M1 First flight:** the mixed map (bando, park, city), mesh collision, radio/gamepad input,
  FPV camera, HUD, quick respawn. Flyable in a browser.
- **M2 Physics review:** deliver R2's `docs/physics-review.md`.
- **M3 Prototype content:** first challenges placed in the map; settle crash/respawn rules and
  explore freestyle grading options by playtesting.
- **M4+:** progression, beginner introduction, social features.

## 6. Out of scope for now

Gaussian splat worlds, Betaflight SITL mode, multiplayer. Each is kept possible by R1–R4.
