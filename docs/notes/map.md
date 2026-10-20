# First map: look passes, world pass, crane, names, doors

Archived work notes, moved verbatim from HANDOFF.md on 2026-10-18. Read only when working in this area;
`HANDOFF.md` has the current state. Section numbers (§0a ...) are the ones code comments cite.

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
  not crawl (since §0l it re-centres only every 16 m). Measured GPU time at 2560x1319 (WebGPU, owner's machine): street 2.3 ms with / 1.5 ms without, city
  overview 0.6 / 0.7, bando 0.55 / 0.6. `?noshadows` turns them off. Works on the WebGL 2 fallback too.
- Map v2: 41 462 triangles (v1: 44 006), hash `57c76dcc…`. The self-test hash did not change (its flight is in the park).
- **People and cars (asked, not built):** answered the owner with this estimate. Drawn only (they cannot be hit):
  cheap to run (instanced low-poly models, a few hundred of each, well under a millisecond of CPU and GPU per frame),
  a moderate job to build (lanes and sidewalk paths on the city grid, stopping at junctions, CC0 models). Solid
  (a hit bounces the quad): their positions must come from the sim tick only (replays), and sim-core's contact solver
  must handle a moving surface (it assumes the world is still): a sim-core change with a version bump and a flight test.


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


## 0q. Crane, building names, people going into buildings (owner, 2026-10-18): built, waiting for the owner

**Asked:** "Make the crane more realistic, etc. Put names on buildings, have some of the walking NPCs enter/leave buildings."

**Crane (`first-map.ts towerCrane`, map v5).** Modelled on a Liebherr 172 EC-B 8 Litronic flat-top, from Liebherr's FEM
technical data sheet (copy at ueg.qa, read 2026-10-18): 16 EC tower of 1.6 x 1.6 m sections 3.9 m long (12 sections,
slewing unit at 47.45 m), a 50 m jib (a listed length), 13.4 m counter-jib, 7 ballast blocks of 3150 x 1180 x 280 mm
(2.5 t each; 1.04 m^3 x 2.4 t/m^3 checks out) for that jib. Estimates: member sizes (chords 14 cm, bracing 7 cm),
the jib's section (1.6 m wide, 1.8 m deep triangle, 2.5 m Warren panels), the cab, the 4.5 m foundation block's
height. The trolley sits 20 m out with the hook block on two rope falls down to 30 m (above the 24 m steel frame); the
rope is 5 cm thick (real ~16 mm, estimate) so it shows and is solid. New `LevelBuilder.bar` (a square bar between any
two points) and a `crane` material (yellow). It is still: no slewing (a moving crane needs it in the traffic-style
moving-surface world; not built).

**Names and doors (`first-map.ts building`, `builder.ts` `Building`, `Door`).** Each of the 112 city buildings gets a
made-up name (shops on low ones, offices / flats / hotels mid-height, towers in the centre, a few FPV jokes: "Prop
Wash Laundry", "Turtle Mode Tacos"...) and one street entrance: the middle shop-front bay on a street-facing face, its
sill left out so the glass runs to the sidewalk. Names and doors come from their own `Rng(7)`, so the rest of the city
is drawn exactly as before. `Level.buildings` / `Level.doors` are metadata (not in the collision hash).

**Rendering (`render/buildings.ts`, render only).** One texture with every name; a sign over the shop fronts on each
street face (over the door on its face), and towers of 12+ storeys carry their name across the top storey. Signs sit
3 cm off the wall. Each entrance has a dark frame, fixed side glass and two automatic sliding leaves inside the 15 cm
reveal, which slide open (0.6 s) when a walker going through is within 2.2 m. People inside are not drawn
(`render/traffic.ts`).

**Walkers (`network.ts`, TRAFFIC_VERSION 6).** A walker starting along a block side with a door goes in one time in
four: along the sidewalk to the door (phase 5), in through it to 1.5 m past the glass (6), stays 20-120 s out of
sight (7, `hidden()`; still solid there, unreachable behind the glass), comes out (8) and walks on either way. All
from the tick alone, as before. The signals-off loop model has no doors.

**Evidence:** `pnpm test` 49 files, 443 tests (new: crane lattice and doors in `first-map.test.ts`: a 0.25 m sphere
fits through every tower section's face, rays pass down through the jib, the hook block under the trolley; every
building named uniquely with its door on a street face and no sill; `traffic.test.ts` doors: the way out of every door
is clear for a person, and over 5 min 68 people went in and 49 came out, at most 22 of 270 inside, nobody in a doorway
off its middle line). Typecheck and production build clean. Seen in the built-in browser (dev server, WebGPU):
the crane from the street and up close (cab, truss jib), "Ashford Court" sign and doors, a walker going into
"Lindqvist's Deli" with the doors opening and closing behind (screenshots in the session's tool-results, not saved).
Re-pinned: map `e9343a1d…` (226 642 triangles), traffic self-test `59f44e0a…`. Flight self-test hashes unchanged
(the flight is in the park).

**For the owner:** look at the crane and fly through its tower and jib (thin bars are solid: tight gaps), read some
signs, watch a door. Ask: crane slewing wanted? Names OK (want real-sounding only, or more jokes)? How many people
should go in (25 % of block-side walks now)?

**Left open:** `?selftest` not run in Chrome on the Pages build yet (Node hashes re-pinned); the crane does not move;
no interiors (people vanish 1.5 m behind the door); signs are not lit at night (no night); the car park, plaza and
surface-parking blocks have no names or doors.




## 1c. Forest, trees to fly through, the yard filled out (owner, 2026-10-19): map v10, built, waiting for the owner

**Asked:** "The random treelines should probably be spread out and more random, larger multi branch trees so you can fly
through and around them, a forest area where you could fly through dense and sparse areas. Maybe in the 'stumps' area
that is currently near the Fields Station. Also lets flesh out the area with the silos, buildings and shipping crates.
Open some of the crates up to fly through, stack them somewhat more randomly, etc." The "stumps" were read as the hay
bales (short wooden octagons, x 150-400, z 300-450): that field is now the forest, and its clearing has real stumps.

**Trees (`woods.ts`, new; shapes and sizes are estimates of mature European trees).** New builder shapes: `blob` (a
rounded clump, 4n triangles), `triOut`, and `cone` pointing down (hoppers). Three kinds:
- broadleaf, 13-19 m (times its scale): a trunk forking into 4-6 limbs (bars), each ending in one or two leaf clumps, a
  clump on the leader; the inside of the crown is open between the limbs. Open-grown: crown from 3-5 m, reaching about
  10 m out. Forest-grown: crown from about 40 % of its height (shaded lower limbs die off), so you fly under it.
- spruce, 15-23 m: four tiers of needles, from 1.5-3 m up in the open, 4.5-6 m in a thicket.
- pine, 16-22 m: a bare trunk to about 60 % of its height, a few flat clumps on top.
Plus snags (dead standing trees), fallen trees on their root plates, stumps, log piles and bushes. Everything is solid,
leaves too. Only the new areas use them: the park, the garden and the plazas keep the old cone trees (the flight
self-test flies in the park).

**Forest (`woods.ts forest`, `Rng(10)`), x 112-492, z 288-450.** Trees thrown as darts, each kept clear of the ones
before by a spacing that depends on where it lands: 4-7 m in seven thickets (radius 34-62 m; mostly spruce, some pines
and tall thin broadleaves), 11-14 m in the open woodland between (big broadleaves, pines), wider at the edges. 260
bushes in the undergrowth. A 4 m dirt track (painted, `FOREST_TRACK`) winds from the fields past the water tower through
a 24 m clearing (one big open-grown oak, 18 stumps, two log piles) out to the east. A fallen tree lies across the track
at x 404 on its root plate and a stump, about 1.1 m clear under it. In the first thicket, a 7 m gap where a tree fell.
Spawn "Forest track" (196, 318). Measured cover 6 m up per 30 m square (test): quartile 1.6 %, median 2.8 %, thickest
21 %; 12 m up the thickest is 36 %.

**Tree line and border (`treeLine`, `borderBelt`).** The south-east tree line (was a tree every 9 m on z 220) now wanders
up to 8 m either side, 5-16 m apart, with gaps, mostly broadleaves. The border ring (was every 14 m) is a belt 0-14 m
outside the square, 8-20 m apart, a second tree behind one in three; mostly spruces, the cheapest to draw.

**Yard (`yard.ts`, new; `industrial()` moved there, still `Rng(4)`).**
- Containers at ISO 668 sizes (40 ft 12.192 m, 20 ft 6.058 m, 2.438 x 2.591 m), 5 colours (new `container-d` green,
  `container-e` white). A stack field of 8 blocks of 2-3 rows (0.4 m apart, lanes 3-10 m between blocks), 6-8 slots,
  stacks 0-4 high, each box set down up to 0.4 m off the one below, the top one sometimes up to 3 m off; one slot in four
  holds two 20 ft boxes. A box with no neighbour at its ends may be a **tube** (both ends cut off) or have its **doors**
  swung open; one with free sides may be **cut** (two 3.6 m holes through both sides). Now and then a box lies across
  the top of a block (over an empty middle row it makes an arch); half of those are tubes. The lane of the old prop
  "Down the alley between the container rows" stays (z 261.3-271). On the apron to the south, 14 lone stacks set down
  any which way, many opened; a white tube on a blue box at (-425, 352) holds a prop.
- Grain plant: the three silos as before, a 30 m headhouse frame (machinery room to 35 m), a catwalk over the silo tops
  (deck 24.2-24.3 m), a 74 m open-truss conveyor gallery up from an intake shed at 17.9 degrees (a quad fits along inside
  it), three trestles, four hopper bins on legs (rims at 8 m, braced at 4.4 m: fly under them), two spouts.
- Pallet racking in the big warehouse (three back-to-back rows, beams at 1.6-6.4 m, pallets on 6 in 10 places), two
  semi-trailers at its doors (1 m clear underneath), a three-cabin site office with a stair, an open shed with pallets
  and a workshop container, a roofless old brick workshop (windows, doorways, fallen bays, three roof beams), pallets.

**Golden props:** 7 new ones, 57-63, after all the others (so none renumbers): in the apron tube, inside the gallery,
under the hopper bins, under a trailer (Industrial yard); under the fallen tree on the track, in the big oak's crown
(`inCrown`: the heading furthest from every limb), in the thicket's gap (Forest, a new area name).

**Evidence:** `pnpm test` 58 files, 505 tests (new: down-pointing cones and blobs wind outwards; the forest's cover
spread and the clearing open to the sky; a quad fits through the apron tube, along the gallery and under each bin; all
63 props clear and reachable from the sky). Map v10 hash `7396a013...`, **421 868 triangles (v9: 245 218)**: forest
100 k, border 55 k, yard 29 k, tree line 8 k. Flight and traffic self-test hashes unchanged. Production build clean.
Seen in the built-in browser (WebGPU): the forest from above (thickets darker, the track, the clearing) and from the
track at 3 m, the stack field's alley, the apron tube with its prop inside, the gallery and the headhouse.

**Left open:** frame time not measured (the built-in browser pane ran 12-36 fps everywhere, the unchanged city view
too, so it says nothing); low spec modes draw every tree (no tree LOD or billboards); leaves are solid (a real quad
pushes through twigs); the forest floor is plain grass; the yard's middle (x -350 to -270, z 200-330) is still open
apron; the trains don't use the yard; the park's trees are still cones.

## 1g. The map joined up (owner, 2026-10-19): map v11, built, waiting for the owner

Owner: "Lets make the map feel more complete. The paths in each section dont match up with each other, the edges of
the city dont really make sense (they are just weird edges of asphalt), there are power poles but no lines, and the
poles are facing the wrong way to connect, etc." Answers (asked first): wires solid; roads out to the yard, the bando
and the fields station, no cars on them yet; the city's edge a kerb, sidewalk and verge (not suburbs).

Found from a top-down render of the level (a throwaway vitest that rasterises `level.parts` from above, not committed;
`docs/evidence/2026-10-19-map-joined/top-down-v10.png` and `-v11.png`): the city's asphalt ran 11 m past the ring road
on three sides, so every street ended in a stub at the grass, with zebras across the stubs and the outer traffic lights'
poles floating 15 cm over asphalt; the park's paths ended in the grass and at -60 (10 m short of the city), and ran
under the railway's ballast; the yard, the bando and the fields station had no way in; the crossarms ran along the line
and a pole stood in the park's main path (x 0).

Built (`packages/maps/src/links.ts`, `first-map.ts ground / cityEdge / roadMarkings`):
- **City edge:** asphalt only kerb to kerb (x ±489, z -499 to -81); a 5 m sidewalk round it at kerb height (the outer
  signal poles stand on it), lamps midway between junctions, a row of street trees on the south verge (own Rng 11).
  No dashes, zebras or stop lines past the ring road.
- **Yard road:** x -360, 7 m, from the ring road (a gap in the sidewalk, a stop line) south between the bando and the
  park, over the railway on a level crossing (concrete deck 0.44 m, 1 cm under the rails, ramps 6.5 m; a crossbuck with
  lights and a raised half barrier each side), into the yard between the two warehouses through a gate (sliding gate
  open). The yard's fence now runs on its north and west sides too.
- **Bando driveway:** cracked concrete slabs (painted, 1 in 9 gone, own Rng 12) off the yard road to a yard in front of
  the loading dock; a worn line from the park path to it.
- **Fields station:** a forecourt and car park behind the platform, a 1 in 12 ramp up to it, a lane south off the map.
- **Paths:** the park's north-south path runs to the city's sidewalk; its east-west path on west to the yard road and
  east to a farm track that leads south to the forest track's north end; the forest track runs on east off the map.
  Boarded foot crossings where the park's paths cross the railway (3: one on the straight, two on the curve).
  Trees of the tree line and the border belt that stood on these ways are grown into a throwaway builder, so the trees
  after them keep their draws.
- **Power line:** poles now at x -425 to 475 (clear of the path), 12 m, an 8 ft crossarm square to the line 0.6 m under
  the top, three pin insulators, wires (3.5 cm drawn, solid) sagging 0.6 m over each 50 m span in 8 straight pieces.
  West end: a fenced substation (gantry, transformer, gravel drive from the ring road). East end: a riser pole with a
  guy wire and the cables down a conduit into the ground. The golden prop on a pole moved from x 200 to 225 (its number
  stays).

**Evidence:** `pnpm test` 58 files, 515 tests (new: "joins the map up": sidewalk where the stubs were, the wire's height
at mid-span, the crossarm across the line, both crossing decks at 0.44 m; train clearance and all 63 props still pass).
Map v11 hash `71aa352f...`, 433 062 triangles (v10: 421 868). Seen in the built-in browser (WebGPU, look-around camera):
the level crossing, a pole with its wires, the city's corner and the substation, a foot crossing, the station forecourt
(`docs/evidence/2026-10-19-map-joined/`). Flight and traffic self-test hashes unchanged.

**Left open:** no cars on the roads out (traffic stays on the grid); the level crossing's lights and barriers don't
work with the train; the yard road's T at the ring road has no lights; wires are 3.5 cm (real 1-2 cm) and may shimmer
far off; the lane and the forest track just run on to the ground's edge at 2 km.

## 1q. Flickering faces (owner, 2026-10-19): map v14, built, waiting for the owner to look

The owner saw "objects clipping and flashing both models back and forth": z-fighting, two faces of different materials
in one plane, facing the same way and overlapping, so the depth test picks either one from pixel to pixel. A new test
(`packages/maps/test/z-fight.test.ts`) finds them in the drawn triangles: same normal (to 0.01), same plane (to 4 mm),
the overlap clipped in the plane; bottoms resting on the ground are left out (never seen). Map v13: 135 m² in 16 pairs
of materials.

**Fixed:**
- *Stacked containers (`yard.ts` stackField):* the top box of a stack was now and then set up to 3 m off, the others
  up to 0.4 m, with slots 0.6 m apart, so a box stood inside its neighbour at the same height. Now at most 0.25 m
  towards a neighbour that has a box at that height (no new random draws: the rest of the yard is as it was).
- *Warehouse roof trusses and the old workshop's roof beams:* ran the full depth, so their ends sat flush in the walls'
  outsides (and the beams' tops in the walls' tops). Now wall to wall, inside.
- *The construction site's plank decks:* their undersides lay on the columns' feet; now 1 cm up.
- *The bando driveway's painted slabs* and the worn path's paint met at one height; the slabs 5 mm up (paint only).

**Left (4.2 m²; the test allows under 5, and no container at all):** out of sight (the fountain's water on its basin,
inside the hopper bins' legs), slopes of 1-4 deg the test reads as flat (ramps and rails, not coplanar), a few cm² at
the fields station. Map hash re-pinned `6923dfa1…` (433 278 triangles, count unchanged). The fixed spots were not
screenshotted in the game.
