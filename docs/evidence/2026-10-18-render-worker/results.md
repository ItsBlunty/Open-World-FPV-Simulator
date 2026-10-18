# Render worker and gamepad clock (2026-10-18)

Windows 11, 120 Hz display, Firefox 158 and Chrome 155, throwaway profiles. `spike.html` + `worker.js` + `serve.mjs`:
Three.js r186 in a worker on an OffscreenCanvas (raw results in `results.jsonl`). `clock-probe.html`: worker clocks
(served by the same `serve.mjs`, port changed). `drive.mjs`: drives a windowed Firefox (WebDriver BiDi) or Chrome (CDP)
against `vite preview` of the production build; `CATCH=1`, `UI=1`, `RADIO=1` pick the checks below.

## Spike (before the app changed)
| Browser | Backend in worker | Worker fps | 1 ms worker clock ticks reaching the page |
|---|---|---|---|
| Firefox 158 headless | WebGL 2 (no adapter headless) | 116-119 | 244-248/s |
| Firefox 158 window | WebGPU | 118 | 244/s |
| Chrome 155 window | WebGPU | 118 | 261/s |
Four 1 ms intervals staggered 1 ms apart (Firefox headless): 1002 ticks/s but bunched (median gap 0 ms, p95 5 ms).

## Clocks (headless, page otherwise idle)
| Clock | Firefox 158 | Chrome 155 |
|---|---|---|
| worker `setInterval(1)` | 230/s, gaps p05/p50/p95 3/4/5 ms | 250/s, 3/4.1/4.7 ms |
| worker 1 ms timeout set from a message task ("bounce") | **665/s, 1/1/2 ms** | **544/s, 1.1/1.7/2.7 ms** |

## Imitated Firefox gamepad (app, `?demo`, `CATCH=1`, Firefox 158 window)
A worker posts a numbered update every 4 ms (Firefox's drain timer, WindowsGamepad.cpp); the page keeps the latest;
the poller counts distinct values.
| Engine | Clock | sent/s | caught/s | share | polls/s |
|---|---|---|---|---|---|
| worker | setInterval(1) | 230.8 | 194.5 | 0.843 | 230.8 |
| worker | bounce | 231.0 | 230.8 | 0.999 | 678.8 |
| page | setInterval(1) | 230.3 | 193.0 | 0.838 | 230.3 |
| page | bounce | 230.5 | 230.5 | 1.000 | 680.5 |

## App checks (production build, windows)
Lateness: a worker posts its absolute time every ~4 ms; the page records receipt - send (Firefox timers have 1 ms steps).
| Browser | Run | Engine | fps | ticks/s | lateness p50 / p95 / max (ms) |
|---|---|---|---|---|---|
| Firefox 158 | ?demo | WebGPU in a worker | 121 | 228 | 0 / 0 / 1 |
| Firefox 158 | ?demo&render=main | WebGPU on the page | 120 | 227 | 1 / 4 / 6 |
| Firefox 158 | ?demo&webgl | WebGL 2 in a worker | 120 | 230 | 1 / 1 / 2 |
| Chrome 155 | ?demo | WebGPU in a worker | 120 | 250 | -0.1 / 0 / 0.3 |
| Chrome 155 | ?demo&render=main | WebGPU on the page | 120 | 250 | 0 / 1.8 / 2.6 |
| Chrome 155 | ?demo&webgl | WebGL 2 in a worker | 120 | 250 | -0.2 / -0.1 / 0.1 |
`?selftest`: MATCH in both (flight `cd45c59c…`, traffic `80f0c9aa…`).

UI (`UI=1`, both browsers, engine in the worker): "Look around" activates the free camera; W held 1 s moves it
10.0-10.2 m (10 m/s); a drag turns it; Esc pauses the sim; the spawn menu moves the session (park <-> bando, kept);
the FOV slider reaches the engine (100); canvas pixels = CSS size (1280x715 Firefox, 1264x705 Chrome).

Radio (`RADIO=1`, both browsers): a saved test profile, `__fly.fakeRadio()` fed every 2 ms through the page's `onRaw`;
Space arms at low throttle; 0.4 throttle climbs 0.15 -> 31.3 m in 1.5 s; 400 ms after the frames stop the quad is
disarmed (stale-radio rule, now in the engine).
