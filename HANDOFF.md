# Handoff: research, decisions and state of the work

Read with `SPEC.md`: this file explains *why* and records where the work stands; SPEC.md says *what*.
Started 2026-10-17 at the end of the planning conversation; updated 2026-10-17 at the end of M0 and again after building M1.

## 0. Where things stand (start here)

- **M0 is done** (2026-10-17). **M1 is built** (2026-10-17) and waits for the owner to fly it with the Boxer:
  that test flight, and the owner's notes on feel, close M1. Commands: `pnpm install`, `pnpm typecheck`, `pnpm test`,
  `pnpm dev` (Node 22.12+, pnpm 10). 35 test files, 348 tests.
- **Owner to-dos for M1:** fly it; check the first-flight list in §2b; turn on GitHub Pages (Settings > Pages >
  Source: "GitHub Actions") so CI publishes the playtest build.
- **Next after M1: M2 physics review** (SPEC.md §5).

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

## 2b. What M1 built, and what was learned

- **Layout:** `packages/input` (DOM-free: HID reader ported from upstream, `RadioProfile` + `mapFrame`, the calibration
  wizard), `packages/maps` (the first map as code, `LevelBuilder`, seeded integer `Rng`, `levelSha256`), `apps/fly`
  (Vite + Three.js 0.186 `WebGPURenderer`; `session.ts` wraps the runner, director and clock; UI in `src/ui`).
  Provenance of ported upstream files: `packages/input/UPSTREAM.md`, `apps/fly/UPSTREAM.md` (MIT notices kept).
- **Input research:** EdgeTX USB Joystick "Classic" sends CH1-8 as eight axes and CH9-32 as buttons; with both RF
  modules off the mixer runs at 1000 Hz (manual.edgetx.org, color radios, USB Joystick). WebHID reads each report with
  its own timestamp at the radio's rate and reads the device's own descriptor (upstream `hid-layout.ts`), so it is
  the primary path in Chrome/Edge; the Gamepad API (upstream's 500 Hz poll outside the render loop) is the fallback
  and the only path in Firefox. Stick modes 1-4 follow EdgeTX's Radio Setup table.
- **Calibration wizard:** our own, user-paced (nothing advances without Next), using upstream's rules found on real
  radios: a push counts at >= 70 % of travel held 400 ms; a switch is a held jump. Steps: range, centre, throttle,
  yaw, pitch, roll, arm (skip: Space arms), flight-mode switch (optional, positions mapped to acro/horizon/angle),
  respawn switch (optional), check. Profiles are saved per device key in localStorage. The thresholds are NOT yet
  tested on a real radio: the Boxer is the first.
- **Map:** ~1 km square, 44 006 triangles, pinned hash in `packages/maps/test/first-map.test.ts` (bump `MAP_VERSION`
  with any layout change). Park + spawn in the middle, 5-storey bando to the west (60 x 24 m, 3.6 m storeys, missing
  floor panels, a collapse through floors 3-4, an open shaft, windowed/missing walls, a dock annex), 60 city blocks
  north (heights grow towards the centre, a steel construction frame with a crane, an open car park), an industrial
  yard south-west (walk-through warehouses, container stacks, silos, a gantry), fields and a water tower south-east.
  The renderer draws the collision's own triangles, with a world-space 1 m / 5 m grid in a TSL shader for speed and
  height cues.
- **Determinism, Node vs browsers on the mesh map:** `?selftest` flies a scripted 20 s flight (2 crashes, 2 respawns)
  and compares with Node's hash `ead63cdd…`: **match** in Chrome 155 (WebGPU and forced WebGL 2) and Firefox 158.
- **Respawn (to playtest):** crash -> 1 s -> 2 s back along the path, on the platform, armed if the switch is on
  (`QUICK_RESPAWN` in `apps/fly/src/session.ts`); R or the radio's respawn switch -> the chosen spawn point.
  Settings changes (rates) start a new life at the spawn point.
- **Rates box:** Betaflight and Actual, fields and limits from sim-core's `rates-edit.ts`; switching type converts
  with `fitRates`, keeping the feel. Overrides go into each life header, so replays keep them.
- **Not done / known gaps:** no real-radio test yet; no fisheye lens (the 120° camera is rectilinear, so the edges
  stretch); no shadows; no sound; the gamepad path is untested on hardware; the HUD has no flight timer (not asked).

### First-flight checklist for the owner
1. `pnpm dev`, open the page in Chrome, plug in the Boxer, choose "USB Joystick (HID)" on the radio.
2. "Connect USB radio", pick the Boxer, run "Radio setup". Note any step that misreads or feels slow.
3. Fly from the park, then the bando. Report: hover throttle, rates feel, how crashes and respawns feel, whether
   landing / ceiling touches register as crashes too easily (finding F1), camera tilt and FOV.
4. Run `?selftest` once on your machine and say whether it shows MATCH.

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

**Asked and answered at the start of M1:** see SPEC.md §7.

**Open from M1:** loading glTF levels into `MeshContactWorld` (not needed while the map is code; needed when CC0 assets
replace the blockout), a fisheye lens model for the FPV camera, the Boxer's real HID descriptor as a test fixture.

**Left open on purpose:** freestyle grading method, progression and challenge design, until levels are flyable.

## 6. How the owner wants to work

- Building in Claude Code on the owner's computer, testing with a real radio.
- Workflow from Anthropic's best practices: explore, plan, then implement; give Claude a check it can run;
  `/clear` between unrelated tasks; commit often.
- Ask the owner rather than assume; record each answer in SPEC.md §7.
