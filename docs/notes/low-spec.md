# Low spec mode (old laptops with barely a GPU)

Section §0v. Read only when working on low spec mode or rendering performance; `HANDOFF.md` has the current state.

## 0v. Low spec mode (owner, 2026-10-18): built, waiting for the owner to fly it

**Asked:** "review options to make a low spec version of this game that still runs in the browser and has good
physics. Like super min spec, such that an old laptop with barely a gpu could run it", then "if you can find a good
solution, keep going until you solve it".

**Physics is not the problem** (Node, this machine, demo trick sticks, 20 s of sim): 5.7 µs per 1 ms step without
traffic, 20-23 µs with cars, people and signals, i.e. 0.6-2.3 % of one CPU core. A CPU 4-5x slower still spends
under ~12 %. So low spec keeps the full physics, untouched: same sim-core, same 1 ms steps, same hashes.

**Where the frame time went** (headless Chrome 155 on SwiftShader, a software GPU where the CPU draws every pixel,
as a stand-in for "barely a GPU"; 1366x768; probe scripts in `docs/evidence/2026-10-18-low-spec/`):
- Default (WebGPURenderer on its WebGL 2 backend, fisheye lens, 4096 shadow map, PBR materials): ~1 fps.
- With the whole scene hidden, the WebGPURenderer still drew only 4-6 fps at full resolution (an empty raw WebGL
  canvas: 120 fps): its multisampled, half-float output passes are a fixed full-screen cost.
- Triangles per frame: city 241 k, cars and people 980 k (rounded bodies, eyes, spokes), doors 20 k, props 16 k.
- The fisheye lens draws the scene into up to 5 cube faces (each 4x MSAA half float) every frame.
- Probe pitfall found and fixed: settings written to localStorage on `about:blank` are silently lost; the first
  "variant" runs were all the default settings.

**Options weighed:** (a) a separate lite app: duplicates the UI, rejected; (b) the same WebGPURenderer with features
off: still 14 fps at best on SwiftShader (fixed output-pass cost); (c) **Three.js's classic WebGLRenderer with cheap
materials, chosen**: 60 fps on SwiftShader with no traffic at half resolution in the first spike. Same Three.js
version: `three` and `three/webgpu` share `three.core.js`, so the scene objects are the same classes.

**Built** (`render/kit.ts` and its users; Settings > Graphics > Low spec mode, applies on reload; `?lowspec` forces it
on for a visit, `?lowspec=0` off):
- Renderer: `WebGLRenderer` (WebGL 2), no antialias, reversed depth as before, at most 1 device pixel per CSS pixel
  times the resolution slider. Menu footer reads "WebGL 2, low spec".
- Materials: a `Kit` (full: node materials; low spec: `MeshLambertMaterial` / `MeshBasicMaterial` /
  `LineBasicMaterial`) passed to every scene part (level, traffic, buildings, golden props, quad, replay path).
- Level: one mesh per 80 m tile with every opaque material merged and coloured per vertex; the 1 m / 5 m grid kept in
  a few lines of GLSL (`onBeforeCompile`, same maths as the TSL grid; a `grid` vertex attribute switches it off on
  PLAIN surfaces). No mullions on ribbon glass (a lighter glass colour instead). Frosted panels stay a separate
  transparent mesh.
- View distance: fog 160-650 m (full: 250-1600 m), camera far plane 660 m, so tiles out of view or past the fog are
  culled and never reach the GPU.
- No shadows, no fisheye lens (the flat camera and its FOV slider apply; the settings screen says why).
- Traffic: fewer segments on round parts (980 k -> 314 k triangles), and movers further than 250 m from the camera
  are not drawn. **Both kits now pack the drawn cars and people into the first instances** (with their colours) and
  set `count`, instead of zero-scaling hidden ones; the picture is the same, the GPU skips the rest.
- Hint: in full graphics, if the HUD frame rate stays under 30 fps for 5 s while flying, a toast says once a visit
  "Try Low spec mode: Esc > Settings > Graphics".

