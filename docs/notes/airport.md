# Airport and the hospital air ambulance

Archived work notes for the airport. `HANDOFF.md` has the current state. Owner answers: `docs/decisions.md` (2026-10-20).

## 2d. The airport, its planes, the air ambulance (owner, 2026-10-20): map v21, air v1, built, waiting for the owner

**Asked:** an airport between the city and the forest/train station: a runway, a tower with controllers working and open
windows to fly through, ten planes of different sizes that land, park in a hangar, pull out and take off again; a
helipad on a city building marked as the hospital, a helicopter that lands there, drops people on the roof and flies
back to the airport.

**Owner's answers:** a regional airport with a 1.4 km runway (largest plane an ATR 72); landings eastbound over the park;
tugs tow the planes in and out (as real airports do). The railway east of the city is still ~2.3 m up on its viaduct
where a runway would cross it, so (second answer) the whole airport lies just east of the railway; the trains are unchanged.

**The still part (`packages/maps/src/airport.ts`, map v21).**
- Runway 09/27 from x 660 to 2060 along z 40, 30 m wide (ICAO code 3C), its threshold displaced to x 760 (arrows before
  it) so arrivals cross the railway with room over a train. Markings: edge stripes, threshold bar and eight stripes,
  "09" / "27" numerals 9 m tall, aiming points 300 m in (45 x 6 m, 18 m apart: ICAO Annex 14 Table 5-1 as quoted in
  ICAO APAC WP22, 2025), centre-line dashes 30 m with 20 m gaps [estimate].
- Taxiway A 60 m south of the runway (15 m wide), five exits and the west entry (all turns on 25 m), a holding position
  marking 40 m from the centre line; yellow paint 1 cm over the white where they cross (no z-fight).
- Apron (concrete) with three hangars on its south edge, open along their whole fronts, numbered 1-3 on the header,
  girders inside to fly under: 1 for the five small planes, 2 for the Twin Otter, King Air and PC-12, 3 for the ATR 72 and
  Phenom (bays sized span + 3-6 m). Each hangar's tug waits in the gap east of it.
- The tower at (722, 222): a hollow 5 m shaft with a door at its foot (east), open up into the cab; a 9 m cab 22 m up with
  three open windows 2.5 m high on each side between slim posts, consoles along the north and east windows, four chairs,
  a mast and beacon on the roof. The terminal (two storeys, glass), a road south to the forest track, a car park, the
  air ambulance's pad on the apron, a windsock (pointing west: the fixed east wind).
- The hospital: the city building that was the Cobalt Hotel (6 storeys, 54 m roof) is "City General Hospital"; a 20 m
  pad deck 0.3 m up on its roof with a red H on a white cross, and a stair house with a door the medics go in by.
- Border trees under the last 400 m of the approach are grown nowhere (their draws kept: the rest of the map is as before);
  the grass runs on to x 2600. Spawns "Airport (apron)" and "Hospital roof". 544 196 triangles (map v20: 543 666).

**The moving part (`packages/traffic/src/air*.ts`, AIR_VERSION 1).** Placed from the sim tick alone (replays): every
mover's day is built once as legs (`air-path.ts`: straights and arcs with a height polynomial, constant acceleration,
eased pitch, bank, power and gear; dmath only), repeating every AIR_DAY = 3000 s (50 min).
- Ten types (`air-shapes.ts`, sources on each): Piper J-3 Cub (taildragger), Cessna 172, Cirrus SR22, Beechcraft Baron 58,
  Cessna 208 Caravan, Pilatus PC-12, Beechcraft King Air 350, DHC-6 Twin Otter, Embraer Phenom 300, ATR 72-600. Lengths,
  spans, heights and stall speeds, climb rates, take-off and landing distances from their Wikipedia specifications (read
  2026-10-20) and AOPA's G58 sheet; approach speed 1.3 x stall in landing setting unless a reference speed was found
  (King Air 107 kn, Phenom 108 kn, ATR 113 kn); ground rolls about half the 15 m distances where only those were found.
  Shapes are capsules (fuselage, nacelles) and boxes (wings with dihedral, fin, tailplane, gear), solid as drawn; props
  and rotors are drawn only.
