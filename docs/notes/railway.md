# The railway: track, tunnel, station and the steam train

Sections §0y, §0z, §1a. Read only when working on the railway or the train; `HANDOFF.md` has the current state.

## 0y. Railway, tunnel and steam train (owner, 2026-10-19): built, then reworked in §0z (route, coaches, smoke)

**Asked:** "Add a tunnel and a train that travels through a railyard, stops, then continues. Train should slowly accel
and deccel like a real train, should be steam engine and put out simple clouds as smoke. Try to make it not take too
many resources, but I do want it to be cool. Make this a different toggle to remove the train in the settings, and
groups all graphics settings in the settings page properly."

**Layout (map v7, `packages/maps/src/railway.ts`; decided by Claude, not yet put to the owner):** one loop of
standard-gauge track in the empty land south of the park, a rectangle x -255..235, z 245..475 with 110 m curves
(1251 m round). Clockwise from above: north up the west side (through the industrial yard, whose fence has gaps
there), east along the north straight through the tunnel, south, then west along the south straight through the
station.
- Track: ballast (3 m top, 4.8 m base, 0.3 m high), two 7 cm rails at standard gauge (top 0.45 m), British standard
  sleepers (8 ft 6 in x 10 in, 2.59 x 0.254 m) every 0.7 m. Sleepers are paint (`LevelBuilder.paintQuad`, not
  solid); rails and ballast are solid. New materials: ballast, rail, sleeper, stone, wagon.
- Tunnel: a 92 m straight bore (x -56..36, z 245) under a new 22 m hill (a cosine dome over a 160 x 80 m ellipse, a
  5 m grass height field). 5 m wide, walls to 4 m, a round arch to 6.5 m (12 segments), stone lined; a 1 m stone
  headwall with a parapet at each portal; a 7 m cutting between stone retaining walls beyond each portal.
- Station: a 0.9 m platform (x -62..42), its edge 1.5 m from the track; a canopy at 3.6 m on columns; a brick
  building; a water tower for the engines; semaphore signals at x 70 and -100, on the driver's left.
- Goods yard (north of the station): a ladder of points at 1 in 8 from x 118, three sidings 4.5 m apart with buffer
  stops at x -118, ten still wagons (vans, open wagons with coal, tank wagons), and an engine shed over the third
  siding (brick, windows, open at both ends, a roof vent you can fly through).
- Moved for it: hay bales and yard fence posts within 4 m of the line are left out (their RNG draws unchanged, so the
  rest of the map is as before). New spawns: "Railway station" (on the platform), "Railway tunnel" (before the west
  portal). Golden props 52-55 (area "Railway"): in the tunnel under the arch, under the canopy, in the engine shed,
  on the station's water tower; numbered after all the others, so saved collections keep their numbers.
- 235 694 triangles (map v6: 228 994), hash `a4e18ec2…`.

**The train (`packages/traffic/src/train.ts`, TRAIN_VERSION 1):** modelled on the LMS Ivatt Class 2 2-6-0 (Wikipedia,
"LMS Ivatt Class 2 2-6-0", read 2026-10-19): tractive effort 77.44 kN, engine 47.9 t, tender 37.7 t, 16.20 m over
engine and tender, coupled wheels 1.524 m. Three coaches like BR Mark 1s (19.66 m, 2.82 m wide, 3.86 m high, 33 t:
estimates). 75.2 m and 184.6 t in all.
- The run is worked out once when the train is built, in 1 ms steps: the driver opens the regulator over 6 s to 60 %
  of the tractive effort [estimate]; then the pull is limited by 450 kW at the rail [estimate]; resistance
  4000 + 100 v + 12 v^2 N [estimate]; top speed 12.5 m/s (45 km/h, about the most a 110 m curve takes [estimate]).
  The brake is 0.35 m/s^2 [estimate: about half the 0.5-0.8 m/s^2 of the full vacuum-brake stops from 45 mph in the
  1876 trials, Wikipedia "Railway brake", the Abbots Ripton table], put on and off at 0.25 m/s^3, timed so the front
  stops on the mark (x -57). It stands 40 s [estimate] and goes again: one lap is 155 s running plus 40 s standing.
- Kept every 10 ms and interpolated (cubic Hermite from distance and speed). A place is a function of the tick alone
  (replays). Each vehicle sits on two pivots on the track (bogie centres), so it swings out on the curves as real
  coaches do.
- Solid (`train-world.ts`, `TrainWorld`, a ContactWorld wrapper like TrafficWorld): the engine is four boxes (frames,
  boiler, cab, chimney), the tender and each coach one, from 0.55 m up to 3.2-3.95 m. Moving surfaces as for cars.
