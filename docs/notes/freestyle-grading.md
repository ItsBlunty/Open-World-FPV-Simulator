# Freestyle grading: research

Work notes for SPEC §4.3. Read only when working in this area; `HANDOFF.md` has the current state.

## 0s. Freestyle grading research (owner, 2026-10-18): write-up, no code

**Asked:** the owner chose "Research it now (write-up, no code)" (`docs/decisions.md`, 2026-10-18). Their direction
(SPEC §4.3): recognise specific tricks, then grade each on how it was flown (a power loop on how circular it is).
Constraints: R5 (grading works from the replay alone, so saved flights can be re-scored when the method changes) and
R1 (sim-core stays separate; grading lives in the game and only reads sim state).

Marks used below: **[estimate]** = a number I picked, to be tuned by flying; **[not found]** = I looked and found no
source; **[secondary]** = from a fan guide or summary, not from the maker.

### Short version

- **No FPV sim grades how well a trick was flown, as far as I could find.** Liftoff has detected and scored tricks
  since 2017 (60 s rounds, points, a multiplier, less for repeats), but nothing it has published says it grades
  roundness, accuracy or smoothness. Uncrashed, DRL, TRYP and VelociDrone show no trick scoring at all in what they
  publish. Grading the quality of each trick would be new.
- **No FPV freestyle rulebook exists at the international level.** FAI's 2026 drone volume has only drone soccer and
  racing. Real FPV freestyle events use human judges with loose criteria (MultiGP 2023: consistency, creativity,
  flow).
- **The best model for grading quality is RC aerobatics.** FAI's F3A rules (planes) and F3N rules (freestyle
  helicopters) say exactly how to mark down a loop or a roll: start at 10 (or 20), take off points per defect,
  "1 point per 15 degrees". An open-source project (PyFlightCoach / FCScore) already scores F3A flights automatically
  from flight logs, and re-runs old flights when its method changes, which is our R5 idea.
- **Recommendation:** recognise tricks with hand-written rules built from a few basic "elements" (a rotation about
  one axis, a loop of the flight path, a held state such as inverted or diving, a gap). Grade each element and each
  trick F3A-style, with every deduction shown to the pilot. Start with five tricks: flip, roll, power loop, split-S,
  dive. Machine learning is not a fit for now (no labelled data, hard to explain, harder to keep deterministic).
- **Before building:** the owner should settle the questions at the end, mainly what a "good" power loop is. Matty
  Fleischer, whose name is on the Matty flip, writes that an oblong power loop is sometimes the right one.

### 1. How existing sims grade freestyle

**Liftoff (LuGus Studios).** The best documented. All from the developer's own Steam announcements and developer
replies, unless marked otherwise:
- Milestone 0.11.0 (2017-10-10) added Freestyle mode: "One environment. 60 seconds. Pull off tricks to earn points
  and increase your score multiplier." That first release had sustained tricks that score for as long as they are
  held (dive, upside down), modifiers that add points (an action cam on the quad, a power loop through a narrow gap
  or close to a wall), fewer points for the same trick several times in a row, and an option to detect tricks in
  every mode. In the same post the developers expected false positives, missed tricks and exploits.
- 0.11.1 (2017-10-12): added half back and front flips; flips and power loops made "easier to register".
  0.12.8 (2017-12-14): "Freestyle mode internal rework: tricks should be easier to detect", 7 new tricks.
  0.12.9 (2017-12-19): "Removed Delayed Backflip trick in favour of Powerloop" (the two looked alike to the detector).
  1.3.6 (2020-11-11): the score of each stunt is saved in the recording and shown on replay.
- Fixed 60 s rounds "so players can compare scores"; 100 s was "a bit too long" (developer, Steam thread, 2017-12-28).
- The trick list is not shown in game. A player posted the 29 names it detects (2018); in 2024 a developer explained
  that 13 of them are "base-stunts" used to build the rest, and only Flip Flop and Flop Flip "seem not to work"
  because they are "extremely hard to trigger". Base stunts: aileron roll / half roll / delayed roll, front and back
  flip / half / delayed, left and right spin / half, drift. Tricks: aileron roll, backflip, double backflip, front
  flip, double front flip, dive, gap clear, tight gap clear, inverted split S, split S, inverted yaw spin, yaw spin,
  power loop, upside down, "Law Mowner" (sic), target acquired, flip flop, flop flip.
