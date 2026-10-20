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
