# FPV Practice Sim

Open-source browser FPV simulator: realistic flight physics plus game design that rewards practice.
Goals, requirements and milestones: `SPEC.md`. Research history and why each decision was made: `HANDOFF.md`.
Read both before starting a new milestone.

<!-- Build, test and lint commands go here once M0 creates them. Keep this file under 200 lines. -->

## Architecture rules
- `packages/sim-core` is a separate component. It must never import from the game, renderer, UI or browser APIs.
  The game uses only its public exports from `packages/sim-core/src/index.ts`.
- Collision reaches sim-core only through its `ContactWorld` interface. Never add renderer or level types to sim-core.
- Worlds are pluggable (render + `ContactWorld`). Mesh levels are the only world type now; do nothing that
  would rule out adding Gaussian-splat worlds later.
- Keep the flight controller and the physics separable at the mixer output (four motor commands in [0, 1]),
  so real Betaflight (SITL) can replace the built-in controller later.

## Determinism
- Replays must stay bit-identical from stick inputs alone. Scoring, ghosts and leaderboards depend on it.
- In anything that affects simulation state: no `Math.random`, no wall-clock time, no frame-rate-dependent logic.
  Simulation advances only in sim-core's fixed 1 ms steps.

## Licensing and credit
- Project license is GPL-3.0-or-later (owner, 2026-10-17). Every new dependency, copied code and asset must be GPL-3.0-compatible.
- sim-core comes from ShramkoGSFPV (MIT, © Andrii Shramko). Keep his LICENSE, his NOTICE and the fdlibm/musl
  notices in `packages/sim-core`; never remove a copyright notice from any copied code.
- Code copied from Betaflight or other GPL projects must keep its original copyright header and name its source.
  Our changes and new files in `packages/sim-core` are GPL-3.0-or-later (owner, 2026-10-17); Andrii's original files keep their MIT notice.
- Record each third-party asset's source and license (CC0 preferred).

## Working with the owner
- The owner is an FPV pilot with basic Python experience; Claude writes the code. Explain decisions in plain language.
- Do not fill information gaps with assumptions. Research, or ask the owner.
- When citing a source, read it completely first. Prefer primary sources (official docs, the code itself).
- Flight feel can't be tested automatically: when a change affects handling, say so and ask the owner to fly it.
- Show evidence of checks (test output, screenshots), not just claims that something works.