- How detection works, how many points each trick gives and how the multiplier grows: **[not found]**. The base-stunt
  answer suggests rules that build tricks out of simpler rotations (my reading, not stated by Liftoff).
- An achievement guide says the "Deep Dive" achievement needs a dive worth over 200 points **[secondary]**.

**Uncrashed.** Store page and all 44 Steam announcements (2021-08 to 2026-07): no trick detection or
freestyle score. Its 2023 Christmas event had human judges pick the best video. **[not found]** beyond that.

**DRL Simulator.** 93 Steam announcements: no trick, stunt or freestyle score. It has a freestyle mode. **[not found]**

**TRYP FPV.** Store page: "Challenge your skills in freestyle with CHALLENGE Mode"; a challenge system "to practice
your precision skills in specific places". 22 announcements: no trick scoring. **[not found]**

**VelociDrone.** Not on Steam; its leaderboards are lap times. No trick scoring found. **[not found]**

### 2. What board-sport games do

These grade *what* you did far more than *how well*. Useful for the game loop, less for the grading itself.
- **Tony Hawk's Pro Skater 1+2** (Activision's own help page): chain tricks into a combo before the board touches down;
  each trick, each gap and each spin raise the multiplier; repeating a trick in a combo lowers its value. A fan wiki
  gives a repeat floor of one tenth **[secondary, could not read it]**.
- **SSX (2012)** (Wikipedia, uncited section): tricks fill the boost meter, a full meter gives "Tricky" mode; the combo
  bonus is multiplied when cashed in and lost if you bail; rewinding costs trick points.
- **Steep:** a review says a backflip with a poor landing earns few points, so landing quality counts. The rules
  themselves **[not found]**.
- **Skate:** "spot battles": a score to beat at a fixed spot, with a leaderboard per spot. The formula **[not found]**.

What carries over: named gaps (THPS) fit our hand-made map; spot leaderboards fit challenges placed around the world
(SPEC §4.2); lower value for repeats stops a pilot farming one easy trick. Combos lost on a crash would be a
crash cost, which the owner has ruled out for now (see question 6).

### 3. What real pilots and competitions value

**No official FPV freestyle rules.** I read the full FAI Sporting Code Section 4, Volume F9 Drone Sport, 2026: it
has F9A drone soccer (provisional) and F9U racing (official), nothing on freestyle. A French blog (dronesport.fr,
2026) says FAI made freestyle official in 2025 and scores it with AI; it cites no link, and the FAI volume does not
support it. Ignore it.

**Judged events.** MultiGP International Open 2023, "Sendit Showdown": two 2-minute solo runs, the better one counts,
three judges, each scoring Consistency, Creativity and Overall Flow, plus a 1-point "je ne sais quoi" bonus. The page's
numbers don't add up (it says 100 points per judge but lists 11 per category). A 2022 iFlight guest post (pilot BMac)
lists trick tiers from "the drone national championships official rules" (which I could not find) and says each trick
gets points for difficulty, without numbers:
- Novice: flip, roll, slow pass through a large gap.
- Intermediate: back-to-back flips or rolls, flip or roll with a hesitation, flip or roll through a gap, power loop,
  inverted hang time.
- Expert: knife-edge flip (cartwheel), flip or roll through a tiny gap, power loop through a small gap, proximity
  flip (close over an object, keeping it in view), knife-edge proximity, rail slide.

