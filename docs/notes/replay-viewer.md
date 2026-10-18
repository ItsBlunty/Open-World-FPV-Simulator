# Replay viewer

Work notes. Read only when working in this area; `HANDOFF.md` has the current state.

## 0u. Replay viewer (owner, 2026-10-18): built

**Asked:** the next step toward the owner's trick report (`docs/decisions.md`): watch a saved flight, draw its path,
play it from the FPV or chase camera. The owner's answers (2026-10-18): all four cameras (FPV with the pilot's lens,
chase, free, a fixed spotter); the path switchable (off / trail / whole flight), whole flight by default; a stick
overlay, speed / height / throttle, timeline marks for crashes, respawns and golden props; play / pause, scrub bar,
speeds 0.1x to 2x; radio control as an option that starts off.

**How it works.**
- `apps/fly/src/replay.ts` (no DOM): `buildTrack` flies the flight again life by life from its records (sim-core
  `LifePlayer`, the same as `checkFlight`) and keeps a pose every 2 ticks (500 a second, Float32: position, rotation,
  velocity, the four sticks, armed, crashed; about 1.3 MB a minute). Each life's hash is checked on the way, so the
  viewer says "replay matches the flight" or not. Marks: each life's start (with its respawn reason), each `crash`
  event, each golden prop. `poseAt` interpolates (rotation along the shorter way) and never across a respawn's jump
  (> 5 m). `pathSegments` makes the path line, cut at every jump.
- The track is built in the check worker (`check-worker.ts`, `want: 'track'`, with progress) and sent to the engine.
  The engine (`replay` / `replay-ctl` / `replay-exit` messages) plays it while the sim stays paused: the playhead is
  page time x speed, so scrubbing costs nothing and no sim steps. Traffic is rebuilt from each life's toggles and moved
  by the playhead's tick (it is a function of the tick alone); golden props show as they were at the playhead (taken
  on an earlier visit: hidden; taken in this flight: there until the playhead reaches them, then they pop).
- `render/replay-view.ts`: the path line (colour by speed, blue hovering to red at 30 m/s; trail = last 3 s) and the
  spotter. The spotter stands 8 m behind the quad (along its heading) at 1.7 m above what is under that spot; chosen
  from the free camera, it stands exactly where the free camera was (a roof, a balcony). FPV and free use the lens;
  chase and spotter are flat.
- `ui/replay-ui.ts`: the screen. Keys: Space play / pause, arrows 5 s, C next camera, Esc back to Saved flights; in
  the free camera WASD / Space / E / Q / Shift fly it and a click captures the mouse. A mark jumps to 1 s before it.
- Radio control (`RadioReplayControl`, off by default, only with a set-up radio): roll past half way winds the replay
  (0.5 to 8 s a second, right forward, left back); pitch past 80 % either way plays or pauses once, and counts again
  only after the stick came back under 30 %. Throttle and yaw do nothing. While the viewer is open the sticks fly
  nothing.

**Evidence:** `apps/fly/test/replay.test.ts` (9 tests): a 12 s flight with traffic, a settings change and a respawn
gives a track with exactly the live flight's poses (as float32) at every checked tick, a mark per respawn and the
prop, no path segment across a jump; a changed stick record makes the track say "differs"; the radio control ignores
jitter up to half way and toggles once per push. `pnpm test` 53 files, 463 tests. In the built-in browser (Chrome, dev
server, `?demo`): a 16.5 s flight watched, "replay matches the flight", FPV / chase / spotter / free cameras, trail,
pause, arrow-key seek and C cycle checked; Esc back left the sim at its tick (16509), no console errors. An older
19.4 s flight showed its two respawn marks.

**Left open:** the trail does not fade; the path is a 1 px line (WebGPU lines have no width). The free camera's speed
follows the frame time (it is clamped at 0.1 s a frame, so a slow frame rate moves it slower). Radio control not yet
tried with a real radio. No crash marks seen in the browser (damage is off by default, so the sim reports no crashes).

**Later (2026-10-18):** the owner looked at it: "looks good for now", radio controls to be tried later. The viewer now
also lists the grader's tricks (`freestyle-grading.md` §11).
