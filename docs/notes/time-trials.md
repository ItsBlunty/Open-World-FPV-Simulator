# Time trials: courses through the map, the race, the times

Work notes for the time trials. Read only when working in this area; `HANDOFF.md` has the current state.

## 1h. Time trials (owner, 2026-10-19): map v12, built, waiting for the owner to fly

**Asked:** time trials built into the landscape, with gates the pilot flies through (windows, open areas by a wall,
and so on), the gates in an area linked into a course. Each has a checkerboard flag and a platform: land on it, stay 3 s
without flying away (the platform slowly glowing brighter) and a popup asks whether to race. The popup takes the drone's
controls; confirm is yaw right + roll left, exit yaw left + roll right, each held 1 s with a circle filling over the
choice. Accept: the quad goes onto the platform under the checkerboard gate, 3 2 1 GO!, control during the countdown
but leaving before GO is a false start and a reset. The checkerboard gate is the last gate and ends it. Then the time,
saved, compared with the old one, and every time trial logged in a "Time Trials" section like the collection. Decline:
back to flying as if the menu was closed.

**Courses (`packages/maps/src/trials.ts`).** Three, one per area, hand-placed from the layout's own numbers (each
course's comment gives them). A gate is a rectangle (centre, a unit normal, half width and height): the quad's centre
must pass through it, either way. Its across axis is level; a flat gate (a hole in a floor, a gap between wires) lies
along x and z. Gates are metadata (`Level.trials`): not solid, not in the collision hash.
- **Park loop** (6 gates, easy): under the bar of the post gate; up between the power line's wires (1.5 m apart, at
  mid-span); past the fountain inside its rim; under the gazebo roof between its west posts; skim the pond under 1.6 m;
  back through the arch. Pad at (68, 48).
- **Bando line** (8): in at a first-floor window on the south side; out at a first-floor window on the north side; in
  at the ground-floor window by the shaft; up the lift shaft and out at the roof; between the water tank's legs; into
  the loading dock between its posts; out of its open east end; back through the arch. Pad at (-242, 36), on the
  bando's forecourt slabs. The windows are the map's own Rng(2) picks: the test checks they are framed openings.
- **Grain plant run** (8, hard): under the gantry; under the four hopper bins on legs, in at the south end and out at
  the north; into the conveyor gallery at its foot and up to the headhouse (the gallery is an open truss: its sides
  are open between the diagonals, so a pilot can leave and re-enter it); out of the headhouse's south side; through the
  open shed out of its west end; back through the arch. Pad at (-285, 348).

**Start arch (solid, map v12).** Per course: a 2.4 m square pad, 0.2 m high; two posts 5.2 m apart with a banner from
3.5 to 4.2 m over the pad; a 6.5 m pole 4 m beside the arch with a 1.5 x 1 m flag [all estimates, about a quad race's
start gantry]. Its opening over the pad is the course's last gate. Built after everything else with no random choices,
so nothing else moved (+216 triangles).

**The race (`apps/fly/src/trials.ts`, no DOM).** Checked after every 1 ms sim step (the runner's `onStep`, with the
golden props). On a pad: the centre over the pad's top, at most 0.4 m above it, slower than 0.5 m/s. 3000 ticks of that
asks (`ask`). An offered pad must be left before it asks again (so declining and staying put does not nag). Accept: the
session's director is asked for a respawn to the start with the pad's pose (`FlightSession.onPad`), so it is a logged
respawn like R, fresh pack and all; the countdown starts once the quad is on the pose (`ready`), GO 3000 ticks later.
Before GO, the centre 0.6 m sideways or 0.35 m up from the pose is a false start: back on the pad, the countdown again
(a throttle held up false-starts again at once). From GO, each step's segment from the last position is tested against
the next gate only (gates go in order); a move over 1 m in a tick is a respawn and passes nothing. The time is the
tick of the last gate minus GO's, in ms. Crash rewinds during a race keep the clock running. R during a countdown or
race: back on the pad for a new countdown. Pause menu: "Leave time trial". A new start point, flight or traffic
settings leave it too. While the offer is up, and after it until roll and yaw are back within 25 % of centre, the
engine feeds the sim centred sticks with the throttle down (`TrialRunner.filter`): the arm switch passes as it is.

**Determinism.** Everything is on sim ticks from the sim state; what reaches the flight is the respawn onto the pad,
which the runner logs, so replays need none of this code. Test: a race in the real sim, saved with `captureFlight`,
passes `checkFlight` (bit-identical replay), with a false start too; gates placed on the path change nothing (same
hash). The flight and traffic self-test hashes are unchanged.