**Trick names.** Community definitions are loose and disagree, so we will have to write our own (question 2).
- Rotor Riot's "Tricktionary" (2023, from a video with Le Drib, Alex Vanover and Joshua Bardwell): almost every trick
  is a mix of three basics: roll (or barrel roll, which spirals the path), flip, yaw spin. Open-air tricks: Rubik's
  cube (half flip forward, a 360 roll, half flip forward "or some combination"), inverted yaw spin, juicy flick (flip
  upside down to look back, then return), stall, throwback, vanny roll. Object tricks: gap, knife-edge gap, power loop
  (over or under something and back), orbit (360° around an object), split-S (roll 180°, then go back the way you
  came), Immelmann (climb, go back, roll out), Matty flip (over an object, keep pitching forward with power, end up
  flying backwards under it), trippy spin, dive (a nose-down stall), backwards dive, wall ride. Contact tricks: wall
  bonk, slides and grinds, perches.
- WREKD's "master list" (about 80 names, beginner to advanced) adds rewinds, lookbacks, side locks, pendulum, coin drop,
  Barani and more, but with one-line descriptions too vague to define a detector.
- Matty Fleischer, "How to Powerloop" (updated 2026-07-14): fly under or through a gap, add throttle and back pitch
  together, keep the object in view over the top, cut throttle to near zero while inverted, come back down through the
  same gap. A gentle pop with smooth pitch makes a round loop; a harder pop makes an oblong one, which clears tall
  objects with less run-up. Holding throttle inverted pushes the quad away from the object. **So a round loop is not
  always the aim**; going around the object and coming back through the gap is.

**The closest formal judging: RC aerobatics (FAI, read in full).**
- *F3A planes, Annex 5B "Manoeuvre Execution Guide" (2024 volume).* Judge the flight path (the path of the centre of
  gravity), not the attitude. Each manoeuvre starts at 10 and loses points in 0.5 steps by type, severity and number
  of defects; a mark is never raised for "something nice". The basic rule: **1 point per about 15° of deviation**,
  0.5 for half that. Loops: constant radius, in a vertical plane, no segments; each radius is compared with the last
  one flown; drift out of the plane costs 0.5 or more. Rolls: constant rate, crisp start and stop (0.5 each if not),
  a rate change at the end judged by the 15° rule, same rate for repeated rolls. Entry and exit: straight and level
  lines; centre manoeuvres finish on the entry heading and height. Speed should stay constant (up to 1 point). Each
  manoeuvre's mark is multiplied by a difficulty factor (K-factor).
- *F3N freestyle helicopters, Annex 5G "Judges' Guide" (2026 volume).* Set manoeuvres start at 20; rule of thumb 1
  point per 5° of misalignment and 1 point per 5 m off centre, 1 point per 2 m of height change in horizontal flight.
  A severe mistake costs about 6, medium 3, small 1; repeated severe mistakes 6, 4, 2, then 1; a recognisable
  manoeuvre with nothing missing never drops below 5. Flips: height wobble under 50 cm, 1 point per 50 cm of sideways
  drift. A pirouette (yaw spin) must not change the flight path. A freestyle flight is scored from zero up, on
  difficulty (×3), harmony (×1: smooth transitions, each manoeuvre finished before the next), creativity (×1: new
  combinations; repeats and one pirouette rate everywhere are marked down), precision (×3) and safe presentation
  (×1: risky flying is never rewarded as difficulty). A table rates difficulty from 3 (loop, roll) through 6-10 (tic-toc,
  funnel) to 16-20 (manoeuvres with reversals built in).

**Automatic aerobatic judging already exists: PyFlightCoach / FCScore** (Thomas David and others, University of
Bristol; paper: "Enabling the Automated Assessment of Precision Aerobatic Manoeuvres", AIAA SciTech 2022,
doi 10.2514/6.2022-1287; I read the abstract, the project README and its process docs, not the paper itself).
- A manoeuvre is a chain of "principal elements": line (with or without a roll), loop, snap, spin, stall turn.
- Finding where each element starts and ends is "one of the most challenging tasks", though easy for a human. It
  aligns the flight to a computer-made template with dynamic time warping (DTW), twice (the second time with the roll
  directions, loop sizes and speeds measured from the first pass), then nudges each split point to give the lowest
  total downgrade.
