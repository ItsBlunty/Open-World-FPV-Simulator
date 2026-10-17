# Open World FPV Simulator

An open-source, browser-based FPV drone simulator with realistic flight physics and game design
that rewards deliberate practice. Early development: nothing is flyable yet.

- What we're building and in what order: [`SPEC.md`](SPEC.md)
- Why each decision was made: [`HANDOFF.md`](HANDOFF.md)
- Physics findings collected for the M2 review: [`docs/physics-review.md`](docs/physics-review.md)

## Packages

| Package | What it is |
|---|---|
| `packages/sim-core` | The flight model, from [ShramkoGSFPV](https://github.com/AndriiShramko/ShramkoGSFPV) by Andrii Shramko (MIT). See its `UPSTREAM.md`. |
| `packages/world-mesh` | Collision against triangle meshes for sim-core (its `ContactWorld`), plus ray and sphere queries. |

## Development

Needs Node 22.12+ and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
```

## License

GPL-3.0 (see [`LICENSE`](LICENSE)). Included third-party code keeps its own license and copyright
notices; `packages/sim-core` contains MIT code by Andrii Shramko.