- Collision hash: `worldSha256` adds `|train/1` only when the train runs, so every older hash is unchanged.
  `TrafficConfig.train` is optional (absent: no train); a saved flight's config is found among 16 combinations.

**Drawing (`apps/fly/src/render/train.ts`):** each vehicle one merged mesh coloured per vertex (a black engine with a
red buffer beam and a brass chimney rim, maroon coaches, grey roofs), instanced wheels (the coupled ones with red
spokes and counterweights) and coupling rods that turn with the distance run, the two sides a quarter turn apart.
Smoke: one instanced icosahedron per puff. A puff may leave the chimney every 0.1 s, if the engine exhausted since the
slot before (four beats per turn of the coupled wheels, as on a two-cylinder engine), or every 0.5 s as a wisp while
it stands. It rises with the blast and slows, keeps the train's speed for under a second, drifts on a made-up breeze,
swells to about four times its size and shrinks away over 7 s (4 s in super low spec). In the tunnel it stays under
the arch. All from the tick, so a replay's smoke is the same smoke. First try was too big and dark (one grey wall);
the puffs are now smaller and lighter.

**Cost (Chromium, WebGPU, this machine):** 9 draws and about 10 000 triangles for the whole train and its smoke;
`TrainView.update` 0.013 ms of CPU a frame (the cars and people: 0.47 ms). So the train runs at every graphics level,
super low spec included, unless its own switch is off.

**Settings:** the graphics settings are one group now (level, resolution, sun shadows, one reload notice), and a
second group "Traffic and train" holds cars, people, traffic lights and the new "Steam train" switch (on by default;
a change restarts at the spawn point, as the traffic does). The menu's settings summary has a Train line.

**Evidence:** `pnpm test` 58 files, 496 tests pass; `pnpm typecheck` clean. New tests in `apps/fly/test/train.test.ts`:
the run (pull at most 0.230 m/s^2, top 12.50 m/s after 61.5 s, brake at most 0.361 m/s^2, jerk at most 0.367 m/s^3,
stops 0.000 mm from the mark, stands 40 s); vehicle ends 0.43-0.51 m apart all round the loop; the hash rule; a
hovering quad shoved to 13.17 m/s with -0.00 mm least clearance; a quad on a coach roof carried through the tunnel at
12.50 m/s, 0.125 mm drift in 1.5 s; the same run hash twice. In `first-map.test.ts`: spheres on the train's outline
every metre round the loop touch nothing; the bore is open with its crown at 6.5 m; the platform's height and edge.
The traffic self-test hashes the train too: `?selftest` MATCH in the built-in browser (Chromium, WebGPU), traffic
`d8e138b3…`. Seen there (screenshots in the session, not saved): the station and yard, the engine shed, the train
pulling out with smoke, the tunnel portal and the train inside it, an aerial of the loop, super low spec.

**For the owner:** fly the railway: chase the train, ride a coach roof through the tunnel, fly the tunnel when the
train comes (2 m over its chimney), fly through the engine shed's vent. Ask: do the pull-away (60 s to 45 km/h) and
the stop (about 36 s) feel like a real train? The smoke's size, colour and how long it lasts? 40 s at the station?
Faster, longer, or a goods train sometimes?

**Left open:** the hill reads flat from straight above (one grass colour); look-around mode does not run the sim, so
the train stands still there (as the traffic does); no sound (no audio yet); the yard's wagons never move; a puff
that leaves just before a portal can pass through the hill; the train does not react to the quad.

## 0z. The railway round the whole map, a city station, open coaches, billowing smoke (owner, 2026-10-19): map v8, train v2

**Asked:** "Make the train travel around the entire map, and make it slightly less close to the ground so you could
fly a quad under it. It should pass through all the areas and even through the city, with another station inside the
city. Also make open windows and add people inside, so the player can try to fly into or through the train while its
moving. The smoke is a little rough, it should expand more into bigger clouds instead of a stream of one size."

Most of §0y still holds (track, tunnel shape, the engine, the physics constants); this section is what changed.

**Route (map v8, `railway.ts`; decided by Claude, not yet put to the owner):** six right-angle corners, all 100 m
curves, 3632 m round, clockwise: north from the south-east fields through the tunnel (now under a hill south of the
park, the bore along z at x 20, z 226-298); a curve west across the park's south end (crossing its two paths); west at
ground level along z 100 between the bando (78 m north) and the industrial yard (40 m south); round the map's west
edge (x -610, outside the border trees); east across the whole city along the z = -250 street; south outside the east
edge (x 610); and west along z 475 through the fields station and goods yard (moved 260 m east, same layout).
- The city: a viaduct deck 5.2 m wide, top 8.3 m, underside 7.1 m over the street's centre line, so it clears the
  traffic lights' poles and mast arms (6.0 m, traffic network.ts) and the street lamps (7 m). Piers (1.6 x 1.0 m with a
  cap under the deck) every 20 m; in the city only 18-62 m past a junction, so the junctions under it are open, and
  cars run 1.55 m or more from the centre line, clear of the piers. Traffic is unchanged: no level crossings anywhere.
