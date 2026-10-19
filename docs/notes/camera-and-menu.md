# Cameras (free-fly, fisheye) and the main menu

Archived work notes, moved verbatim from HANDOFF.md on 2026-10-18. Read only when working in this area;
`HANDOFF.md` has the current state. Section numbers (§0a ...) are the ones code comments cite.

## 0f. Free-fly "Look around" camera (owner, 2026-10-18): built, waiting for the owner to try it

The owner: with nothing connected, "Look around" opened the view but the camera could not move. Asked for a free-fly
camera with WASD and the mouse.

- `apps/fly/src/render/freecam.ts` (new): `FreeCam`, active whenever no radio profile is set up and not `?demo`.
  Click the canvas to capture the mouse (pointer lock), then the mouse steers; holding a button and dragging also
  steers (fallback when the browser refuses pointer lock). W/A/S/D move (W flies where you look, pitch included),
  Space / E up, Q down, Shift 4x. 10 m/s, 40 m/s with Shift, 0.0025 rad per pixel, 60 deg vertical FOV (all
  constants at the top of the file). R puts the camera back on the quad; C does nothing in this mode. The quad
  model is shown at the spawn point.
- `main.ts`: enters the free camera from the current camera pose (no jump), leaves it and restores the FPV / chase
  camera once a radio profile exists; opening the menu releases the mouse. The menu has a "Look around" key line.
- `ui/hud.ts`: the no-radio prompt is now passed in (`noRadioHint`): "click to look around, Esc for the menu", and
  the key list while the mouse is captured.
- Render-only: it moves the Three.js camera with the frame time and never touches sim state, so determinism is unaffected.

**Evidence (Chrome, dev server):** WASD + Shift then E moved the camera from (0, 0.16, 40) to (0, 6.74, 24.65); a
drag turned it about 70 deg right and slightly down, horizon level; `?selftest` MATCH (flight and traffic);
`tsc` for `apps/fly` clean. Screenshot after the drag: `C:\Users\vhdbl\AppData\Local\Temp\claude-chrome-screenshots-GYM1tn\screenshot-1792317412826-17.jpg`.

**Left open:** pointer lock was refused in the automation tab (`WrongDocumentError`, the tab was not the foreground
window), so click-to-capture steering is untested; ask the owner to try it, and whether the speeds and mouse
sensitivity feel right. The free camera has no collision (it flies through buildings).


## 0m. Fisheye FPV camera with Gyroflow lens profiles (owner, 2026-10-18): built, waiting for the owner to fly

**Asked:** "lets work on fisheye for the camera, and I want you to fetch gyroflow and use that for the lens profiles."
**Owner's choices** (asked 2026-10-18): default lens the Caddx Ratel 2 (analog); a camera picture that does not match
the screen's shape is fitted with black bars; a short curated list (not all 9 773 profiles); the field-of-view slider
is hidden while a lens is chosen. Method: Claude explained the three ways (below); the owner chose the face cameras.

**Research (sources read):**
- https://github.com/gyroflow/lens_profiles (commit `886fc61`, **CC0**): 9 773 profiles; every FPV-brand one (Caddx,
  DJI, Foxeer, Hawkeye, RunCam, Walksnail, ~930) uses `opencv_fisheye`: a ray at θ off the axis lands at normalised
  radius θ(1 + k1θ² + k2θ⁴ + k3θ⁶ + k4θ⁸). Only that model is supported.
- https://github.com/gyroflow/gyroflow (commit `5fa0309`, GPL-3.0-or-later): `opencv_fisheye.rs` (distort,
  undistort by Newton) and `mod.rs` (`radial_distortion_limit`: where the curve folds back). Ported to
  `apps/fly/src/render/lens.ts` with Gyroflow's copyright line.
- Many community calibrations fold back inside their own picture (garbage corners). The original Ratel (Nazgul5 V1
  stock) and the PAL Ratel 2 file both do; `lensFromGyroflow` rejects such profiles.