**Measured** (same probes):
| Setup | SwiftShader, park | SwiftShader, city street |
|---|---|---|
| Full graphics, default settings | ~1 fps | ~1 fps |
| Low spec, traffic on, 100 % / 50 % resolution | 28 / 34 fps | 17 / 23 fps |
| Low spec, traffic off, 100 % / 50 % resolution | 59 / 90 fps | |

Slow CPU (real GPU, Chrome's CPU throttling of the page, city street spawn): full graphics 47 fps at 4x, 21 fps at
6x; low spec 105 fps at 4x, 77 fps at 6x. Load to ready: about half the time in low spec.
SwiftShader is far slower than any real GPU (its vertex work runs on the CPU), so real weak GPUs should do better than
the first table. Screenshots: `docs/evidence/2026-10-18-low-spec/city-full.png`, `city-lowspec.png` (same colours and
grid, no shadows). The replay viewer runs in low spec (path line drawn, 133 draws).
Tests: 54 files, 475 pass; typecheck clean; pinned hashes unchanged (rendering only).

**Left open:** not tried on a real old laptop (the owner's or anyone's). No view-distance slider (fixed 650 m). No
cheap lens for low spec (a single wide render warped in one pass could give a mild fisheye). Signal poles and lamps
(about 77 k triangles) are still drawn city-wide. WebGL 1-only machines (pre-2012 GPUs or blocklisted drivers) can't
run it: Three.js r163+ needs WebGL 2.

**GPU acceleration off (owner question, 2026-10-19):** works. Chrome 155 on Windows with `--disable-gpu` (the same as
"Use graphics acceleration when available" off) still gives WebGL 2, drawn by WARP ("Microsoft Basic Render Driver",
Windows' own software D3D11), not SwiftShader, so Chrome's removal of the SwiftShader fallback doesn't block it. Headless
probe on this machine, park spawn, menu open: low spec 60 fps (vsync cap), full graphics 8 fps. A slow laptop CPU will
draw slower than this one. Not checked: Edge, Windows without WARP, real old hardware.

## Super low spec: no GPU and an old CPU (owner question, 2026-10-19): measured, not built

**Asked:** "Is there any way we could get an old laptop to run this, like maybe SUPER low spec mode? Still with the
same physics? We should probably auto disable all the cars and people, and driving mechanics on super low spec mode.
Targeted at NO GPU and old CPU."

**Stand-in:** headless Chrome 155, GPU off (WARP draws every pixel on the CPU), Chrome pinned to 2 cores (or 1), the
page's CPU throttled 4x, city street spawn, menu open, 1350x673. Pinning cores slows WARP's drawing; the 4x throttle
slows our JavaScript only. A real old dual-core is slower per core than this machine, so expect lower numbers there.
Probes: `docs/evidence/2026-10-19-no-gpu/`.

| Low spec, GPU off, 4x CPU | fps |
|---|---|
| 2 cores, traffic on / off | 17 / 24 |
| 1 core, traffic on / off | 13 / 17 |
| 1 core, traffic off, half resolution | 29 |

Levers, one at a time (2 cores, traffic off, base 21 fps, 158 k triangles, 71 draws):
| Lever | fps |
|---|---|
| half resolution | 35 |
| 0.35 resolution | 40 |
| view distance 300 m (fog 120-290 m) | 25 |
| hide buildings' doors, frames, signs, golden props, frosted panels | 25 |
| unlit materials instead of Lambert | 24 |
| half resolution + 300 m + hidden details + unlit | 45 |

**Findings:** with no GPU, pixels cost most; triangles are the next floor (at 0.35 resolution it stops scaling).
Main-thread JavaScript is about 5 % of a frame (profile: 4.1 s of 4.3 s outside JS, waiting on drawing). Physics stays
small (20 µs per 1 ms step with traffic, about 6 µs without, on this machine), so the same physics fits an old CPU.
Traffic costs about a quarter of the frame rate here, so super low spec turns cars, people and signals off.

**Owner (2026-10-19): "We need to hit 60 fps not 45".** Same stand-in, menu closed and HUD on (the open menu alone
cost about 6 fps), all levers above plus these (traffic off throughout):
| Setup | 2 cores, street / 40 m up | 1 core, street / 40 m up |
|---|---|---|
| half resolution, 300 m view | 52 / 56 (HUD hidden) | |
| half resolution, 200 m view (fog 80-195 m) | 59 / 60 | 43 / 53 |
| 0.35 resolution, 200 m view | 60 / 60 | 54 / 56 |
| empty level (sky only), half resolution | 60 (HUD hidden) | |
At 200 m the city is 81 k triangles in 35-42 draws (300 m: 117-121 k). With traffic on (half resolution, 200 m):
49 fps on 2 cores. At 6x CPU throttle instead of 4x: still 60 on 2 cores, so our JavaScript isn't the limit.
**So:** 60 on 2 cores needs traffic off, 200 m view and half resolution; 1 core needs resolution lower than 0.35. A
real old core is slower than these, so a resolution that drops by itself when frames run late is the way to hold 60.

**Built (owner, 2026-10-19: "three low spec modes"):** Settings > Graphics is now a choice of four (`graphics.ts`,
`render/kit.ts`); the old low spec switch carries over as Low spec. `?lowspec` = low, `?lowspec=extra`,
`?lowspec=super`, `?lowspec=0` full, for one visit.
- **Extra low spec:** low spec at half resolution (fixed; the slider is hidden), fog 120-290 m and the camera's far
  plane 300 m, no cars, people or traffic lights (whatever their switches say; the switches keep the pilot's choice
  for full and low), no doors or name signs (the entrances show their shop-front glass), golden props with fewer
  segments. Frosted shelter glass stays (it is solid, and props hide behind it).
- **Super low spec:** the same at a quarter resolution, fog 80-195 m, far plane 205 m.
- The slow-running hint now points at the next cheaper level (full > low > extra > super), once a visit.
- Saved flights keep their own traffic in their header, so replays of flights flown with traffic still show it.

**Measured, built game** (same stand-in: no GPU, 4x CPU, menu closed, HUD on; traffic switches all on, forced off):
| Mode | 2 cores, street / 40 m up | 1 core, street / 40 m up |
|---|---|---|
| Extra low spec | 41 / 50 | 35 / 42 |
| Super low spec | **60 / 60** | 55 / 54 |
Super draws 88 k triangles in 38-45 draws. Screenshots: `docs/evidence/2026-10-19-no-gpu/city-extra.png`,
`city-super.png` (blocky, and thin lattice like the crane breaks up at a quarter resolution), `settings-super.png`.
Tests: 56 files, 486 pass (new `graphics.test.ts`); typecheck clean; hashes unchanged (rendering and traffic toggles only).
**Left open:** not tried on a real old laptop; 1 core stays under 60 in super; no automatic switch when the browser
has no GPU (owner not asked yet: auto-switch or tip).

## Low spec fisheye lens (owner, 2026-10-22): built; on main 2026-10-24

**Asked:** "Is it possible to make a simple version of fisheye that is runnable on lower spec machines? Feels kinda bad
to just have to disable fisheye lenses to fly on a cheap laptop." Then "Lets build it".

**Why there was none:** the lens (`render/fisheye.ts`) was written for the WebGPURenderer (TSL), and low spec runs the
classic WebGLRenderer; it also drew 3 cube faces a frame into 4x multisampled half-float targets.

**First try, the same 3 faces in GLSL** (8-bit sRGB targets, no MSAA, 0.7 texels per screen pixel): the lens cost
40-45 % of the frame rate everywhere (city street; probes `docs/evidence/2026-10-19-no-gpu/fps.mjs`):
| Setup | flat | 3 faces |
|---|---|---|
| Low, real GPU, CPU 6x throttled | 105 | 64 |
| Extra, no GPU (WARP), 2 cores, 4x CPU | 37 | 21 |
| Super, same | 57 | 36 |
| Low, SwiftShader | 13.4 | 7.4 |
Levers (super / extra, WARP): flat at 103 deg vertical instead of 60: 57 / 35, i.e. a wider view costs nothing; lens
without its two side faces: 57 / 36, i.e. flat speed. **The side faces were the whole cost:** each is a scene pass
that draws every 80 m city tile it touches whole (in Super: 23 draws, 49 k triangles flat; 51 draws, 97 k with 3 faces),
though it covers only a strip at the edges. Fewer texels per face barely helped (0.5: 41 / 27, 0.35: 41 / 27).

**Built: one wide face.** `lensLayout(..., single)` puts the whole picture on the front face (every lens offered stays
under 80 deg off the axis; the crop reaches tan 1.9-4.8). Low spec draws it once into an 8-bit sRGB target with
mipmaps, and a GLSL pass maps each screen pixel through the lens to it (no branch round the read, so the GPU picks the
mipmap level: the face is squeezed up to ~15x at the edges, and without mipmaps they would shimmer). Texels per screen
pixel at the centre: 0.7 in Low, 0.5 in Extra and Super (`LOW_SPEC_OVERSAMPLE`, `NO_GPU_OVERSAMPLE`); the face is then
~1.5-4x the screen's pixels (Ratel 2 at 1366x768 Low: 1773x1407). Full graphics keep the exact 3-face lens.
- Near plane: each face camera's near plane is brought in to `CAMERA_NEAR / hypot(1, crop corner)`, so nothing 1 cm
  from the lens is cut at a wide crop's corners. Without it the single face cut the quad's own frame at the bottom
  corners (the 3-face lens also lost a sliver there; both builds now match: `city-lowspec-lens.png`, `city-full-lens.png`).
- Settings > Camera > Lens is offered in every mode. In Extra and Super it adds "With no GPU the fisheye costs about a
  third of the frame rate ... Flat is faster". The saved lens applies in every mode (default Ratel 2), so low spec
  pilots now get the lens unless they pick Flat.

**Measured, built game** (city street; two runs each, these probes vary by up to ~15 %):
| Setup | flat | lens (built) |
|---|---|---|
| Low, real GPU, CPU 6x throttled | 98-105 | 104-105 |
| Extra, no GPU (WARP), 2 cores, 4x CPU | 33-34 | 18-21 |
| Super, same | 57 | 39-40 |
| Low, SwiftShader, full resolution | 13.6 | 4.8 (at 0.7) / 7.1 (at 0.5) |
Tried and dropped: a linear 8-bit target without mipmaps (Extra 24, Super 39-40: a small gain, with banding and
shimmering edges). Screenshots: `docs/evidence/2026-10-22-low-spec-lens/` (`city-super-lens.png` against
`city-super-flat.png`: blocky both ways at a quarter resolution).
Tests: `lens.test.ts` checks the single-face layout for all 15 lenses (every ray in front and inside the crop, 0.7
texels at the centre). 75 files, 659 pass + 1 expected fail; typecheck clean; rendering only, hashes unchanged.

**Left open:** not tried on a real weak laptop; with no GPU the lens still costs about a third (Extra, Super); the
centre is softer than in full graphics (0.7 / 0.5 texels per pixel).

**On main (owner, 2026-10-24):** "Bring it over, but make sure its clear on the camera menu that this is a special
fisheye that is worse on purpose because its low spec." Brought over from branch main-bng8wu without the physics. In
any low spec mode Settings > Camera now opens with a "Low spec fisheye." note (a simplified version, worse on purpose,
softer most of all at the edges; the full lenses in High and Medium), and each lens in the list ends "(low spec
version)". Checked in headless Chrome: `menu-super.png` (super low spec, the lens drawn behind the menu), `menu-full.png`
(full graphics: no note, no tag). 69 files, 620 tests pass; typecheck clean.
Owner: "This is not clear at all. It looks like simple explainer text." Now a warning box under the Lens list (amber
border and tint, "⚠ LOW SPEC FISHEYE: LOWER QUALITY ON PURPOSE", "This is not the real lens ... For the real fisheye, set
Graphics to High or Medium"), the row label "Lens (low spec)" in amber, each lens "LOW SPEC · <name>". Shots re-taken.
