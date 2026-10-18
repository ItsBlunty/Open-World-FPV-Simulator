# Handoff: research, decisions and state of the work

Read with `SPEC.md`: this file explains *why* and records where the work stands; SPEC.md says *what*.
Started 2026-10-17 at the end of the planning conversation; updated 2026-10-17 at the end of M0, after building M1, after sim-core/0.3.0 (contacts), after sim-core/0.3.1 (prop strikes), after sim-core/0.4.0 (turtle mode), after the FPV camera near-plane fix, after the level look pass (map v2), after solid traffic (sim-core/0.5.0, map v3), after left-turn arrows (2026-10-18), and after the free-fly "Look around" camera (2026-10-18), and after the world pass (map v4, 2026-10-18), and after the Firefox gamepad fix (2026-10-18), and after the render worker and the warm-up (2026-10-18).

## 0. Where things stand (start here)

- **M0 is done** (2026-10-17). **M1 is built and live** at https://itsblunty.github.io/Open-World-FPV-Simulator/
  (CI publishes every push to `main`; Pages is on). The owner is flying it with the Boxer.
  Commands: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm dev` (Node 22.12+, pnpm 10). 46 test files, 417 tests.
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
  everywhere on protected arrows and only ever follow their own light. The owner: "It looks good to me for now",
  but opposing left turners seemed to drive through each other (they were 0.51 m apart). Claude then tried a
  diagonal path across the junction; the owner rejected it: **"STOP MAKING THINGS UNREALISTIC. REAL CARS CAN TURN
  NORMALLY ... NOBODY DRIVES DIAGONAL IN REAL LIFE"**. Real fix: lanes were 4 m from the centre line (near the
  kerb); now 2.5 m, and a left turn is one smooth quarter circle. **Waiting for the owner to look at it.**
- sim-core is now `sim-core/0.5.0` (moving surfaces; still worlds bit-identical); the self-test hash is `cd45c59c…`
  and the traffic hash `80f0c9aa…` (traffic v5: arrows, lanes 2.5 m from the centre line; Node and Chrome 155 match on WebGPU; Firefox not re-checked).
- **Free-fly "Look around" camera (owner, 2026-10-18, §0f, renderer only):** without a radio, "Look around" now flies
  the camera with WASD and the mouse. **Waiting for the owner to try the click-to-capture mouse steering** (Claude
  could only test drag-to-steer; see §0f).
- **World pass, map v4 (owner, 2026-10-18, §0g):** bando beams so walls never float, the roof tank on steel beams,
  real recessed city windows, see-through car windows with riders, car-park ramps, street-lamp heads, the south-east
  water tower's braces. **Waiting for the owner to look at it and fly it** (handling: window reveals and beams are solid).
- **Firefox gamepad fix (owner, 2026-10-18, §0h):** the Boxer in Joystick mode was never seen by "Use gamepad" in
  Firefox. Not a Web Serial matter (the owner asked about it; see §0h). The owner: "it works now", but ~200 Hz and
  **24 fps with the radio attached** (120 without). Fixed: the gamepad poll no longer spins on the main thread (§0h
  "Frame rate"). Flown: frame rate holds, sticks okay at ~140 Hz. Then the gamepad clock lost its 4 ms floor and the
  engine can run in a worker (§0i). **Flown (owner):** Firefox gamepad 225 Hz in the worker but "slight stutters every
  5 to 10 seconds"; 219 Hz on the page with no stutter. **Owner's choice: the engine stays on the page** (default);
  `?render=worker` keeps the worker. Chrome WebHID fine either way; Chrome gamepad 185-191 Hz (Chrome samples
  gamepads every 4 ms itself, §0i).
- **First-turn stutter (owner, 2026-10-18, §0j, renderer only):** the scene is drawn along six directions while the
  map loads, so the first turn no longer hitches. **Waiting for the owner to reload and turn.**
- The owner asked to push to `main` after each fix so they can test the Pages build (2026-10-17).
- **Browser checks (owner, 2026-10-18):** if Claude in Chrome is not connected, ask the owner to open Chrome; do not
  work around it with other tools.

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
- Geometry: lane centre `LANE` = 2.5 m right of the road's centre line (was 4 m, which put opposing left turners
  0.51 m apart). The left turn is one smooth quarter circle from just past the stop line into the far lane
  (`R_LEFT = STOP + LANE - 0.1` = 15.4 m), so the two opposing left turns on one arrow stay on their own side of the
  junction centre (paths 0.414 STOP - LANE = 2.9 m either side of it): no movement crosses another in the same
  phase. Measured over 10 min (sampled every 10 ms with interpolation): any two cars in one junction from different
  approaches never closer than 2.82 m (279 pairs; the closest are opposing straight cars), any two cars 1.95 m.
  Do not use diagonal or other unnatural paths (owner).
- Signals: an arrow head (`SignalHead.kind 'arrow'`, a solid box too) on the mast arm 0.9 m left of the main head;
  the renderer draws its three lamps as arrows pointing to the driver's left (`arrowLamp` instanced mesh).
- Tried and measured, not kept: split phasing (each approach its own green, no arrows): 1.62 m/s; arrows 5 s with
  straight 20 s (90 s cycle): 1.76 m/s. Kept: 7 s arrows, 84 s cycle: 1.89 m/s.
- **Cost to tell the owner:** mean car speed fell from 3.08 to 1.89 m/s. Straight-on now has 15 s green in 84 (was 15
  in 60), and with one lane a straight car behind a car waiting for its arrow waits too. Real cities fix that with
  left-turn pockets (a short extra lane) or coordinated "green wave" offsets; neither is built. Ask the owner.
- Evidence (numbers below measured with LANE 4; with LANE 2.5 all 406 tests pass again with the same bounds and
  `?selftest` MATCHes in Chrome, numbers not re-logged): 10-minute test: overlaps 0, red runs 0, crossers near cars 0, arrow turns
  > 150 (about 313), longest stand-still under one cycle (73 s < 84), mean 1.89 m/s (bound now > 1.6). Over 30 min:
  1.92, 1.86, 1.84, 1.83, 1.86, 1.88 m/s per 5 min (no jam growing), 984 arrow turns, 25 cars on the 34
  anticlockwise edge links at the end. `?selftest` MATCH in Chrome (flight `cd45c59c…`, traffic `4479b371…`).
  Screenshot of an arrow head lit red: `C:\Users\vhdbl\AppData\Local\Temp\claude-chrome-screenshots-GYM1tn\screenshot-1792314003439-15.jpg`
  (zoom: `...-16.png`).

**For the owner to try (handling changes):** fly into cars and people, ride a car roof, hit a signal arm and pole,
turn each setting off and on, watch a junction through a whole cycle. Ask: do hits on cars feel right (friction 0.4
as on concrete, cars never slow)? Is the traffic density, speed and light timing fun? Is the slower traffic with
arrows OK, or add left-turn pockets / green-wave offsets / shorter cycle?

**Left open:** Firefox `?selftest`; WebGL 2 `?selftest` not re-run after the arrows; the arrow-head screenshot above
predates the lane move (heads now sit over the 2.5 m lane); left-turn pockets or green waves
if the owner wants faster traffic; cars do not react to the quad; the chase camera still has no collision (§5).

## 0f. Free-fly "Look around" camera (owner, 2026-10-18): built, waiting for the owner to try it

The owner: with nothing connected, "Look around" opened the view but the camera could not move. Asked for a free-fly
camera with WASD and the mouse.

- `apps/fly/src/render/freecam.ts` (new): `FreeCam`, active whenever no radio profile is set up and not `?demo`.
  Click the canvas to capture the mouse (pointer lock), then the mouse steers; holding a button and dragging also
  steers (fallback when the browser refuses pointer lock). W/A/S/D move (W flies where you look, pitch included),
  Space / E up, Q down, Shift 4x. 10 m/s, 40 m/s with Shift, 0.0025 rad per pixel, 60 deg vertical FOV (all
  constants at the top of the file). R puts the camera back on the quad; C does nothing in this mode. The quad
  model is shown at the spawn point.
- `main.ts`: enters the free camera from the current camera pose (no jump), leaves it and restores the FPV / chase
  camera once a radio profile exists; opening the menu releases the mouse. The menu has a "Look around" key line.
- `ui/hud.ts`: the no-radio prompt is now passed in (`noRadioHint`): "click to look around, Esc for the menu", and
  the key list while the mouse is captured.
- Render-only: it moves the Three.js camera with the frame time and never touches sim state, so determinism is unaffected.

**Evidence (Chrome, dev server):** WASD + Shift then E moved the camera from (0, 0.16, 40) to (0, 6.74, 24.65); a
drag turned it about 70 deg right and slightly down, horizon level; `?selftest` MATCH (flight and traffic);
`tsc` for `apps/fly` clean. Screenshot after the drag: `C:\Users\vhdbl\AppData\Local\Temp\claude-chrome-screenshots-GYM1tn\screenshot-1792317412826-17.jpg`.

**Left open:** pointer lock was refused in the automation tab (`WrongDocumentError`, the tab was not the foreground
window), so click-to-capture steering is untested; ask the owner to try it, and whether the speeds and mouse
sensitivity feel right. The free camera has no collision (it flies through buildings).

## 0g. World pass (owner, 2026-10-18): map v4, built, waiting for the owner to look and fly

The owner asked for another pass over the whole world. Their points: the bando walls float like the columns used to
(missing bottom or top pieces); the water tower on the bando has part of its base touching nothing; office windows
should be set back, not flat; cars should have see-through windows with people in them.

- **Bando walls (`first-map.ts bando`, `BEAM`):** the walls ran from the floor panel to the panel above, so a missing
  panel left a 30 cm gap under or over them. Now, like a real cast frame, there are beams on every column line at
  every floor (0.45 m deep, 0.3 m wide; estimates, about span / 13), and the walls fill from the floor up to the
  beam above. Inside the collapse the beams fell with the panels; the perimeter ones all stand. The parapet sits on
  the edge beams. RNG draws unchanged, so the same panels and walls are missing as before.
- **Bando roof tank:** two of its legs stood over a missing roof panel (checked on map v3: nothing under them down to
  floor 3). Now the legs stand on two steel beams (dunnage) laid across the roof beams of column lines 7 and 8, as
  rooftop tanks are set.
- **City windows (`windowedBlock`):** real geometry, not paint. Each building is a glass core set 15 cm in from its
  footprint (`REVEAL`, estimate) wrapped in solid bands between window rows and piers between windows. Office windows
  1.4 m every 3 m (sill 0.9, head 2.6), shop fronts on the street floor (2.5 m, 0.3-3.0), glass towers get ribbon
  windows (0.8-3.2) with painted mullions (`window-ribbon` material). Windows are laid out per wall, whole bays,
  centred (the old shader's world-aligned windows could be cut by a corner). Hidden faces are left out
  (`LevelBuilder.box` `skip` mask, `FACE`). Cost: **222 630 triangles (map v3: 41 462)**; the map test (build twice,
  BVH, hash) still runs in about 0.4 s. The reveals are solid: a quad sliding along a wall can catch on a sill.
- **Cars (render only, `render/traffic.ts`):** the cab is now light-tinted transparent glass (both sides, no depth
  write) with body-colour pillars, a dark interior (floor, dashboard, steering wheel on the left, seat backs) and
  1-3 bean riders with eyes (driver on the left: traffic drives on the right). Collision unchanged (the cab box is
  solid, as glass is). 134 cars, 274 riders in the default traffic.
- **Also fixed or added:** the south-east water tower's brace floated between its legs (now two rings of girders
  joining the legs); the car park had no way up (now switchback ramps in two lanes, 16 % grade, each through an
  opening in the slab above, `LevelBuilder.rampZ`) and parapets on two sides only (now all four); street lamps were
  bare poles (now an arm and a lamp over the road); silos got roofs.
- `apps/fly/test/stuck.test.ts`: the owner's old under-the-slab spot is 7 cm from a new beam, so the spot moved 0.78 m
  into the same bay (under the flat slab, as the test means).
- Map v4 hash `e6d95de1…`. The self-test and traffic hashes are unchanged (the flight is in the park).

**Evidence:** `pnpm test` 44 files, 410 tests pass (4 new map tests: every perimeter bay has its beam at every floor;
the tank's legs stand on steel over the roof beams; windows 15 cm back on every south-row building face; the car-park
ramp's height and the opening over it). Each of the four fails on map v3. Screenshots in Chrome (WebGPU) of the
bando, its roof tank, a brick street, a glass tower corner and cars with riders (taken 2026-10-18, not saved to disk).

**Left open:** the owner to look and fly (do the window sills and beams feel right to fly along?); no frame-time
measurement after the 5x triangle count (the GPU cost was 0.5-2.3 ms before; worth a check on the owner's machine);
the underside of slabs renders very dark (the hemisphere light's ground colour), unchanged by this pass.

## 0h. Boxer not seen in Firefox (owner, 2026-10-18): gamepad connect fix, waiting for the owner

**Asked:** "add webserial support so that firefox can use radios", then: "I want to run it in HID/Joystick mode";
in Firefox "Use gamepad" kept saying "move a stick or press a button" and never saw the Boxer (Chrome's WebHID path
works fine).

**Why not Web Serial:** Firefox 151 (desktop) has Web Serial (hacks.mozilla.org, 2026-05), but it opens serial (COM)
ports only. A radio in USB Joystick mode is an HID device, not a serial port. EdgeTX's USB serial (VCP) modes
(`UartModes` in `radio/src/dataconstants.h`, `radio/src/serial.cpp`: telemetry mirror, telemetry, SBUS trainer, Lua,
CLI, GPS, debug, SpaceMouse, external module) send no stick channels to a computer either. Firefox has no WebHID, so
its only path for a joystick-mode radio is the Gamepad API, which the sim already has.

**Cause found in the code:** `connectGamepad` (main.ts) waited only for the `gamepadconnected` event. A browser fires
it once per page, the first time the pad is touched. A stick moved before "Use gamepad" was clicked used up the
event, so the menu waited forever. The poll loop already found the pad in `navigator.getGamepads()` but never said so.

**Built:** `devices/gamepad.ts` (upstream change 5 in `apps/fly/UPSTREAM.md`): a pad the poll finds is adopted and
announced like the event's; each source announces one pad once (a second pad no longer re-runs `useDevice`).
`main.ts`: with no Gamepad API at all (page not on localhost/https) the menu says so instead of waiting.

**Evidence:** `apps/fly/test/gamepad-connect.test.ts` (fake `getGamepads`): the old code fails 2 of 3 (pad present
before start never announced; a second pad announced), the new code passes 3 of 3. Full suite: 45 files, 413 tests
pass; `pnpm --filter @owfpv/fly typecheck` clean.

**Left open:** not tried on hardware, and Claude has no way to drive Firefox here. If the owner still sees nothing
after moving a stick, Firefox itself does not list the Boxer: next step is to see whether a gamepad tester page in
Firefox shows it (not yet researched why Firefox would miss it).
Firefox's input rate and stamps for this pad are not measured yet.

**Frame rate (owner, 2026-10-18):** with the Boxer as a gamepad Firefox showed ~200 Hz and fell to 24 fps; without
the radio it held 120 fps; Chrome with WebHID was fine. Cause, reproduced without a radio: upstream polled with a
MessageChannel loop that re-posts itself ~280 000 times a second, and Firefox 158 runs those messages ahead of its
frames (120 -> 25 fps with 6 ms of frame work); `getGamepads()` itself costs nothing measurable. Chrome 155 keeps 119.
Without a radio the loop never ran, which is why only the radio made it slow. Measured alternatives
(`docs/evidence/2026-10-18-gamepad-clock/results.md`): `scheduler.postTask` starves the same way; `setTimeout` and
`requestIdleCallback` hold 120 fps but poll only 105-120 Hz; a worker timer posting to the page every 1 ms holds
120 fps and polls ~140 Hz (Firefox clamps worker timers to ~4 ms); a worker busy loop polls ~205 Hz but keeps a CPU
core at 100 %. **Chosen: the worker timer** (`startClock` in `devices/gamepad.ts`, UPSTREAM change 6), one path for
every browser. Chrome gamepads (not the Boxer, which uses WebHID there) drop from ~220 to ~130 polls/s at that
load. Each new sample keeps its `Gamepad.timestamp`, so timing stays right; only some in-between samples are missed.
Evidence: full suite 45 files, 413 tests pass; typecheck clean; `pnpm --filter @owfpv/fly build` bundles the worker.
The owner flew it: frame rate held, "sticks feel okay", HUD ~140 Hz. The owner asked why a 1 ms clock is not 1000 Hz
and rejected tying input to the frame rate; Claude read Firefox's source (mozilla-firefox/firefox `main`, 2026-10-18):
- `dom/gamepad/windows/WindowsGamepad.cpp`: the "Gamepad" thread drains raw-input (WM_INPUT) reports only on a 4 ms
  one-shot timer (`kWindowsGamepadPollInterval = 4`, "250 Hz, is consistent with Chrome's gamepad implementation"),
  sending one event per changed axis/button.
- `ipc/GamepadEventChannelChild.cpp`: in the page's process every update is `NS_DispatchToMainThread`'d; the value in
  `getGamepads()` changes only when that main-thread task runs.
- `Gamepad.cpp`: `UpdateTimestamp()` sets `Gamepad.timestamp` to `performance.now()` when that task runs.
**So in Firefox:** updates that arrive while the main thread draws wait and are applied back to back after the
frame; only the last is ever visible, whatever the poll rate. The busy worker would NOT reach ~200 Hz while
flying (its 205 was polls in the probe with no pad; the owner's earlier ~200 was read while frames were starved to
24 fps, i.e. a mostly idle main thread). And **`gamepad.ts`'s stamp comment is wrong for Firefox**: the timestamp is
the main-thread apply time, up to a frame (~8 ms at 120 fps) late, not the gamepad thread's sample time.
**Proposed (asked the owner, not started):** move the renderer and the sim off the main thread (OffscreenCanvas in a
worker) so the main thread only takes gamepad updates as they arrive (~200-250 Hz, stamps a few ms late, independent
of the scene). Needs research first: Three.js WebGPU renderer in a worker in Firefox and Chrome.
The Boxer's real report rate: **500 Hz** (Chrome WebHID HUD, owner). Owner: "Yes, do this and report back with a
plan"; keep the worker timer until then.

**Render worker plan (researched 2026-10-18, not started; waiting for the owner's go):**
- Support (MDN browser-compat-data, read 2026-10-18): `requestAnimationFrame` in dedicated workers Chrome 69 /
  Firefox 99; `transferControlToOffscreen` + OffscreenCanvas Chrome 69 / Firefox 105; WebGPU in workers Chrome 113 /
  Firefox 141 (Windows only; Firefox macOS Apple silicon 145+, no Linux); WebGL 2 on OffscreenCanvas Chrome 69 /
  Firefox 105; WebHID in dedicated workers Chrome 131, not Firefox. `localStorage` is not in workers.
- Three.js r186 source: `Animation` calls `self.requestAnimationFrame`; backends accept an OffscreenCanvas and skip
  `setAttribute`; `CanvasTarget.setSize(w, h, false)` skips `style`. Our render code uses no DOM (only freecam's
  pointer lock and key/mouse listeners, which stay on the page).
- Spike (`docs/evidence/2026-10-18-render-worker/`, headless Firefox 158): Three.js renders from a worker at
  116-119 fps (WebGL 2: headless has no WebGPU adapter; `navigator.gpu` exists in the worker). With drawing off the
  page, the 1 ms worker clock reaches the page 248 times/s (Firefox's 4 ms timer floor; was ~140 while the page drew).
  Four staggered 1 ms intervals give 1002 ticks/s but fire in bunches (median gap 0 ms, p95 5 ms): no gain.
- Design: the page keeps the DOM (menu, settings + localStorage, Radio setup, HUD) and all input (Gamepad poll,
  WebHID, keys, mouse, pointer lock) and maps raw frames with the profile as now; it posts each mapped frame with its
  stamp shifted by `performance.timeOrigin` (page) - `timeOrigin` (worker). The worker owns FlightSession (sim-core,
  SimClock, traffic), the Three.js scene, views and the frame loop, and posts a small HUD snapshot back each frame.
  Same engine module runs on the page through the same message interface when a worker canvas is not available
  (and `?render=main` forces it, for A/B). sim-core is untouched; the determinism self-test must still match.
- Expected: Firefox gamepad ~200-250 new values/s (cap: Firefox's 4 ms drain; Boxer 500 Hz), stamps a few ms late
  instead of up to a frame, independent of the scene. Chrome WebHID stays 500 Hz (later option: open HID in the
  worker, Chrome 131+).
- Built: §0i. Claude in Chrome cannot drive Firefox: the probe ran in
throwaway Firefox windows, which pop up on the owner's screen (ask first, see memory).

## 0i. Render worker and a faster gamepad clock (owner, 2026-10-18): flown; engine stays on the page

**Asked:** the owner approved the plan (§0h): "1. yes [open browser windows] 2. yes [keep a fallback]". The Boxer's
real rate is 500 Hz (Chrome WebHID).

**Built (commit `fd5090b`):**
- `engine/engine.ts`: the flight session, Three.js scene, views, traffic view, free-fly camera motion and the frame
  loop, talking only through messages (`engine/protocol.ts`). `engine/worker.ts` runs it in a module worker on the
  page's canvas (`transferControlToOffscreen`). `main.ts` is now the page: menus, settings (localStorage), Radio
  setup, HUD, all input; it maps radio frames with the profile and posts them with their page time.
- Clocks: `engine/radio-link.ts` shifts page time to the worker's (`performance.timeOrigin` difference) and keeps
  the stale-radio disarm (150 ms) on the engine's clock. Messages sent while the engine starts are queued, then handled.
- Fallback: no worker canvas, a worker that fails before 'ready', or `?render=main` -> the same engine on the page
  through a MessageChannel (lazy-loaded chunk). The menu's last line says "in a worker" / "on the page".
- HUD: the engine posts a snapshot 30 times a second (`HUD_HZ`); `Hud.update` takes a `HudSim` (a Sim fits it).
- Free-fly camera: `render/freecam.ts` has no DOM; the page captures the mouse and sends held keys and mouse movement.
- Gamepad clock (`devices/gamepad.ts`, UPSTREAM change 7): each 1 ms timeout is set from a message task, so the HTML
  timer-nesting clamp (4 ms) never applies: ~665 ticks/s in Firefox, ~544 in Chrome, gaps 1-2 ms, no spinning.
- Console: `__fly.engine` (backend and where), `__fly.ask(code)` runs code in the engine with `fly` in scope.

**Why the clock mattered more than the worker on this machine:** with the engine on the page, worker-clock ticks
still reached the page ~230 times/s with p95 lateness 3-4 ms, so drawing alone did not explain the owner's 140 Hz.
An imitation of Firefox's path (updates every 4 ms, page keeps the latest) showed the clamped `setInterval(1)`
catching 84 % of updates and the new clock 99.9-100 %, with the engine in the worker or on the page. The worker
still takes input lateness from p95 4 ms / max 6-8 ms to p95 0-1 ms / max 1-2 ms (Firefox) and keeps it there as
scenes get heavier.

**Evidence** (`docs/evidence/2026-10-18-render-worker/results.md`, production build in windowed browsers via
`drive.mjs`): Firefox 158 and Chrome 155 run WebGPU in the worker at 120 fps, WebGL 2 in the worker at 120 fps,
`?render=main` at 120 fps; `?selftest` MATCH in both (`cd45c59c…`, `80f0c9aa…`); UI (free camera keys and drag,
Esc pause, spawn menu, FOV slider, canvas size) and a simulated radio through `onRaw` (arm with Space, climb at 0.4
throttle, stale disarm) work in both. 46 test files, 417 tests (new: `engine-link.test.ts`); typecheck clean.

**Flown (owner, 2026-10-18):** "in the new version im getting slight stutters every 5 to 10 seconds. Update rate in
firefox shows 225hz, however, now when I do ?render=main, I get 219hz and no stutter. Id prefer to keep it in main".
Chrome: "fine in HID mode either way", gamepad mode 185-191 Hz with the Boxer. **Done:** the default is the engine on
the page; `?render=worker` opts into the worker (main.ts). So the Boxer in Firefox went ~140 -> 219 Hz from the clock
alone. Chrome's gamepad path is capped by Chrome: `device/gamepad/gamepad_provider.cc` (chromium `main`, read
2026-10-18) `kPollingIntervalMilliseconds = 4;  // ~250 Hz`; use WebHID in Chrome.
**Left open (worker):** the stutter's cause is not found (not reproduced by Claude; candidates to measure: garbage
from the 30 Hz HUD snapshots, Firefox's OffscreenCanvas presentation, worker GC). Earlier list, for when the worker
is picked up again: Firefox's real gamepad rate now (expected ~200+ Hz of the Boxer's 500;
Firefox drains raw input every 4 ms, so at most ~250), Chrome WebHID still 500 Hz, and feel in both. Window resize
while running not exercised (the start size is right). CPU cost of the new clock not measured (about 600 tiny tasks/s
on the page and in its worker). WebHID could later be opened inside the engine worker (Chrome 131+).