- These lenses are 117-132 deg wide and 130-159 deg corner to corner. **Ways to draw that:** (1) one wide flat render
  warped afterwards: cheapest, but a flat render stretches without bound towards 180 deg, so these corners need ~3x
  the screen's size per side or a blurry centre; (2) bending vertices in the vertex shader: one pass, but straight
  triangle edges stay straight (our map is big boxes); (3) several cropped face cameras then a remap: exact, costs
  scene passes. Chosen: (3).
- Three.js r186 source: `ShadowNode.updateBefore` redraws the shadow map once per camera per frame (so each face would
  redraw it; `shadow.autoUpdate` is switched off after the first face); rendering to a render target applies no tone
  mapping or colour conversion (`Renderer.isOutputTarget`); the full-screen pass to the canvas does.

**Built:**
- `render/lenses/`: 15 calibrations copied unchanged (README: source path, calibrator, date), list in `index.ts`
  (`LENSES`, `DEFAULT_LENS` = `caddx-ratel-2`, `NO_LENS` = `'none'`). Chosen per camera: no fold inside the picture,
  then low RMS error and more images, official first. The Ratel 2 file is the only Ratel 2 one that does not fold
  (NTSC capture, 14 images, RMS 0.46; 128 x 103 deg, 156 diagonal).
- `render/lens.ts` (pure, tested): the model, `lensFov`, and `lensLayout(profile, w, h)`: fits the picture with bars,
  a 1024-entry radius -> angle table, and for each face the crop (tangent units) and size (enough texels that one
  screen pixel never spans less than one; measured over a 256-wide grid plus the picture's edges; 2 spare texels).
  Faces: front/back/right/left by heading, up/down only past `SIDE_REACH` = 2 (63 deg), so every listed lens needs 3
  faces. Principal point: the picture is centred on the lens axis (calibrations are off by up to 5 %: one camera's
  sensor mounting; the uptilt sets the horizon).
- `render/fisheye.ts` (`FisheyeView`): per face a `PerspectiveCamera` (frustum cut to the crop with `setViewOffset`,
  so Three.js keeps its reversed depth) into a half-float 4x MSAA render target; a `QuadMesh` TSL pass maps each
  screen pixel -> normalised point -> θ (table, `textureLoad` + blend: float textures need not filter) -> ray -> face
  -> `texture().level(0)` (sampled inside branches). A render target's v runs from its top row (found by looking:
  the first build was upside down).
- `engine.ts`: the FPV view and the free "Look around" camera go through the lens when one is set (the free camera
  was flat at first; owner, 2026-10-18: "the free fly camera should also have lens applied"); the chase camera stays flat; the faces follow
  the drawing buffer (resize, resolution slider); the warm-up also draws into a face-format target and the lens pass.
  `__fly.ask('return fly.fisheye.layout')` shows the faces.
- Settings: `lens` (default `caddx-ratel-2`); a "Lens" dropdown in Settings > FPV camera lists each lens with its
  horizontal x vertical FOV; "Flat (no fisheye)" brings back the FOV slider.

**Evidence (Chrome 155, WebGPU, production build, 1920 x 863 canvas, Ratel 2):**
- `pnpm test`: 48 files, 431 tests (new `apps/fly/test/lens.test.ts`: undistort inverts distort on all 15 lenses;
  Ratel 2 FOV 128/103/156, as a separate Python check of the file gave; the folding Ratel 1 is rejected; every
  picture ray lands inside its face's crop at 3 screen sizes; front-face resolution ~= screen at the centre; 3 faces
  per lens). Typecheck clean. `?selftest`: flight and traffic MATCH.
- Frame cost (render 120 times in a loop, wait for the GPU queue; CPU / total ms per frame):

  | View | Flat 120 deg | Lens, 5 cube faces (first build) | Lens, 3 faces (built) |
  |---|---|---|---|
  | Park | 0.44 / 0.49 | 2.18 / 2.32 | 1.37 / 1.43 |
  | City from 65 m | 0.43 / 0.50 | - | 1.45 / 1.54 |

  Draw calls: 71 flat, 127-130 with the lens. The cost is CPU (each face is a scene pass; the map's big meshes are in
  every face), not pixels. The HUD showed 120 fps with the lens.
