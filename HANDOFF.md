# Handoff: where the work stands

The current state only. Rewrite it in place: don't add to it. Detail from finished work goes in the topic note under
`docs/notes/` (see the list at the end); this file keeps one line per item and a link to its note.

## State (2026-10-19)

- **Live build:** https://itsblunty.github.io/Open-World-FPV-Simulator/ (CI publishes every push to `main`; if a run sits queued for good, as on 2026-10-19, a new push starts a fresh one).
- **Milestones:** M0 done, M1 flown, M2 review done (`docs/physics-review.md`) and its first fix built (rotor inflow,
  sim-core/0.6.0). M3 started (owner): 56 golden props to collect, built. Freestyle grading researched and answered (owner). Saved flights built (replay check passes in Chrome and Node);
  replay viewer built (Saved flights > Watch); a downloaded flight opens again with Saved flights > Open a flight file. [saved-flights] Grader v1 built: flips, rolls, power loops, split-S, dives, marked out
  of 10 with reasons, listed in the replay viewer; next: calibrate it with the owner's flying, then challenges.
  Low spec mode built (Settings > Graphics, or `?lowspec`): classic WebGL renderer, same physics. [low-spec §0v]
  Report screen built (menu > Report or suggest): opens a GitHub issue with the game's state. [feedback §0w]
  Extra and super low spec built (Settings > Graphics, `?lowspec=extra|super`): no traffic, half / quarter resolution,
  300 / 200 m view; super holds 60 fps with no GPU on 2 cores. [low-spec]
  Chase camera see-through circle built: a wall between the camera and the quad shows it through a soft circle. [camera §0x]
  Railway built (map v9): a 3.6 km loop round the whole map, over the city on a viaduct with a city station, a tunnel,
  the fields station and goods yard; two solid steam trains half a lap apart, open coaches with side doors, people
  inside and room under them; billowing smoke; a footbridge and stair from the city station down to a new garden,
  walkers who board and get off there; one Settings switch; graphics settings grouped. [railway §0y, §0z, §1a]
  Wall bounces and blade strikes built (sim-core/0.7.0): side, prop and top hits bounce as measured (0.53, falling
  with speed), a prop edge-on to a surface stalls; free flight unchanged. [contacts §1b, physics-review F6]
  Forest and yard built (map v10): a forest with thickets, open woods, a track and a clearing where the hay bales were;
  trees with limbs and gaps to fly through; tree lines and the border broken up; the yard's containers stacked loosely,
  some opened; the grain plant, trailers, racking, sheds; 7 new golden props (63). [map §1c]
  Shadow distance setting built (Settings > Graphics): about 110 m (default), 250 m or 500 m, applies live. [browsers-input-performance §1d]