- The climb to it and down from it: 574 m each way at 1 in 72 (8 m), round the west and east edges, eased over 80 m at
  each end (`bedAt`, a railway vertical curve). The deck is level from 40 m before the city edge.
- City station: on the viaduct, x 2-102, a platform each side (edges 1.5 m from the track, tops 0.45 m over the rails,
  as at the fields station), canopies 3.1 m over them from x 20 to 85, a waiting shelter each side. The train stops
  with its front at x 97. New spawn "City station (on the viaduct)"; moved: "Fields station" (x 292, z 480), "Railway
  tunnel" (x 30, z 335, facing the south portal). Golden props 52-55 moved with their places; 56 is new (under the
  city canopy).
- Trees the line or the hill would stand in are left out after their random draws (`tree()`), so the rest are as
  before. 243 542 triangles, hash `bc8162fa…`. `Level.railway` now carries the height profile, both stops, and a
  tunnel on either axis.

**Train (TRAIN_VERSION 2):**
- The runs between the stations, each worked out once in 1 ms steps: 220 s to the city, 176 s back, 35 s [estimate] at
  each: 7.8 min a lap. Top 72 km/h (20 m/s [estimate]) on the straights, though the engine's power holds it to about
  16 m/s; 45 km/h round every curve (it aims 0.4 m/s under and slows at 0.22 m/s^2 in time). The grade pulls on the
  train: it holds 12.5 m/s up the climb at full power and brakes to hold its speed coming down. The regulator opens
  and closes at no more than 0.3 m/s^3 [estimate].
- Each vehicle tilts with the grade: its frame runs from its back pivot to its front one (`TrainPlace`, along and up),
  in the collision and the drawing alike.
- Coaches are hollow: floor 1.35-1.5 m over the base (0.9 m between the rails' top and the floor, so a quad flies under
  a coach between its bogies), seven open windows a side (1.6 x 1.2 m, sill 2.25, head 3.45), a doorway at each end
  (0.9 x 2.0 m), bays of facing seats either side of a 0.6 m aisle, and people sitting in about 4 seats in 10 (a hash
  of coach and seat, the same every run). About 110 solid boxes a coach; bodies 4.0 m high.
- Collision cost inside a coach: 2.15 us per sphere query against 0.97 us for the map alone (a cheap per-box reject
  and a cached frame transform halved it from 4.5 us). Away from the train it costs nothing.

**Drawing:** each coach is drawn from its own collision boxes (maroon walls, wooden floor, blue seats, people as
candy-coloured beans with eyes facing along the coach), so what you see is what you hit. Smoke: each puff is now a
cluster of three blobs that spread apart as it grows, from a chimney's width to several metres over 10 s, each puff a
little different in size, lighter as it thins. Train and smoke: 9 draws, about 60 000 triangles (most of it the
people), `TrainView.update` 0.042 ms a frame.

**Evidence:** `pnpm test` 58 files, 497 tests pass; `pnpm typecheck` clean. `train.test.ts`: runs 220 + 176 s, top
15.84 m/s, curves at most 12.55 m/s, pull at most 0.298 m/s^2, brake 0.366, jerk 0.550 m/s^3, up to 8.30 m, both
stops 0.000 mm off the mark; couplings 0.43-0.52 m round the loop; with the train standing, a 0.25 m sphere fits under
all 3 coaches (0.9 m up, right across), through all 21 windows (across the coach between the facing seats, 3.0 m up)
and down the aisles through the end doors from one coach to the next, while the wall beside a window is solid; a
hovering quad shoved to 14.42 m/s by the train at 13.73 m/s, -0.00 mm least clearance; a quad on a coach roof carried
through the tunnel at 12.47 m/s, 0.296 mm drift. `first-map.test.ts`: the train's outline clear every metre round the
loop at the profile's height; the deck at 8.3 m over the whole city with only mid-block piers under it and every
junction open to 7 m; the tunnel; both platforms. `?selftest` MATCH in the built-in browser, traffic and train
`226587db…`. Seen there: the viaduct over the street with cars under it, the train at the city station, its open
windows with people in the seats, the gap under a coach, the billowing smoke leaving the fields station, the climb
round the west edge.

**For the owner:** fly under a coach, in one window and out the other, down the aisle through the end doors, and under
the viaduct between the piers. Ask: is the train too rare now (a given spot every 7.8 min)? A second train, shorter
stops, faster running? Is 1 in 72 and the viaduct's height right? The smoke's size and colour?

