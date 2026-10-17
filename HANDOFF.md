# Handoff: research and decisions so far

Written 2026-10-17 at the end of the planning conversation, before any code. Read with `SPEC.md`.
This file explains *why*; SPEC.md says *what*.

## 1. Physics core: ShramkoGSFPV `sim-core`

- Repo: https://github.com/AndriiShramko/ShramkoGSFPV (MIT). Tested at commit
  `8c90f535a92ac63ada655772772f7f382ed1a5c9` (2026-10-16). Package `packages/sim-core`, `SIM_CORE_VERSION = 'sim-core/0.2.0'`.
- The owner should keep a GitHub fork of it in case the original disappears.
- Why it was chosen:
  - Its source (5,591 lines) imports nothing outside its own folder and has no runtime dependencies.
  - 1 ms fixed physics step; deterministic (same SHA-256 trace in Node and Chrome, across frame rates).
  - Rate curves verified against Betaflight 4.5.1 (`rc.c`) by its author: 0 error across 1,880 points.
  - Imports a pilot's Betaflight CLI `diff` (rates, PID, throttle curve).
  - Models motor lag, rotor inertia, battery sag, drag, airmode, Acro/Angle/Horizon, wind, prop wash (opt-in per preset).
  - The author re-implemented Betaflight from formulas rather than copying GPL code (his `docs/decisions.md`, D4).
- Verified by us on 2026-10-17: in his full workspace, all 317 sim-core tests passed; the whole repo passed
  1,528 of 1,529 (1 skipped). Copied out alone, 14 of 29 sim-core test files ran (204 tests passed); the other 15 need:
  - his bot pilot (`packages/input/src/sim/`: bot, plan, scenario; ~1,900 lines, depends only on sim-core
    and his radio-input code). Port it: useful for automated tests and later demo flights or ghosts.
  - his voxel collision (`packages/collision`) for splat scenes. Rewrite those tests against mesh collision.
- Owner flew it on his live site: physics "flies well enough to proceed"; the splat visuals looked bad,
  which is why only the core is used.
- Caveats: project started 2026-09-24, one maintainer, AI-assisted (52 commits co-authored by Claude).
  Many preset values are the author's estimates, labelled as such in his presets.
- FC/physics seam: one `Sim.step()` in `src/sim.ts` does both. At the tested commit the mixer starts at line 437
  (`// ---- mixer with airmode ----`, writes `this.motorCmd`) and the motor model at line 466 (`// ---- motors ----`).
  Splitting there gives four motor commands in [0, 1], the same shape Betaflight SITL outputs.
- Frames: PlayCanvas convention (Y up, nose along −Z). The renderer must convert if it uses another convention.
- First keyword survey of possible gaps (unconfirmed, for the physics review): no ground effect, no thrust change
  with inflow/airspeed, no blade flapping, ideal gyro (no noise), no RPM/notch filters, no thermal effects.

## 2. Betaflight SITL (for the later "real firmware" mode)

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
  project's GPL-3.0, so its code can be reused with its notices kept (check each file's header first).

## 3. Rejected options and why

| Option | Why not |
|---|---|
| notfeylo/propwash (MIT) | Was the first pick; the repo was deleted or made private on 2026-10-17. Lesson: don't depend on tiny single-person repos without forking. |
| aashizpoudel/fpv-simulation (MIT) | Runner-up. 480 Hz, simpler drag/motor model; controller outputs a whole-body force, not per-motor commands, so a poor fit for SITL. |
| RCForge (MIT) | General RC (planes, VTOL); quadcopter is a sideline. Good validation culture worth borrowing. |
| OceanFPV (MIT) | Rendering showcase; 120 Hz, 90-line flight model; its README says it's not a calibrated training sim. |
| AristidesAI/FPV.Sim (MIT) | Small, no tests, dormant since 2026-01-15. |
| Hyper-Fpv-Sim-v2, Cha-Shao/fpv-simulator | No license file, so not reusable. |
| Unity / Godot / Unreal | Owner wants browser-first and lightweight. Liftoff's Unity physics-upgrade trouble is a reason to keep physics outside any engine. |

## 4. Open questions for the owner

- ~~License of our changes to `packages/sim-core`.~~ **Decided 2026-10-17: GPL-3.0 (option B).** Owner does not
  need to contribute back upstream. Andrii's original code keeps its MIT notices; our changes and new files are GPL-3.0.
- Renderer: Three.js proposed (WebGPU with WebGL fallback). Not yet confirmed.
- Art: proposed blockout geometry first, then CC0 assets (Kenney, Quaternius, Poly Haven). Not yet confirmed.
- Freestyle grading method, progression and challenge design: deliberately left open until levels are flyable.

## 5. How the owner wants to work

- Building in Claude Code on the owner's computer, testing with his real radio.
- Workflow from Anthropic's best practices: explore, plan, then implement; give Claude a check it can run;
  `/clear` between unrelated tasks; commit often.
