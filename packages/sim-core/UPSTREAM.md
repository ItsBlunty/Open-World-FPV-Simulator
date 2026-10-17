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
- Our changes and new files in this package: GPL-3.0, like the rest of this project (owner's decision, 2026-10-17).
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
