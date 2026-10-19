# No GPU probes (2026-10-19)

`probe.mjs`: which WebGL renderer Chrome gives with the GPU on, `--disable-gpu`, and SwiftShader.
`fps.mjs`: the low-spec probe from `../2026-10-18-low-spec/` plus `warp` mode (`--disable-gpu`), `AFF=<mask>` to pin
Chrome to some cores (`3` = 2 cores, `1` = 1 core), and `PRE=<file>` to run code in the engine before measuring.
`A.js`-`G.js`: the levers measured in `docs/notes/low-spec.md` (super low spec section). `count.js`: triangles per part.
Serve the built game with `../2026-10-18-low-spec/serve.mjs <absolute dist path> 18777`; settings need a
`dist/blank.html` to be written to localStorage first.
`PAGEPRE=<expression>` runs in the page before measuring (used to hide the menu; the HUD stays). `H`-`J`, `L`: lower
resolution, 200 m view, empty level. `*air.js`: the same with the free camera 40 m up. `count2.js`: triangles by part.
