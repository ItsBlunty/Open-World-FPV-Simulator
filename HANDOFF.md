# Handoff: where the work stands

The current state only. Rewrite it in place: don't add to it. Detail from finished work goes in the topic note under
`docs/notes/` (see the list at the end); this file keeps one line per item and a link to its note.

## State (2026-10-18)

- **Live build:** https://itsblunty.github.io/Open-World-FPV-Simulator/ (CI publishes every push to `main`).
- **Milestones:** M0 done, M1 flown, M2 review done (`docs/physics-review.md`) and its first fix built (rotor inflow,
  sim-core/0.6.0). M3 started (owner): 51 golden props to collect, built. Freestyle grading researched and answered (owner). Saved flights built (replay check passes in Chrome and Node);
  replay viewer built (Saved flights > Watch). Grader v1 built: flips, rolls, power loops, split-S, dives, marked out
  of 10 with reasons, listed in the replay viewer; next: calibrate it with the owner's flying, then challenges.
  Low spec mode built (Settings > Graphics, or `?lowspec`): classic WebGL renderer, same physics. [low-spec §0v]
  Report screen built (menu > Report or suggest): opens a GitHub issue with the game's state. [feedback §0w]
  Super low spec (no GPU, old CPU) measured, not built: 60 fps on 2 cores needs traffic off, 200 m view, half resolution; plan waits for the owner. [low-spec]
- **Tests:** `pnpm test`: 55 files, 481 tests pass. `pnpm typecheck` clean.
- **Pinned hashes** (re-pin them on purpose when a change is meant to alter them):
  - flight self-test `af127b88…`; classic physics `cd45c59c…` (`apps/fly/src/selftest.ts`)
  - traffic self-test `59f44e0a…` (traffic v6)
  - map v6 `27a17110…` (228 994 triangles, `packages/maps/test/first-map.test.ts`)
- **Versions:** `SIM_CORE_VERSION` sim-core/0.6.0, `MAP_VERSION` 6, `TRAFFIC_VERSION` 6, `GRADE_VERSION` 1.
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
6. **Low spec mode:** open the Pages build with `?lowspec` (or tick it in Settings > Graphics and reload), fly it,
   ideally on an old laptop. Is 650 m view distance OK? Is the flat camera (no fisheye) OK there? [low-spec §0v]
7. **Report screen:** Esc > Report or suggest, write a test report, Open on GitHub, and look at the filled-in issue
   (create it or not). Is the format right? Anything missing for replicating bugs? [feedback §0w]

## Left open (not started)

- Freestyle grading: Matty flip, Rubik's cube, yaw spins, orbit not built; challenges (spots, pars, stars, ghost)
  not built and need owner questions first; long carving (> 8 s turning) hides tricks inside it. [freestyle-grading §11]
- `?selftest` on the Pages build since map v5 / traffic v6 (Node hashes are pinned; Chrome not re-run).
- Golden props: billboards are blank, no pickup sound (no audio yet), no minimap. Renumbering props breaks saved
  collections. [collectibles]
- Low spec: not tried on a real old laptop; no view-distance slider; no cheap lens; signal poles and lamps still
  drawn city-wide. [low-spec]
- Chase camera has no collision and can end up inside buildings (owner: "on the list").
- Physics: G3 inertia may be 20-50 % high (waits for blackbox logs); inflow gaps (idle props in a fast fall, rotor
  speed not rising as props unload, no inflow lag, no vortex-ring model); "(to read)" claims in the review are not
  yet checked against their sources. [physics]
- Damage is shelved, off by default. Before bringing it back, ask the owner what a 5" survives. [contacts §0a]
- Reverse prop thrust 0.73 is an estimate from a 7" test; hard hits barely bounce (owner chose turtle mode). [contacts]
- Traffic: mean car speed 1.89 m/s with left-turn arrows; left-turn pockets or green waves if the owner wants faster
  traffic. Cars don't react to the quad. Turning traffic on in Settings may hitch once (its meshes aren't warmed). [traffic]
- Map: frame time after the 5x triangle count (map v4) not measured; slab undersides render very dark; the crane
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
| `contacts.md` | §0a-0c: contact solver, damage (shelved), prop strikes, turtle mode, camera near plane |
| `map.md` | §0d, §0g, §0q: look pass, world pass (beams, windows, ramps), crane, names, doors |
| `traffic.md` | §0e: solid traffic, signals, the junction network, left-turn arrows |
| `camera-and-menu.md` | §0f free-fly camera, §0m fisheye lenses, §0n main menu and settings |
| `browsers-input-performance.md` | §0h-0l: Firefox gamepad, input clock, render worker, warm-up, stutters, shadows |
| `physics.md` | §0o-0p: the M2 review and rotor inflow (sim-core/0.6.0), NeuroBEM check |
| `collectibles.md` | §0r: golden props, bus shelters, billboards, dumpsters, the collection screen |
| `saved-flights.md` | §0t: flights kept in the browser as stick logs, the replay check, the flights screen |
| `replay-viewer.md` | §0u: watching a saved flight: the track, cameras, path line, timeline, radio control |
| `low-spec.md` | §0v: low spec mode for weak GPUs: where frame time went, the classic renderer, tiles, measurements |
| `feedback.md` | §0w: the Report screen: GitHub issue links, the report format, the game state it carries |
| `freestyle-grading.md` | §0s: how sims, games, judges grade freestyle; trick definitions; §11 the grader v1 |

Owner decisions: `docs/decisions.md`.
