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
- **Before building:** the owner should settle the questions at the end, mainly what a "good" power loop is. The
  pilot Matty Fleischer writes that an oblong power loop is sometimes the right one. (Correction: the first version of
  this note said the Matty flip carries his name. No source said so; it is named after MattyStuntz, see §9.)
- **Follow-up (§9, §10):** exact trick definitions from public sources, and a power-loop consensus from 18 sources.

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

### 9. Trick definitions from public sources (owner: "write them up from public sources")

**What I read (2026-10-18).** In full: Rotor Riot's Tricktionary (§3) and its 15-video "Trick Series" list (support
doc, 2021), with the auto-generated transcripts of 7 of those videos, each taught by a named pilot; ProWhooper's
tricktionary (Tyrantt's Pro Whooper, a whoop freestyle competition with over 80 tricks, points per trick and published
rules); WREKD's list (§3); and transcripts of 25 more tutorials by Joshua Bardwell, Le Drib, Drew (Rotor Riot),
Phantom, Patrick Watkins, VIK FPV, Bacon Ninja, Infinity Loops, MaiOnHigh, TuxedoFPV, FPV Academy (GetFPV) and DRL's
FPV 101.
Transcripts are YouTube's automatic captions: the words are sometimes garbled, the stick movements on screen are not in
them, and five silent text-overlay tutorials (headmazta) had nothing to read. Blogs that read like generated text
(uavmodel.com and similar, with contradictory throttle numbers) are left out. The full list is under Sources.