- Screenshots: park `C:\Users\vhdbl\AppData\Local\Temp\claude-chrome-screenshots-GYM1tn\screenshot-1792333800574-18.jpg`,
  city `...-1792333951664-19.jpg`, the front/right face border zoomed (no seam) `...-1792333960250-20.png`.

**For the owner to try:** fly with the Ratel 2 and a few others (Settings > FPV camera > Lens). Does it look like
your goggles? Is the uptilt still right (a fisheye shows more sky and ground at the edges)? Black bars OK?

**Left open:** Firefox not checked (shelved). The calibrations are of recorded video (DVR / onboard), which may be
framed a little differently from the live goggle feed. No vignetting, analog noise or video latency. The chase camera
stays flat. If the CPU cost matters later: fewer draws per face (merge small meshes, fewer materials).

## 0n. Repo link on the main menu (owner, 2026-10-18): done

The main menu shows "Source code, issues and updates: github.com/ItsBlunty/Open-World-FPV-Simulator" under the
subtitle (`apps/fly/src/main.ts` `renderMenu`). It opens in a new tab so the sim keeps running. Links use the accent
colour (`style.css`). Evidence: typecheck clean, production build OK. Nothing left open.

**Menu pass (owner, 2026-10-18): "reorganize the menu to be more clear, hide USB radio if the browser doesnt support
webusb, make a disclaimer for firefox users".** The sim uses WebHID (not WebUSB) for radios, so "Connect USB radio"
is hidden when `navigator.hid` is missing; the gamepad button is then called "Connect radio or gamepad". The menu
(`main.ts` `renderMenu` and the functions above it) is now: title + GitHub link; a browser notice (Firefox: radios
only as a gamepad, at most ~250 reads/s, may stutter, use Chrome or Edge; any other browser without WebHID: a shorter
note); "1 · Controller" (status dot, connect buttons, "Run radio setup" highlighted when a radio is connected but not
set up, "How to connect a radio" steps folded away, the EdgeTX 1000 Hz tip inside); "2 · Start" (start point,
Settings, Fly / Look around); "Controls" showing only the keys for the current mode (Space / T only when the radio
has no arm / turtle switch); footer with renderer, licence, credit, repo link. Evidence: typecheck clean, build OK,
headless screenshots `docs/evidence/2026-10-18-menu/menu-chrome.png` and `menu-firefox.png`.
**Settings made obvious (owner, 2026-10-18):** "use a basic gear icon, put it in a corner", then "indicate more
clearly about camera, tilt, etc, that its all in the settings ... a larger explanation like the controls". A gear
button sits in the menu's top-right corner (next to GitHub), and a "Settings" section (between Start and Controls)
lists what Settings holds with the current values (camera uptilt + lens or FOV, rates, flight mode, traffic,
graphics, crashes) and an "Open settings" gear button. The gear is our own 8-tooth SVG path (`main.ts` `GEAR_PATH`),
no icon set. Screenshot: `docs/evidence/2026-10-18-menu/menu-chrome-settings.png`.
**Left open:** the connected-radio states (yellow "not set up", green "ready") were not screenshotted; Safari and
mobile were not tried.



## 0x. Chase camera see-through circle (owner, 2026-10-19): built, waiting for the owner to fly it

The owner: when a wall blocks the chase camera, show "a circle that covers like 50% of the screen with feathered
edges" so the quad shows through. (Taken as a circle half the screen high; easy to change.)

- `apps/fly/src/render/see-through.ts` (new): each chase frame, one ray along the collision mesh (`MeshContactWorld.rayT`,
  read only) from the camera to the quad. A hit closer than 0.3 m to the quad does not count (`CLEAR_M`: a wall the
  quad rests against). While blocked, the circle fades in over 0.15 s (`FADE_S`), and out again the same way.
- How it draws: after the normal frame, the scene is drawn again for the circle's square only (`setViewOffset`) with
  the near plane moved to 0.25 m in front of the quad (`CUT_M`, past the prop tips), so everything between the camera
  and the quad is cut away. That square is laid over the frame through a mask texture: fully see-through out to 55 %
  of the radius (`INNER`), a smooth fade to nothing at the edge. Radius 25 % of the screen height (`RADIUS`).
