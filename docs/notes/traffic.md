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



## 1p. People keeping apart (owner, 2026-10-19): traffic v8, built, waiting for the owner to look

The owner saw walkers walk into each other. Measured first (10 min of traffic on the first map, positions every 0.5 s,
two people closer than 0.55 m with PERSON.r = 0.3): 4880 touching pair-samples among 280 people. Most were people
waiting to cross on one spot (`row = queued % 2` put every third person on the first one's spot), people crossing
inside each other, and faster walkers walking through slower ones.

**What changed (`network.ts`).**
- *Waiting spots:* one row along the kerb, `CROSS_IN` 0.4 m in (was 0.6, so people walking past behind them stay
  clear), 3 spots 0.6 m apart to the right of the crossing's middle (2 where the right runs towards the block's corner;
  the street lamp 4 m from the corner comes after the third). A spot within 0.6 m of anyone else's (the other crossing
  at the same corner too) is taken. When all are, the person walks on along the block instead of queueing (more spots
  along the kerb ran into the lamps; a second row stood on the walking line).
- *Keeping apart (`keepApart`):* each step a walker looks 1.8 m ahead along their way at anyone within 0.6 m of their
  line. Same way: they keep 0.75 m behind (slow to their pace, or wait). Crossing their way close ahead: the higher
  index waits. When each is ahead of the other (paths that meet), only the higher index waits, so two never wait for
  each other (a first version deadlocked two people for good). People standing (waiting, inside, on the platform) are
  not walked round: tried, a 0.4 m sidestep made it worse (962 touching samples against 641 without) and put people
  into walls.