- A plane's day: appears 4.26 km out on the 3 deg glide path, flares from 2-6 m, touches down, lowers its nose, brakes in
  its landing roll, takes the first exit past its bay, taxis west on A, turns into the apron and makes an 18 m U-turn to
  stop facing north in front of its bay; engines off; its hangar's tug comes to the nose and pushes it in tail first
  (1.5 m/s); its stay (5-7 min); the tug pulls it out; engines start; it taxis to the hold, lines up, rolls (constant
  acceleration to lift-off in its take-off roll; a taildragger raises its tail first), rotates, climbs out east (gear up
  for those that fold it) and is hidden 6 km out at 450 m.
- The runway takes one user at a time, 10 s apart (`Booking`): arrivals fixed by SCHEDULE (from 1.2 km out until off the
  runway); a departure stays in its hangar until the tug and, by the time it reaches the hold, the runway are free (waits
  at the hold under 20 s; no queue there). Each tug does one job at a time (also booked).
- The EC135 air ambulance (Wikipedia: mainly flown for air medical transport) twice a day: rotors up on its pad, waits for
  the runway, lifts, turns, transitions and climbs to 70 m, cruises at 30 m/s, a decelerating approach to a 6 m hover over
  the hospital pad, settles; two medics wheel the patient on a stretcher from its right door to the stair house and go in
  (out of sight); it lifts, waits so its crossing back is clear, lands on the airport pad, rotors down. The medics stay in.
- Four controllers sit at the tower's consoles (solid, still).
- Collision: `air-world.ts`, a ContactWorld over the rest, like TrainWorld but with each mover's full frame (pitch and
  bank); surface velocities from where the touched point is one tick later; hidden movers and folded gear are not there.
  `TrafficConfig.air`, `worldSha256` adds `|air/1` only when on (older flights keep their hashes). Settings > World:
  "Airport traffic" (on by default, at every graphics level: some twenty movers).
- Drawing: `apps/fly/src/render/air.ts`, each mover from its own collision parts in its livery, a window line, props as
  blades that blur into a disc with power, the helicopter's rotor blades, nav lights and a flashing beacon; medics and
  controllers as beans.

**Evidence.** `pnpm test`: 67 files, 599 tests (new: `packages/traffic/test/air.test.ts` builds the day; samples it every
0.5 s and finds no two movers' footprints overlapping (the medics with each other and the helicopter, the controllers
left out); every plane, tug and the helicopter clear of the level's geometry at every second below 200 m (gear and skids
left out); same places when built again; a point by a taxiing ATR is pushed out and gets its velocity. `first-map.test.ts`:
a 0.25 m sphere passes through each side's middle window of the cab, in at the shaft's door and up the shaft into the cab;
every hangar bay open and deep enough; the hospital named, its pad on the roof). Map re-pinned `2c689a96…`; flight and
traffic self-test hashes unchanged. Headless Chrome (WebGPU, dev server, `docs/evidence/2026-10-20-airport/probe.mjs`):
the ATR over the park, touching down, being pushed in, the tower cab, the medics on the hospital roof, a take-off, an
overview; 120 fps there (capped), no console errors.

**Left open:** (sound added: `docs/notes/sound.md` §2e) props and rotors are not solid (a quad flies through them);
planes don't react to the quad; arrivals appear out of nowhere 4.26 km west (past the fog, but a quad flying out there
sees them); hangar doors are always open; no runway or apron lights; the medics never come back out; waits for a tug can
be several minutes on the apron; frame cost not measured on a weak machine; the airport has no golden props.

## 2h. The small planes' city tours (owner, 2026-10-22): air v2, built, waiting for the owner

**Asked:** "Make the smaller planes fly around the city so the players can chase and fly around them." Owner's answers:
the Cub, the 172 and the SR22; a sightseeing loop over the city and park after take-off, then back to land (in place of
leaving east); low, about 100-150 m (real rules want about 300 m over the tallest building; lower is better for chasing).

**Built (`packages/traffic/src/air.ts` `TOURS`, `tour()`, `bankTurn()`, `flyTo()`; `air-path.ts` `dubins()`).** The three
never leave now: each plane's day is exactly AIR_DAY and has no hidden part.
- After lift-off it climbs straight ahead to 100 m [estimate], then takes the shortest way (a Dubins path: turn, straight,
  turn) round to the west end of its racetrack's north straight, climbing to its tour height.
- Racetracks flown with left turns: the north straight westbound along z -420 (Cub), -300 (172), -180 (SR22), each over its
  own band of the city (z -81 to -499); the south straight 2 r further south; the west turn about x -300. Heights 110,
  130, 150 m (20 m apart, as a tower would give each its own altitude; the helicopter cruises at 70-84 m).
