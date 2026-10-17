# Upstream: ShramkoGSFPV input code

Three files here come from **ShramkoGSFPV** by **Andrii Shramko** (MIT, Copyright (c) 2026 Andrii Shramko):

| | |
|---|---|
| Original project | https://github.com/AndriiShramko/ShramkoGSFPV |
| Copied from (owner's fork, same commit) | https://github.com/ItsBlunty/ShramkoGSFPV |
| Commit | `8c90f535a92ac63ada655772772f7f382ed1a5c9` (2026-10-16) |
| Files | `packages/input/src/hid-layout.ts`, `edgetx.ts`, `frame.ts` |
| Copied | 2026-10-17 |

His license and notice: [`LICENSE-MIT`](LICENSE-MIT) and [`NOTICE`](NOTICE), copied unchanged from the upstream
repository root. Everything else in this package is ours, GPL-3.0-or-later. `src/wizard.ts` is new code; it follows
rules upstream's wizard (`calib.ts`) found on real radios, credited in its header, but copies none of its code.

## Local changes

1. Each copied file got a two-line header naming its source.
2. `hid-layout.ts`, `edgetx.ts`: `import type { RawFrame } from './calib'` now imports from `./frame`
   (upstream's `calib.ts` was not copied).
3. `frame.ts`: the `RawFrame` interface added, copied from upstream `calib.ts` (lines 42-46), with a doc comment.
