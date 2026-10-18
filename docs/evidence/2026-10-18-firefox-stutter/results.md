# Firefox microstutters (2026-10-18)

Owner: Chrome "runs great"; Firefox "still getting some kind of microstutter or frame drop every now and then. It doesnt
really feel like loading". Firefox 158, Windows 11, 120 Hz, the GitHub Pages build, engine on the page, Boxer as gamepad.

## 1. Frame recorder in the owner's tab (injected via claudecodebrowser, 65 s)
7799 frames = 120.0 fps; our work per frame p50 4 ms, p99 6 ms. Three slow frames: 1.77 s (16 ms) and 36.0 s (17 + 28 ms,
~3 frames lost, then 34 physics steps to catch up). In the slow frames every part of our frame was slower at once.

## 2. The owner's Firefox profile (https://share.firefox.dev/4hNMkq4; scripts here: gc.mjs, ticks.mjs, cpu.mjs, bail.mjs, mapsamples.mjs)
- Sim thread: 7387 refresh ticks, interval p99 8.45 ms, 4 gaps > 12.5 ms in 62 s.
- GCMinor 8184 (p50 0.05 ms, max 0.47 ms); GCMajor at 477.66 s (TOO_MUCH_MALLOC, max pause 4.85 ms) and 503.23 s
  (FULL_GC_TIMER, max pause 1.54 ms), 25.6 s apart, ~32 MB allocated per cycle.
- Long ticks used the CPU 86-98 % (normal ~73 %): the thread was running, not preempted.
- JIT Bailout/Invalidate bursts coincide with the slow frames: 477.683-477.725 s (172 events, 20 ms after the major GC
  began) and 507.949-507.965 s (92 events). The 507.95 s frame: 8 of 10 samples in Three.js node building
  (`build`, `buildCode`, `generateConst`) inside `renderShadow`.
- 509.17 s: 17.6 ms gap with the sim thread idle (Firefox missed a vsync; not ours).
- `message` DOM events: 55 375 in 62 s (~900/s, as expected).

## 3. Shader builds after load, logged in the owner's tab
Flight 1 (135 s): 4 builds at 80.6-82.3 s, all `ShadowMaterial` for level meshes (concrete-dark, brick, plaster,
rubble) with the sun's orthographic camera. Flight 2 (72 s, fresh reload, render-object rebuild tracking keyed by
object and camera id): **0 builds, 0 rebuilds**; slow frames at 27.21 s and 57.31 s (14 ms each), 30.1 s apart.
Sliding the shadow square over the whole level (120 m steps, 2304 spots, `SWEEP=1`) built nothing: the level meshes'
bounds span ±2828 m, so culling never kept them out. Cause of flight 1's builds: not found.

## 4. What allocates (Firefox startup profiler, 60 s `?demo`, `GC=1`, gcparse.mjs)
| Build / mode | gamepad-like clock | major GCs (reason, s) | minor GCs | slow frames |
|---|---|---|---|---|
| Pages build, WebGPU | on (661/s) | TOO_MUCH_MALLOC 25.4, 58.8; FULL_GC_TIMER 60.7 | 4828 | 2, max 41.7 ms |
| new build (local ports), WebGPU | on | TOO_MUCH_MALLOC 25.4, 59.0; FULL_GC_TIMER 60.3 | 5046 | 3, max 16.7 ms |
| new build, WebGPU | off | TOO_MUCH_MALLOC 25.4, 59.0; FULL_GC_TIMER 60.3 | 5044 | 3, max 16.7 ms |
| new build, WebGPU, ?noshadows | off | TOO_MUCH_MALLOC 37.1; FULL_GC_TIMER 60.3 | 4324 | 0, max 8.3 ms |
| new build, ?webgl | off | FULL_GC_TIMER 60.3 only | 5016 | 2, max 66.7 ms |

Messages are not what fills memory; WebGPU is. WebGPU calls per frame (`GPU=1`): with shadows `queue.writeBuffer` 180,
`pass.setBindGroup` 113, 3 passes; without shadows 27 and 54, 2 passes.

## 5. Clocks under load (`CATCH=1`, Firefox, flying ?demo, engine on the page)
| Clock | polls/s | share of imitated 4 ms updates caught | a 2 ms page timer next to it |
|---|---|---|---|
| setInterval(1) | 229 | 0.868 | 201/s |
| worker 1 ms timeouts from message tasks (kept) | 635 | 1.000 | 182/s |
| scheduler.postTask delay 1 (rejected) | 230 | 0.687 | 179/s |

(postTask on an idle headless page: Firefox 650/s, Chrome 66/s.)

## 6. Stall right after loading
Closing the menu ~1 s after the map loaded: the free camera moved 3.5-5.5 m in 1 s of W instead of 10 m (Pages
build and new build alike); with a 4 s wait, 10.08 m. Fix: 'ready' waits for `device.queue.onSubmittedWorkDone()`
after the warm-up; then 10.08 m at 1 s in Firefox and Chrome, and the simulated radio arms, climbs and stale-disarms.
