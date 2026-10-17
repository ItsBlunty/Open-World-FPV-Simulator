# FPV Practice Sim — Specification (DRAFT)

Status: M0 done 2026-10-17; M1 built 2026-10-17, waiting for the owner's test flight. Game design beyond the first map pending owner interview.
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
- Renderer: Three.js (owner, 2026-10-17), using WebGPU where available with a WebGL fallback for wider browser reach.

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
- First map: one open world with a 5-storey bando (broken floors), a park and a city area, about 1 km x 1 km to start
  (owner, 2026-10-17).
- Art: blockout geometry first, tuned by flying; then CC0 assets (e.g. Kenney, Quaternius, Poly Haven) once the layout
  feels right (owner, 2026-10-17).
- Radio setup: a wizard that walks the pilot through moving each stick and switch, for stick modes 1-4, and saves the
  calibration per device (owner, 2026-10-17).
- Rates: the preset's by default, plus a box to type the pilot's own Betaflight or Actual rates (owner, 2026-10-17).
- FPV camera: 20° uptilt and 120° field of view by default, both adjustable (owner, 2026-10-17).
- HUD for M1: battery voltage, armed / flight mode, throttle and speed (owner, 2026-10-17).
- Playtest builds: published to GitHub Pages (owner, 2026-10-17).
- Default drone: a 5" freestyle quad, sim-core's `nazgulf5v3-6s` preset (owner, 2026-10-17). Several of its values
  are the preset author's estimates (see `packages/sim-core/docs/research/drones-v08.md`).
- Challenge types: a variety, to be designed once levels work. Levels first, content added into them after.
- Progression / rewards: undecided; decide after a playable prototype.
- Crashes (to prototype): quick respawn where you are; inside a challenge area, respawn at that
  challenge's start. Final behaviour decided by playtesting.
- Contacts (owner, 2026-10-17): the quad must never stick to or shake inside walls, floors or ceilings; this is fixed
  in the physics, not by respawning a stuck quad.
- Damage (owner, 2026-10-17): a simple model to start: one health value, 100 % at spawn, reduced by each hit from an
  estimate of the impact (from speed). Built in sim-core/0.3.0: no damage up to a safe speed, then growing with the
  impact energy to 100 % at the crash speed; shown on the HUD. **[proposed]** 0 % is a crash (disarm, the usual
  quick respawn) and every respawn restores 100 %; to confirm with the owner.
- Landing (owner, 2026-10-17): landing on the bottom of the drone does no damage unless very fast, as on a real FPV quad.
  Built in sim-core/0.3.0 **[proposed thresholds, to tune by flying]**: on the underside no damage up to 4 m/s, a crash
  at 10 m/s; on the props, arms or top no damage up to 1.5 m/s, a crash at 5 m/s (Nazgul).

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

- **M0 Foundation (done 2026-10-17):** repo, vendored sim-core with provenance, its tests passing standalone
  (port the bot-pilot test helper; replace splat-voxel collision tests with mesh-collision ones);
  split the flight controller from the physics at the mixer (R1), proven trace-identical by the hash tests.
- **M1 First flight:** the mixed map (bando, park, city) as blockout geometry, mesh collision (`packages/world-mesh`),
  radio input (EdgeTX over USB first, gamepad as fallback), FPV camera, HUD, quick respawn, the 5" default drone,
  rendered with Three.js. Flyable in a browser.
- **M2 Physics review:** deliver R2's `docs/physics-review.md`.
- **M3 Prototype content:** first challenges placed in the map; settle crash/respawn rules and
  explore freestyle grading options by playtesting.
- **M4+:** progression, beginner introduction, social features.

## 6. Out of scope for now

Gaussian splat worlds, Betaflight SITL mode, multiplayer. Each is kept possible by R1–R4.

## 7. Owner decisions log

Questions put to the owner and the answers, newest last. The body of this spec reflects them.

| Date | Question | Answer |
|---|---|---|
| 2026-10-17 | Project license | GPL-3.0 |
| 2026-10-17 | License of our changes to `packages/sim-core`: MIT (so they can go upstream) or GPL? | GPL; upstreaming not needed |
| 2026-10-17 | Split the flight controller from the physics in M0, or later? | Claude's call: done in M0 |
| 2026-10-17 | GPL-3.0 "only" or "or later"? | GPL-3.0-or-later |
| 2026-10-17 | Which 3D engine renders the world? (Three.js / PlayCanvas / Babylon.js) | Three.js |
| 2026-10-17 | How is the first map's art made? (blockout then CC0 / CC0 from the start / blockout only) | Blockout first, then CC0 |
| 2026-10-17 | What radio, connected how? (EdgeTX USB / wireless dongle / gamepad) | EdgeTX radio over USB |
| 2026-10-17 | Default drone for the first map? (5" freestyle / 65 mm whoop / 3" cinewhoop) | 5" freestyle |
| 2026-10-17 | Which EdgeTX radio, set up how? | RadioMaster Boxer. A setup system that saves calibration and settings, supports all 4 stick modes and walks the pilot through moving each stick |
| 2026-10-17 | Use the owner's own Betaflight rates? | Preset defaults, plus a box for Betaflight and Actual rates where pilots enter their own |
| 2026-10-17 | FPV camera uptilt and field of view? | 20° default, adjustable; ~120° FOV, adjustable |
| 2026-10-17 | Map scale and bando size? | One open world, start quite large; bando 5 storeys with broken floors |
| 2026-10-17 | HUD readouts for M1? | Battery voltage, armed / flight mode, throttle and speed |
| 2026-10-17 | Where do playtest builds run? | GitHub Pages |
| 2026-10-17 | Is ~1 km x 1 km the right map size to start? | Yes |
| 2026-10-17 | (owner's request after flying M1) Sticking and shaking on surfaces | Must not happen at all; fix the physics, respawn workarounds are not acceptable |
| 2026-10-17 | (owner's request) Damage | Simple health 100 % down by impact speed for now |
| 2026-10-17 | (owner's request) Landing | Landing on the bottom does no damage unless very fast |
