# Owner decisions log

Questions put to the owner and the answers, newest last. `SPEC.md` reflects them. Add each new answer here.

| Date | Question | Answer |
|---|---|---|
| 2026-10-17 | Project license | GPL-3.0 |
| 2026-10-17 | License of our changes to `packages/sim-core`: MIT (so they can go upstream) or GPL? | GPL; upstreaming not needed |
| 2026-10-17 | Split the flight controller from the physics in M0, or later? | Claude's call: done in M0 |
| 2026-10-17 | GPL-3.0 "only" or "or later"? | GPL-3.0-or-later |
| 2026-10-17 | Which 3D engine renders the world? (Three.js / PlayCanvas / Babylon.js) | Three.js |
| 2026-10-17 | How is the first map's art made? (blockout then CC0 / CC0 from the start / blockout only) | Blockout first, then CC0 |
| 2026-10-17 | What radio, connected how? (EdgeTX USB / wireless dongle / gamepad) | EdgeTX radio over USB |
| 2026-10-17 | Default drone for the first map? (5" freestyle / 65 mm whoop / 3" cinewhoop) | 5" freestyle |
| 2026-10-17 | Which EdgeTX radio, set up how? | RadioMaster Boxer. A setup system that saves calibration and settings, supports all 4 stick modes and walks the pilot through moving each stick |
| 2026-10-17 | Use the owner's own Betaflight rates? | Preset defaults, plus a box for Betaflight and Actual rates where pilots enter their own |
| 2026-10-17 | FPV camera uptilt and field of view? | 20° default, adjustable; ~120° FOV, adjustable |
| 2026-10-17 | Map scale and bando size? | One open world, start quite large; bando 5 storeys with broken floors |
| 2026-10-17 | HUD readouts for M1? | Battery voltage, armed / flight mode, throttle and speed |
| 2026-10-17 | Where do playtest builds run? | GitHub Pages |
| 2026-10-17 | Is ~1 km x 1 km the right map size to start? | Yes |
| 2026-10-17 | (owner's request after flying M1) Sticking and shaking on surfaces | Must not happen at all; fix the physics, respawn workarounds are not acceptable |
| 2026-10-17 | (owner's request) Damage | Simple health 100 % down by impact speed for now |
| 2026-10-17 | (owner's request) Landing | Landing on the bottom does no damage unless very fast |
| 2026-10-17 | (owner, after the damage model was built) Damage too harsh, not realistic: a 5" hits on its belly and slides without damage | Shelve damage: off by default, every hit a bounce, keep flying; a toggle to bring it back later |
| 2026-10-17 | After a hit leaves the quad on its back: turtle mode, bouncier hits, a prop-strike kick, or nothing? | Turtle mode |
| 2026-10-17 | Turtle switch turned off while armed: disarm and re-arm (Betaflight 2026.6 default), fly on (auto re-arm), or 4.5 style? | Disarm, re-arm (Betaflight default) |
| 2026-10-17 | The automatic rewind of a quad lying flipped for 1.5 s (Liftoff's rule)? | Always off |
| 2026-10-17 | (after flying 0.3.0-0.4.0) Contacts, prop strikes, turtle mode, the camera fix | All good for now |
| 2026-10-17 | Keep the automatic rewind of a quad wedged with the throttle up for 3 s? | Keep it: a pilot throttles down unless something is wrong |
| 2026-10-17 | A chase camera that does not go inside buildings? | Later: on the to-do list |
| 2026-10-17 | (owner's request) Level look | A general pass; bando columns must run unbroken like a real building's |
| 2026-10-17 | People and cars: drawn only, or solid? | Solid, stylised to look fun, with settings to turn them off |
| 2026-10-17 | (owner's request) Traffic | Stoplights, more realistic driving, people waiting at crossings, crossing lights; a toggle in the performance settings |
| 2026-10-18 | (owner's request) Fisheye FPV camera from Gyroflow lens profiles: default lens? | Caddx Ratel 2 (analog) |
| 2026-10-18 | A camera picture of another shape than the screen? | Fit with black bars |
| 2026-10-18 | Which profiles to offer? | A short curated list |
| 2026-10-18 | The FOV slider with a lens? | Hide it |
| 2026-10-18 | Fisheye method: wide render + warp, vertex bending, or cropped face cameras + remap? | Face cameras (exact); Firefox shelved for now |
| 2026-10-18 | M2: blackbox logs of the owner's quad to fit the preset? | Not now; go without, maybe correct later |
| 2026-10-18 | M2: write the review into `docs/physics-review.md` and commit? | Yes |
| 2026-10-18 | M2: first improvement? | The airflow fix (per-rotor inflow thrust, review G1) |
| 2026-10-18 | Airflow fix: vertical drag area, which drones? | 150 cm^2; Nazgul only |
| 2026-10-18 | (owner's request) Compare with the old physics | A "Classic physics" toggle that loads sim-core/0.5.0's model |
| 2026-10-18 | Download NeuroBEM's 627 MB measured-flight data to check the model? | Yes, carefully (token budget) |
| 2026-10-18 | Use NeuroBEM's measured 33 ms motor lag for the Nazgul? | No, leave 17 ms |
| 2026-10-18 | (owner's request) City pass | A realistic tower crane, names on buildings, some walkers going in and out of buildings |
| 2026-10-18 | (owner, on left turns) Give-way rules for cars? | No: cars only follow traffic lights, with cycles and turn arrows; natural paths, never diagonals |
| 2026-10-18 | Render worker: engine in a worker or on the page? | On the page by default (the worker stuttered); `?render=worker` opt-in |
| 2026-10-18 | Firefox support | Shelved until the rest is complete |
| 2026-10-18 | (owner's request) Fisheye on the free "Look around" camera too? | Yes |
| 2026-10-18 | Next task? | Start M3 |
| 2026-10-18 | (owner's request) First M3 content | Collectibles like Tony Hawk pickups, FPV themed (golden props), numbered, hidden around the city, a lot of them; a collection screen with the count; add city features to hide some (e.g. a covered bus stop with a semi-opaque panel, seen only from the road side or when looking for it) |
| 2026-10-18 | Crash rule in challenges? | Nothing costs the pilot in normal flight; no penalties for now |
| 2026-10-18 | Freestyle grading now? | Research it now (write-up, no code) |
| 2026-10-18 | Freestyle grading: free flight or challenges first? | Challenges first |
| 2026-10-18 | Who defines each trick? | Write them up from public sources (Rotor Riot's Tricktionary and the like) |
| 2026-10-18 | What makes a power loop good? | Research many sources and find a consensus |
| 2026-10-18 | Tricks after flip, roll, power loop, split-S, dive? | Matty flip, Rubik's cube, yaw spins and orbit |
| 2026-10-18 | What does the pilot see of a grade? | Verbose for now, to discuss. Owner's idea: a "trick report" from a trick log showing the path flown, a replay from FPV or chase cam to see why, and a ghost of the perfect version (or versions) to guide the pilot |
| 2026-10-18 | Combos that multiply points? | Later |
| 2026-10-18 | Gaps: by hand or from geometry? | Marked by hand in the map |
| 2026-10-18 | Timed rounds or open flight? | Challenges you can retry, each with its best score in a log and maybe an overlay at the challenge spot; a score or star rating; the open-world goal is full stars in every challenge |
| 2026-10-18 | Port PyFlightCoach's LGPL-3.0 code if useful? | Yes, keeping its notices and naming the source |
| 2026-10-18 | Save flights (stick logs) in the browser before the grader? | Yes, first |
| 2026-10-18 | Power loop shape? | Grade steady rotation and tightness everywhere; roundness only in open-air loop challenges |
| 2026-10-18 | Keeping the object in view counts? | No: grade the path only, so camera uptilt does not change scores |
| 2026-10-18 | Rubik's cube version? | ProWhooper's exact pattern (half flip, full roll, half flip, same direction); other mixes are separate tricks |
| 2026-10-18 | Inverted yaw spin? | 360 is the trick; a 180 version as a separate, easier challenge |
| 2026-10-18 | Orbit? | One full circle, nose within 30° of the object most of the way; tighter centring scores better |
| 2026-10-18 | Split-S exits? | Heading reversed (180° ± 45°) now; 270° and yaw-entry variants as separate named tricks later |
| 2026-10-18 | Wind in challenges? | The world's wind |
| 2026-10-18 | Trick difficulty scale? | Start from ProWhooper's base points (flip 50, power loop 200, Rubik's cube 325, inverted yaw spin 400), tune later |
| 2026-10-18 | Replay viewer cameras? | All four: FPV (the pilot's lens), chase, free camera, and a fixed spotter that turns to follow the quad |
| 2026-10-18 | Replay path line? | Switchable (off / trail / whole flight), whole flight by default |
| 2026-10-18 | Replay overlay? | Stick overlay; speed, height, throttle; timeline marks for crashes, respawns and golden props |
| 2026-10-18 | Replay controls? | Play/pause and a scrub bar; speeds 0.1x to 2x. Radio control of the replay as an option that starts off, so stick jitter or a bumped stick never moves the playback unless the pilot means it |
| 2026-10-18 | Replay viewer OK? | Looks good for now; the radio controls get tried later |
| 2026-10-18 | Next task? | Continue: the grader (first prototype, shown in the replay viewer) |
| 2026-10-18 | Report bugs from the game? | Yes: an in-game button that opens GitHub issues or suggestions, formatted, with the game state for reference and replication |
| 2026-10-18 | Low spec version? | Yes: a browser version an old laptop with barely a GPU can run, with good physics; keep going until it works |
| 2026-10-19 | Super low spec for no GPU and an old CPU? | Yes, same physics; auto-disable cars, people and traffic lights in it |
| 2026-10-19 | Is 45 fps enough? | No: "We need to hit 60 fps not 45" |
| 2026-10-19 | How many low spec modes? | Three: low spec as it is; extra low spec at half resolution and a 300 m view; super low spec at a quarter resolution and a nearer view (200 m) |
| 2026-10-19 | Chase camera blocked by a wall? | A circle covering about half the screen, feathered edges, that sees through walls to the quad |
| 2026-10-19 | A railway? (owner's ask) | A tunnel and a steam train through a railyard that stops and goes on, speeding up and slowing down slowly like a real train, with simple cloud smoke; cheap to run but cool; its own toggle in settings, and the graphics settings grouped properly |
| 2026-10-19 | The railway, next (owner's ask) | Round the whole map through every area and through the city, with a station in the city; coaches high enough to fly under; open windows with people inside, to fly into and through while it moves; smoke that billows into bigger clouds |