- **Tests:** `pnpm test`: 58 files, 509 tests pass. `pnpm typecheck` clean (run it without `-s`: pnpm's silent flag hides tsc errors).
- **Pinned hashes** (re-pin them on purpose when a change is meant to alter them):
  - flight self-test `1eb33767…`; classic physics `c1c4280b…` (`apps/fly/src/selftest.ts`, both new in 0.7.0)
  - traffic self-test `68fe64ac…` (traffic v7 with people taking the trains, and the trains v3)
  - map v10 `7396a013…` (421 868 triangles, `packages/maps/test/first-map.test.ts`)
- **Versions:** `SIM_CORE_VERSION` sim-core/0.7.0, `MAP_VERSION` 10, `TRAFFIC_VERSION` 7, `TRAIN_VERSION` 3, `GRADE_VERSION` 1.
- **Browsers:** Chrome / Edge only. Firefox is shelved (owner): don't check it until the rest is done.
  The engine runs on the page; `?render=worker` is opt-in. Low spec mode needs WebGL 2 only (works with GPU off, on WARP).
- **Accepted by the owner:** contacts, turtle mode, traffic, the free-fly camera, map v4, fisheye lenses, the menu,
  the replay viewer (radio controls not tried yet).

## Waiting for the owner

1. **Rotor inflow (sim-core/0.6.0):** fly punch-outs, fast forward flight, dives, a flat throttle-cut drop (now
   26 m/s instead of 16), then tick Settings > Physics > Classic physics and compare. [physics §0p]
2. **City pass (map v5):** look at the crane (it's solid lattice, you can fly through it), the building names and
   doors. Questions: should the crane turn? Are the names OK (real-sounding only, or more jokes)? How many walkers
   should go in (25 % of block-side walks now)? [map §0q]
3. **Golden props (map v6):** hunt some (Esc > Golden props > Collection lists them by number). Is 1 m pickup reach
   right? Are the frosted shelters too easy or too hard to see through? More props, harder spots? [collectibles §0r]
4. **Replay radio controls** (owner: later): tick "Radio controls" in the viewer, roll to wind, pitch to play / pause.
5. **Grader v1 calibration:** fly flips, rolls, power loops (around something and in the open), split-S and dives, some
   clean, some sloppy, then Esc > Flights > Watch and read the trick list. Do the marks rank them as you would? Which
   reasons are wrong or missing? Thresholds are guesses until then. [freestyle-grading §11]
6. **Low spec modes:** fly `?lowspec`, `?lowspec=extra` and `?lowspec=super` (or Settings > Graphics and reload),
   ideally on an old laptop with graphics acceleration off. View distances OK? Quarter resolution too blocky? Should
   the game switch to super by itself when the browser has no GPU, or just show a tip? [low-spec]
7. **Report screen:** Esc > Report or suggest, write a test report, Open on GitHub, and look at the filled-in issue
   (create it or not). Is the format right? Anything missing for replicating bugs? [feedback §0w]
8. **Chase see-through circle:** now upright (it was upside down on WebGPU) and larger (about two thirds of the screen
   high). Fly the chase camera (C) behind buildings and trees: size, edge softness and fade OK? Spotter camera too? [camera §0x]
9. **Railway and train:** spawn at "City station", "Fields station" or "Railway tunnel"; fly under a coach, through
   its windows and down its aisle, under the viaduct. Pull-away and stops feel real? Smoke OK? The train passes a spot
   every 3.9 min now (two trains). Watch people board at the city station; enough of them (35 % at the garden)? [railway §1a]
10. **Wall hits (sim-core/0.7.0):** fly into walls and pillars at speed, level and nose down, throttle held and cut;
   lean a prop on a wall; blip into the bando ceiling. Bounce strong enough, too much? Motors stall as on your quad?
   Landings should feel as before. Turtle on an edge now flips with roll too. [contacts §1b]
11. **Opening a flight file:** Esc > Flights > Download one, delete it, then Open a flight file… (or drop the file on
   the screen) and Watch it. [saved-flights]
12. **Forest and yard (map v10):** spawn "Forest track": fly the thickets, the open woods, under and through the big
   trees' crowns, under the fallen tree on the track. Then "Industrial yard": the container lanes, the open boxes, the
   conveyor gallery, under the hopper bins. Watch the fps counter in the forest (245 k to 422 k triangles, not measured).
   Dense enough? Trees right? Were the "stumps" the hay bales? [map §1c]
13. **Shadow distance:** Settings > Graphics > Shadow distance, try 250 m and 500 m while flying. Pop-in gone? Shadows
   at 500 m too soft close up? Watch the fps counter (not measured at the bigger distances). [browsers-input-performance §1d]

## Left open (not started)

- Freestyle grading: Matty flip, Rubik's cube, yaw spins, orbit not built; challenges (spots, pars, stars, ghost)
  not built and need owner questions first; long carving (> 8 s turning) hides tricks inside it. [freestyle-grading §11]
- `?selftest` on the Pages build since map v5 / traffic v6 (Node hashes are pinned; Chrome not re-run).
- Golden props: billboards are blank, no pickup sound (no audio yet), no minimap. Renumbering props breaks saved
  collections. [collectibles]
- Low spec: not tried on a real old laptop; super stays under 60 fps on 1 core (54-55); no view-distance slider; no
  cheap lens; signal poles and lamps still drawn city-wide in low spec. [low-spec]
- Railway: the hill reads flat from above; people on the platform don't queue (they can overlap at a door); no stair on the north platform; the yard's wagons never move; a puff can
  pass through the hill at a portal; the train ignores the quad; look-around doesn't run the sim (the train stands). [railway]
- Chase see-through: one ray to the quad's centre (a thin pole can flick it on; a part-hidden quad doesn't); cars don't
  trigger it. [camera §0x]
- Physics: G3 inertia may be 20-50 % high (waits for blackbox logs); inflow gaps (idle props in a fast fall, rotor
  speed not rising as props unload, no inflow lag, no vortex-ring model); "(to read)" claims in the review are not
  yet checked against their sources. [physics]
- Damage is shelved, off by default. Before bringing it back, ask the owner what a 5" survives. [contacts §0a]
- Reverse prop thrust 0.73 is an estimate from a 7" test. Wall restitution measured at 1.85 m/s only (its fall-off
  with speed is an estimate); blade-strike brake time is an estimate; no sideways prop-strike kick, no broken props;
  saved flights from 0.6.0 that touched something no longer check as matching. [contacts §1b, physics F6]
