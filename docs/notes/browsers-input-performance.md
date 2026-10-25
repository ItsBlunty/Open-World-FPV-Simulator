# Browsers, gamepad input, render worker, stutters (Firefox shelved)

Archived work notes, moved verbatim from HANDOFF.md on 2026-10-18. Read only when working in this area;
`HANDOFF.md` has the current state. Section numbers (§0a ...) are the ones code comments cite.

## 0h. Boxer not seen in Firefox (owner, 2026-10-18): gamepad connect fix, waiting for the owner

**Asked:** "add webserial support so that firefox can use radios", then: "I want to run it in HID/Joystick mode";
in Firefox "Use gamepad" kept saying "move a stick or press a button" and never saw the Boxer (Chrome's WebHID path
works fine).

**Why not Web Serial:** Firefox 151 (desktop) has Web Serial (hacks.mozilla.org, 2026-05), but it opens serial (COM)
ports only. A radio in USB Joystick mode is an HID device, not a serial port. EdgeTX's USB serial (VCP) modes
(`UartModes` in `radio/src/dataconstants.h`, `radio/src/serial.cpp`: telemetry mirror, telemetry, SBUS trainer, Lua,
CLI, GPS, debug, SpaceMouse, external module) send no stick channels to a computer either. Firefox has no WebHID, so
its only path for a joystick-mode radio is the Gamepad API, which the sim already has.

**Cause found in the code:** `connectGamepad` (main.ts) waited only for the `gamepadconnected` event. A browser fires
it once per page, the first time the pad is touched. A stick moved before "Use gamepad" was clicked used up the
event, so the menu waited forever. The poll loop already found the pad in `navigator.getGamepads()` but never said so.

**Built:** `devices/gamepad.ts` (upstream change 5 in `apps/fly/UPSTREAM.md`): a pad the poll finds is adopted and
announced like the event's; each source announces one pad once (a second pad no longer re-runs `useDevice`).
`main.ts`: with no Gamepad API at all (page not on localhost/https) the menu says so instead of waiting.

**Evidence:** `apps/fly/test/gamepad-connect.test.ts` (fake `getGamepads`): the old code fails 2 of 3 (pad present
before start never announced; a second pad announced), the new code passes 3 of 3. Full suite: 45 files, 413 tests
pass; `pnpm --filter @owfpv/fly typecheck` clean.

**Left open:** not tried on hardware, and Claude has no way to drive Firefox here. If the owner still sees nothing
after moving a stick, Firefox itself does not list the Boxer: next step is to see whether a gamepad tester page in
Firefox shows it (not yet researched why Firefox would miss it).
Firefox's input rate and stamps for this pad are not measured yet.

**Frame rate (owner, 2026-10-18):** with the Boxer as a gamepad Firefox showed ~200 Hz and fell to 24 fps; without
the radio it held 120 fps; Chrome with WebHID was fine. Cause, reproduced without a radio: upstream polled with a
MessageChannel loop that re-posts itself ~280 000 times a second, and Firefox 158 runs those messages ahead of its
frames (120 -> 25 fps with 6 ms of frame work); `getGamepads()` itself costs nothing measurable. Chrome 155 keeps 119.
Without a radio the loop never ran, which is why only the radio made it slow. Measured alternatives
(`docs/evidence/2026-10-18-gamepad-clock/results.md`): `scheduler.postTask` starves the same way; `setTimeout` and
`requestIdleCallback` hold 120 fps but poll only 105-120 Hz; a worker timer posting to the page every 1 ms holds
120 fps and polls ~140 Hz (Firefox clamps worker timers to ~4 ms); a worker busy loop polls ~205 Hz but keeps a CPU
core at 100 %. **Chosen: the worker timer** (`startClock` in `devices/gamepad.ts`, UPSTREAM change 6), one path for
every browser. Chrome gamepads (not the Boxer, which uses WebHID there) drop from ~220 to ~130 polls/s at that
load. Each new sample keeps its `Gamepad.timestamp`, so timing stays right; only some in-between samples are missed.
Evidence: full suite 45 files, 413 tests pass; typecheck clean; `pnpm --filter @owfpv/fly build` bundles the worker.
The owner flew it: frame rate held, "sticks feel okay", HUD ~140 Hz. The owner asked why a 1 ms clock is not 1000 Hz
and rejected tying input to the frame rate; Claude read Firefox's source (mozilla-firefox/firefox `main`, 2026-10-18):
- `dom/gamepad/windows/WindowsGamepad.cpp`: the "Gamepad" thread drains raw-input (WM_INPUT) reports only on a 4 ms
  one-shot timer (`kWindowsGamepadPollInterval = 4`, "250 Hz, is consistent with Chrome's gamepad implementation"),
  sending one event per changed axis/button.
- `ipc/GamepadEventChannelChild.cpp`: in the page's process every update is `NS_DispatchToMainThread`'d; the value in
  `getGamepads()` changes only when that main-thread task runs.
- `Gamepad.cpp`: `UpdateTimestamp()` sets `Gamepad.timestamp` to `performance.now()` when that task runs.
**So in Firefox:** updates that arrive while the main thread draws wait and are applied back to back after the
frame; only the last is ever visible, whatever the poll rate. The busy worker would NOT reach ~200 Hz while
flying (its 205 was polls in the probe with no pad; the owner's earlier ~200 was read while frames were starved to
24 fps, i.e. a mostly idle main thread). And **`gamepad.ts`'s stamp comment is wrong for Firefox**: the timestamp is
the main-thread apply time, up to a frame (~8 ms at 120 fps) late, not the gamepad thread's sample time.
**Proposed (asked the owner, not started):** move the renderer and the sim off the main thread (OffscreenCanvas in a
worker) so the main thread only takes gamepad updates as they arrive (~200-250 Hz, stamps a few ms late, independent
of the scene). Needs research first: Three.js WebGPU renderer in a worker in Firefox and Chrome.
The Boxer's real report rate: **500 Hz** (Chrome WebHID HUD, owner). Owner: "Yes, do this and report back with a
plan"; keep the worker timer until then.

