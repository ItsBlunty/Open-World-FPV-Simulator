# Traffic: solid cars and people, signals, left turns

Archived work notes, moved verbatim from HANDOFF.md on 2026-10-18. Read only when working in this area;
`HANDOFF.md` has the current state. Section numbers (§0a ...) are the ones code comments cite.

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


