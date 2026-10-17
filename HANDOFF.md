# Handoff: research, decisions and state of the work

Read with `SPEC.md`: this file explains *why* and records where the work stands; SPEC.md says *what*.
Started 2026-10-17 at the end of the planning conversation; updated 2026-10-17 at the end of M0, after building M1, after sim-core/0.3.0 (contacts), after sim-core/0.3.1 (prop strikes), and after sim-core/0.4.0 (turtle mode).

## 0. Where things stand (start here)

- **M0 is done** (2026-10-17). **M1 is built and live** at https://itsblunty.github.io/Open-World-FPV-Simulator/
  (CI publishes every push to `main`; Pages is on). The owner is flying it with the Boxer.
  Commands: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm dev` (Node 22.12+, pnpm 10). 41 test files, 382 tests.
- **§0a is done** (sim-core/0.3.0, commits `ecc89a2`, `fb45716`): the new contact solver fixes sticking and shaking;
  the damage model is built but **shelved by the owner** (off by default, every hit a bounce, toggle in Settings).
  **Waiting for the owner to fly the contacts** (bounces, sliding on walls and floors). Then M2 (physics review).
- **§0b, sim-core/0.3.1 (prop strikes):** the owner flew 0.3.0 and still got stuck on walls. Cause: a forward hit
  leaves the quad flat on its props against the wall, and their full thrust plus friction held it there. Now a prop
  against a surface over its intake makes no thrust, and the quad falls off. The owner chose turtle mode for a quad
  left on its back: **§0c, sim-core/0.4.0**. **Waiting for the owner to fly both** (re-run Radio setup to map the
  turtle switch, or use the T key).
- sim-core is now `sim-core/0.4.0`; the self-test hash is `cd45c59c…` (Node and Chrome 155 match; Firefox not re-checked).
- The owner asked to push to `main` after each fix so they can test the Pages build (2026-10-17).

## 0a. Contacts, damage, landing (owner, 2026-10-17, after flying M1): done, damage shelved

The owner's words, after the pinned-to-ceiling fix (§2b) went live: "I'm still getting stuck on surfaces, walls, etc,
and shaking inside of them, this shouldn't happen at all, timing out and moving isn't helpful, it just shouldn't
happen." Then: a simple damage model, and landing on the bottom of the drone like a real FPV drone.

1. **Fix the contact physics at the source (sim-core).** No sticking, no shaking against walls, floors or ceilings.
   Respawn rules that move a stuck quad away are NOT an acceptable fix: the owner rejected that approach. The
   "stuck, pinned" director rule added on 2026-10-17 (§2b) can be removed once contacts are right.
2. **Damage model, simple for now.** One health value, 100 % at spawn, going down with each hit, by an estimate of
   the impact from the speed (e.g. the contact's approach speed or the impact energy). Shown on the HUD. What happens
   at 0 % (crash / disarm / respawn) and whether a respawn restores it: not yet decided; propose, then ask.
3. **Land on the bottom without damage**, as a real FPV quad does, unless coming down very fast. Today any approach
   at or over `vCrash` (5 m/s for the Nazgul preset) is a crash wherever it hits, and contacts under it are free.
   A hit on the frame's underside (body-down contact normal) should be gentle up to a much higher speed than a hit on
   the props, the arms' ends or the top.

**What was learned reading the contact code** (`packages/sim-core/src/sim.ts`, `contact()` from line ~777):
- The collision shape is 5 spheres: 4 "duct" spheres at the motors (0.1 m from the centre in x and z, r = 45 mm for
  the Nazgul, so they stand in for the props) and 1 body sphere at the centre (r = 45 mm). There is no frame-bottom
  shape, so "landing on the bottom" today means landing on the prop spheres.
- Per tick: one swept test of all spheres (`world.sweep`), move to the first contact pose, ONE impulse at that one
  sphere (`impulse`: restitution 0.1 under `vBounce`, Coulomb friction `MU` 0.4), plus a 1 mm skin. Only when the
  first contact "pinned" the body (`PIN_M`) do the other touching spheres get impulses (`pinnedContacts`).
- When a sphere starts the tick overlapping (`t === 0`), the tick's motion is thrown away and spheres are pushed out
  (`pushOut`, 3 passes). Resting and sliding contacts go through this path or the single-impulse path every few
  ticks: that is the shaking. The body rocks from sphere to sphere, the ideal gyro sees rotation of several rad/s,
  and airmode answers with thrust (physics-review F1, F2; reproduction in `apps/fly/test/stuck.test.ts`).
- The invisible respawn platform already has a proper resting solver (`restOnDisc`: projected Gauss-Seidel over
  every touching sphere with accumulated normal and friction impulses). That is the model to extend to the scene:
  gather every sphere touching (within a contact margin) after the move, solve them together with accumulated
  impulses, and handle penetration by position correction rather than discarding the tick.
- `impact()` decides crash vs contact from one approach speed only; damage and the landing rule go there (and the
  sphere index / contact normal in body frame tells "bottom" from "props").

**Rules that apply** (`.claude/rules/sim-core.md`, CLAUDE.md): this changes traces, so bump `SIM_CORE_VERSION`,
add a CHANGELOG entry, list the change in `packages/sim-core/UPSTREAM.md`, comment every new constant's source
(estimates labelled), keep determinism (only `+ - * /`, `Math.sqrt`, dmath), add tests (a resting craft stays still
and the gyro reads ~0 on floors, walls and ceilings; sliding along a wall does not stick; landing at 2-3 m/s on the
bottom does no harm), re-pin hashes that legitimately change (`SELFTEST_HASH` in `apps/fly/src/selftest.ts`, upstream
log-replay tests may need their saved logs regenerated: check what they guarantee first), and ask the owner to fly it.
Record findings in `docs/physics-review.md` (F1/F2 are the starting point).

**What was built (sim-core/0.3.0, 2026-10-17).** Details: `packages/sim-core/CHANGELOG.md`; findings: physics-review
F1, F2 (fixed) and F3 (new).
- Contact solver (`sim.ts contactsAt`): every sphere's surfaces within 5 mm (new `ContactWorld.contacts()`) solved
  together each tick, speculative contacts (close the gap, no further), projected Gauss-Seidel, Coulomb-cone friction.
  The sweep only catches fast impacts (spheres 0.5 mm smaller), then the same solver at the touch pose. Leftover
  penetration is fixed by moving the pose. `MeshContactWorld.contacts` merges the triangles of a flat surface (seams
  between coplanar triangles would otherwise feel like bumps: turning that filter off breaks the wall-slide test).
- Measured: resting on a floor 3e-7 rad/s, pressed under a ceiling 1e-6, leaning into a wall 2e-5 (0.2.0: 2-3 rad/s);
  the owner's bando case lets go of the slab as soon as the throttle is down. Director's pinned rule removed.
- Damage: `S.health` (1 at every spawn), crash at 0; thresholds `vHarm`/`vCrash` (props, arms, top) and
  `vLandSafe`/`vLandCrash` (underside, normal within 30 deg of body up), blended to 60 deg. HUD shows HEALTH.
- Determinism: `?selftest` MATCH in Chrome 155 with the new hash `5115a73f…` (Node). Firefox not re-checked.
- Logs: 0.2.0 logs no longer replay to their 0.2.0 traces (`log-v2-compat.test.ts` says why); the app saves none.

**Damage shelved (owner, 2026-10-17):** "lets shelve the damage system for now, we should just bounce off of stuff
and keep flying". The app sets `crashOn: false` by default (setting `damage`, toggle "Damage and crashes" in
Settings; HUD hides HEALTH while off). sim-core keeps the model. The owner found it unrealistic: a real 5" hits on
its belly and slides without damage. Measured before shelving: belly skids at flight attitudes (0-30 deg nose down,
10-20 m/s forward, 2-3 m/s down) already took 0 %; the harsh parts were straight-down belly hits over 4 m/s, tilted
drops (F3) and hits past 60 deg counted as prop hits. When it comes back, ask the owner what a 5" survives.
**Still open for the owner:** do contacts, bounces and sliding along walls and floors feel right (friction 0.4)?

## 0b. Stuck on walls after 0.3.0 (owner, 2026-10-17): prop strikes, sim-core/0.3.1

The owner's words after flying 0.3.0: "When I hit a wall or floor or anything like that, my whole quad gets stuck".
Reproduced in Node (details and numbers: `docs/physics-review.md` F4): in forward flight the quad's top leans towards
the wall, so a hit swings it flat against the wall props first; the props kept full thrust into the wall, friction
held it up, and the acro controller's saturated corrections (airmode included) kept those props busy. Floor hits at
normal flight angles recover; steep nose-first ones flip it on its back, as in real crashes.
Fix: prop strikes (`sim.ts propStrikes`). Test: `contact-solver.test.ts`, "a forward-flight hit on a wall" (fails on
0.3.0: hangs at 2.83 m; passes on 0.3.1). Ported bot tests (`model-pinned`, `b12-dash`) now see the craft drop off the
wall it leans on; each says why. Open: after a hit the quad lies on its back at the foot of the wall (turtled):
turtle mode, bouncier hits or a prop-strike kick are the options to put to the owner.

## 0c. Turtle mode (owner, 2026-10-17): sim-core/0.4.0

The owner chose turtle mode over bouncier hits or a prop-strike kick, with Betaflight's default exit (turtle switch off
while armed disarms; arm again) and no automatic rewind of a flipped quad (SPEC.md §7).
- Source read in full: Betaflight 2026.6.2 (current release) `mixer.c applyCrashFlipModeToMotors`, `core.c`
  (arming, crash flip, small_angle), `imu.c isUpright`, `mixer_init.c` defaults; 4.5-maintenance compared (it had an
  expo and read the switch only at arming). Ported mix: `packages/sim-core/src/crashflip.ts` with Betaflight's header.
- Seam: `Sim.motorDir` next to `motorCmd`, as DShot's spin-direction command; SITL later sends the same.
- Input: channel 6 is the turtle switch. Radio setup has an optional turtle step (button or axis); T toggles it on
  radios without one; the HUD shows TURTLE, and TILTED with what to do when arming is refused. Old profiles have no
  turtle switch until Radio setup is run again.
- The game's director has the stuck-flipped rule off (`QUICK_RESPAWN.flipped`). The stuck-wedged rule (throttle up,
  not moving, 3 s) still rewinds, also a quad on its back with the throttle up (the self-test flight shows it).
- Findings: physics-review F4, "Turtle mode added".
- Seeing through surfaces after a crash (owner, 2026-10-17): the FPV camera sits at the body's centre, 45 mm from a
  surface the quad rests on, inside the old 5 cm near plane. Now 1 cm (`view.ts CAMERA_NEAR`) with a reversed depth
  buffer (`main.ts`); checked in Chrome on WebGPU and WebGL 2 against a tree trunk. The chase camera still has no
  collision of its own and can end up inside a building.

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
  line endings (byte-exact fixtures have their own override). CI's actions were moved to their Node 24 majors
  on 2026-10-17 (checkout v7, setup-node v7, pnpm/action-setup v6, upload-pages-artifact v5, deploy-pages v5).

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
- **Owner's first flight (2026-10-17, Pages build):** stuck in the bando: rewinds put the quad 25 cm under a slab
  and it got pinned against the ceiling with the throttle at zero (physics-review F2). Fixed for now by roomier
  rewind spots (`REWIND_MARGIN_M` 0.5 m) and a director rule for being pinned; the physics cause is for M2.
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