**General findings.**
- Pilots build tricks from three basics: roll, flip, yaw spin (Rotor Riot Tricktionary; Rotor Riot "Rolls, Flips, and
  Spins", 2016; Charpu: "you can start combining the halves"). Fractions of them (half, full, 540) are the words pilots
  use, so detectors should count rotation in half turns.
- Throttle is what separates tricks that look the same from the stick: a flip or roll with throttle held becomes a
  loop or a barrel roll (Chad and Tommy, Rotor Riot 2016); a power loop with the throttle cut too early becomes a
  "teardrop" that "is not a power loop" (Bardwell 2016). So detectors must look at the path, not just the rotation.
- Camera uptilt changes how a trick looks, not what it is: with uptilt, a plain yaw while flying forward tilts the
  view, so pilots mix roll and yaw to keep a spin flat (Chad and Tommy; Le Drib; Bardwell "10 tricks"). Detectors must
  use the body and path, never the camera view, except where a definition asks for an object to stay in view.
- Names disagree at the edges (below), and in a challenge the game names the trick, so the first detectors only need
  to confirm one named trick at one place (owner: challenges first).

**How to read the detector lines.** All angles are summed from the body rates (`wx`, `wy`, `wz` in sim-core's `S`):
"pitch +360°" means one full turn about the body's right axis, nose forward first. (Check the signs against
`packages/sim-core/src/sim.ts`: Betaflight's pilot convention is pitch + = nose down.) "Path" is the centre of
gravity's track; "heading" is the direction of horizontal velocity. A challenge gives the place: a hand-marked gap
(a rectangle with a "forward" side) or an object's box. Every number marked [estimate] is a starting value to tune by
flying.

| Trick | Sources say | Where they disagree | Chosen definition (why) |
|---|---|---|---|
| **Flip** (front / back) | ProWhooper: "a 360° pitch forward or backward with a consistent motion". Chad and Tommy: done at zero throttle, after a small throttle blip, so the quad stays "within your three-dimensional space"; with throttle held it "almost looks like a loop". Bardwell: stop "with the horizon perfectly level", no overshoot or undershoot. | Snap vs. slow or varied speed (Bardwell prefers "fast slow" flips and calls snaps less interesting; Chad and Tommy show both). | One full turn in pitch at low throttle, the path not looping. Speed is style, so it is not part of the definition. |
| **Roll** (axial / barrel) | ProWhooper: "a 360° roll left or right with a smooth and continuous motion". Rotor Riot Tricktionary: a barrel roll is one where "you use power to actually go spiral". Chad and Tommy: throttle on turns a roll into a barrel roll that loses height. | Whether a barrel roll is a separate trick (Rotor Riot: yes; ProWhooper lists only "roll"). | Two tricks: axial roll (path straight) and barrel roll (path spirals, as F3A's barrel roll). |
| **Power loop** | All 18 sources in §10: under or through an object, pitch back with power, over the top inverted at low throttle, back down and through the same place, same direction. ProWhooper: "fly beneath an object ... until you're fully inverted. Cut the throttle while continuing to pitch back ... pass back under the object". | Whether an object is required (see §10); "power on the whole time" (Bardwell 10 tricks: "some people feel" so; he floats the end). | As ProWhooper and Bardwell L15 ("technically to make it a true power loop you go back through the obstacle"). Open-air loops are a separate, easier challenge. |
| **Split-S** | ProWhooper: fly over an object, 180° roll, dive down its back, pitch back and throttle to level out, pass under it. Rotor Riot Tricktionary: roll 180°, then go back the way you came. Skitzo (Rotor Riot): thrust up, half roll inverted, dive under or between something. Le Drib: half roll then half pitch; also done as a half yaw or a blended "cartwheel". Bardwell (proximity split-S): drop the throttle during the roll so the quad flies "like it's been shot out of a cannon"; exits need not be exactly 180°, a "270" works too. Alias "S-turn" (Rotor Riot support doc). | The order and mix of roll and pitch (Le Drib: "technically" still a split-S when pitched first); exit angle 180° vs any. | Half roll to inverted, then a downward half loop, ending upright with the heading reversed (180° ± 45° [estimate]), through or under the challenge's object. Variants (yaw entry, 270) are later tricks. |
| **Immelmann** | ProWhooper: "begin a Powerloop, but at the peak ... a rapid 180° Roll". Rotor Riot Tricktionary: "you climb, go back, then roll out". Rotor Riot (DJI series): roll out at the top of a power loop. MaiOnHigh calls it a "reversed split-S". | None found. | Half loop up, half roll at the top, ending upright with the heading reversed and higher (F3A's definition too). |
| **Dive** | Rotor Riot Tricktionary: "diving by using a nose down stall". ProWhooper "building dive": climb, preferably 12 m or more, cut throttle, pitch down, pitch back to level near the ground; "the closer you are to an object during the dive, the more visually appealing". Le Drib: split-S into it, nose down along the building face, throttle "all the way down or just very very low", pull out smoothly, not abruptly at the bottom. Drew and Steele: the lens "pointing like straight down" looks good. Bardwell: idle thrust pushes you away from the wall; pitch past vertical to counter it. Liftoff scores dives by how long they last. | Height (ProWhooper's 12 m is a whoop competition's number); how vertical. | A held state: nose and path within 30° of straight down [estimate], throttle near idle, for at least 1.0 s [estimate], ending in a pull-out to level flight without touching the ground. In a challenge: along the marked face. |
| **Matty flip** | Bardwell (Lesson 19): named after a pilot called Matty, one of the few tricks traceable to one person; "fly over an obstacle ... pitch forward and then fly backwards underneath the obstacle", "almost kind of like a backwards or inverse power loop"; off throttle while inverted, then throttle to pull backwards through. MattyStuntz himself (Rotor Riot, 2018) teaches finding the pitch angle that keeps the quad "not going down or up but rather just going in the backward motion". ProWhooper: "a partial front flip over it while attempting to keep the object in your view as you descend ... level out and fly backwards beneath the object". Rotor Riot Tricktionary: same. Alias "Backward Swing" (Rotor Riot support doc); Le Drib's tutorial title calls it a "backwards powerloop". | Keeping the object in view (Bardwell: many pilots don't, as it makes you swing wide); WREKD's one line ("roll backward over an obstacle") does not match the others. | Over the object, forward pitch of 180-300° [estimate] while the path drops behind it, ending nose-up and flying backwards (velocity along the body's back) under or through the object. |
| **Rubik's cube** | Rotor Riot Tricktionary: half flip forward, 360 roll, half flip forward "or some combination". ProWhooper: "a 180° flip, then ... a 360° roll, and ... another 180° flip in the same direction as the first one" (and "Cubik's Rube": 180 roll, 360 flip, 180 roll). Charpu (Rotor Riot): any combination of halves, e.g. half flip, full roll, half flip; it helps if all axes take the same time per turn. VIK FPV: half flip, roll, half flip, front or back "as long as you are consistent". WREKD: "four quick half-rolls and flips". | Strict pattern vs any combination; flip direction. | ProWhooper's pattern: half flip, full roll, half flip in the same pitch direction, quickly linked [estimate: each gap under 0.3 s], ending upright on the entry heading. It is the only exact, checkable version; Cubik's Rube can be a separate trick. |
| **Yaw spin** | ProWhooper: "a continuous 360° Yaw to either the left or right without any interruptions". Chad and Tommy, Bardwell: while flying forward a plain yaw looks wrong (ground, sky, ground); mix roll to keep it flat. Bardwell: drop throttle so you "come out of it ... still going the same direction". | Flat or not (a look, set by camera tilt). | At least 360° of yaw while upright, the path keeping its heading (within 30° [estimate]). Flatness is graded, not required. |
| **Inverted yaw spin** | ProWhooper: "a 180° Pitch/Roll to invert, ... an inverted 360° Yaw spin, and conclude with a Flip/Roll in the same direction". Charpu (Rotor Riot): half loop, 360 yaw spin, another half loop, "keep going forward"; throttle cut; similar rates on all axes help. Patrick Watkins: zero throttle during the yaw; "180 for me is good enough"; best is a quick entry and a slow yaw. Le Drib: "I wouldn't say that there's a right or wrong way" to the flatness. | 180° vs 360° of yaw; how to exit. | ProWhooper's version: half turn to inverted, at least 360° of yaw while inverted at low throttle, half turn back upright. A 180° version could be a separate, easier trick. |
| **Orbit** | ProWhooper: "fly your drone around an object in a circular path while keeping the object centered in your camera view"; "a smooth, consistent circle". Bardwell (orbits "as made famous by Mr. Steele"): "nose in yaw spins"; the nearer the object to the screen's centre, "the more of a sort of a pure yaw spin"; top pilots keep it slightly inside the centre; keep a constant distance and altitude. Rotor Riot Tricktionary: go around a stationary object, "orbiting it 360 degrees". WREKD: "consistent radius and speed". | How centred the object must be. | One full circle (≥ 360°) around the challenge's object with the nose pointing at it (within 30° [estimate]). Radius, height and speed steadiness are graded. Inverted orbits ("trippy spin") are a separate trick. |

**Detector sketches (for the challenge version; thresholds [estimate]).**
- *Flip:* pitch total reaches ±330° within 1.2 s; roll and yaw totals each under 60° meanwhile; throttle stick under
  30 % for most of it; the velocity direction turns less than 90° (else it was a loop). Graded: steady rate, crisp
  start and stop, off-axis wobble, exit attitude level, height lost. Double flip: 690°.
- *Roll:* the same on roll. Axial if the path stays within ~0.5 m of a straight line; barrel if it circles a line.
- *Power loop:* see §10.
- *Split-S:* roll ±180° (± 40°) first, while pitch and yaw stay small; then pitch up through 150-210° until upright;
  height falls; heading changes by 180° ± 45°; in a challenge, the path passes over the object then under or through
  it. *Immelmann:* the reverse order, height rises.
- *Dive:* held state as in the table; graded on straightness, closeness to the marked face, pull-out smoothness.
- *Matty flip:* forward pitch of 180-300° over the object; ends with velocity pointing out of the quad's back (dot
  product of velocity and body back axis > 0.7) and passes under or through the object.
- *Rubik's cube:* pitch 180° (± 40°), then roll 360° (± 60°), then pitch 180° in the same direction, each starting
  within 0.3 s of the last ending; total under 2.5 s; ends upright on the entry heading (± 30°).
- *Yaw spin / inverted yaw spin:* yaw total ≥ 330° while body up stays above (or below) the horizon; for inverted,
  preceded and followed by half turns.
- *Orbit:* the horizontal path turns ≥ 360° around a centre inside the object's box; nose-to-object angle under 30°
  for 80 % of the circle.

### 10. What makes a good power loop: consensus and dissent (owner: "get some kind of consensus")

18 sources: Bardwell (2016 trick tutorial; Lessons 15, 16 and 18 of his 2024 series; "10 tricks", 2019; "more uptilt",
2023); StingersSwarm (Rotor Riot Trick Series, 2016); Drew (Rotor Riot "First Flight to Freestyle", 2021); FPV Academy
(GetFPV, 2023); Phantom (proximity power loops); VIK FPV ("How to fix your power loop"); Bacon Ninja; Infinity Loops;
DRL FPV 101; TuxedoFPV (IGOW 4); Le Drib (blind-gap power loops); Matty Fleischer (§3); ProWhooper (definition and its
"constant loop motion" penalty). Counts below are how many said it, not a vote among all 18 (most only talk about part
of the trick).

**Consensus (no source disagrees):**
1. **Back through the same place, same direction.** "Technically to make it a true power loop you go back through the
   obstacle" (Bardwell L15); "else it is not a true power loop" (Bacon Ninja); "it's not a power loop unless you power
   loop around something" (Drew, Rotor Riot); also ProWhooper, DRL, Fleischer, FPV Academy ("the end point is the same
   as the start point"). Open-air loops are taught as practice (Bardwell, Infinity Loops, Drew, FPV Academy).
2. **Fling backwards: no teardrop.** Throttle must stay on past vertical so the quad moves backwards over the top;
   cutting it early gives "kind of a teardrop move ... but it's not a power loop" (Bardwell 2016; also Bardwell L15,
   "10 tricks"; Infinity Loops; Drew: "you power up and then you flip out of it").
3. **Steady rotation.** Hold the pitch stick still; "a good loop has a consistent rotational speed" (Drew); "ideally
   your pitch stick will be at the same position through the whole move" (Bardwell 2016); "constant down on the pitch"
   (StingersSwarm). ProWhooper takes 35 % off for "breaking constant loop motion". Same as F3A's "no segments" rule.
4. **Throttle: on climbing, near idle inverted, bled back on smoothly.** Cut around the top: when the horizon appears
   (FPV Academy), when the object leaves the view (StingersSwarm), around 12 to 1 o'clock (Bardwell). "You don't really
   want to chop throttle ... you want to bleed off the throttle" and an abrupt catch makes the quad wobble (Drew);
   "a smooth onset of throttle during the catch giving the impression of one seamless flow" (FPV Academy). Full
   throttle all the way sends you "really really high or really far back" (StingersSwarm).
5. **Tight to the object.** "Really good power loops are nice and tight to the obstacle" (Bardwell L15); huge loops
   "to the moon" look like a beginner's (Bardwell L15, L18); also VIK, Phantom ("staying really close to my target"),
   DRL ("as close to your obstacle as possible throughout the maneuver").
6. **On axis.** Approach level and straight, no roll or yaw in the loop; a crooked entry makes it "spiral" or
   "corkscrew" out of line (Bardwell L18; Drew; FPV Academy; StingersSwarm: "a little bit off axis").
7. **Exit at the entry height, on the entry line.** "You should ideally exit these loops at the same altitude that you
   enter them" (Bardwell 2016, again in L18); FPV Academy.

**Dissent and open points:**
- **Round or not.** Most treat a round loop as the goal ("try and make it a perfect round power loop", Bardwell L18;
  "nice smooth circles", L15; StingersSwarm: "the loop looked perfect"). Dissent: a harder pop gives an oblong loop that
  clears tall objects with less run-up (Fleischer); climbing a wall makes "a stretchy oval" or a near "square" on
  purpose (Bardwell L16); a quicker pitch at the top is fine "if that's what you want ... being intentional with it and
  not doing that because you're panicking" (Drew). **Reading:** the shape should fit the object: round in the open or
  around a compact object, stretched along a tall one. Steady rotation (point 3) and tightness (point 5) capture what
  all of them want; geometric roundness alone does not.
- **Keeping the object in view.** StingersSwarm, Bardwell L15 and Fleischer want it in view all the way round; it
  depends on camera uptilt (Bardwell 2023: 45° makes it much easier than 25°; Bacon Ninja flies 15° and warns not to set
  uptilt for one trick). Grading "in view" would favour high uptilt.
- **Throttle at the top.** A full-throttle blip at the apex to clear a deep object (StingersSwarm; Infinity Loops: "a
  little bit more of a flick" for a wide one) vs. low throttle from the horizon on (FPV Academy); both fit point 4, as
  the size of the object sets the pop.
- **Wind.** Bacon Ninja's loops were pushed off by 20-40 mph gusts; real pilots correct for it. Our sim has wind.

**Proposed power-loop grade (challenge with a marked gap or object; numbers [estimate]).**
- *Must (else "not a power loop", with the reason shown):* passes the gap forward, then back through it forward again
  within 8 s; backward speed of at least 1 m/s at some point while inverted (no teardrop); total pitch 300-420°, with
  roll and yaw totals under 60°.
- *Graded, F3A-style from 10:* rotation steadiness (spread of pitch rate after the entry; a pause in rotation counts as
  "broken loop motion", -2); tightness (largest distance from the object's box, against a par set per challenge); on
  axis (lean of the loop's plane, 1 point per 15°); exit height vs entry (0.5 per 1 m [estimate]); exit heading vs entry
  (1 point per 15°); throttle smoothness (stick rate of change during the catch, against a par); roundness counted only
  in open-air challenges.
- *Ghost of the perfect version* (owner's idea): the par values come from a reference flight per challenge (the
  owner's own best, or a computed path); that same flight is the ghost.

**Questions for the owner (from §9 and §10).**
1. Power loop shape: grade steady rotation and tightness (the consensus), with roundness only in open-air challenges?
   Or roundness everywhere?
2. Should "keeping the object in view" count? It rewards high camera uptilt.
3. Rubik's cube: only ProWhooper's exact pattern (half flip, full roll, half flip, same direction), or any mix of
   halves (Charpu)?
4. Inverted yaw spin: 360° only, or also an easier 180° version?
5. Orbit: one full circle enough? How centred must the object be?
6. Split-S exits: exactly reversed (180°) only, or also 270° and other turns as named variants?
7. Wind in challenges: off, fixed per challenge, or the world's wind?
8. Point values: ProWhooper gives each trick base points (flip 50, power loop 200, Rubik's cube 325, inverted yaw spin
   400, outdoors). Use these as a starting difficulty scale for the stars, or set our own?

**Owner's answers to §9-10 (2026-10-18, also in `docs/decisions.md`):** 1 steady rotation and tightness everywhere,
roundness only in open-air challenges; 2 keeping the object in view does not count (path only); 3 Rubik's cube is
ProWhooper's exact pattern; 4 inverted yaw spin 360, plus a separate 180 version; 5 orbit: one circle, nose within 30°,
tighter centring scores better; 6 split-S 180° ± 45° now, variants later; 7 challenges fly in the world's wind (so wind
is part of every attempt: a par should allow for it); 8 start from ProWhooper's base points.

### 11. Grader prototype v1 (2026-10-18): built

**Asked:** "Let's continue" after the replay viewer (owner): the next step in HANDOFF was the grader. It is §7 steps
1-4 for the first five tricks (flip, roll, power loop, split-S, dive). Challenges are not built: they need spots in the
map and answers from the owner first. Until then the grader runs on a saved flight while the replay viewer prepares it
(the owner's "trick report" idea), so every mark comes from the stick log and can be re-made when the method changes.

**How it works** (`apps/fly/src/grade.ts`, `GRADE_VERSION` 1; every threshold is an [estimate] in one table at the top).
- `Grader.step(tick, s, ch)` after every 1 ms step keeps a 12 s history: position, velocity, body up and back, the
  pilot-axis rates, the rotation summed from them, the throttle stick, and touches. It only reads; `touch(hit)` takes
  sim contact events (a bounce is a hit), `crash()` and a jump in ticks (a new life) reset it.
- **Episodes:** turning faster than 200°/s starts one; it ends after 300 ms under 45°/s (a power loop floats slowly
  over the top; §9's 90°/s split loops in two). Longer than 8 s is ordinary flying and is dropped.
- **Which trick:** the axis with the most summed rotation. Pitch: under 240° nothing; 240-330° "Nearly a ...";
  roll or yaw swinging over 60° "Mixed rotation". Then the **path turn in the pitch plane** (velocity turn about the
  entry's body right axis, signed, through the exit: a loop's path keeps turning in the catch). Same way as the pitch
  and 270° or more: a loop (backwards = power loop). Under 90°: a flip. A back flip whose path climbed to 60°+ having
  gained 30°+ in it: "Nearly a power loop", and "teardrop" when it never moved backwards over the top. Where the path
  reverses through a stop (straight up then down) the turn takes the pitch's direction, so a teardrop reaches the power
  loop's checks and is turned down there with the reason. Roll: axial or barrel (path more than 1 m off the straight
  line). Split-S: roll 180 ± 40 done (135°) before 60° of pitch, pitch back 180 ± 60, heading reversed 180 ± 45, lower.
  Dive: held state (nose and path within 30° of straight down, 5 m/s or more, 1 s or more), then level within 2.5 s.
- **Power loop musts** (§10): backwards at 1 m/s or more while inverted (else teardrop), and back within 2.5 m of the
  entry point (§5's "a few metres"; tighter once loops go through marked gaps). Something solid within 0.7 x the
  loop's mean radius of its centre (one `contacts` query) makes it "Power loop", else "Power loop (open air)".
- **Marks:** 10 minus deductions, each shown with its reason. Flip / roll: off-axis wobble and stop error 1 per 15°,
  rate spread over 15 % 1 per 10 % (at most 3), path sideways (flip) or off its line (axial roll) 1 per 0.5 m. Power
  loop: a pause in the rotation -2 (ProWhooper), rate spread, plane lean and roll / yaw 1 per 15°, exit height 0.5 per
  m, exit heading 1 per 15°, throttle jumping more than 50 % in 100 ms in the catch -1, roundness 1 per 10 % of radius
  spread in open-air loops only (owner). Split-S: heading error, half roll error, yaw, exit off level, 1 per 15° each.
  Dive: nose wander 1 per 5° rms, throttle above 25 % for over a fifth of it -1, path off a line 1 per 0.5 m. A brush
  -2; a hit voids the trick ("hit something during it"). Tightness to the object is shown as a fact (loop height), not
  graded: it needs a par per challenge (§10). No points or stars yet: they belong to challenges.
- **Where it shows:** `buildTrack` (replay.ts) grades while it flies the flight again, so `Track.tricks` exists for
  every saved flight; the replay viewer lists them (time, name, mark, each deduction, the facts; the one at the
  playhead is outlined; a click jumps to it; Hide folds the list) and puts a green mark on the timeline per trick.
  `?demo=tricks` flies a back flip and a roll every 6 s (open-loop sticks; on the map it can hit things).

**Evidence.** `apps/fly/test/grade.test.ts` (10 tests): a scripted pilot flies the real sim (Nazgul 6S, acro, open
air). Marks it gave (v1): back flip 9.0, the same with roll and yaw stick mixed in 8.0 ("roll wobble 9°, yaw wobble
7°"); front flip 8.8 (released at 330°: "under-rotated"); roll right 6.8, barrel roll right 6.6; power loop in the open
air 6.0 ("not round, radius varied 25 %"), the same flight with a ball at the loop's centre "Power loop" 8.5;
climbing back flip with the throttle cut at 90° "Nearly a power loop: teardrop"; split-S 9.4 (wide pull) and 8.8
(tight pull, heading 167°); dive 9.4, with the sticks wobbling 9.1; a 0.8 s dive and 12 s of forward flight with yaw
turns give nothing; a brush costs exactly 2, a hit voids. `apps/fly/test/replay.test.ts`: an 8 s flight on the real
map graded live and graded again in `buildTrack` gives identical tricks (a back flip and a roll), each on the timeline.
`pnpm test` 54 files, 475 tests. Built-in browser (dev server, `?demo=tricks`): the viewer listed "Between a flip and a
loop (path turned 163°)" and "Roll right: hit something" for a demo flight that clipped a building, "replay matches
the flight", no console errors.

**Left open.**
- Calibration (§7 step 5): the owner flies each trick, good and bad, and says which were better; thresholds move until
  the marks agree. None of the numbers above has met a real pilot yet.
- Carving flight that keeps turning faster than 45°/s for over 8 s hides any trick inside it (the episode is dropped).
- Matty flip, Rubik's cube, yaw spins, inverted yaw spin, orbit, Immelmann (owner's next list): not yet.
- Challenges: spots, pars, a best score and stars per challenge, the "trick report" ghost: not yet; questions for the
  owner first.

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

Added for §9-§10 (read 2026-10-18; videos read as YouTube's automatic captions, https://www.youtube.com/watch?v=ID):
- ProWhooper (Tyrantt's Pro Whooper) tricktionary, trick pages (flip, roll, double flip, powerloop, maverick loop,
  power flip, power roll, split S, Immelmann, building dive, Matty flip, half / beginner / anti / power Matty,
  Rubik's cube, Cubik's Rube, yaw spin, inverted yaw spin, orbits, trippy spin, segmented flips, juicy flick) and
  "Complete Rules Overview": https://prowhooper.com/tricktionary/ , https://prowhooper.com/rules-overview/
- Rotor Riot support doc "How do I do freestyle tricks?" (2021-10-26), the Trick Series list:
  https://rotorriotsupport.helpscoutdocs.com/article/35-how-do-i-do-freestyle-tricks
- IntoFPV thread "Freestyle Tricktionary" (2023-12), pointing to ProWhooper: https://intofpv.com/archive/index.php/thread-25017.html
- Rotor Riot Trick Series: Rolls, Flips, and Spins with Chad and Tommy (2016-07-11, EbAwSQF0Ks0); Split-S with Skitzo
  (2016-12-04, t561TF9s9xk); Power Loops with StingersSwarm (2016-12-06, LSwz3F2pjYg); Inverted Yaw-Spins with Charpu
  (2016-12-19, jnj2Rggr55s); Rubiks Cube with Charpu (2016-12-26, xvRKoKHmkNE); Dives with Drew and Steele (2017-07-17,
  YIq5tXVm8Mk); Mattyflip with MattyStuntz (2018-01-28, Twcj_8k_-vk). Orbits with Mr Steele (-7xgB99JLJo) had no
  captions. Also Rotor Riot "How to POWER LOOP A Freestyle Drone" (Drew, 2021-06-07, SeAoaiZY98w).
- Joshua Bardwell: How To Do Power Loops (2016-03-11, T1vzjPa5260); How To Do A Proximity Split S (2016-01-15,
  CyhEUMpFoyA); How To Do FPV Orbits (2016-09-27, qycbKimdr_I); How To 10 FPV Freestyle Tricks (2019-07-11,
  0EqJ9C8KuTQ); The secret to great power loops is more uptilt (2023-01-06, tyQcyXJMWpY); Learn to Fly Lessons 15
  (2024-01-26, j-fJIPVe3fs), 16 (2024-01-30, ziNq8F1xbeY), 18 (2024-04-04, Sryd8oZIo4s), 19 Matty Flip (2024-04-05,
  v25IwLExF80); Tips for Diving (livestream clip, 2022-05-30, LyaR1eYkNfY).
- Le Drib: how to Split S (2018-09-27, 7U39hW0I4Ak); how to BUILDING DIVE (2018-02-18, 9YH1GzPw01Y); how to INVERTED
  YAW SPIN (2017-11-15, UwE4qKzrIbU); how to POWER LOOP BLIND GAPS (2018-03-21, KjoS6SjFBwc); "how to MATTYFLIP
  (backwards powerloop)" (2017-02-08, 625wUUsPqwk; title only, no captions).
- FPV Academy / GetFPV, How To Powerloop an FPV Drone (2023-08-22, LTl0780qgCE); Phantom, Proximity Power Loops
  (2021-02-25, zfhcBwVs_gE); VIK FPV, How to FIX your POWER LOOP (2020-11-16, s_ydaptn6no) and How to FIX your RUBIKS
  CUBE (2021-01-07, Iuv5nluun0E); Bacon Ninja FPV, Power loops for FPV newbs (2022-12-31, JpMY2OgyywU); Infinity Loops,
  How Do You Powerloop? (2021-02-03, 5OOE8PTAHNs); Drone Racing League, FPV 101 Learning Power Loops (2022-12-16,
  qrKuIGemAsM); TuxedoFPV, Powerloop indoors (2023-05-09, xzxyEjIe-2g); Patrick Watkins, INVERTED YAW SPIN (2021-04-29,
  02x7HyC2U1E); MaiOnHigh, Reversed Split-S (Immelmann) (2024-05-04, CbH-XDqKtPg).
