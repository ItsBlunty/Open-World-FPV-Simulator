# Firefox review (2026-10-25)

Firefox 158.0.1 and Chrome 155, Windows 11, RTX 4070 Ti, the GitHub Pages build at `3981ab9`, 1280 x 800 windows
(CSS 1280 x 715, dpr 1), `?demo` (the self-test's scripted sticks), default settings unless said.

Tools: `ffprobe.mjs <url> <expr.js | steps.json> [waitMs] [--windowed]` (headless Firefox through WebDriver BiDi on
port 19335, throwaway profile in %TEMP%); `drive.mjs` is `2026-10-18-firefox-stutter/drive.mjs` plus `SETTINGS=<json>`
(written to localStorage, then reload; needs `"version":1`), `CPU=1` (CPU ms in `renderer.render` per frame, 10 s) and
the runs `demo-low` (`?demo&lowspec`), `demo-city`. It makes its throwaway profiles next to itself: run a copy from the
scratchpad. GC counts: as in 2026-10-18 (`MOZ_PROFILER_*` env, `../2026-10-18-firefox-stutter/gcparse.mjs`).

## 1. Capabilities (`caps.js` headless, `caps2.js` windowed; `caps-headless.json`)
- WebGL 2: **no `EXT_clip_control`**; 24-bit depth; max texture 16384. Renderer string bucketed:
  "ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar" (the PC has an RTX 4070 Ti).
- WebGPU (windowed only; headless has no adapter): adapter maxTextureDimension2D 16384, maxBufferSize 2 GB, features
  include depth-clip-control, depth32float-stencil8, timestamp-query, shader-f16. `adapter.info` vendor and
  architecture empty.
- `navigator.hid` absent, `navigator.serial` present, `navigator.usb` absent, `scheduler` present, `userAgentData` absent.
- Audio: a context made without a click stays suspended and reports base/output latency 0: not measured.

## 2. Depth in Firefox's WebGL (`zfight.json`, headless, `?demo&lowspec&spawn=city`)
Three.js r186 turns reversed depth off when `EXT_clip_control` is missing (`WebGLCapabilities.js` line 96,
`WebGLBackend.js` line 284): `renderer.capabilities.reversedDepthBuffer` read back **false**. The sim frozen
(`session.advance` emptied), one shot as is (1 cm near plane; the low spec lens's faces even nearer), one with every
perspective camera's near raised to 10 cm: `z-crop.png` (left 1 cm, right 10 cm). The grey building's windows break
into slivers and the brick building's windows fray at 1 cm; at 10 cm they are whole. 901 pixels differ in the still
frame; in flight this shimmers. Depth step at 24 bits, normal depth, near n: about z² / (n x 2^24): at 1 cm, 6 cm at
100 m, 1.5 m at 500 m. Mozilla bug 1885031 "Implement EXT_clip_control": fixed in Firefox 159 (release 2026-10-27);
not in ESR 153.

## 3. GPU calls per frame (`GPU=1`, Firefox, 5 s)
| Settings | writeBuffer | setBindGroup | passes | fps |
|---|---|---|---|---|
| default (lens Ratel 2, shadows near, clouds on) | 593 | 775 | 7 | 115 |
| clouds off | 590 | 768 | 6 | 118 |
| lens off | 233 | 307 | 4 | 120 |
| lens off, clouds off | 231 | 303 | 3 | 120 |
| lens off, clouds off, shadows off | 100 | 141 | 2 | 120 |
| (2026-10-18 after the shadow fix, no lens, no clouds, map v4) | 69 | 113 | 3 | 120 |
Chrome default: the same 594 / 776 / 7.

## 4. Frame time (`CPU=1`, 10 s)
| Browser, settings | fps | CPU ms in render() / frame | frame p50 / p95 |
|---|---|---|---|
| Firefox, default | 113.8 | 6.76 | 8.3 / 16.7 |
| Firefox, lens off | 119.9 | 3.79 | 8.3 / 8.3 |
| Firefox, lens off, shadows off | 120.2 | 2.19 | 8.3 / 8.3 |
| Firefox, `?webgl` (WebGPURenderer's WebGL 2), lens off | 120 | 3.85 | 8.3 / 8.3 |
| Firefox, `?lowspec` (classic WebGLRenderer) | 120 | 1.16 | 8.3 / 8.3 |
| Chrome, default | 120 | 3.43 | 8.3 / 8.4 |
| Chrome, lens off | 120 | 2.12 | 8.3 / 8.4 |
Same calls, Firefox ~2x Chrome's CPU per frame. The rest of a frame (sim, traffic, HUD) comes on top of render().

## 5. Garbage and slow frames (`GC=1`, 60 s, profiler)
| Run | frames (fps) | frames > 12.5 ms | worst | major GCs after load (reason, s) |
|---|---|---|---|---|
| default | 5590 (93) | 1587 | 66.7 ms | ALLOC_TRIGGER 9.2, TOO_MUCH_MALLOC 42.9, FULL_GC_TIMER 60.9 |
| lens off | 7171 (120) | 16 | 33.3 ms | ALLOC_TRIGGER 4.4, TOO_MUCH_MALLOC 55.7, FULL_GC_TIMER 60.9 |
| `?webgl`, lens on | 5135 (86) | 2034 | 50 ms | (profile not written) |
The profiler itself costs some frame time; compare rows, not with section 4.

## 6. Determinism
`?selftest` headless Firefox 158: ok, flight `1eb33767…`, traffic `d157f30a…` (the pinned hashes).

## 7. Gamepad source (mozilla-firefox/firefox `main`, read 2026-10-25)
Unchanged since 2026-10-18: `dom/gamepad/windows/WindowsGamepad.cpp` `kWindowsGamepadPollInterval = 4`;
`Gamepad.cpp` `UpdateTimestamp()` stamps when the page's main thread applies the update.

## 8. After the fix: logarithmic depth where reversed depth is missing (same day, local production build)
`zf-low.json` / `zf-gl.json` (headless Firefox, frozen sim; headless has no WebGPU, so plain `?demo` runs the
WebGPURenderer's WebGL 2 backend):
- `?demo&lowspec&spawn=city`: classic renderer reads back reversed false, logarithmic **true**. Against the 10 cm
  reference, 10 pixels differ (was 901 at 1 cm on normal depth). `z-before-after.png`: left the old build, right the new.
- `?demo&spawn=city` at tick 18 280: WebGPURenderer reversed false, logarithmic true; in the distant buildings
  0 of 153 340 pixels differ from the 10 cm reference (`gl-far.png`). The near part differs because 10 cm cuts the
  ground the crashed quad lies on (why the near plane is 1 cm); log depth draws it.
- Built-in browser (Chromium 152, has the extension): `?lowspec&demo` and `?demo&webgl` keep reversed depth, log off;
  no console errors. `?selftest` in Firefox: ok, `1eb33767…` / `d157f30a…`. 71 files, 643 tests; typecheck clean.

## 9. WebGPU or WebGL 2 in Firefox (windowed, `?demo` vs `?demo&webgl`, 60 s each)
| Run | frames (fps) | frames > 12.5 ms | worst |
|---|---|---|---|
| WebGPU, lens on (profiler) | 5875 (98) | 1314 | 50 ms |
| WebGL 2, lens on (profiler) | 5219 (87) | 1952 | 66.7 ms |
| WebGPU, lens off (profiler) | 7161 (119) | 17 | 33.3 ms |
| WebGL 2, lens off (profiler) | 7152 (119) | 24 | 83.3 ms |
| WebGPU, lens off, twice | 7167 / 7084 | 15 / 86 | 33.3 / 108.3 ms |
| WebGL 2, lens off, twice | 7161 / 7164 | 17 / 16 | 83.3 / 91.7 ms |
`CPU=1`, lens on: WebGPU 6.92 ms in render() a frame, 117.6 fps; WebGL 2 7.83 ms, 94.8 fps.
WebGL 2's major GCs: only while loading (2.4, 12.7 s) and the 60 s timer (no TOO_MUCH_MALLOC in flight), yet every
WebGL 2 run had one 83-92 ms frame (cause not found). WebGPU's profiles were not written by Firefox in two runs.

## 10. The fast lens (option C; same day, local production build, Firefox 158 windowed, `?demo`)
| Lens drawing | fps | CPU ms in render() / frame | p95 frame | writeBuffer / setBindGroup / passes | 60 s: frames > 12.5 ms, worst |
|---|---|---|---|---|---|
| Automatic = fast (Firefox) | 119.9 | 4.10 | 8.3 ms | 253 / 331 / 16 (12 are mipmap levels) | 78 / 75 ms; again 21 / 58 ms |
| Exact | 115.7 | 6.91 | 16.7 ms | 593 / 775 / 7 | 1640 / 91.7 ms (92 fps) |
Pictures, same flight frozen at tick ~7000 (`lens-exact.json`, `lens-fast.json`; 8 ms apart): `lens-side.png` (left exact,
right fast): same shape and framing; `lens-centre.png` (3x): as sharp, edges a little more jagged (no multisampling);
`lens-edge.png` (3x): softer, thin wires and road lines fade sooner. Settings (`ui.json`, `settings-firefox.png`): the
Lens drawing row reads "Automatic (fast in Firefox)" with the amber box; switching to Exact draws 3 faces and drops the
box, back to Fast 1 face, saved. Single-face sizes (Ratel 2): 2932x2326 at 1280x715, 4097x3249 (capped) at 1920x1080.
