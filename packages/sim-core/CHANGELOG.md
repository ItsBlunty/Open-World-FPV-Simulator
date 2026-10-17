# Changelog

Versions follow `SIM_CORE_VERSION` in `src/index.ts`. It changes whenever a change alters flight traces.

## Unreleased (traces unchanged, so still sim-core/0.2.0)

- The bot pilot from upstream's `packages/input` is part of this package, exported as `./bot`.
- `Sim.step()` is split into the flight controller and the physics, which meet only at the four motor
  commands. Traces are bit-identical.
- Tests that needed upstream's voxel collision moved to `packages/world-mesh`.
- Respawn director: a new "stuck, pinned" rule (armed, still, touching something above, throttle stick
  below hover, 1.5 s: rewind, reason `stuck-wedged`). It works around physics-review finding F2. The
  physics is unchanged and every log replays as before (replays apply logged respawns, never the
  director); only live runs that get pinned under a ceiling now respawn where they stayed stuck before.

## sim-core/0.2.0: vendored (2026-10-17)

Copied unchanged from ShramkoGSFPV at commit `8c90f535a92ac63ada655772772f7f382ed1a5c9`. See `UPSTREAM.md`.
