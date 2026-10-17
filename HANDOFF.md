# Handoff: research, decisions and state of the work

Read with `SPEC.md`: this file explains *why* and records where the work stands; SPEC.md says *what*.
Started 2026-10-17 at the end of the planning conversation; updated 2026-10-17 at the end of M0.

## 0. Where things stand (start here)

- **M0 is done** (2026-10-17) and pushed to https://github.com/ItsBlunty/Open-World-FPV-Simulator (`main`).
  CI (GitHub Actions: install, typecheck, test) passes: 31 test files, 334 tests.
- **Next: M1 First flight** (SPEC.md §5). Owner decisions for it are in SPEC.md §7: Three.js, blockout then
  CC0 art, EdgeTX radio over USB, 5" freestyle default drone (`nazgulf5v3-6s`).
- **Before planning M1, ask the owner the questions in §5 below**, then research the items listed there.
- Commands: `pnpm install`, `pnpm typecheck`, `pnpm test` (Node 22.12+, pnpm 10).

## 1. Physics core: ShramkoGSFPV `sim-core`

- Original repo: https://github.com/AndriiShramko/ShramkoGSFPV (MIT). Owner's fork, same commit, used as the copy
  source: https://github.com/ItsBlunty/ShramkoGSFPV. Commit `8c90f535a92ac63ada655772772f7f382ed1a5c9` (2026-10-16),
  `SIM_CORE_VERSION = 'sim-core/0.2.0'`. Vendored in `packages/sim-core`; every local change is listed in its
  `UPSTREAM.md`.
- Why it was chosen:
  - Its source (5,591 lines) imports nothing outside its own folder and has no runtime dependencies.
  - 1 ms fixed physics step; deterministic (same SHA-256 trace in Node and Chrome, across frame rates).
  - Rate curves verified against Betaflight 4.5.1 (`rc.c`) by its author: 0 error across 1,880 points.
  - Imports a pilot's Betaflight CLI `diff` (rates, PID, throttle curve).
  - Models motor lag, rotor inertia, battery sag, drag, airmode, Acro/Angle/Horizon, wind, prop wash (opt-in per preset).
  - The author re-implemented Betaflight from formulas rather than copying GPL code (his `docs/decisions.md`, D4).
- Owner flew it on the author's live site: physics "flies well enough to proceed"; the splat visuals looked bad,
  which is why only the core is used.
- Caveats: project started 2026-09-24, one maintainer, AI-assisted (52 commits co-authored by Claude).
  Many preset values are the author's estimates, labelled as such in his presets.
- Frames: Y up, right-handed, nose along −Z, metres (PlayCanvas convention). Three.js uses the same axes
  (Y up, right-handed, cameras look along −Z), so no conversion should be needed; confirm when building M1.
- First keyword survey of possible gaps (unconfirmed, for the physics review): no ground effect, no thrust change
  with inflow/airspeed, no blade flapping, ideal gyro (no noise), no RPM/notch filters, no thermal effects.

## 2. What M0 built, and what was learned

- **Layout:** `packages/sim-core` (flight model + bot pilot, exported as `@owfpv/sim-core` and `@owfpv/sim-core/bot`),
  `packages/world-mesh` (`MeshContactWorld`: sim-core's `ContactWorld` on triangle meshes, plus `queryRay`,
  `querySphere`, `distance`, and `MeshBuilder` for boxes and quads), `docs/physics-review.md` (findings for M2).
- **Commit history is the audit trail:** commit `cbf6a4a` holds sim-core exactly as upstream; diff against it to see
  every change we made.
- **Bot pilot** ported from upstream `packages/input/src/sim/{bot,plan,scenario}.ts`. It uses `Math.tan`/`atan2`/
  `hypot`, so the same bot flight may give different sticks in different engines; replays are still exact.
- **Mesh collision** is our own code: exact swept-sphere contact (face, edge, vertex), deterministic BVH, only
  `+ - * /` and `sqrt` in anything that changes state. Triangles are two-sided and have no "inside": a sphere whose
  centre is already past a surface is pushed out on that side (the sweep prevents this in flight).
  Evidence: a drop on a 200-triangle mesh floor gives the same trace hash as upstream's analytic plane floor;
  a flight at 30/60/144/240 fps gives equal hashes; BVH results equal a search of every triangle.
- **Voxel-scene tests** moved to `packages/world-mesh/test/` and fly in a mesh room built to the scan's measured
  layout (`test/room.ts`). What did not carry over, and why, is marked `port:` in each file. In short: the scan's
  uneven voxel surfaces caused a spin and a corner trap that flat meshes do not reproduce; a recorded Chrome flight
  replays only on the scan, so it was replaced by flying its recorded starting state.