- Both renderers: WebGPU (target as the lens faces: half float, 4x MSAA) and the classic low spec one (8-bit sRGB
  target). The sun's shadow map is not redrawn for the second pass. Pipelines are built in the engine's warm-up.
- Chase camera only, live and in the replay viewer; not the spotter or free camera. Cars and people are not in the
  collision mesh, so they do not trigger it. Rendering only: determinism is unaffected (no hash changes).
- Cost: one extra scene draw of about a quarter of the screen while the circle shows; none otherwise.

**Evidence:** `apps/fly/test/see-through.test.ts` (3 tests: wall between, wall behind / beside / touching, mask
shape). Chrome (built-in browser pane, dev server, `?demo&cam=chase`, quad parked with `__fly.ask`):
`docs/evidence/2026-10-19-see-through/` tree-webgpu.jpg (through a pine), wall-webgpu.jpg and wall-lowspec.jpg (quad
1 m inside Harbour Medical Centre, camera outside: the floor and quad show through the wall, image upright, colours
match the frame). Moved into the open, the circle's fade went from 1 to 0. `pnpm test` 57 files, 489 tests.

**Fix (owner, 2026-10-19): "a bit larger", and it was upside down.** The WebGPU circle showed the scene flipped
top to bottom: the node renderer (WebGPU, and its WebGL fallback the same way) reads a render target with v = 0 at the
image's top (three.js r186 `TextureNode.setupUV` flips render targets so), and the overlay plane has v = 0 at its
bottom. The plane's v is now flipped for the node renderer; the classic low spec renderer reads v = 0 at the bottom and
was right. The earlier `tree-webgpu.jpg` and `wall-webgpu.jpg` were in fact flipped (the trunk hangs from above);
the "image upright" claim above was wrong. Radius 25 % to 32 % of the screen height (`RADIUS`, about two thirds of
the screen high). Evidence: `flipped-before.jpg` (circle forced on in the open: buildings below, grass above) and
`tree-webgpu-upright.jpg` (quad behind a pine: trunk down to the ground, horizon above). Low spec with the circle forced
on: upright (its pavement matches the frame). `pnpm test` 58 files, 502 tests; typecheck clean.

**Left open:** the owner's verdict on size, softness and fade; a single ray to the quad's centre, so a thin pole can
flick the circle on briefly and a wall hiding only part of the quad does not; the spotter camera could use it too.

## 1e. Graphics quality presets (owner, 2026-10-19): built, waiting for the owner

**Asked:** lay out the graphics settings as a real game does: an overall setting at the top. **Owner's answers:** five
presets (keep all three low spec modes); High and Medium differ in shadows and resolution.

**Built:** Settings > Graphics now starts with **Quality preset**: High (full renderer, shadows to about 250 m, 100 %),
Medium (the same with shadows to about 110 m; the default settings are Medium, so nobody's game changes), Low,
Very low and Super low (the low, extra and super low spec levels). A line under it says what the preset is. Under
**Details**: Renderer (the four levels), Resolution, and Shadows (Off / 110 / 250 / 500 m: the old on/off switch and
the distance in one box). Changing a detail shows the preset as Custom. The renderer and shadows on/off still apply on
reload (the notice and Reload now button stay); resolution and shadow distance apply at once. The presets live in
`graphics.ts` (`PRESETS`, `presetOf`, `applyPreset`, `cheaperPreset`; no new stored setting: the preset is read from
the details). The main menu's summary names the preset; the "running slowly" tip now suggests the next cheaper preset
(High -> Medium -> Low -> Very low -> Super low).

**Evidence** (`docs/evidence/2026-10-19-graphics-presets/`, built-in browser): `high.jpg` (preset High from saved
250 m shadows), `custom.jpg` (shadows set Off: Custom, reload notice), `low.jpg` (Low: Simple renderer, shadows none).
Medium moved the engine's shadow square back to 120 m live; after a reload on Low the page ran "WebGL 2, low spec" and
the menu read "Low: simple lighting, ...". 58 test files, 514 tests (5 new in `graphics.test.ts`); typecheck clean.
