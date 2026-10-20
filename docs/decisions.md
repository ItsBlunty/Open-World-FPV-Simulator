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
| 2026-10-19 | The railway, then (owner's ask) | A walkway down from the city station to the empty lot beside it, made a garden with trees and paths to the sidewalks; walkers go up, board and get off there (only at the city station; nobody at the other); a second train on the same loop |
| 2026-10-19 | Wall hits (owner's ask) | Hitting a wall with throttle should bounce the quad back off it, often stalling a motor, instead of pushing it flat onto the wall to slide down; research it first; keep the physics in the air as it is |
| 2026-10-19 | Chase see-through circle (owner's report) | A bit larger; it showed the scene upside down (fixed: flipped, radius 25 % to 32 % of the screen height) |
| 2026-10-19 | More map (owner's ask) | Tree lines spread out and more random; larger multi-branch trees to fly through and around; a forest with dense and sparse parts, maybe in the "stumps" area by the Fields station (read as the hay-bale field: it became the forest, with a felling clearing of real stumps); flesh out the silos, buildings and shipping containers, some opened to fly through, stacked more randomly |
| 2026-10-19 | Shadow distance (owner's ask) | A setting to let shadows draw much farther; the pop-in at ~110 m was bad |
| 2026-10-19 | Graphics settings laid out like a game (owner's ask) | A quality preset at the top: High, Medium, Low, Very low, Super low (all three low spec modes kept); High and Medium differ in shadows and resolution (taken: High shadows to 250 m, Medium to 110 m, both full resolution); details below, changing one makes it Custom |
| 2026-10-19 | Cleaner start screen (owner's ask) | A title card with Start flying, Settings, Collection, Flight replay and the connected radio shown (no connect button there); everything else from the old menu merged into Settings; Esc in game opens a pause popup with an X (or Esc) to close and Settings, Collection, Flight replay |
| 2026-10-19 | Map joined up (owner's ask) | Paths that meet between areas, a city edge that makes sense, wires on the power poles with crossarms facing the right way. Asked: wires solid (yes); roads out to the yard, bando and fields station, no cars on them yet (yes); city edge a kerb, sidewalk and verge, not suburbs (yes) |
| 2026-10-19 | Time trials (owner's ask) | Courses built into the landscape: windows, open areas by a wall and the like as gates, the gates in an area linked into a course. Each has a checkerboard flag and a platform: stay on it 3 s (it glows brighter) and a popup offers the race, taking the drone's controls; yaw right + roll left held 1 s races, yaw left + roll right declines, a circle filling while held. Accept: back on the platform under the checkerboard gate, 3 2 1 GO!, leaving before GO is a false start and a reset; the checkerboard gate is the last gate. The time is shown, saved and compared with the old one; every time trial logged in a Time Trials section like the collection. Decline: back to flying |
| 2026-10-19 | Time trial gates and pads (owner's report) | The gates must be much clearer, it is hard to tell where to go; the pad is not obvious: a floating 3D arrow over it pointing down, bobbing, saying "Time Trial" |
| 2026-10-19 | Time trial pads (owner's ask) | Pads much larger; the big arrow under the checkerboard arch, hovering right over the pad, with LAND HERE TO START until the pilot has a time on that course; then both go; the TIME TRIAL words stay always |
| 2026-10-19 | Menus (owner's ask) | Buttons to clear all data for the profile and to go back to default settings; Back to main menu in the pause menu; Start at moved from Settings to the main menu. Taken without asking: Default settings keeps the radio setup, collection, times and flights; Clear all data removes all of them; both reload the page |
| 2026-10-19 | Sound (owner's ask) | Add sounds, realistic, from open-source sources (the project is GPL-3). Approved downloading ten CC0 files (Freesound previews, Kenney Impact Sounds) to cut from. Taken without asking: FPV camera heard from on board, chase from behind; M mutes; `docs/notes/sound.md` |
| 2026-10-19 | Sound fixes (owner's report) | Sounds came in too late; the props sounded tinny, a bit echoey and had a static sound; turn the environmental sounds down by default, with room to turn them up in the audio settings. Taken without asking: a separate Ambience slider (city, park) at 50 %, World renamed Trains; a Low latency sound switch, on by default, that turns itself off if it crackles; `docs/notes/sound.md` §1m |
| 2026-10-19 | Sound latency (owner's report) | Low latency sound can't stay on in the owner's Chrome on a high-end PC: is there no other way to cut the latency? Research it, then finish the sound. Taken without asking: per-frame changes ramp over one frame instead of a 20 ms smoothing; a note in Settings > Sound on what adds delay outside the game; no output-device picker (Chrome only names devices after a microphone permission) |
| 2026-10-19 | Battery and time trials (owner's ask) | Battery simulation as a setting, off by default; the battery full when a time trial starts with it on; a throttle down check before the 3-2-1. Taken without asking: off = the pack never drains but still sags under load; throttle down = at or under 1050 us (Betaflight's min_check); flying off the pad before the countdown starts is no false start |
| 2026-10-19 | Shadows, people, flicker (owner's report) | Shadows have a light ring round an object before the shadow starts; walking people clip into each other; objects round the map clip and flash between two models. Taken without asking: people who find a crossing's waiting spots full walk on instead; no sidestepping round people standing |
| 2026-10-20 | Sound crackle (owner's report) | The last sound change made all the audio crackle; fix it, and research how Chrome handles audio rather than only probing. Taken without asking: back to setTargetAtTime smoothing at 10 ms (Chrome's own former dezippering constant) instead of 20 ms; `docs/notes/sound.md` §1s |
| 2026-10-20 | Vehicles and vendors (owner's ask) | Variety in the cars beyond colour; pickups, sometimes hauling things; semis, sometimes open at the back, sometimes with stuff in them when open; vendors round the city selling hot dogs and similar. Taken without asking: four car shapes (toy car, saloon, SUV, van), pickups with five loads, semis with 53 ft vans (shut, open with pallets, open empty), 28 ft pups and 48 ft flatbeds (lumber, steel); trailers follow the lane through turns (the corners are too tight to off-track); 11 carts (hot dogs, pretzels, ice cream, coffee, tacos) with the vendor a solid standing person; `docs/notes/traffic.md` §1t |