- **FC/physics seam (R1):** `Sim.step()` now runs `arming()`, `controller()` (writes `motorCmd`, four commands in
  [0, 1] after idle) and `physics(motorCmd)`. They are private for now; the public API for an external controller
  is left to the SITL milestone. Proven trace-identical (upstream's saved logs replay to their saved hashes).
- **Physics finding F1** (`docs/physics-review.md`): sim-core resolves one contact per tick, so a near-level hit on
  a flat ceiling or floor becomes lopsided and can register as a crash (2.84 m/s climb → 4.56 m/s duct hit).
  Flat mesh levels will show this often; ask the owner whether ceiling touches and landings feel too harsh in M1.
- **Test coupling to know about:** world-mesh tests import sim-core's test kit (`packages/sim-core/test/log-kit.ts`)
  for the preset, `PlaneWorld`, `runFrames` and director wiring.
- **Not done in M0:** a Node-vs-Chrome determinism check with mesh collision (needs a browser page: do it in M1).
- **Upstream code worth reading before writing M1 input:** upstream `packages/input` (MIT, same commit) has EdgeTX
  WebHID, gamepad, keyboard, calibration and switch-mapping code. Only the bot was ported.
- **Repo housekeeping:** git identity is set per repo (`ItsBlunty`, GitHub noreply email). `.gitattributes` forces LF
  line endings (byte-exact fixtures have their own override). CI warns that its actions (`checkout`, `setup-node`,
  `pnpm/action-setup` v4) target the deprecated Node 20 runtime; it still passes.

## 3. Betaflight SITL (for the later "real firmware" mode)

From Betaflight's own SITL docs (https://betaflight.com/docs/development/autopilot/SITL_Autopilot_Testing_Gazebo):
- SITL builds as a native Linux x86_64 program (`make TARGET=SITL`). It cannot run inside a browser tab.
  No existing WebAssembly build of Betaflight was found.
- It talks to the physics over UDP: port 9002 motor speeds out (4 floats, 0–1), port 9003 sensor packet in
  (timestamp, gyro, accel, orientation quaternion, velocity, position, pressure), port 9004 RC channels in
  (timestamp + 16 × uint16). Configurator connects on TCP 5761, via a WebSocket proxy for the web app.
- Plan: a small companion app runs SITL and relays UDP to the browser over WebSocket. On Windows, SITL runs
  under WSL per Betaflight's docs.
- Reference implementation (GPL, Rust + Godot, not browser): https://github.com/hugowis/open-fpv-sim
  runs Betaflight SITL in lockstep with its physics. Its PyPI listing gives GPL-3.0-or-later, compatible with this
  project's GPL-3.0-or-later, so its code can be reused with its notices kept (check each file's header first).

## 4. Rejected options and why

| Option | Why not |
|---|---|
| notfeylo/propwash (MIT) | Was the first pick; the repo was deleted or made private on 2026-10-17. Lesson: don't depend on tiny single-person repos without forking. |
| aashizpoudel/fpv-simulation (MIT) | Runner-up. 480 Hz, simpler drag/motor model; controller outputs a whole-body force, not per-motor commands, so a poor fit for SITL. |
| RCForge (MIT) | General RC (planes, VTOL); quadcopter is a sideline. Good validation culture worth borrowing. |
| OceanFPV (MIT) | Rendering showcase; 120 Hz, 90-line flight model; its README says it's not a calibrated training sim. |
| AristidesAI/FPV.Sim (MIT) | Small, no tests, dormant since 2026-01-15. |
| Hyper-Fpv-Sim-v2, Cha-Shao/fpv-simulator | No license file, so not reusable. |
| Unity / Godot / Unreal | Owner wants browser-first and lightweight. Liftoff's Unity physics-upgrade trouble is a reason to keep physics outside any engine. |
| PlayCanvas, Babylon.js (as renderer) | Owner chose Three.js (2026-10-17). PlayCanvas was upstream's engine and is strong on splats; Three.js has the larger community. |

## 5. Open questions

Decided so far: see SPEC.md §7 (license GPL-3.0-or-later, GPL for sim-core changes, renderer, art, radio, drone).

**Ask the owner at the start of M1:**
- Which EdgeTX radio model, and is it set up as a USB joystick? Any channel order or switch for arm/mode to match?
- Use the owner's own Betaflight rates? sim-core imports a CLI `diff`; if yes, ask for the `diff all` text.
- FPV camera: usual camera uptilt angle and field of view.
- Map scale: how big a "small bando" is (storeys, rooms), and roughly how large the whole map should be.
- HUD for M1: which readouts (e.g. battery voltage, flight timer, throttle, speed, armed/mode).
- Playtest builds: publish to GitHub Pages (static hosting) or run locally only?

**Claude to research for M1 (do not assume):**
- WebHID vs Gamepad API for EdgeTX over USB (read upstream `packages/input` and EdgeTX docs).
- Three.js WebGPU/WebGL setup and its current version; loading glTF levels into `MeshContactWorld`.
- Driving sim-core's `Runner` from the render loop (fixed 1 ms steps, frame-rate independent).

**Left open on purpose:** freestyle grading method, progression and challenge design, until levels are flyable.

## 6. How the owner wants to work

- Building in Claude Code on the owner's computer, testing with a real radio.
- Workflow from Anthropic's best practices: explore, plan, then implement; give Claude a check it can run;
  `/clear` between unrelated tasks; commit often.
- Ask the owner rather than assume; record each answer in SPEC.md §7.