- Each element's downgrade: take a measurement at every sample (for a loop, the radius at each instant), weight it
  by how visible it is to the judge, pick the part that counts, find the points to mark down (peaks, the last value,
  the spread), then read the deduction off an error-to-downgrade curve. Separate "inter-element" rules check that loops
  in one manoeuvre share a radius and rolls share a rate.
- It stores the flight data, the scores and the split points; when the analysis version changes, it re-runs only the
  split optimisation and re-scores. That is our R5 idea, already working.
- It only scores a *known* sequence (the pilot is flying a published schedule). It does not spot tricks in free flight.
- Licences: its geometry and FlightData packages are LGPL-3.0, Plotting is GPL-3.0, the scoring docs repository states
  none. We would reuse ideas, not code (question 9).

**Recognition research (pointers only, not read in full).** Travert (Embry-Riddle MSc thesis, 2009; abstract read)
recognised Aresti aerobatic figures from simulated IMU data by comparing attitude, accelerations and rates with known
figures; the author says the figure identification needed more testing. Search listings (not read) also show
air-combat manoeuvre segmentation by clustering or neural networks, and skateboard trick classifiers on board-mounted
IMUs; their accuracy figures are left out here because I have not read the papers.

### 4. Recognising tricks from our trace: options

What we have every 1 ms tick (from `S` in `packages/sim-core/src/sim.ts`): position, velocity, attitude quaternion,
body rates, the four motor outputs, the stick channels (`sim.ch`), flight-controller internals, and the events
(arm, contact, crash, respawn). The level's `ContactWorld` can be asked for surfaces near any point (`contacts`), which
gives proximity and gaps. Body axes: x right, y up (thrust), z back; the nose points along -z; world y is up.

