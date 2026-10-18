# Golden props: collectibles and the street furniture they hide in

Work notes for M3's first content. Read only when working in this area; `HANDOFF.md` has the current state.

## 0r. Golden props (owner, 2026-10-18): map v6, built, waiting for the owner to fly

**Asked:** "Lets start by adding some random collectibles around the world. They should be kinda like tony hawk pickups,
but FPV themed, like golden props or something. We need a central collection UI to show how many you've collected, they
should each be numbered for referencing them, and they should be hidden around the city. We should add city features to
hide some of them if needed, for example, a covered bus stop with a semi opaque window might hide one, so you only see it
if you're watching out for it or come from the road side. Add a bunch of them." Crashes: "Nothing should cost the user
during normal flight ... no penalties."

**The props (`packages/maps/src/golden-props.ts`).** 51, numbered by area: Park 1-6, Bando 7-12, City 13-42, Industrial
yard 43-49, Fields 50-51. Each has a number, an area and a spot ("In the bus shelter outside Harbour Medical Centre"). The
fixed spots were placed by hand from the layout's own numbers (comments give the reasoning for each); the city's shelters,
billboards, alleys and the tallest tower are found from the generated buildings. `Level.collectibles` is metadata: not
solid, not in the collision hash. Hand-placed rather than random: a random spot is rarely a good hiding place.

**Street furniture (solid, map v6).** All from their own `Rng(8)` after the rest of the map, so nothing else moved.
- 10 bus shelters: 3.9 x 1.4 x 2.5 m [estimates], open to the road, frosted back and end panels, a bench, the stop's flag
  at the kerb. Only where a building stands 3.9 m or more back from the kerb: people walk 1.0-1.6 m in (0.3 m wide, so
  up to 1.9 m), and the shelter starts at 2.1 m, so they pass in front of it. Kept 14 m from block corners (crossing
  queues, lamps, signal poles) and 5 m from doors. The prop floats inside, 0.6 m behind the open front.
- `frosted` material: drawn see-through at 65 % opacity (no blur), solid like glass. 78 % hid the prop completely through
  an end panel; at 65 % it shows as a faint gold shape through the back panel.
- 6 rooftop billboards on 3-8 storey buildings: a 6 x 3 m panel 1.3 m back from the street face, 0.9 m above the roof,
  two posts with kicker braces [estimates]; kept clear of the AC units (now recorded while the roofs are built). The
  prop sits 1.5 m behind the panel, below its top.
- 6 dumpsters (1.8 x 1.1 x 1.2 m, a 3-yard front-loader [estimate]) in the 4 m alleys between split buildings, one per
  block. The prop sits low beside it, seen from one end of the alley only.

**Taking one (`apps/fly/src/collect.ts`).** After every 1 ms sim step (the runner's `onStep`), a prop is taken when the
quad's centre is within 1.0 m (`COLLECT_RADIUS`; the drawn prop is 0.8 m across, so brushing past counts). Same sticks,
same props on the same ticks; the props change nothing in the flight (test: the run's hash with props equals the run
without). Taken in any state (armed or not, any camera's quad); the free-fly camera does not take them.

**Drawn (`apps/fly/render/collectibles.ts`).** One instanced mesh: a gold tri-blade prop standing on edge, turning about
the vertical every 2.4 s and about its hub every 4 s, bobbing 6 cm. A taken one swells to 1.7x over 0.3 s and is gone.
Full metal drew dark brown (nothing to reflect), so it is 35 % metallic with a gold glow.

**Page.** HUD: `PROPS n / 51` under the speed, and "GOLDEN PROP #n" with the count and the spot for 3 s on a pickup.
Menu: a "Golden props" section with the count and a Collection button. Collection screen: per area, found ones in gold with
their spot, unfound ones as "#n ?"; a Reset button that asks twice. Saved in this browser (`localStorage`
`owfpv.goldenProps`, by map id, by number). **Renumbering the props breaks saved collections**: add new ones at the end of
an area list only if the numbers can change, or bump the key.

**Evidence:** `pnpm test` 51 files, 450 tests (new: `packages/maps/test/golden-props.test.ts`: numbering, every prop 5 cm
clear of all geometry at its drawn size, and a flood fill on a 0.4 m grid of quad-sized (0.25 m) spots from within 1 m
of each prop out to open sky; the shelters' walking lane is clear at 0.7 and 1.9 m in, the front is open to the road, the
first thing from the building side is the frosted panel; each billboard's panel is 1.5 m from its prop towards the
street. `apps/fly/test/collect.test.ts`: the radius, saved collections, and a scripted flight taking the same props on
the same ticks twice with an unchanged hash). Typecheck and production build clean. Seen in the built-in browser (dev
server, WebGPU): the fountain prop, the shelter outside Harbour Medical Centre from the road and from behind the frosted
panel, the billboard on Rosewood House from the street and from behind, a pickup's message and counter, the collection
screen, and Reset (screenshots in the session's tool results, not saved). Re-pinned: map v6 `27a17110…` (228 994
triangles). Flight and traffic self-test hashes unchanged (the props are not solid; the traffic does not use the new
furniture).

**Left open:** the owner to fly them (hard ones: inside the crane tower, the counter-jib, the shaft, the alleys). Billboards
are blank (render-only art could go on them). No sound on pickup (the sim has no audio yet). Walkers don't sit in the
shelters. The props are not shown on any map or radar (there is no minimap).
