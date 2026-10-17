# Upstream: ShramkoGSFPV sim-core

This package is the flight model from **ShramkoGSFPV** by **Andrii Shramko**.

| | |
|---|---|
| Original project | https://github.com/AndriiShramko/ShramkoGSFPV |
| Copied from (owner's fork, same commit) | https://github.com/ItsBlunty/ShramkoGSFPV |
| Commit | `8c90f535a92ac63ada655772772f7f382ed1a5c9` (2026-10-16) |
| Path in that repo | `packages/sim-core` |
| Upstream version | `SIM_CORE_VERSION = 'sim-core/0.2.0'`, package `@gsfpv/sim-core` 0.1.0 |
| Copied | 2026-10-17 |

## Licenses

- Andrii Shramko's original code: MIT, Copyright (c) 2026 Andrii Shramko. See [`LICENSE`](LICENSE) and
  [`NOTICE`](NOTICE), both copied unchanged from the upstream repository root.
- `src/dmath.ts` ports fdlibm (Sun Microsystems notice) and musl libc (MIT). The notices are in that file and in `NOTICE`.
- Our changes and new files in this package: GPL-3.0-or-later, like the rest of this project (owner's decision, 2026-10-17).
  Original files keep their MIT notice; a changed file is under both.

## Also copied from upstream

- `docs/PROVENANCE.md`: upstream `docs/PROVENANCE.md`, unchanged. Says where each formula and constant comes from.
  Paths in it are relative to the upstream repository, not to this one.
- `docs/research/drones-v08.md`: upstream `docs/research/drones-v08.md`, unchanged. Sources for three presets.

## Local changes

Every change made here after the copy, newest last. The first commit holds the upstream files unchanged,
so `git diff` against it shows exactly what we changed.

1. `package.json`: renamed from `@gsfpv/sim-core` to `@owfpv/sim-core`, version 0.1.0 → 0.2.0 to match
   `SIM_CORE_VERSION`, license field updated, its own dev dependencies (TypeScript, Vitest) added. No code change.
2. `vitest.config.ts` added (upstream used one at its repository root), so this package tests on its own.
3. Bot pilot ported: upstream `packages/input/src/sim/{bot,plan,scenario}.ts` (same commit, MIT, Andrii Shramko)
   copied to `src/bot/`. Only change: imports of `@gsfpv/sim-core` now point to `../index`. New `src/bot/index.ts`
   and package export `./bot`. Tests that imported the bot from `../../input/src/sim/` now import it from `../src/bot/`.
   Not ported: the rest of upstream `packages/input` (radio, gamepad, keyboard input, the simulated human pilot).

   Caveat: the bot and planner use `Math.tan`, `Math.atan2`, `Math.sin`, `Math.cos` and `Math.hypot`, which can differ
   between JavaScript engines. Replays stay exact (they replay the recorded sticks, not the bot), but the same bot
   flight is not guaranteed to produce identical sticks in Node and in every browser.
4. Tests that needed upstream's voxel collision and its scanned scene 39e63ce9 moved to `packages/world-mesh/test/`
   and fly in a mesh test room instead: `respawn-realfloor.test.ts` → `respawn-room.test.ts`, `model-pinned.test.ts`
   (same name), `b12-rewind.test.ts` → `b12-dash.test.ts`. Each marks its changes with `port:` comments, including the
   upstream checks that do not carry over to mesh geometry and why. `test/fixtures/b12-control-chrome-life.json`
   (a flight recorded on the scan, which replays only there) removed.
5. `src/sim.ts`: `Sim.step()` split into `arming()`, `controller()` (setpoints, self-level, rate PID, mixer; writes
   `motorCmd`) and `physics(motorCmd)` (motors to crash settling), so another flight controller can drive the physics
   through four motor commands (SPEC.md R1). No calculation changed: traces are bit-identical, shown by every replay
   test, including upstream's saved format /2 logs replaying to their saved hashes (`test/log-v2-compat.test.ts`).
6. `src/director.ts`: a "stuck, pinned" rule (`PINNED_TICKS`, `pinSince`) after the wedged rule, for a craft held
   against a ceiling with the throttle below hover (`docs/physics-review.md` F2). Physics and traces unchanged.
7. `src/sim.ts`, `src/platform.ts`, `src/params.ts`, `src/director.ts`, `src/index.ts` (sim-core/0.3.0, changes traces):
   the contact model is replaced by a contact solver over every touching sphere (`contactsAt`, `sweepImpact`,
   `pushClear`, `applyHit`), `ContactWorld` gains `contacts()`, the state gains `S.health` and a damage model with
   a landing rule (params `vHarm`, `vLandSafe`, `vLandCrash`), `contact` events gain `damage`, and item 6's pinned
   rule is removed. Upstream's `contact`, `impact`, `impulse`, `pinnedContacts`, `restOnDisc` and their helpers are
   gone; restitution values and the crash settling are upstream's. Tests: assertions that recorded the old contact
   chatter now record its absence (`model-platform`, `respawn-director`; in `packages/world-mesh`: `respawn-room`,
   `model-pinned`, `b12-dash`), `wind` checks the new state size, `log-v2-compat` no longer expects 0.2.0's saved
   hashes (each test says why); new `test/model-damage.test.ts`. `SIM_CORE_VERSION` is `sim-core/0.3.0`.
8. `src/sim.ts`, `src/index.ts` (sim-core/0.3.1, changes traces): prop strikes (`propStrikes`, `STRIKE_*`): a prop
   touching a surface over its intake makes no thrust (`docs/physics-review.md` F4); `contactsAt` is split into
   `gatherContacts` and `solveContacts` so the start-of-tick contacts reach the motors. Tests: in `packages/world-mesh`,
   `contact-solver` (the ceiling case; new wall-hit and take-off tests), `model-pinned` and `b12-dash` (the craft now
   drops off the wall it leans on with its props; each test says why). `SIM_CORE_VERSION` is `sim-core/0.3.1`.