- Speeds [estimates: sightseeing at reduced power, below the cruise speeds Wikipedia gives, read 2026-10-22: J-3 65 kn,
  172R 122 kn, SR22 G5 183 kn]: Cub 65 kn (33 m/s), 172 90 kn (46 m/s), SR22 110 kn (57 m/s). Turns at 30 deg bank
  [estimate], so r = v^2 / (g tan 30): 197, 378, 565 m. Roll in and out over 3 s (10 deg/s) on the turn's own arc.
- The laps fill the time to its next arrival exactly: n laps with their straights stretched (about 600 m: 25 laps for
  the Cub's half hour), so a lap's place is fixed by the tick (replays).
- It leaves the last lap at the north straight's west end and flies level at its tour height to where the 3 deg glide
  path is at that height (1.8 / 2.2 / 2.6 km before the threshold), slowing to its approach speed, and lands as before
  (the runway booked from 1.2 km out, as every arrival). The other seven still appear 4.26 km out and leave east.
- AIR_VERSION 2 (the world hash's `|air/2`): flights saved with airport traffic before this no longer open.

**Evidence** (`docs/evidence/2026-10-22-city-tours/`, `probe.mjs`: headless Chrome, WebGPU, dev server): `0-plan.svg` (the
three tracks over the day on a plan), `1-cub-chase.png`, `1-c172-chase.png`, `1-sr22-chase.png` (each from 45 m behind,
over the city), `2-cub-from-street.png` (the Cub over the x 0 road); 106 fps, no console errors. `pnpm test` 75 files,
660 pass + 1 expected fail; new in `air.test.ts`: the three's days are exactly AIR_DAY, every leg starts where the last
ended (the last where the first starts), never hidden, over the city at their tour height for over 300 s of the day
(Cub 1008 s, 172 494 s, SR22 385 s). The day's no-clash test and the clear-of-buildings test pass with the tours.
`air-sound.test.ts`'s silent-when-away check uses the King Air now (the Cub is never away). Self-test hashes unchanged
(the airport is off in them).

**Left open:** the planes still ignore the quad (no avoiding, no wake); the tour paths are the same every day.

## 2l. Solid propellers and rotors (owner, 2026-10-24: Next up "solid propellers and rotors"): air v3, built

- *What is solid (`air-shapes.ts` Prop, `air-world.ts`):* while a mover's engine turns (power above 0) each prop or rotor
  is a solid disc, its radius and as thick as its blade's chord (the drawing's: 12 % of the radius, 6 % for a main rotor,
  at least 8 cm), moving with the mover; stopped, each blade is a box (radius long, 3 cm thick, chord wide) at the angle
  the prop always stops at (`propRest`: no blade straight down; a 2-blade prop level, 4 in an X, odd counts one blade
  up). The drawing turns a prop on to the next rest angle and stops it there once its power is under 0.1, so the blades
  drawn stopped are the blades the quad hits. A hit bounces as off a wall moving with the plane: the blade's own speed
  (a tip at ~250 m/s) is not in it, and nothing breaks (damage is off). The helicopter's main rotor (10.2 m) and its
  Fenestron count the same way.
- *Found on the way:* the King Air's 2.68 m props reached 8 cm into the runway, the Baron's cleared it by 7 cm: wing
  engines now sit at least 7 in (0.178 m) clear, the rule for a nose-wheel plane level on its gear (14 CFR 25.925(a),
  read 2026-10-24). Not changed (their whole fuselage would move): the SR22's prop clears by 0.160 m, the Cub's by 0.025 m
  level (a tail-wheel plane needs 9 in in its level take-off attitude; on its tail wheel it sits nose up).
- *Tests (`air.test.ts`):* every prop has its rest blades, a parked prop's blade tips are over 0.1 m off the ground, every
  prop clears the ground level, wing props by 7 in; for each plane, a point 0.7 out on a stopped blade is pushed out and
  one between two blades is not, and the same point between the blades is pushed out while the engine runs (over 5 planes
  each); props and rotors (a turning one's rim, a stopped one's blade tips) clear of buildings, trees and ground all day.
  627 pass; typecheck clean. AIR_VERSION 3: flights saved with airport traffic before this no longer open.
- *Left open:* a hit doesn't throw the quad as a real blade strike would (owner to say); props not tried in a browser.
