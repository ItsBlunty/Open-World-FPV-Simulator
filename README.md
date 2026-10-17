# Open World FPV Simulator

An open-source, browser-based FPV drone simulator with realistic flight physics and game design
that rewards deliberate practice. Early development: the first blockout map is flyable with an EdgeTX radio over USB (or a gamepad).

- What we're building and in what order: [`SPEC.md`](SPEC.md)
- Why each decision was made: [`HANDOFF.md`](HANDOFF.md)
- Physics findings collected for the M2 review: [`docs/physics-review.md`](docs/physics-review.md)

## Packages

| Package | What it is |
|---|---|
| `packages/sim-core` | The flight model, from [ShramkoGSFPV](https://github.com/AndriiShramko/ShramkoGSFPV) by Andrii Shramko (MIT). See its `UPSTREAM.md`. |
| `packages/world-mesh` | Collision against triangle meshes for sim-core (its `ContactWorld`), plus ray and sphere queries. |
| `packages/input` | Radio input without the browser: HID report reading (from ShramkoGSFPV, MIT), radio profiles, the calibration wizard. |
| `packages/maps` | Levels as code: the first map's blockout geometry, its collision triangles and spawn points. |
| `apps/fly` | The simulator page: Three.js rendering (WebGPU, WebGL 2 fallback), radio setup, FPV camera, HUD, settings. |

## Development

Needs Node 22.12+ and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm dev       # the simulator at http://localhost:5173
```

URL options for checks: `?selftest` (flies a scripted flight and compares its hash with Node's), `?demo` (scripted
flight, no radio needed), `?webgl` (force WebGL 2), `?spawn=bando`, `?cam=chase`.

## License

GPL-3.0-or-later (see [`LICENSE`](LICENSE)). Included third-party code keeps its own license and copyright
notices; `packages/sim-core` contains MIT code by Andrii Shramko.