**Render worker plan (researched 2026-10-18, not started; waiting for the owner's go):**
- Support (MDN browser-compat-data, read 2026-10-18): `requestAnimationFrame` in dedicated workers Chrome 69 /
  Firefox 99; `transferControlToOffscreen` + OffscreenCanvas Chrome 69 / Firefox 105; WebGPU in workers Chrome 113 /
  Firefox 141 (Windows only; Firefox macOS Apple silicon 145+, no Linux); WebGL 2 on OffscreenCanvas Chrome 69 /
  Firefox 105; WebHID in dedicated workers Chrome 131, not Firefox. `localStorage` is not in workers.
- Three.js r186 source: `Animation` calls `self.requestAnimationFrame`; backends accept an OffscreenCanvas and skip
  `setAttribute`; `CanvasTarget.setSize(w, h, false)` skips `style`. Our render code uses no DOM (only freecam's
  pointer lock and key/mouse listeners, which stay on the page).
- Spike (`docs/evidence/2026-10-18-render-worker/`, headless Firefox 158): Three.js renders from a worker at
  116-119 fps (WebGL 2: headless has no WebGPU adapter; `navigator.gpu` exists in the worker). With drawing off the
  page, the 1 ms worker clock reaches the page 248 times/s (Firefox's 4 ms timer floor; was ~140 while the page drew).
  Four staggered 1 ms intervals give 1002 ticks/s but fire in bunches (median gap 0 ms, p95 5 ms): no gain.
- Design: the page keeps the DOM (menu, settings + localStorage, Radio setup, HUD) and all input (Gamepad poll,
  WebHID, keys, mouse, pointer lock) and maps raw frames with the profile as now; it posts each mapped frame with its
  stamp shifted by `performance.timeOrigin` (page) - `timeOrigin` (worker). The worker owns FlightSession (sim-core,
  SimClock, traffic), the Three.js scene, views and the frame loop, and posts a small HUD snapshot back each frame.
  Same engine module runs on the page through the same message interface when a worker canvas is not available
  (and `?render=main` forces it, for A/B). sim-core is untouched; the determinism self-test must still match.
- Expected: Firefox gamepad ~200-250 new values/s (cap: Firefox's 4 ms drain; Boxer 500 Hz), stamps a few ms late
  instead of up to a frame, independent of the scene. Chrome WebHID stays 500 Hz (later option: open HID in the
  worker, Chrome 131+).
- Built: §0i. Claude in Chrome cannot drive Firefox: the probe ran in
throwaway Firefox windows, which pop up on the owner's screen (ask first, see memory).

## 0i. Render worker and a faster gamepad clock (owner, 2026-10-18): flown; engine stays on the page

**Asked:** the owner approved the plan (§0h): "1. yes [open browser windows] 2. yes [keep a fallback]". The Boxer's
real rate is 500 Hz (Chrome WebHID).

**Built (commit `fd5090b`):**
- `engine/engine.ts`: the flight session, Three.js scene, views, traffic view, free-fly camera motion and the frame
  loop, talking only through messages (`engine/protocol.ts`). `engine/worker.ts` runs it in a module worker on the
  page's canvas (`transferControlToOffscreen`). `main.ts` is now the page: menus, settings (localStorage), Radio
  setup, HUD, all input; it maps radio frames with the profile and posts them with their page time.
- Clocks: `engine/radio-link.ts` shifts page time to the worker's (`performance.timeOrigin` difference) and keeps
  the stale-radio disarm (150 ms) on the engine's clock. Messages sent while the engine starts are queued, then handled.
- Fallback: no worker canvas, a worker that fails before 'ready', or `?render=main` -> the same engine on the page
  through a MessageChannel (lazy-loaded chunk). The menu's last line says "in a worker" / "on the page".
- HUD: the engine posts a snapshot 30 times a second (`HUD_HZ`); `Hud.update` takes a `HudSim` (a Sim fits it).
- Free-fly camera: `render/freecam.ts` has no DOM; the page captures the mouse and sends held keys and mouse movement.
- Gamepad clock (`devices/gamepad.ts`, UPSTREAM change 7): each 1 ms timeout is set from a message task, so the HTML
  timer-nesting clamp (4 ms) never applies: ~665 ticks/s in Firefox, ~544 in Chrome, gaps 1-2 ms, no spinning.
- Console: `__fly.engine` (backend and where), `__fly.ask(code)` runs code in the engine with `fly` in scope.

**Why the clock mattered more than the worker on this machine:** with the engine on the page, worker-clock ticks
still reached the page ~230 times/s with p95 lateness 3-4 ms, so drawing alone did not explain the owner's 140 Hz.
An imitation of Firefox's path (updates every 4 ms, page keeps the latest) showed the clamped `setInterval(1)`
catching 84 % of updates and the new clock 99.9-100 %, with the engine in the worker or on the page. The worker
still takes input lateness from p95 4 ms / max 6-8 ms to p95 0-1 ms / max 1-2 ms (Firefox) and keeps it there as
scenes get heavier.

**Evidence** (`docs/evidence/2026-10-18-render-worker/results.md`, production build in windowed browsers via
`drive.mjs`): Firefox 158 and Chrome 155 run WebGPU in the worker at 120 fps, WebGL 2 in the worker at 120 fps,
`?render=main` at 120 fps; `?selftest` MATCH in both (`cd45c59c…`, `80f0c9aa…`); UI (free camera keys and drag,
Esc pause, spawn menu, FOV slider, canvas size) and a simulated radio through `onRaw` (arm with Space, climb at 0.4
throttle, stale disarm) work in both. 46 test files, 417 tests (new: `engine-link.test.ts`); typecheck clean.

**Flown (owner, 2026-10-18):** "in the new version im getting slight stutters every 5 to 10 seconds. Update rate in
firefox shows 225hz, however, now when I do ?render=main, I get 219hz and no stutter. Id prefer to keep it in main".
Chrome: "fine in HID mode either way", gamepad mode 185-191 Hz with the Boxer. **Done:** the default is the engine on
the page; `?render=worker` opts into the worker (main.ts). So the Boxer in Firefox went ~140 -> 219 Hz from the clock
alone. Chrome's gamepad path is capped by Chrome: `device/gamepad/gamepad_provider.cc` (chromium `main`, read
2026-10-18) `kPollingIntervalMilliseconds = 4;  // ~250 Hz`; use WebHID in Chrome.
**Left open (worker):** the stutter's cause is not found (not reproduced by Claude; candidates to measure: garbage
from the 30 Hz HUD snapshots, Firefox's OffscreenCanvas presentation, worker GC). Earlier list, for when the worker
is picked up again: Firefox's real gamepad rate now (expected ~200+ Hz of the Boxer's 500;
Firefox drains raw input every 4 ms, so at most ~250), Chrome WebHID still 500 Hz, and feel in both. Window resize
while running not exercised (the start size is right). CPU cost of the new clock not measured (about 600 tiny tasks/s
on the page and in its worker). WebHID could later be opened inside the engine worker (Chrome 131+).

## 0j. First-turn stutter after a reload (owner, 2026-10-18): warm-up while loading, waiting for the owner

**Asked:** "Is there a way to preload more so we dont get stutters as we turn initially after reloading the page?"

**Cause (Three.js r186 source):** `Renderer.render` builds an object's pipelines and uploads its buffers the first
time it is drawn, and draws only what is in view (`_projectObject` culls to the camera frustum). `compileAsync`
culls the same way, so it would not cover what is behind the spawn view.

**Built:** `engine/engine.ts` `warmUp()`: before 'ready', the engine draws the scene from the spawn with a 90 deg
camera along the six cube faces, the chase-view quad shown, then restores the camera. Rendering only; no sim state.

**Evidence** (`drive.mjs` `SPIN=1`: reload in a fresh profile, "Look around", drag the free camera 360 deg, down
86 deg, up 172 deg, then 360 deg again; rAF frame times; production build, windows):
| Browser | Warm-up | Ready after | First turn: frames > 25 ms, worst | Second turn worst |
|---|---|---|---|---|
| Firefox 158 | no | 1.9-2.1 s | 3, 150-183 ms | 8.3 ms |
| Firefox 158 | yes | 1.9-2.2 s | 0, 17-25 ms (frame 0: the recorder's first frame) | 8.3 ms |
| Chrome 155 | no | 3.7-3.9 s | 3, 133 ms | 8.5 ms |
| Chrome 155 | yes | 4.1-5.3 s | 0, 8.5 ms | 8.5 ms |
46 test files, 417 tests pass; typecheck clean.

**Left open:** not tried by the owner. Turning traffic on in Settings builds new traffic meshes, which probably hitch once
the first time they come into view (not warmed). Other spawn points were not measured (they use the same materials).

## 0k. Firefox microstutters (owner, 2026-10-18): measured; WebGPU garbage; waiting for the owner's test

**Asked:** Chrome "runs great"; Firefox shows 120-121 fps and "some kind of microstutter or frame drop every now and
then. It doesnt really feel like loading". The owner offered claudecodebrowser (localhost:8765) to measure in their
Pages tab; scripts were injected as `<script>` elements (the extension's own scripts cannot see `__fly`).

**Found** (evidence: `docs/evidence/2026-10-18-firefox-stutter/results.md`): Firefox holds 120.0 fps (120-121 on the
HUD is the mean of 1/dt over frames that are 7-10 ms apart) and our work is ~4 ms a frame. The stutters come about
every 25-35 s and line up with Firefox's major garbage collections (TOO_MUCH_MALLOC) and JIT bailout bursts after
them. What fills memory is WebGPU: Firefox's WebGPU calls (180 `writeBuffer`, 113 `setBindGroup` a frame with
shadows; 27 and 54 without) allocate native memory. With WebGL 2 there was no malloc-triggered GC in a minute;
without shadows the GC came after 37 s instead of 25 s and no frame was slow. Messages (radio clock, page<->engine)
made no difference. One flight also had 4 shadow-pass shader builds mid-flight (cause not found; none in a fresh
flight with rebuild tracking, none when sliding the shadow square over the whole level).

**Built:** on the page the page<->engine messages are handed over directly (`engine/protocol.ts` `localPorts`, no
copies) and the HUD reuses one snapshot: overhead removal, measured not to change the GC rhythm. 'ready' waits for
the GPU to finish the warm-up (`onSubmittedWorkDone`), which removed a ~1 s stall when the menu was closed right
after loading (free camera 3.5-5.5 m -> 10.08 m in 1 s of W). `__fly.padClock` reports the gamepad clock.
`scheduler.postTask` as the gamepad clock was tried and rejected (while flying: 230 polls/s, 69 % of updates caught;
the worker clock: 635/s, 100 %). 46 test files, 417 tests; typecheck clean; Firefox and Chrome UI, radio and
self-test checks pass (results.md section 6).

**The owner tried both (2026-10-18):** "webgl2 is not useable for me because everything flashes and looks bad.
Turning off sun shadows on the normal mode seems to stop the stutter. Lets try to fix it based on that". -> §0l.

## 0l. Shadows without the Firefox stutter (owner, 2026-10-18): built, waiting for the owner to fly

**Measured first** (local Firefox 158 window driven by `drive.mjs`, `?demo` 60 s, WebGPU calls counted per frame by
wrapping `GPUDevice`/`GPUQueue`/`GPURenderPassEncoder` methods, `GPU=1`):
| Firefox, flying ?demo | `writeBuffer` / frame | `setBindGroup` / frame |
|---|---|---|
| as it was | 180 | 113 |
| shadow square frozen (`sun.follow` disabled) | 69 | 113 |
| shadow map redrawn every 2nd frame (`shadow.autoUpdate = false`) | 157 | 99 |
| every 4th frame | 146 | 93 |
| shadows off | 27 | 54 |
So redrawing the shadow map less often saves little; the cost is the square **moving**: `Sun.follow` re-centred it
every frame (it moves in 6 cm texels, so in flight almost every frame), and every shadow-receiving object's shadow
data is written again. With the square frozen, a 60 s startup-profiler flight had **0 slow frames** (max 8.3 ms)
although Firefox's major GCs still came at 24.5 s and 58.2 s: the GC alone is not felt, a GC on a write-heavy frame is.

**Built:** `render/shadow-follow.ts` (`shadowNeedsRecentre`, `RECENTRE_M = 16`, `RECENTRE_DEPTH_M = 100`) and
`render/world.ts` `Sun.follow`: the square re-centres only when the camera is 16 m from its centre across the sun's
view (or 100 m along it); still snapped to whole texels, so static shadows land on the same texels after a move. The
shadow map is still drawn every frame (cars and the quad cast live shadows). Rendering only; no sim state.

**Evidence** (`docs/evidence/2026-10-18-firefox-stutter/`): with the fix `writeBuffer` 69 a frame; two 60 s Firefox
flights: 1 slow frame (16.7 ms) and 0 (max 8.3 ms), against 3 before. Chrome screenshot mid-flight
(`shadows-demo.png`): trees and benches cast shadows. Firefox and Chrome: free camera 10.08 m/s, settings, simulated
radio (arm, climb, stale disarm) and `?selftest` MATCH. 47 test files, 420 tests (new: `shadow-follow.test.ts`).

**What it costs (tell the owner, ask to look):** shadows reach at least 104 m round the camera instead of 120 m, and
the far edge of the shadows (104-136 m away; fog from 250 m) jumps once per 16 m of travel.

**Left open:** not flown by the owner. The every-~30 s GC still happens (WebGPU in Firefox allocates per draw:
`setBindGroup` 113 a frame); if a stutter remains, the next levers are fewer shadow casters and fewer draws (merging
traffic parts). Flight 1's 4 mid-flight shadow shader builds (§0k) are unexplained.

**Tools (for the next session; all in `docs/evidence/2026-10-18-firefox-stutter/`):**
- `drive.mjs firefox|chrome <base url> <runs>`: launches a windowed browser with a throwaway profile (Firefox through
  WebDriver BiDi on port 19333, Chrome through CDP on 19334; 9333 is someone else's) and runs checks chosen by env:
  `UI=1`, `RADIO=1`, `SPIN=1`, `FLY=1`, `SWEEP=1`, `CATCH=1`, `GPU=1` (+`GPUVAR=freeze|every2`), `GC=1` (+`NOCLOCK=1`),
  `SHOT=<png>` (Chrome screenshot), `WAIT=<ms>`. Runs: `demo`, `demo-main`, `demo-worker`, `demo-webgl`,
  `demo-noshadows`, `selftest`, `menu`. Serve the build with `vite preview --port 18940` from `apps/fly`, and stop it.
- Firefox GC counts: run with `MOZ_PROFILER_STARTUP=1 MOZ_PROFILER_STARTUP_FILTERS=GeckoMain
  MOZ_PROFILER_STARTUP_FEATURES=nostacksampling MOZ_PROFILER_SHUTDOWN=<file.json>`, then `gcparse.mjs <file.json>`.
- The owner's Firefox profile (shared link -> `https://storage.googleapis.com/profile-store/<hash>`, processed format,
  stacks via `stackTable.prefixOffset`, sources via `sources.filename`): `gc.mjs`, `ticks.mjs`, `cpu.mjs`, `bail.mjs`,
  `mapsamples.mjs` (maps bundle offsets to our source through a `vite build --sourcemap` of the same commit).
- In the owner's tab: the claudecodebrowser extension (localhost:8765) runs scripts in an isolated world; to reach
  `__fly` inject a `<script>` element and pass results back through a hidden DOM element. `__fly.ask(code)` runs code
  in the engine (`fly.renderer`, `fly.session`, `fly.sun`, ...).



## 1d. Shadow distance setting (owner, 2026-10-19): built, waiting for the owner to fly

**Why:** the sun's shadows covered a 240 m square round the camera (§0l), so they ended 104-136 m away and popped in
while the fog only starts at 250 m.

**Built:** Settings > Graphics > Shadow distance (under Sun shadows; hidden in low spec and with shadows off). Three
steps (`render/shadow-follow.ts` `SHADOW_REACHES`): near, the old 240 m square on a 4096 map (5.9 cm texels, the
default); far, a 500 m square on 8192 (6.1 cm, as sharp, shadows to ~234-266 m); farthest, a 1000 m square on 8192
(12 cm, softer close up, to ~484-516 m). Far and farthest use 4x the shadow memory (an 8192² depth map, ~256 MB) and
draw more casters into the shadow map each frame. `Sun.setReach` changes it live: Three.js's shadow node resizes its
map to `mapSize` on its next draw. The map is capped at the GPU's largest texture (WebGPU's default limit is 8192).
The 16 m recentring (§0l) is unchanged. Rendering only; no sim state.

**Evidence** (`docs/evidence/2026-10-19-shadow-distance/`, built-in browser, WebGPU, free camera 60 m up): at near the
farmhouse ~150 m off is unshaded; at far it is shaded; at farthest the far towers' shadows show too. Engine read back
half 250 / map 8192 after picking far in the menu, and the choice was saved. 58 test files, 509 tests (4 new in
`shadow-follow.test.ts`); typecheck clean.

**Left open:** frame time at far and farthest not measured (the pane's fps is not reliable). Cascaded shadow maps
(sharp near, far reach, less memory) would be the better fix but the fisheye lens draws up to five cameras a frame, and
Three.js's cascades fit one camera.

## 1r. The light ring before a shadow starts (owner, 2026-10-19): built, waiting for the owner to look

Cause: the sun's shadow bias (`render/world.ts` Sun) is in the shadow camera's depth, which spans its whole 1199 m
(near 1, far 1200): -0.0002 moved every shadow about 24 cm towards the sun, so the bottom ~19 cm of anything (the sun is
54 deg up) cast no shadow, and a lit strip showed between an object's foot and its shadow. Three.js adds the bias to
the shadow coordinate's z after the divide (three 0.186.1 `src/nodes/lighting/ShadowNode.js`, setupShadowCoord), so it
is a share of that range.

Fix: bias -0.00001 (1.2 cm); the normal bias now follows the texel, 0.7 x texel (`setReach`): 4.1 cm near, 4.3 cm far,
8.5 cm farthest (was 4 cm at every reach).

**Evidence (`docs/evidence/2026-10-19-shadow-ring/`, `probe.mjs`: headless Chrome on WebGPU against the dev server):**
`pole-old.png` (the power-line pole at x -25: a lit gap between its foot and its shadow) and `pole-new.png` (the shadow
starts at the foot). An extreme bias (-0.004) moved the shadow metres off, so the runtime value does reach the shader.
At the farthest reach no acne was seen on facades, roads or the bando's floors (screenshots not kept). Not checked:
the low spec renderer (it has no shadows), Firefox.

## 2j. Ultra graphics preset, shadows to 1000 m (owner, 2026-10-24): built, waiting for the owner

**Asked (Next up):** an Ultra preset above High, shadows to 1000 m, for GPUs with more VRAM.

**Built:** Settings > Graphics > Quality preset now starts with **Ultra** (full renderer, 100 %, shadows "To about 1000 m");
the Shadows box has that step too. `SHADOW_REACHES.ultra`: a 2032 m square (half 1016) on a 16384² map, 12.4 cm texels
(as farthest's 12 cm), about 1 GB of shadow depth (16x near). WebGPU hands out 8192² textures unless asked, so the
engine asks the adapter (the same options Three.js uses: `featureLevel: 'compatibility'`) for its largest, up to 16384,
as `requiredLimits`; a GPU that has no more gets 8192² (25 cm texels, soft). When slow, the tip suggests High.

**Fixed on the way (all reaches):** the shadow camera stood 600 m up-sun with a 1200 m depth range. Ground outside it
drew as shadowed, so from 350 m up with shadows to 500 m a large dark wedge covered the fields (shot before the fix
read in the probe, not kept). `shadowDepth(half)` now gives room for the square's edge (0.72 half along the sun's
view), a camera 400 m up, and the 100 m recentring: near 600 m, far 654, farthest 834, ultra 1206. The depth bias is
now 1.2 cm whatever the range (it was -0.00001 of the range).

**Evidence** (`docs/evidence/2026-10-24-ultra-shadows/`, headless Chrome, WebGPU, `probe.mjs`): the engine read back
map 16384, half 1016, depth range 2412 m (the device's texture limit 16384 on this PC);
`ultra-1000m.jpg` and `farthest-500m-fixed.jpg` from 350 m up west of the yard (the city, park and airport shaded on
Ultra; no wedge on either now); `city-500-vs-1000.png` (from 120 m over the park looking north: the city 400-800 m away
differs, 1.5 mean pixel difference vs 0.2 for the park). Settings text checked in the built-in browser. 623 tests
pass (new: ultra in `graphics.test.ts`, `shadow-follow.test.ts`); typecheck clean.

**Left open:** frame time and memory on Ultra not measured (headless Chrome caps at 120 fps); not tried on a GPU with
less memory (a failed 1 GB allocation was not tested).

## 2o. Clouds and a longer view at High and Ultra (owner, 2026-10-24): built, waiting for the owner

Owner: "add clouds, set longer view distance at ultra and high."

**View distance.** Full graphics always saw to the fog's end at 1600 m (from 250 m). Now a setting, Settings > Graphics >
View distance (applies live), that the presets set: Medium 1.6 km (as before), High 3 km (fog from 400 m), Ultra 6 km
(from 600 m) (`graphics.ts VIEW_DISTANCES`). The low spec levels keep their own short views ("Set by this renderer").
Settings saved before it get the view their preset now has (shadows Ultra → 6 km, Far → 3 km), so a saved Ultra or High
still reads as itself, not Custom. Full graphics' far plane went from 5 km to 21 km (`view.ts FULL_FAR`, past the clouds).
Nothing else culled by distance in full graphics (one mesh per material for the whole map), so a longer view costs no
extra draws, only fill; 120 fps (the cap) at all three in headless Chrome on this PC. Evidence: `medium-`, `high-`, `ultra-east-from-120m.jpg`
in `docs/evidence/2026-10-24-clouds/` (taken with the first, flat clouds; fog read back 250/1600, 400/3000, 600/6000).

**Ground.** The map's grass ended 2 km out (2.6 km east), which a 3-6 km view would show as an edge. Map v24 carries
plain grass out to 10 km round it (`first-map.ts FAR_GROUND`, four quads, 8 triangles more: 545 800), solid like the rest.

**Clouds, first try: a flat picture (dropped).** A tiling 2D cumulus picture on a sheet 1500 m up. Owner: "The clouds
look horrible, they should be 3d pillowy clouds, not some repeating 2d pattern." Asked: volumetric (realistic, costlier)
or piles of balls (stylised, cheap)? "lets test volumetric for performance."

**Clouds, second try: volumetric (dropped).** Ray-marched cumulus 1.5-2.8 km up after Schneider (Horizon Zero Dawn)
and Hillaire (Frostbite), ~1 ms a frame at 1080p on the RTX 4070 Ti. Owner: "The clouds are way too high. Make lower
stylized clouds, that players can go up and fly through. Make them cloud the vision like flying in a cloud would really
do, instead of the weird cutout view thing that happens." (Its code is in git at f90db45 if wanted again.)

**Stylised clouds** (`render/cloud-puffs.ts`, `render/clouds.ts`). Cumulus as heaps of soft white balls, low enough to
climb to:
- Placed from a fixed seed on a jittered 650 m grid over a 13 km square round the map's middle, a cloud in 38 % of cells
  (2237 puffs): each 90-260 m long, half to two thirds as wide, its middle heaped up a third to a half of its length, two
  or three smaller puffs on top. Bases 180-280 m (stylised: real fair-weather bases are 1-2 km up); a test checks the
  lowest puff clears the tallest thing the map builds by more than 10 m. Puffs 0.78 as tall as wide.
- One instanced mesh (a 32x20 sphere, ~2.8 M triangles, one draw), shaded by their own light (white facing the sun,
  blue-grey away from it), fogged with the map. Not solid (clouds aren't).
- Their shadows (owner: "they should cast shadows like real clouds"). Each frame the puffs, as coarse 10x6 balls sharing
  their matrices, are drawn white on black from the sun (orthographic, along SUN_DIR) into a 1024² map covering the whole
  13 km field (~19 m texels). Every lit surface looks along the sun's rays into it (five taps 1.5 texels apart: soft
  edges) and the sun's light on it is cut by 80 % under a cloud [estimate], through the sun light's colour node (Three.js
  AnalyticLightNode reads `light.colorNode`), so the sky's light still reaches the shade. Nothing above 280-430 m is
  shaded (the quad over the clouds). Not through the sun's shadow map: that reaches only 110-1000 m round the camera.
  The clouds don't use the scene's light because each lies in its own shadow in that map. `shadow-side.jpg` (a cloud and
  its shadow), `shadow-low.jpg` (the probe aims at where the sun's ray through the cloud meets the ground: the shadow is
  there), `shadows-from-900m.jpg`; WebGL 2 the same.
- They drift (owner: "The clouds should be moving across the sky"): 5 m/s east and 2 m/s south [estimate: fair-weather
  cumulus drift at 5-10 m/s], from the sim's time, so a replay has the same sky at the same moment. Each cloud moves
  whole round the square and comes back on the far side, shrinking to nothing over the last 1200 m before the edge and
  growing back after it (no pop). `drift-0s.jpg` / `drift-20s.jpg`: the same view 20 s apart.
- Inside a cloud: each frame the camera's depth in the nearest puff (`insideDepth`) sets a whiteout, from 4 m outside
  the puff to full 12 m inside. The scene fog closes in (its distances blended in proportion, from the View distance's
  down to 14 m) and turns cloud-white (0xdfe5ec), the sky behind with it, so the edge never shows as a cutout: the puff
  fills the view, then the view greys over. Measured going in along +x into a 62 m puff (`into-cloud.txt`): 40 m out the
  view's own fog (400 / 3000 m at High), 8 m out 224 / 282 m (a neighbouring puff is nearer), 2 m out 33 / 22 m, 4 m in
  and deeper 0 / 14 m.
- Settings > Graphics > Clouds (Off / On), live, on in Ultra, High and Medium (default on). Full graphics only.
- The airport's lights used to ignore the fog (lights carry through haze), so they shone clear through a whiteout (owner:
  "you can see the lights strangely well through the whiteout ... They should also be a bit hazy"). Now each fades into
  the fog's colour with distance, 95 % gone at 3 times where the scene's fog hides everything [estimate: lights in fog are
  seen 2-4 times as far as surfaces]: at High a little hazy over 1-3 km, inside a cloud gone by ~40 m (`airport-lights.ts`
  setHaze, each frame). `lights-from-in-cloud.jpg`: from deep in a cloud 370 m off the runway, none show.

**Cost** (`perf.mjs`, `perf.txt`; RTX 4070 Ti, 1904x929 at dpr 1 and 2, the same frames drawn 60 times with the clouds
and their shadow pass hidden and shown inside the timed task; a first run toggled them outside it, where the engine turned
them back on each frame, and measured nothing): with shadows +0.13-0.26 ms without the lens, +0.11-0.65 ms with the
fisheye (the most among the clouds); moving them each frame 0.17-0.19 ms of CPU. The shadow lookups run on every lit
surface even with the clouds off (strength 0). Not measured on a weak GPU, where 2.8 M triangles could tell.

**The shadow block from high up** (owner's screenshot, 2026-10-24: "there is a shadow big ... it makes a giant
rectangle shadow"). The shadow camera's depth range was centred on the camera and has room for 400 m: from ~600 m up
the ground fell past it and drew as shadowed, a straight-edged dark block growing with height. Now the square is
centred, along the sun's view, on the ground the camera looks down on along the sun's rays (`world.ts Sun.follow`; the
same square across the view), so the ground stays in range at any height. Evidence `docs/evidence/2026-10-24-shadow-high/`
(Ultra from 300, 1200, 2500 m; Medium from 1200 m): no block, shadows still drawn below.

Evidence `docs/evidence/2026-10-24-clouds/` (probe.mjs: from the park up and to the horizon, over the city from 120 m, flying
into one; WebGPU and WebGL 2 `*-webgl.jpg`; no console errors). Tests: `clouds.test.ts`
(same every time, how many and where, clear of the map, depth in a puff, the fog inside), `graphics.test.ts`.

Open: cloud shadows are 80 % [estimate], soft at ~19 m texels and cast by coarse balls; clouds don't shade each other; the wind is fixed (no setting); puffs overlap with hard creases (stylised); not tried on a weak GPU;
none in low spec; the far grass is plain (no fields or hills past 2 km).

## 2p. Firefox review (owner, 2026-10-25): researched and measured; A built and B measured in §2q

**Asked:** "a heavy analysis of firefox support, including deep research of how other devs and programs handle
firefox support for games like ours ... we may have taken some wrong turns in changes to support it before."
Measurements: `docs/evidence/2026-10-25-firefox-review/results.md` (Firefox 158.0.1, Chrome 155, this PC).

**What Firefox gives a game like ours (sources read 2026-10-25):**
- WebGPU: Windows since 141, Apple silicon Macs since 145/147; Linux, Intel Macs and Android Nightly only (gpuweb wiki
  Implementation Status). Elsewhere Three.js's WebGPURenderer falls back to its WebGL 2 backend.
- Its WebGPU is slower per call than Chrome's: Mozilla's own meta bug 1713185 lists ~45 open speed bugs, among them
  1968102 "GPUQueue.writeBuffer is slow" (a fresh shared-memory block per call; small writes inlined since 2025-06),
  1954570 (GPU memory does not trigger GC), 1937100 (stutters from encoder objects kept alive), 1870699 (completions
  polled every 100 ms; open). Measured here: the same 594 writes a frame cost Firefox 6.8 ms of CPU, Chrome 3.4 ms.
- WebGL 2: no `EXT_clip_control` until Firefox 159 (bug 1885031, release 2026-10-27; not ESR 153); the GPU name is
  bucketed ("GTX 980 ... or similar" on an RTX 4070 Ti).
- Input: no WebHID (Mozilla position "negative", standards-positions #459); Web Serial exists but no EdgeTX serial mode
  sends sticks (§0h); gamepads drained every 4 ms and stamped on the main thread (source unchanged since §0h). An
  event-driven Gamepad API (Microsoft) is under review at Mozilla (#1389), not built anywhere yet.

**How others handle it:** the big web engines default to WebGL 2 and make WebGPU opt-in: PlayCanvas
(`createGraphicsDevice`, empty `deviceTypes` = WebGL 2; WebGL 2 always appended as fallback), Unity 6 (WebGL 2 default,
WebGPU opt-in; Firefox not in its WebGPU browser list), Godot 4's web export (WebGL 2 only); Babylon.js picks WebGPU
only when the page creates a `WebGPUEngine` (doc.babylonjs.com setup/support/webGPU; WebGL and WebGPU kept side by side).
Three.js users report the WebGPURenderer costing more CPU than the classic WebGLRenderer
(discourse threads 77629, 91904) and use `forceWebGL` only to test the fallback. Browser FPV sims found online (Nexus
FPV, a Flite Test sim) list gamepads, no WebHID, and claim Firefox works; none published measurements.

**Wrong turns found:**
1. **WebGL 2 was rejected for a fixable reason.** On 2026-10-18 the owner found Firefox's WebGL 2 "flashes and looks
   bad", so Firefox stayed on WebGPU with its GC stutter. The day before, the near plane had gone to 1 cm on a reversed
   depth buffer (`f1ddc51`), which in WebGL needs `EXT_clip_control`; Firefox lacks it, Three.js silently drops back to
   normal depth, and 1 cm on normal 24-bit depth z-fights (shown: `z-crop.png`). The same hits every WebGL path in
   Firefox 158: all three low spec levels, the no-GPU drop to super low, `?webgl`, and Firefox on Linux / Intel Mac.
   Firefox 159 fixes it for most, but not ESR.
2. **The lens was built knowing Firefox would pay.** The fisheye's face cameras (decisions 2026-10-18, "Firefox
   shelved for now") draw the scene 3-5 times: 593 writes a frame against 233 without the lens. Chrome absorbs it
   (3.4 ms); Firefox does not (6.8 ms, 93 fps and 1587 slow frames a minute under the profiler; 120 fps and 16 without
   the lens). The lens is on by default, so a new Firefox user starts in the worst case.
3. **Fixes for Firefox were tuned to a scene that has since grown.** §0l cut writes to 69 a frame; with the lens,
   clouds, airport, crane and more it is 593. The 16 m shadow recentring (§0l) still helps, but it is no longer the lever.
Not wrong turns: the gamepad clock (§0h/§0i) and the gamepad-connect fix help every browser; keeping the engine on the
page (§0i) was the owner's call from a felt stutter; the Firefox notice is accurate about radios.

**Options (for the owner; none started):**
- A. Depth: when the renderer reports no reversed depth, use Three.js's logarithmic depth buffer (or a nearer-far
  split); small, rendering only, fixes Firefox <159, ESR, and any WebGL without the extension.
- B. Firefox renderer: after A, measure WebGPU vs WebGL 2 in Firefox for a minute each (§0k found no malloc GC with WebGL 2;
  lens off both hold 120 here), and let the owner fly both; pick per browser.
- C. Lens cost: a cheaper lens for Firefox (the low spec "one wide view + warp" already exists), or fewer face passes,
  or sharing per-object data across faces.
- D. Fewer draws for everyone: merge static meshes (BatchedMesh / merged geometry); clouds move by a shader offset
  instead of re-sending 2237 matrices (143 KB) every frame.
- E. Smaller: the Report screen says the GPU name is a Firefox bucket; check the no-GPU detection in Firefox with
  acceleration off; audio latency in Firefox not measured; Firefox checks as part of each graphics change.

## 2q. Option A built, option B measured (owner, 2026-10-25): log depth without EXT_clip_control

**Asked:** "Yes, build option A (the WebGL depth fallback), then we can compare WebGPU and WebGL 2 in Firefox (B)."

**Built (`engine/engine.ts`):** the classic renderer (low spec levels) asks a throwaway WebGL 2 context for
`EXT_clip_control` (`clipControl()`, works in the worker too) and is made with `logarithmicDepthBuffer` when it is
missing; the WebGPURenderer is made as before, and if its WebGL 2 backend cleared `reversedDepthBuffer` in `init()`,
`logarithmicDepthBuffer` is set before anything is drawn (Three.js r186 node materials and the shadow node read it
when they build). WebGPU and every browser with the extension are unchanged. The Report screen's Renderer line ends in
", logarithmic depth" when it is on. Cost: log depth writes depth from the fragment shader, so the GPU loses early
depth rejection; only on the browsers that had z-fighting. Rendering only; no sim state.

**Evidence** (`docs/evidence/2026-10-25-firefox-review/results.md` §8): frozen frames in Firefox 158 match the 10 cm
reference far away (low spec 10 px differ, was 901; full graphics on WebGL 2 0 of 153 340 px in the distance), windows
whole (`z-before-after.png`, `gl-far.png`); Chromium unchanged; `?selftest` matches in Firefox; 643 tests; typecheck clean.

**B, WebGPU vs WebGL 2 in Firefox (§9 there):** no case for switching. Lens off, both hold ~119 fps with 15-86 slow
frames a minute; WebGL 2 has no mid-flight malloc GC but one 83-92 ms frame in every run. Lens on, WebGL 2 is worse
(95 vs 118 fps; 7.8 vs 6.9 ms CPU a frame). The cost is in Three.js's WebGPURenderer on either backend (as three.js
users report); the classic renderer of low spec takes 1.2 ms. So the lens (option C) is the lever for Firefox.

**Left open:** the owner flies Firefox on Pages with `?webgl` and without, and low spec (no shimmer?); the one long
WebGL 2 frame; GPU cost of log depth on a weak GPU not measured; Firefox 159 (2026-10-27) brings the extension, after
which these paths go back to reversed depth by themselves.

## 2r. Option C built: the fast fisheye lens, by default in Firefox (owner, 2026-10-25)

**Asked:** "I flew it. Build C: a cheaper fisheye lens for Firefox."

**Built:** Settings > Camera > Lens drawing (full graphics, with a lens): Automatic (the default: fast in Firefox, exact
elsewhere), Exact (the face cameras, as before), Fast (`graphics.ts` `LensDrawing`, `fastLens`; `settings.ts`
`lensDrawing`). Fast draws the low spec way with the WebGPURenderer: the front face alone, cropped as wide as the
picture reaches (`lensLayout(..., single)`), one scene pass instead of three to five (`render/fisheye.ts` `wide`,
`wideShader`). The face is half float with mipmaps and 16x anisotropic reads, **no multisampling**: one face is 3-11 Mpx
at 1280x715 (the exact faces 1.5-2 Mpx), so 4x MSAA would take 200-600 MB; without it about 100 MB. The centre keeps one
texel per screen pixel up to the 4096 cap (Ratel 2 hits it from 1920x1080 up, so the centre softens a little there).
When fast is on, an amber box says it is softer on purpose and why (as the low spec lens's box). Changing the setting
builds the lens view again (`FisheyeView.dispose`); its pipelines build on the next frame (one hitch). Rendering only.

**Evidence** (`docs/evidence/2026-10-25-firefox-review/results.md` §10): Firefox, default settings: 4.1 ms CPU a frame
(exact 6.9), 120 fps, 21-78 slow frames a minute (exact 1640 at 92 fps); writes 253 a frame (593). Pictures side by side:
same framing; centre as sharp with slightly harder edges; picture edges softer. Settings checked in Firefox, live
switch 1 -> 3 -> 1 faces. 644 tests (new: lens drawing in `graphics.test.ts`); typecheck clean.

**Left open:** the owner flies it in Firefox (and may try Fast in Chrome); not tried on a weak GPU (the face's pixels and
mipmaps cost GPU time, the passes CPU time); no anti-aliasing in the centre (FXAA would be the cheap fix if it shows);
the one-off hitch when switching.

## 2s. Option D built: fewer draws for every browser (owner, 2026-10-25)

**Asked:** "I flew the fast lens. Build D next: fewer draws for everyone (merged static meshes, clouds moved in the shader)."

**Built:**
- **Level merged** (`render/world.ts` `levelGroup`, `mergedMaterial`): the plain opaque materials share one mesh; each
  vertex carries its material's number (`surface`), which picks colour, roughness, metalness and the grid from tables
  (the values `gridMaterial` gives each alone). Ribbon glass and frosted panels keep their own meshes. The shadow
  casters are one more mesh, positions only, on `SHADOW_ONLY_LAYER`, which only the sun's shadow camera sees (Three.js's
  ShadowNode keeps a shadow camera's own layers); the visible meshes no longer cast. First map: 26 draws a camera pass
  -> 3, 20 in the shadow pass -> 1. `?nomerge` draws it as before, to compare.
- **Clouds drift on the GPU** (`render/clouds.ts` `driftNode`): each puff's matrix is fixed round its cloud's centre, a
  per-puff `cloud` attribute holds that centre and the puff's base, and the shader adds the wind and the shrink at the
  square's edge with the same sums as `cloud-puffs.ts` `drift()` (kept on the CPU for the whiteout). No more 2237
  matrices (143 KB) sent every frame.
- **Found on the way, fixed:** the lens's views (and the chase see-through view) had 24-bit depth: Three.js gives a
  render target 24-bit depth unless it has a depth texture, and reversed depth needs float to reach far, so through the
  lens 5 cm park paths vanished into the grass from ~400 m up (since the lens was built). Now 32-bit float depth textures.

**Evidence** (`docs/evidence/2026-10-25-firefox-review/results.md` §11): Firefox CPU a frame, fast lens 4.47 -> 3.51 ms;
exact lens 7.84 -> 5.71 ms, 98 -> 117 fps. Merged and `?nomerge` draw the same picture (80-143 of 915 200 pixels differ;
shadows, clouds in place), exact lens too; low spec draws. Cloud positions and shadows the same as the Pages build at the
same sim time. 644 tests; typecheck clean. Not measured in Chrome (the owner stopped it: too many windows).

**Left open:** Chrome numbers; airport (12 draws) and time-trial gates (8) not merged; the 80-143 differing pixels are
ties between coplanar faces (draw order changed); the merged mesh's material tables use a few more shader cycles on
plain surfaces (the grid is computed everywhere).

## 2t. The picture froze in Firefox with sound on (owner, 2026-10-25): fixed

**Reported:** "Flying without a radio is not working on firefox", then: the image draws, clicking in captures the mouse,
"but moving the mouse and hitting the buttons does nothing ... the whole world is frozen"; switching tabs and back
shows one new frame; with a radio too; low spec the same; it unfroze when sound went off (M).

**Cause:** `audio/audio.ts` `frame()` moved the listener through `AudioListener.positionX/forwardX/upX`, which Firefox
does not have (it has only the older `setPosition`/`setOrientation`): every audio message threw. With the engine on the
page, `engine/protocol.ts` `localPorts` hands messages over synchronously, so the error went back into the engine's
frame (`postAudio` comes just before `draw`) and stopped it before drawing: the sim, the free camera and the HUD ran on,
nothing was drawn. A tab switch suspends the sound (`visible`), so one frame got through. Since sound was built (§1l);
Firefox was shelved then, and headless checks never clicked, so the sound never started in them.

**Fixed:** the listener uses `setPosition`/`setOrientation` where the parameters are missing (applied at once, no 10 ms
smoothing in Firefox); `localPorts` reports a handler's error (`reportError`) and does not throw it at the sender, as a
MessageChannel would, so a page error can no longer freeze the picture.

**Evidence:** reproduced headless (Firefox 158, a real click starts the sound, E held): Pages build, screenshots 1.2 s
apart identical with sound on (0 px differ), 174 071 px with it off; the sound's `frame` threw `can't access property
"setTargetAtTime", e is undefined` from the listener. Fixed build: 201 sound frames, 0 errors, 142 076 px differ with
sound on. In the owner's tab (claudecodebrowser): sim ticking, HUD 120 fps, no WebGPU errors, canvas unchanged.
646 tests (new: `local-ports.test.ts`); typecheck clean.

**Left open:** Firefox's spatial sound otherwise not checked by ear (panners use the parameters Firefox has).

## 2u. Firefox back on the exact lens (owner, 2026-10-25)

**Owner:** "the resolution/quality is terrible on firefox, even on Ultra. Chrome version still looks great", then
"firefox should be using the same lens as chrome". The fast lens (§2r) was Firefox's default ("Automatic"); its single
face is capped at 4096 texels (lens.ts MAX_SIZE), so on the owner's 2509x1371 screen (Ratel 2: a 4098x3249 face across
7.5 tangent units) the centre gets fewer texels than screen pixels, with no multisampling.
**Changed:** Lens drawing is Exact (default, every browser) or Fast; "Automatic" is gone and a saved 'auto' loads as
Exact (`graphics.ts` `fastLens`, `isLensDrawing`). The Fast warning box no longer talks about Firefox. Checked headless:
a saved 'auto' draws 3 faces. 646 tests; typecheck clean. Firefox's exact-lens cost after §2s: 5.7 ms CPU a frame at
1280x715 (117 fps); at the owner's size not measured.