**Page.** The offer (`ui/trial-prompt.ts`): course, gate count, best time; Race and Not now, each a ring that fills
over 1 s of holding (yaw and roll past 60 % of travel; a hold already on when the offer comes up counts only after the
sticks let go). It names the stick shapes for the pilot's stick mode (modes 1-2: race is both sticks in; 3-4: both
out). Enter and Esc, or a click, answer too. The sim runs under it. HUD: on a pad, "PARK LOOP · stay on the pad" while
the glow grows; countdown 3, 2, 1 big (FALSE START in red), GO! for 0.8 s; while racing, the clock, "GATE n / N" and the
next gate's name at the top. Finish: a card with the time and "First time on this course", "New best, -1.555 s (was
43.870)" or "+0.812 s on your best 42.315", for 7 s. Time Trials screen (title card and pause menu): per course its
area, gates in order, best with its date, last, runs, the ten most recent. Times are kept in this browser
(`localStorage` `owfpv.timeTrials`, by map id, by `course@version`: a course whose gates change starts a new log), with a
Reset that asks twice.

**Drawn (`apps/fly/src/render/trials.ts`).** Checks on both faces of each banner and flag (a 2 x 2 texture repeated,
0.35 m squares on the banner, 0.25 m on the flag). The pad's glow: dim teal always (so pads can be spotted), brightening
with the square of the hold; pulsing during the countdown. During a countdown or race: the next gate's outline in
orange, also drawn faintly through walls so it can be found, and the one after it dim. Not solid, nothing feeds back.

**Evidence:** `pnpm test` 60 files, 533 tests (new: `packages/maps/test/trials.test.ts`: pads rest on the ground with
room above them under the arch, every gate's opening clear for a 0.18 m sphere, the windows and gaps framed within 0.5
m on all four sides, and a grid search (0.3 m cells, weighted A*) finds a way a quad fits from the pad to each gate in
turn and back through the arch; `apps/fly/test/trials.test.ts`: gate crossing, the hold, the offer, decline and leave
first, the countdown and false start, gates in order, a jump passing nothing, R and quit, the stick hold, saved times,
the stick answers, and the real-sim race with its replay check). Typecheck and production build clean. Seen in the
built-in browser (dev server, WebGPU, a simulated radio): the park pad's hint and glow, the offer (the ring filling over
"Not now"), the countdown and false start, the race HUD, all three arches, pads and flags, the next-gate outline at the
post gate, a bando window, the gallery foot and the gantry, the finish card (first time and new best), the Time Trials
screen, and declining with Esc (screenshots in the session's tool results, not saved). Re-pinned: map v12 `e99e66dc…`
(433 278 triangles).

**Left open:** the owner to fly all three (the yard's gallery line is a guess at "hard"; are the park wires too
tight?). A saved flight keeps no race results: the replay viewer does not show gates or splits (the race's respawns are
in it). No split times per gate on the HUD or saved (each gate's time is in the `gate` event). No ghost of the best run.
No minimap or arrow to the pads; the Time Trials screen says where each is only by area.

## 1i. Clearer gates and pad markers (owner, 2026-10-19): built, waiting for the owner to fly

**Asked:** "We need a much clearer/more obvious gate graphic, its hard to tell where to go right now easily. The pad
under the arch is not obvious at all, we should have a floating arrow indicator pointing down and bobbing up and down,
and 3d, saying "Time Trial"."

**Gates (`render/trials.ts`).** The next gate: a frame of 16 cm bars (was 6 cm) pulsing orange to yellow twice a second,
a yellow pane over its opening at 14 % opacity, the frame also drawn at 35 % through walls, and a 3D down arrow (1.8 m,
extruded, its tip 1.2 m over the frame, or 2 m over a flat gate's middle) bobbing 0.3 m every 1.4 s, turned to face the
camera, drawn through walls. The arrow is life size within 15 m and grows with the distance beyond, so it stays the same
size on screen and shows where to go from across the map. The gate after it: a thin dim frame, as before. HUD: the next
gate's name now ends with its distance ("... · 34 m"; the gates' centres come with the course list).

**Pads.** Over each pad an orange 3D arrow (1.5x the gate arrow, 2.7 m) pointing down at it, its tip about 1 m over the
banner, with TIME TRIAL in 3D yellow block letters (0.9 m) over it; both bob and turn to face the camera. Hidden while
its own course is offered or raced, and in the replay viewer. The letters are our own: strokes on a 4 x 6 grid drawn as
bars (only T, I, M, E, R, A, L), so there is no font file to license.

**Evidence:** `pnpm test` 60 files, 533 tests; typecheck and build clean. Seen in the built-in browser (WebGPU): the
bando's first window gate from 40 m and 8 m (frame, pane, arrow, HUD distance), the bando and park pad markers. Not
measured: frame time (a handful of draws).