- Traffic: mean car speed 1.89 m/s with left-turn arrows; left-turn pockets or green waves if the owner wants faster
  traffic. Cars don't react to the quad. Turning traffic on in Settings may hitch once (its meshes aren't warmed). [traffic]
- Map: frame time after the 5x triangle count (map v4) and the forest (v10) not measured; no tree LOD in low spec; slab undersides render very dark; the crane
  doesn't move; no interiors; the car park, plaza and parking blocks have no names or doors. [map]
- Loading glTF levels into `MeshContactWorld` (needed when CC0 assets replace the blockout); the Boxer's HID
  descriptor as a test fixture. [foundation]
- Shelved with Firefox: render-worker stutter cause, the remaining GC stutter, `?selftest` in Firefox. The measuring
  tools are in `docs/evidence/2026-10-18-firefox-stutter/`. [browsers-input-performance §0l]
- Left open on purpose until levels have content: progression, challenge design. Crashes cost nothing (owner).

## Gotchas worth knowing before you start

- Every change that alters traces: follow `.claude/rules/sim-core.md`, re-pin the hashes above, and the owner flies it.
- Map layout changes: bump `MAP_VERSION`. New random choices get their own `Rng` stream, so the rest of the map
  stays the same.
- Traffic positions come from the sim tick alone (replays). Rule for cars: they only follow their lights, with no
  give-way logic, and they take natural paths, never diagonals (owner). [traffic]
- `docs/physics-review.md` holds the physics findings (G1-G8, F1-F5). Add new ones there.
- Upstream provenance: `packages/sim-core/UPSTREAM.md`, `packages/input/UPSTREAM.md`, `apps/fly/UPSTREAM.md`. Commit
  `cbf6a4a` is sim-core exactly as upstream had it.
- Console: `__fly.engine`, `__fly.ask(code)` runs code in the engine (`fly.renderer`, `fly.session`, `fly.sun`, ...).

## Topic notes (`docs/notes/`, read only the one you need)

| Note | Covers |
|---|---|
| `foundation.md` | sim-core's origin and why it was picked, what M0 and M1 built, Betaflight SITL plan, rejected options |
| `contacts.md` | §0a-0c: contact solver, damage (shelved), prop strikes, turtle mode, camera near plane; §1b: wall bounces, blade strikes |
| `map.md` | §0d, §0g, §0q: look pass, world pass (beams, windows, ramps), crane, names, doors; §1c: forest, trees, the yard filled out |
| `traffic.md` | §0e: solid traffic, signals, the junction network, left-turn arrows |
| `camera-and-menu.md` | §0f free-fly camera, §0m fisheye lenses, §0n main menu and settings, §0x chase see-through circle |
| `browsers-input-performance.md` | §0h-0l: Firefox gamepad, input clock, render worker, warm-up, stutters, shadows; §1d: shadow distance |
| `physics.md` | §0o-0p: the M2 review and rotor inflow (sim-core/0.6.0), NeuroBEM check |
| `collectibles.md` | §0r: golden props, bus shelters, billboards, dumpsters, the collection screen |
| `saved-flights.md` | §0t: flights kept in the browser as stick logs, the replay check, the flights screen, opening a flight file |
| `replay-viewer.md` | §0u: watching a saved flight: the track, cameras, path line, timeline, radio control |
| `low-spec.md` | §0v: low spec mode for weak GPUs: where frame time went, the classic renderer, tiles, measurements |
| `feedback.md` | §0w: the Report screen: GitHub issue links, the report format, the game state it carries |
| `railway.md` | §0y: the first railway and the steam train; §0z: round the whole map, the viaduct, open coaches; §1a: the city walkway, people taking the train, the second train |
| `freestyle-grading.md` | §0s: how sims, games, judges grade freestyle; trick definitions; §11 the grader v1 |

Owner decisions: `docs/decisions.md`.