## 0j. First-turn stutter after a reload (owner, 2026-10-18): warm-up while loading, waiting for the owner

**Asked:** "Is there a way to preload more so we dont get stutters as we turn initially after reloading the page?"

**Cause (Three.js r186 source):** `Renderer.render` builds an object's pipelines and uploads its buffers the first
time it is drawn, and draws only what is in view (`_projectObject` culls to the camera frustum). `compileAsync`
culls the same way, so it would not cover what is behind the spawn view.

**Built:** `engine/engine.ts` `warmUp()`: before 'ready', the engine draws the scene from the spawn with a 90 deg
camera along the six cube faces, the chase-view quad shown, then restores the camera. Rendering only; no sim state.

**Evidence** (`drive.mjs` `SPIN=1`: reload in a fresh profile, "Look around", drag the free camera 360 deg, down
86 deg, up 172 deg, then 360 deg again; rAF frame times; production build, windows):
| Browser | Warm-up | Ready after | First turn: frames > 25 ms, worst | Second turn worst |
|---|---|---|---|---|
| Firefox 158 | no | 1.9-2.1 s | 3, 150-183 ms | 8.3 ms |
| Firefox 158 | yes | 1.9-2.2 s | 0, 17-25 ms (frame 0: the recorder's first frame) | 8.3 ms |
| Chrome 155 | no | 3.7-3.9 s | 3, 133 ms | 8.5 ms |
| Chrome 155 | yes | 4.1-5.3 s | 0, 8.5 ms | 8.5 ms |
46 test files, 417 tests pass; typecheck clean.

**Left open:** not tried by the owner. Turning traffic on in Settings builds new traffic meshes, which probably hitch once
the first time they come into view (not warmed). Other spawn points were not measured (they use the same materials).

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
- **Every finished task ends with a commit and a HANDOFF.md update** (owner, 2026-10-18), so the context can be
  cleared and the next session picks up from this file alone.
- Ask the owner rather than assume; record each answer in SPEC.md §7.