**Left open:** the hill reads flat from above; no stairs up to the city platforms; the yard's wagons never move; a
puff leaving just before a portal can pass through the hill; the train does not react to the quad; look-around does
not run the sim, so the train stands still there.

## 1a. The walkway to the city station, people taking the train, a second train (owner, 2026-10-19): map v9, traffic v7, train v3

**Asked:** "we need a walkway down to that empty lot near the city station, add some nice trees and a path to the normal
sidewalks and then we need some of the walking NPCs to go up to board and come down to leave the train when it stops at
the city station. Leave everyone on the train at the other station, the boarding and unboarding will just happen at the
city station. Also add a second train on the same loop."

**Map v9 (decided by Claude):**
- The lot is block 31 (x 9-71, z -241 to -179), just south of the city station. Its old draws (plaza or parking) still
  happen, into a builder that is thrown away, so the rest of the city is as before.
- The footbridge from the south platform's back (z -245) over the kerb and the sidewalk to z -235, 9.45 m up, 2.4 m
  wide with railings. Then an open stair of two flights (27 risers each, 17.2 cm rise, 30 cm going [estimates]) with a
  2 m landing on four columns, stringers and handrails, down to the garden at z -217.4.
- The garden: four lawns 15 cm up behind a kerb, 3 trees on each (own `Rng(9)`), a paved cross path from the west
  sidewalk to the east (z -205), a path from the stair south to the south sidewalk, and 8 benches. The lawns keep
  1.3 m off the kerbs, where people walk.
- The city platforms are raised to 9.45 m (the coaches' floors less 5 cm), so people step straight in.
- `Railway.walkway` carries the block, the cross path, the walk up ([x, y, z] points), the platform's top, the waiting
  line and the line inside the doors. 245 218 triangles, hash `69f4a50d…`.

**Coaches (train v3):** a side door at each end of each side, 0.66 m wide, from the floor to the window heads, up to
the end wall (like a Mark 1's vestibule doors). The first try at 0.8 m caught on the end seat backs by 1 cm.

**The second train:** the same timetable half a lap (233 s) behind the first (`Train.lag`). Their fronts are never
closer than 1559 m. It has a Brunswick-green engine and green coaches, and different people in the seats. There is
one switch for both. Each train is a `TrainWorld` (chained) and a `TrainView`.

**People taking the train (`network.ts`, traffic v7):**
- When the trains run, a walker reaching a corner of the garden block goes up to the station 35 times in 100. They
  walk along the block's side to the cross path, to the stair, up it and over the footbridge (phase 9). Then along the
  waiting line to a spot by their coach door (10). The spots are in three rows and nine places either side of the door.
- They wait (15). Once a train has stood at the city station 3 s (plus up to 5 s of their own), and while it has 12 s
  or more left, they step to their door (16) and in (11).
- On board they are out of sight and not solid (12) for 240 s at least. Then they get off at the city station from
  whichever train stands there (13), walk back to the footbridge (17), and go down to one of the garden's corners (14).
- Ten people start on board, so passengers get off at the first stop.
- Nobody gets on or off at the fields station (there is no walkway there). Out-of-sight people (in buildings or on
  trains) are no longer solid (`world.ts`). The walkers know the timetable from `Train.standing`.

**Evidence:** `pnpm test` 58 files, 500 tests pass; `pnpm typecheck` clean.
- `train.test.ts`: two trains never closer than 1559 m. Over 25 min of the network with the trains: 38 people went
  up, 34 boarded, 25 got off, at most 7 waited at once, and every step on or off happened while a train stood at the
  city station. A 0.25 m sphere fits through every platform-side door of every coach.
- `first-map.test.ts`: a person (0.28 m spheres at 0.6 and 1.5 m) clears the whole walk up, every 10 cm, feet within
  0.2 m of the treads. The cross path is clear from sidewalk to sidewalk.
- `?selftest` MATCH in the built-in browser; the traffic hash now covers the network with the trains (people boarding
  through the first city stop): `68fe64ac…`.
- Seen there: the footbridge, stair, garden, lawns, trees and benches; people on the stair; people on the platform
  beside the green train; the platform level with the coach floor and the side doors.

**For the owner:** watch the platform when a train comes in (the first one at about 3.7 min), follow someone up the
stair. Ask: enough people going by train (35 % at the garden's corners)? Should some ride to the fields station too
(it would need a walkway there)? Is the second train's green right?

**Left open:** people on the platform walk through each other if many pick one door. They do not queue at a door.
Nobody is drawn in the coaches' aisles (boarders vanish inside the door). No stair on the north platform.