| Approach | How | Fits us? |
|---|---|---|
| A. Hand-written rules | Derived signals (rotation about each body axis summed since a start point, turn of the velocity vector, inverted or not, distance to surfaces) feed small state machines: "330° or more of pitch in under 1 s with little roll or yaw = a flip". Tricks are built from these elements. | Yes. Deterministic, cheap, needs no data, and every decision can be explained to the pilot ("exit 18° off heading"). Weak spot: edge cases give false positives or misses, as Liftoff's developers found. |
| B. Template matching (DTW) | Compare the trace with a model trace of each trick, as FCScore does. | Good for *grading* once we know which trick it was, or in a challenge that asks for one trick at one spot. Poor for spotting tricks in a long free flight: a template per trick and variant, run at every moment, and it needs a known order. |
| C. Machine learning | Train a classifier on labelled flights. | Not now. We have no labelled data; its answers can't be explained to the pilot; and the model and its exact arithmetic become part of the score, so it must be bit-identical in every browser (pure JS, fixed operation order, no GPU). |
| D. Rules to recognise, metrics to grade (A + F3A-style grading, B's ideas for splitting) | A finds the trick and the rough start and end; the grader measures it per element and per trick, as F3A and FCScore do. | **Recommended.** |

Two ways to use it: in free flight (spot anything, as Liftoff does), and in challenges ("power loop the crane jib":
the trick and place are known, so recognition is easy and grading is the whole job). The second is easier and
more reliable; the owner's direction asks for the first. Both can share the same grader.

### 5. Tricks: proposed detection and grading

A proposal for the first set, with thresholds as **[estimate]**s to tune by flying. "Path" = the centre of gravity's
track; "attitude" = where the quad points. F3A grades the path; many FPV tricks are about attitude (flips), so we
use whichever describes the trick. A small set of named elements does most of the work:

- **Rotation**: rotation about one body axis, summed from the body rates since it started (not from Euler angles,
  which break down when the quad is vertical). Half (≈180°) or full (≈360°), with its direction, duration, rate, and
  how much the other two axes moved meanwhile.
- **Path turn**: how far the velocity direction has turned and about which axis; for a loop, the plane it turned in.
- **Held states**: inverted (body up below the horizon), diving (nose and velocity near straight down), hovering or
  stalled (low speed).
- **Place events**: a gap passed, the closest distance to a surface.

| Trick | Recognise (rule) | Grade (each a deduction, F3A-style) |
|---|---|---|
| Flip (front / back) | One full pitch rotation, ≥ 330° in ≤ 1.0 s, roll and yaw each ≤ 45° meanwhile [estimate]. Two in a row = double. | Rate steadiness (spread of pitch rate during the rotation); crisp start and stop; wobble on the other axes (1 point per 15°); exit attitude vs entry; height lost; how much the path wandered sideways (F3N: 1 point per 50 cm). |
| Roll | Same on the roll axis. Barrel roll if the path spirals (path radius above ~1 m [estimate]), axial roll if not. | Same as the flip; for an axial roll the path should stay straight (F3A "constant flight path"). |
| Power loop | The velocity turns ≥ 300° [estimate] about a near-horizontal axis, pitching backwards over the top, and the path comes back near its entry point (within a few metres [estimate]). Around an object: some solid lies inside the loop (checked with `contacts` at a few points inside it). | Fit a circle to the path: the leftover error vs radius (roundness, if the owner wants it, see question 3); flatness (out-of-plane error vs radius); how far the plane leans from vertical (1 point per 15°); exit heading vs entry; exit height vs entry; throttle smoothness (stick changes, not total throttle: a loop needs a pop and a cut); clearance from the object; the gap passed twice (a bonus, as Liftoff's gap modifier). |
| Split-S | A half roll to inverted, then a half loop down: the path heading turns ≈ 180° and height drops. Half loop up with the half roll at the end = Immelmann. | Heading reversal (180° ± error, 1 point per 15°); half roll crisp and complete; half loop round and in one plane; exit level; height lost (less is harder [estimate]). |
| Dive | Held: nose and velocity within 30° of straight down, speed above ~10 m/s, for ≥ 1 s [estimate]. Liftoff scores dives by how long they last. | Straightness of the line; steadiness of the attitude; closeness to a wall or building face (proximity); pull-out height and smoothness. The deeper and closer, the higher the difficulty, but no extra reward for a crash (F3N "safe presentation"). |
| Matty flip | Forward pitch rotation over the top of an object while the path loops back, ending flying backwards (velocity along body +z) under it. | As the power loop, plus how cleanly the backward exit is held. |
| Yaw spin / inverted yaw spin | One or more full yaw rotations while upright (or inverted). | Constant rate; the path does not change during the spin (F3N pirouette rule); height kept. |
| Orbit | The path circles ≥ 360° around a point with a solid near its centre, camera facing the centre. | Radius, height and speed constant; centring of the object in view. |
| Gap | The path passes through a gap marked in the map (an authored rectangle, like a golden prop). Finding gaps from geometry alone is possible but less reliable and slower. | Centring in the gap; speed; a trick flown in the gap (bonus); attitude (knife edge through a narrow one). |
| Rubik's cube, juicy flick, rewinds, Lawn mower... | Built from the elements above once the owner has defined them (questions 2 and 4). Not in the first prototype. | Same element grades plus "same rate for each part". |

**Score shape (proposal).** Each trick: a mark out of 10, starting at 10, minus each deduction (shown to the pilot:
"Power loop 7.5: plane leaned 20° (-1.5), exit 1 m low (-0.5), radius varied (-0.5)"). Points = mark × the trick's
difficulty (F3A's K-factor idea) × a repeat factor (Liftoff, THPS). The flight's score is the sum, or, closer to
F3N's freestyle, a split into difficulty, precision and variety. Flow or combos are a later layer (question 6).

### 6. Determinism and where the code goes

- **Place:** a grader in `apps/fly` (the game), built like the golden-prop `Collector` (`apps/fly/src/collect.ts`):
  hooked to the runner's per-tick `onStep`, reading `sim.s`, `sim.ch`, the sim events and the level's `ContactWorld`.
  It never writes to the sim, so flights stay identical with grading on or off. Note: `onStep` is a single slot that
  the collector already uses, so it needs a small list of listeners.
- **Same score in every browser:** use only `+ - * /`, `Math.sqrt` and sim-core's `dsin`, `dcos`, `datan`, `datan2`,
  `dexp` in grading code, the same rule as `.claude/rules/sim-core.md`. `Math.acos`, `Math.atan2` or `Math.hypot` can
  differ between JavaScript engines, and then a leaderboard score would change with the browser. No wall clock, no
  `Math.random`, no frame-based logic: everything counts ticks.
- **Re-scoring:** stamp every score with a `GRADE_VERSION`; when the method changes, replay the saved stick log
  (`replayLife` in sim-core already does this) and grade again, as FCScore does. **Missing today:** the game keeps a
  flight's input logs only in memory (`Runner.lives()`); they must be saved (sim-core's log format exists) before old
  flights can be re-scored. A replay also needs the same map, traffic and sim-core versions; gaps marked in the map would be versioned by `MAP_VERSION`.
- **Cost [estimate]:** a few dozen sums per tick plus one `contacts` query, with the last few seconds kept in a ring
  buffer. Re-scoring a 60 s flight means replaying 60 000 steps; how long that takes in the browser is not measured.

### 7. Recommended first prototype

1. **Signals and elements:** per-tick derived signals and the four element detectors (rotation, path turn, held
   state, place event), with unit tests on scripted stick inputs (clean and deliberately sloppy versions of each
   trick).
2. **Five tricks:** flip, roll, power loop, split-S, dive (the owner's example, the most common tricks, and each of the
   four element types). Matty flip and yaw spins next.
3. **F3A-style grade** for each, with a deduction table (`1 point per 15°` style) and the reasons shown.
4. **On screen:** the trick name and mark as a short pop-up, and a list at the end of the flight (next to the
   existing flight stats).
5. **Calibration with the owner:** the owner flies each trick several times, good and bad, and says which were good;
   the grades must put them in the same order. Thresholds get tuned until they do.
6. Then: tricks in challenges (a trick at a spot, with a leaderboard per spot) and marked gaps in the map.

**Risks.**
- False positives and misses at the edges of each rule (Liftoff's developers said so in 2017, and a 2022 player report
  found many tricks not registering). Mitigation: few tricks, tests per trick, and show "nearly a power loop: only
  250°" so the pilot knows why.
- Pilots disagree on definitions and on what "good" means (the oblong power loop). A strict geometric grade can mark
  down a stylish line. Mitigation: the owner decides each definition; grade the trick's purpose (back through the gap)
  above pure geometry.
- Tuned on one pilot. Others fly with other rates and styles; a fixed rate threshold may miss slow, smooth flips.
- Farming easy tricks for points; the repeat factor handles the simplest case.
- The camera's uptilt and the FPV view are not in the path. Proximity and keeping an object in view (BMac's
  "proximity flip") need a view test, which is more work.
- Our physics is still being checked (M2), so how easily a trick can be flown may shift, and the grading
  thresholds with it.

### 8. Questions for the owner

1. Free flight or challenges first? Spot tricks anywhere (like Liftoff), or first grade a trick the game asks for at a
   given spot (easier, more reliable), or both?
2. Trick definitions: will you write (or approve) the exact definition of each first trick? For example: does a power
   loop have to go around or through something, and must it come back through the same gap?
3. What makes a power loop good? Round, or Matty Fleischer's view that an oblong loop is sometimes right? Which
   matters most: roundness, flatness, the exit on the entry line and height, staying close to the object, smooth
   throttle?
4. Which tricks do you want first, beyond flip, roll, power loop, split-S and dive? Juicy flick, Rubik's cube, Matty
   flip, inverted yaw spin, orbit? And for juicy flick and Rubik's cube, which version (sources disagree)?
5. Show deductions to the pilot ("-1.5: plane leaned 20°"), or only a mark?
6. Combos and flow: should chaining tricks without a gap or a crash multiply points (THPS, SSX)? Losing a combo on a
   crash would be a crash cost, which you have ruled out for now.
7. Gaps: mark them by hand in the map (named, like the golden props), or try to find them from the geometry?
8. Timed rounds (Liftoff: 60 s, so scores compare) or open free flight with a running total?
9. PyFlightCoach's geometry and data packages are LGPL-3.0 (compatible with our GPL). Reuse ideas only, or is a port
   of their code acceptable later if useful?
10. Should saving flights (input logs) to the browser come before the grader, so that every graded flight can be
    re-scored from the start?

**Owner's answers (2026-10-18, also in `docs/decisions.md`):** 1 challenges first; 2 write the definitions up from
public sources (Tricktionary and the like); 3 research many sources for a consensus on a good power loop; 4 next tricks:
Matty flip, Rubik's cube, yaw spins and orbit; 5 verbose for now, to discuss: the owner's idea is a "trick report" from a
trick log, showing the path flown, a replay from FPV or chase cam, and a ghost of the perfect version(s) as a guide;
6 combos later; 7 gaps marked by hand; 8 retryable challenges with a best score (or star rating) kept in a log and maybe
shown at the spot, the open-world goal being full stars everywhere; 9 porting PyFlightCoach code is allowed (keep its
notices); 10 save flights in the browser first.

### Sources

- Liftoff, Steam announcements, read via the Steam news API (2026-10-18): Milestone 0.11.0 (2017-10-10), 0.11.1,
  0.12.8, 0.12.9, 1.3.6, 1.6.11; https://store.steampowered.com/news/app/410340
- Liftoff Steam threads: "Freestyle Trick list" https://steamcommunity.com/app/410340/discussions/0/1735465524709582104/
  and "Freestyle Time and tracks" https://steamcommunity.com/app/410340/discussions/0/1621724915796540246/
- Uncrashed (1682970), DRL Simulator (641780), TRYP FPV (1881200): Steam store pages and announcements, same API.
- Activision, "Tony Hawk's Pro Skater 1 + 2 Scoring and Combos",
  https://support.activision.com/tony-hawks-pro-skater-1-2/articles/tony-hawks-pro-skater-1-2-scoring-and-combos
- Wikipedia, "SSX (2012 video game)", Gameplay section.
- FAI Sporting Code Section 4, Volume F9 Drone Sport 2026,
  https://www.fai.org/sites/default/files/document/file/SC4_volume_CIAM_F9_Drone_sports_2026.pdf
- FAI Sporting Code Section 4, Volume F3 Aerobatics 2024, Annex 5B,
  https://www.fai.org/sites/default/files/sc4_vol_f3_aerobatics_24.pdf
- FAI Sporting Code Section 4, Volume F3 Helicopters 2026, F3N and Annex 5G,
  https://www.fai.org/sites/default/files/document/file/SC4_volume_CIAM_F3_Helicopters_2026.pdf
- PyFlightCoach: https://github.com/PyFlightCoach/PyFlightCoach and FCScore docs
  https://github.com/PyFlightCoach/FCScoreDocs (process/segmentation, intra, inter, downgrade tables); paper
  doi 10.2514/6.2022-1287 (abstract only).
- MultiGP IO23 Sendit Showdown: https://www.multigp.com/io23/tracks/freestyle-park-track/
- BMac on iFlight, "What is FPV freestyle" (2022-10-19):
  https://www.iflight.com/en-WHAT-IS-FPV-FREESTYLE-AND-HOW-IS-IT-DIFFERENT-THAN-DRONE-RACING-blog1.html
- Rotor Riot, "FPV Freestyle Tricktionary" (2023-01-11): https://rotorriot.com/blogs/tutorials-guides/fpv-freestyle-tricktionary
- WREKD, "A master list of FPV tricks": https://wrekd.com/pages/a-master-list-of-fpv-tricks-and-manuevers-and-how-to-do-them
- Matty Fleischer, "How to Powerloop": https://mattyfleisch.com/how-to-powerloop/
- Travert, "Flight Regime and Maneuver Recognition for Complex Maneuvers", ERAU MSc thesis 2009,
  https://commons.erau.edu/db-theses/200 (abstract only).
- dronesport.fr, "Drone freestyle FPV: guide complet 2026" (claim not supported by the FAI volume above).
