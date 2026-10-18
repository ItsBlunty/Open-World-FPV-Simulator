# Handoff: research, decisions and state of the work

Read with `SPEC.md`: this file explains *why* and records where the work stands; SPEC.md says *what*.
Started 2026-10-17 at the end of the planning conversation; updated 2026-10-17 at the end of M0, after building M1, after sim-core/0.3.0 (contacts), after sim-core/0.3.1 (prop strikes), after sim-core/0.4.0 (turtle mode), after the FPV camera near-plane fix, after the level look pass (map v2), after solid traffic (sim-core/0.5.0, map v3), and after left-turn arrows (2026-10-18).

## 0. Where things stand (start here)

- **M0 is done** (2026-10-17). **M1 is built and live** at https://itsblunty.github.io/Open-World-FPV-Simulator/
  (CI publishes every push to `main`; Pages is on). The owner is flying it with the Boxer.
  Commands: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm dev` (Node 22.12+, pnpm 10). 44 test files, 406 tests.
- **§0a is done** (sim-core/0.3.0, commits `ecc89a2`, `fb45716`): the new contact solver fixes sticking and shaking;
  the damage model is built but **shelved by the owner** (off by default, every hit a bounce, toggle in Settings).
  **Waiting for the owner to fly the contacts** (bounces, sliding on walls and floors). Then M2 (physics review).
- **§0b, sim-core/0.3.1 (prop strikes, commit `fd50a4b`):** the owner flew 0.3.0 and still got stuck on walls. Cause: a forward hit
  leaves the quad flat on its props against the wall, and their full thrust plus friction held it there. Now a prop
  against a surface over its intake makes no thrust, and the quad falls off. The owner chose turtle mode for a quad
  left on its back: **§0c, sim-core/0.4.0 (commit `320bf30`)**. **Waiting for the owner to fly both** (re-run Radio
  setup to map the turtle switch, or use the T key).
- **Camera fix (commit `f1ddc51`, renderer only):** the owner could see through walls and the ground after a crash.
  The FPV camera's near plane is now 1 cm with a reversed depth buffer (details at the end of §0c). Waiting for the
  owner to confirm on the Pages build.
- **The owner flew 0.3.0-0.4.0 and the camera fix: "all 4 seems good for now"** (2026-10-17). The stuck-wedged rewind
  stays. Chase-camera collision is on the to-do list (§5).
- **Level look pass, map v2 (§0d):** unbroken bando columns, windows on city buildings, road paint, sun shadows.
  **Waiting for the owner to look at it and fly it**, and to answer the people-and-cars question (§0d).
- **The owner liked the look pass and asked for solid cars and people, signals and performance settings: built (§0e).
  Waiting for the owner to fly into cars, ride a car roof, hit a signal arm, and look at the traffic and the new
  "Graphics and performance" settings.** Then M2 (physics review).
- **Left-turn arrows (owner, 2026-10-18, §0e "Left turns"):** the owner asked to fix the empty edge lane so cars drive
  around naturally, and corrected Claude's first attempt (give-way rules for left turns): **"the only rule needs to
  be follow the traffic lights"**, with cycles and turning arrows like a real city. Built that way: cars turn left
  everywhere on protected arrows and only ever follow their own light. **Waiting for the owner to look at it.**
- sim-core is now `sim-core/0.5.0` (moving surfaces; still worlds bit-identical); the self-test hash is `cd45c59c…`
  and the traffic hash `4479b371…` (traffic v4, arrows; Node and Chrome 155 match on WebGPU; Firefox not re-checked).
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

## 0d. Level look pass (owner, 2026-10-17): map v2

The owner asked for "a general pass" on how the level looks, with two points: the bando's pillars "seem like they are
segments only one story tall, so they have gaps in between them unlike a real building", and how much load people
walking and cars driving would add.
- **Bando columns** (`first-map.ts bando`): one box from the ground slab to the roof (or to the 4th floor's top
  for the few broken interior ones) instead of one per storey stopping under each slab. The old gap showed at every
  missing panel and along the outside, where the columns stand 25 cm proud of the slab edges. Test: "runs the bando
  columns unbroken" (fails on map v1). The RNG draws are unchanged, so the rest of the bando is the same.
- **City facades:** buildings use new `facade-*` materials; the shader (`render/world.ts windows()`) paints a window
  every 3 m per 3.5 m storey, shop windows on the ground floor, ribbon windows with mullions on glass towers, and
  fades to the average where the pattern gets finer than the screen can draw. Paint only: collision unchanged.
- **Road paint:** `LevelBuilder.decal()` draws a rectangle 2 cm up and leaves it out of the collision (stripe edges
  would be steps the contact solver catches on; 2 cm is under half a 45 mm collision sphere). Dashed centre lines
  and zebra crossings on every city junction.
- **Sun shadows** (`render/world.ts Sun`): 4096² map over 240 m around the camera, snapped to whole texels so it does
  not crawl. Measured GPU time at 2560x1319 (WebGPU, owner's machine): street 2.3 ms with / 1.5 ms without, city
  overview 0.6 / 0.7, bando 0.55 / 0.6. `?noshadows` turns them off. Works on the WebGL 2 fallback too.
- Map v2: 41 462 triangles (v1: 44 006), hash `57c76dcc…`. The self-test hash did not change (its flight is in the park).
- **People and cars (asked, not built):** answered the owner with this estimate. Drawn only (they cannot be hit):
  cheap to run (instanced low-poly models, a few hundred of each, well under a millisecond of CPU and GPU per frame),
  a moderate job to build (lanes and sidewalk paths on the city grid, stopping at junctions, CC0 models). Solid
  (a hit bounces the quad): their positions must come from the sim tick only (replays), and sim-core's contact solver
  must handle a moving surface (it assumes the world is still): a sim-core change with a version bump and a flight test.

## 0e. Solid traffic, signals and settings (owner, 2026-10-17): built, waiting for the owner to fly it

**Owner's asks:** "Lets add the solid versions of cars and people, stylize them so they look fun, and make
graphics/performance settings in settings menu, to disable these things." Then, mid-build: "Add stoplights and make
the driving more realistic. Make sure people wait at crossings, add crossing lights, etc. Make these also a toggle in
performance settings."

**Design (decided by Claude, not yet put to the owner; tell them):**
- Traffic is solid and replay-exact: every mover's place is a function of the sim tick alone. sim-core/0.5.0 adds
  moving surfaces: `ContactWorld.at?(tick)` (called at the start of every `Sim.step`, also while parked) and an
  optional `vel` out-array on `contacts()`. The solver works on velocity relative to the surface. A still world
  is bit-identical (every earlier hash, the self-test's included, unchanged). Movers are kinematic: a quad never
  slows a car.
- `packages/traffic`: `route.ts` (paths: straights and quarter circles, dmath sin/cos), `model.ts` (`TrafficModel`,
  `CAR`/`PERSON` shapes, `TrafficConfig {cars, people, signals}`, `TRAFFIC_VERSION` 4), `loops.ts` (signals off: cars
  loop each block 3 m off the kerb, people loop the sidewalk), `network.ts` (signals on, below), `world.ts`
  (`TrafficWorld`: mesh + movers + still signal boxes), `make.ts` (`makeTraffic`, `worldSha256`: the life header's
  collisionSha256 is the level hash, or a hash over it + the traffic config).
- `network.ts`: a 20 Hz traffic sim in lockstep with the tick, interpolated between steps, restarting from a
  checkpoint (every 60 s) when time goes back. One lane each way 4 m right of the centre line, stop line 13 m from
  the junction centre. Signal cycle and turns: see "Left turns" below (until 2026-10-18 it was a 60 s cycle, N-S
  then E-W 15 s green each, no left turns across oncoming traffic). Following: IDM (Treiber 2000), slowing for
  turns, "don't block the box". People walk hub to hub, queue at crossings and cross only on WALK.
- Fixes made to pass the 10-minute test (commit `906af21`; each found by logging every violation):
  - Red runs: a car's go-ahead was set once on green, even 100 m out, and kept, so it arrived on red. Now it is
    re-checked every step until the car is inside its comfortable stopping distance (then committed); on yellow
    it goes only if it cannot stop comfortably and gets in before red; never while cross traffic is still in the box.
  - Overlaps: a straight car ran into a slower right-turner from its own lane (they were on different movement
    paths, which share their start). Followers now see cars on sibling movements until the turn is done.
  - People near cars: all were those red runners. Also, people now wait on WALK while a car is in the junction
    or just leaving it (`CLEAR_S`).
  - **A trap that jammed the network:** the anticlockwise lane round the grid's edge has no way off (right is out of
    the city, left has oncoming traffic, corners force a left onto the next edge), so cars that joined it circled
    for ever; mean speed fell from 3.0 to 1.4 m/s over 30 min, one car stood still 20 min. Now no car turns into a
    link that cannot reach the rest of the network (computed, not hand-listed). That left the anticlockwise edge
    lane always empty; fixed on 2026-10-18 by left-turn arrows (below), and the check now finds no dead link.
  - Result over 10 min: overlaps 0, red runs 0, crossers near cars 0, 1606 crossings, mean car speed 3.08 m/s,
    steady over 30 min, longest stand-still 44.6 s (under one cycle). The low mean is the lights' doing (15 s green
    in 60 per approach); the test now checks flow (longest wait, last minute vs the run) and mean > 2.5.
- Session (`apps/fly/src/session.ts`): `traffic` option, `setTraffic()` (a new life at the spawn), `traffic`,
  `collisionSha256`.
- Renderer (`apps/fly/src/render/traffic.ts`): instanced toy cars (candy colours, glass cab, roof cap, big turning
  wheels, headlights, brake lights from `braking(i)`), bean people (googly eyes, swinging legs, party hats on a
  third), signal poles and lamps (walk heads blink on 'flash'). Drawn at the sim's tick from `allStatics()` and the
  model. The visible car body matches the collision box; the wheels sit inside it, and the body's 12 cm ground
  clearance is real: a quad sitting on the road passes under a car.
- Settings, "Graphics and performance": Cars, People, "Traffic lights and realistic driving" (all on by default;
  each change is a new life at the spawn), Resolution 50-100 % (live), Sun shadows (applies on reload: toggling
  `castShadow` live crashed Three.js; a Reload now button appears).
- Map v3 (hash `6ae96052…`): street lamps moved off the corners for the signal poles and crowds; stop lines painted.

**Evidence (2026-10-17):**
- `packages/sim-core/test/moving-surface.test.ts` (Pavo20, synthetic moving box): dragged at 3.87 m/s^2 (μg 3.92),
  then rides at 3.000000 m/s, gyro 6e-9 rad/s; a box driving into it shoves it with no sphere closer than 2 mm;
  control (box reporting no velocity) slides away under it.
- `apps/fly/test/traffic.test.ts` (real session, Nazgul, damage off as in the game): a car at 8.6 m/s shoves a
  hovering quad to 9.26 m/s, least clearance -0.00 mm; a quad with the car's speed rides its roof (0.054 mm drift in
  1.5 s, gyro 6e-7 rad/s); from rest on a roof it is dragged at 3.923 m/s^2 (μg 3.924); same run hash twice.
- `?selftest` now also hashes the traffic (both models, and after going back in time): MATCH in Chrome 155 on
  WebGPU and WebGL 2. Traffic costs about 0.45 ms per frame at street level (2560x1319, WebGPU, 117 cars, 270
  people, 274 car heads): 3.99 ms vs 3.54 ms with the traffic hidden; the traffic view's update is 0.24 ms of CPU.
  (Measured by rendering in a loop and waiting for the GPU queue; the page's fps counter is meaningless when the
  automation tab is in the background, and the first series after an idle spell is slow while the GPU clocks up.)

**Left turns (owner, 2026-10-18): "fix the empty edge, cars should be able to drive around naturally".**
- Claude first made left turns give way to oncoming traffic (gap checks, waiting in the junction). The owner stopped
  it: *"The traffic lights should have cycles like a normal city. The cars go when they can go because the light is
  green. Turning arrows on the lights if needed ... the only rule needs to be follow the traffic lights right?"*
  That code was thrown away. **Rule for this model: cars only follow their light; no give-way logic.**
- Built (`network.ts`): cars go straight (60 %), right or left
  wherever there is a road. The 84 s cycle, offsets ((ix*13 + iz*29) mod 84) s, has car light groups:
  0 N-S left arrows 7 s green / 3 yellow / 2 all-red; 1 N-S straight and right 15 / 3 / 2; 2 E-W arrows 7 / 3 / 2;
  3 E-W straight and right 15 / 3 / 2; then the scramble: walk 6, flashing 12, all-red 2. Each movement has a
  `group`; a car reads the light of the movement it takes; `boxClear` waits for other groups' cars to leave the box.
  A left turn with nothing oncoming (a T's stem, a grid corner) goes on the straight light and has no arrow head.
- Geometry: the left-turn arc starts 0.1 m past the stop line (`R_LEFT = STOP + LANE - 0.1` = 16.9 m), so the two
  opposing left turns on one arrow stay on their own side of the junction centre (paths 1.3 m either side, car
  corners 0.5 m apart): no movement crosses another in the same phase.
- Signals: an arrow head (`SignalHead.kind 'arrow'`, a solid box too) on the mast arm 0.9 m left of the main head;
  the renderer draws its three lamps as arrows pointing to the driver's left (`arrowLamp` instanced mesh).
- Tried and measured, not kept: split phasing (each approach its own green, no arrows): 1.62 m/s; arrows 5 s with
  straight 20 s (90 s cycle): 1.76 m/s. Kept: 7 s arrows, 84 s cycle: 1.89 m/s.
- **Cost to tell the owner:** mean car speed fell from 3.08 to 1.89 m/s. Straight-on now has 15 s green in 84 (was 15
  in 60), and with one lane a straight car behind a car waiting for its arrow waits too. Real cities fix that with
  left-turn pockets (a short extra lane) or coordinated "green wave" offsets; neither is built. Ask the owner.
- Evidence: all 44 files / 406 tests pass. 10-minute test: overlaps 0, red runs 0, crossers near cars 0, arrow turns
  > 150 (about 313), longest stand-still under one cycle (73 s < 84), mean 1.89 m/s (bound now > 1.6). Over 30 min:
  1.92, 1.86, 1.84, 1.83, 1.86, 1.88 m/s per 5 min (no jam growing), 984 arrow turns, 25 cars on the 34
  anticlockwise edge links at the end. `?selftest` MATCH in Chrome (flight `cd45c59c…`, traffic `4479b371…`).
  Screenshot of an arrow head lit red: `C:\Users\vhdbl\AppData\Local\Temp\claude-chrome-screenshots-GYM1tn\screenshot-1792314003439-15.jpg`
  (zoom: `...-16.png`).

**For the owner to try (handling changes):** fly into cars and people, ride a car roof, hit a signal arm and pole,
turn each setting off and on, watch a junction through a whole cycle. Ask: do hits on cars feel right (friction 0.4
as on concrete, cars never slow)? Is the traffic density, speed and light timing fun? Is the slower traffic with
arrows OK, or add left-turn pockets / green-wave offsets / shorter cycle?

**Left open:** Firefox `?selftest`; WebGL 2 `?selftest` not re-run after the arrows; left-turn pockets or green waves
if the owner wants faster traffic; cars do not react to the quad; the chase camera still has no collision (§5).

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

**Open from the 0.3.1-0.4.0 fixes (2026-10-17), to ask or offer the owner:**
- **To do (owner, 2026-10-17: "put chase cam on a list"):** the chase camera (C key) has no collision and can sit
  inside a building.
- The stuck-wedged rewind stays (owner, 2026-10-17).
- Hard hits barely bounce (upstream's restitution, 0.35 at v_bounce and less above) and a forward wall hit always ends
  flat against the wall. The owner chose turtle mode over bouncier hits; revisit only if they ask.
- Reverse prop thrust (0.73) comes from one 7" thrust-stand test; a 5" measurement would replace the estimate.
- Firefox has not run `?selftest` since sim-core/0.2.0 on the mesh map.

**Left open on purpose:** freestyle grading method, progression and challenge design, until levels are flyable.

## 6. How the owner wants to work

- Building in Claude Code on the owner's computer, testing with a real radio.
- Workflow from Anthropic's best practices: explore, plan, then implement; give Claude a check it can run;
  `/clear` between unrelated tasks; commit often.
- Ask the owner rather than assume; record each answer in SPEC.md §7.