- State: a new slot per person (`P_COL`, the waiting spot's column); everyone's place snapped into a 2 m grid at the
  start of each step.

**Result:** 215 touching pair-samples (from 4880), longest touch 1.5 s, no walker stands still more than 1 s, nobody
inside the level at any sample. What is left is a brief pass at a corner, and walking past people waiting. Crossings
in 10 min 1229 (were 1311); cars unchanged (mean 1.81 m/s, 0 overlaps, 0 red runs). Test:
`packages/traffic/test/traffic.test.ts` "people keeping apart". Traffic self-test re-pinned `8afde0e9…`.

**Left open:** walkers still pass through people standing (waiting at a crossing or on the platform) and briefly
through each other at corners; no sidestepping; the platform's waiting spots unchanged.

## 1t. Vehicle variety, pickups, semis, street vendors (owner, 2026-10-20): traffic v9, map v15, built, waiting for the owner

**Owner's ask:** "add some variety to the cars other than color, and lets add some pickup trucks, and some semi trucks.
The pickup trucks should sometimes have things in the back that people are hauling. The semi trucks should sometimes be
open in the back and sometimes have stuff in them when open. Add some vendors around the city selling hot dogs and
similar items."

**Vehicles (`packages/traffic/src/vehicles.ts`).** Each vehicle is a list of solid boxes in its frame; the collision
(`world.ts`) takes those boxes and the renderer draws them, so what is drawn is what the quad hits (wheels, lamps,
windows, roofs, riders are drawn only, inside or against the boxes). Kinds, out of 100: the old toy car 26, saloon 20
(4.8 m), SUV 18 (4.6 m, glass to the tail), high-roof van 9 (5.4 m), crew-cab pickup 17 (5.9 m, bed floor 0.92 m up),
semi 10. Sizes are typical ones, marked [estimate] in the code, except the US trailer limits (23 CFR 658: 102 in wide,
48 / 53 ft; 13 ft 6 in high is the usual state limit).
- *Pickup loads* (35 % empty): moving boxes; 12 ft lumber over the dropped tailgate with a red flag; a sofa; a fridge
  and a box; small square hay bales stacked three layers.
- *Semis:* a day-cab tractor (pink, teal...: the candy colours) and a trailer: 53 ft box van shut (30 %), open with
  pallets (20 %) or open and empty (10 %); 28 ft pup shut or open with pallets (10 % each); 48 ft flatbed with lumber
  bundles or steel beams (10 % each). Open doors are swung right round and latched against the sides (as drivers do
  to drive with them open), with lock bars drawn on them. Pallets (48 x 40 in) fill from the front wall, 2 rows to a
  full trailer, 1.0-1.6 m of boxes, wrapped goods or bottled water each. The box van's floor is 1.27 m up and there is
  room under it between the landing gear and the axles: a quad can fly under a trailer, and into an open one.
- *Trailer kinematics (a design choice, tell the owner):* the kingpin rides on the tractor 2.1 m behind its middle,
  the trailer's axles stay on the lane line 12.2 m behind it (a 53 ft van), as a steered-axle trailer does. A real
  trailer's axles cut inside a turn (off-tracking); the city's corners (6 m right turns) are too tight for that: a
  53 ft trailer would cross the kerb and the people waiting there. Measured with the lane-following trailer, its edge
  stays 2.6 m off the kerb corner on a right turn and 2.3 m off an opposing left turner (geometry script, not kept).
- *Driving (`network.ts`):* each vehicle's own front and back in the following gap (IDM), the stop line, and the room
  a car needs to leave a junction (a semi enters only when its whole length but the last 4 m fits past the box);
  `boxClear` also waits for a tail (a trailer) still in the junction; people wait for a vehicle's tail, not its middle,
  to clear their crossing; a follower on a sibling movement keeps seeing a semi until its trailer is past the split.
  Every vehicle has the same acceleration and speeds as before (a real loaded semi accelerates slower: not modelled).
  The kinds come from their own draw sequence (3 draws per vehicle, the third seeds a semi's pallets), so the cars'
  speeds and routes draw as before. Signals off (loops): no semis (their corners are 5 m round, 3 m off the kerb).

**Street vendors (`packages/maps/src/vendors.ts`, map v15).** 11 carts: 8 on sidewalks where a building stands 3.9 m
or more back (14 m from corners, 5 m from doors, 8 m from bus shelters, 70 m apart), three in the park (ice cream and
hot dogs by the fountain, coffee by the path from the city). Hot dogs (red and yellow umbrella, ketchup and mustard),
pretzels (blue and yellow, a display case), ice cream (cream cart, red and white), coffee (green, an urn), tacos
(green and red). The cart is solid: a cabinet, two wheels, the body, a counter 1 m up, lids, the pole and an
eight-panel striped umbrella 2.2 m up, 1.2 m out [estimates, a New York cart]; it stands off the walking line (people
use the first 1.9 m from the kerb). The vendor is a person of the traffic (`Mover.vendor`, there when People is on,
solid, standing still behind the cart in a white cap); the sign ("HOT DOGS" ...) is drawn only, on the cart's front
(`apps/fly/src/render/buildings.ts`, the building signs' atlas). New materials: `cart`, `awning-red/yellow/blue/green`.

**Evidence (2026-10-20):** `pnpm test` 63 files, 557 tests pass; `pnpm typecheck` clean. Network over 10 min (now
measured with each vehicle's real footprint, trailers included): 36 toy cars, 31 saloons, 19 SUVs, 12 vans, 28
pickups, 8 semis; overlaps 0, red runs 0, people crossing within 1 m of any vehicle 0, vehicle boxes touching the level
or a kerb 0 (sampled every 5 s), mean speed 1.81 m/s (was 1.81), longest stand-still 74.9 s. New tests: a semi's
trailer is solid at its floor (moving with it), open at the back when its doors are (a sweep flies in over the
pallets), shut ones stop it at the doors, and there is room under it; vendors stand clear of the level behind their
carts with room in front, carts off the walking line. Re-pinned: traffic self-test `9fba44b4…` (now hashes the
trailers too), map v15 `bb94691a…` (434 582 triangles). Looked at in the browser (local dev server, screenshots
taken in this session, not kept): the open 53 ft van from behind (doors latched back, lock bars, wooden floor), the
pink day cab at a junction, a pickup with lumber and its flag, an SUV, the hot dog cart on a sidewalk, the ice cream
cart in the park.

**For the owner to try:** spawn "City street" and look at the mix; fly into an open trailer and under one; ride a
flatbed's lumber; land on a pickup's load; find the carts (park: by the fountain). Ask: mix and sizes right (semis
10 %, too many pickups)? Trailers following the lane OK, or should they cut corners like real ones (would need wider
corners)? Semis accelerate like cars: slower? More vendors, people stopping to buy?

**Frame cost (measured 2026-10-20).** Chrome, this PC, the browser pane at 1024 x 768, camera at street level at
(0, 1.8, -138) looking north up the x = 0 avenue, sim paused; the scene rendered in a loop, each frame waiting for the
GPU (`onSubmittedWorkDone`; in low spec a 1-pixel `readPixels`), the median of 150 frames, six rounds with the vehicle
meshes shown and hidden in turn (people and signals always shown). Same 134 vehicles in both builds.

| Build | Vehicle meshes (casting shadows) | Full: with / without vehicles | Low spec: with / without |
|---|---|---|---|
| before (70b50bf, toy cars only) | 13 (5) | 4.0 / 3.6 ms: +0.4 | 0.6 / 0.6 ms: under 0.1 |
| traffic v9 as first built (72a4c2a) | 60 (34) | 4.5 / 3.6-3.8 ms: +0.7 to +0.9 (shorter runs) | 0.9-1.0 / 0.6 ms: +0.35 |
| after the cut below | 38 (14) | 4.2-4.5 / 3.6-4.0 ms: +0.55 | 0.8-0.9 / 0.55-0.6 ms: +0.3 |

The cut (`apps/fly/src/render/traffic.ts`, nothing drawn or solid changed): everything vehicles carry (pallets,
lumber, hay, boxes, the sofa, the fridge, steel, the flag) is one instanced box mesh coloured per box, so pickups and
trailers with different loads share their meshes; a semi's tractor and trailer have meshes of their own, so tractors
are shared across trailer kinds; the fixed-colour parts (insides, trim, windows) cast no shadow, as the toy car's
inside never did. The vehicles still cost about 0.15 ms more than the toy cars in full quality and 0.3 ms more in
low spec on this PC (2 % of a 60 fps frame); a weak laptop pays more per draw. Not measured on a weak laptop.

**Left open:** the vehicles' cost on a weak laptop (each vehicle kind still draws its own body, glass and inside);
trailers don't off-track; no semis in the loops model; vendors serve nobody (walkers pass by).

**Cart fixes and more carts (owner, 2026-10-20, map v16).** The owner found a cart clipping into a building ("sidewalk
spacing is not the same across the whole city"). Cause: the placement took every face of a building, also the inner
faces that look onto the gap between two buildings of one block, not a street; such a face seemed 30 m back from the
kerb, so a cart went on the kerb strip in front of the *other* building, inside it (found again by the new test:
hot dogs at 171.4, -210 inside Kingsley Library). The vendor test missed it: a sphere wholly inside a wall touches no
surface. Fixed: only faces onto a street, and every spot is checked against every building's footprint (the cart's
counter, the vendor behind it, the umbrella). Asked for and added: carts in the tree plazas (up to two each, on the
edge 2.45 m in from the kerb like the sidewalk carts, facing the street, the umbrella 4.5 m or more from a planter's
tree; 8 in the 4 plazas), and three in the station garden (hot dogs, coffee, pretzels) on a paved strip made by
pulling its two south lawns back 3.3 m from the cross path (the way people walk to the stair), facing the path, between
the benches. 24 carts now. Test: no cart, vendor or umbrella over a building footprint (it fails with the old
placement), nothing in a ring just outside each umbrella's rim (trees, walls), three carts in the garden. Map v16
`27e377ab…` (436 110 triangles), traffic self-test `d31e59ea…`; `pnpm test` 63 files, 557 tests pass. Looked at in the
browser: the garden's three stalls, a hot dog cart on a plaza's edge.

## 1v. Contact queries against traffic: one scan a tick (2026-10-20)

CI failed on the food-carts and Duga pushes: `train.test.ts` "is the same flight beside the train twice" timed out at
120 s (52 s on this PC; the whole file was already 114 s on CI before the carts). Profiled (node inspector, 20 s of sim
with the quad armed on the park pad): 64 % of the time in `TrafficWorld.moversNear`, which tested every car, person
and vendor against each of the craft's ~20 contact and sweep asks a tick, so every mover added (trailers, vendors)
made an armed quad dearer to simulate. Now the first ask of a tick scans every mover against a box 8 m bigger and the
tick's later asks inside it test only those, in index order, so the same movers are found and nothing simulated changes
(every pinned hash and replay test passes unchanged). 20 s armed: 4.9 s -> 1.2 s; the test 52 s -> 13 s, the file 23 s.
