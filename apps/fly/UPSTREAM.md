# Upstream: ShramkoGSFPV app code

Four files here come from **ShramkoGSFPV** `apps/fly` by **Andrii Shramko** (MIT, Copyright (c) 2026 Andrii Shramko),
commit `8c90f535a92ac63ada655772772f7f382ed1a5c9` (2026-10-16), via the owner's fork https://github.com/ItsBlunty/ShramkoGSFPV,
copied 2026-10-17. His license and notice: [`LICENSE-MIT`](LICENSE-MIT) and [`NOTICE`](NOTICE), copied unchanged from the
upstream repository root. Everything else in this app is ours, GPL-3.0-or-later.

| File here | Upstream file |
|---|---|
| `src/simclock.ts` | `apps/fly/src/simclock.ts` |
| `src/devices/hid.ts` | `apps/fly/src/devices/hid.ts` |
| `src/devices/gamepad.ts` | `apps/fly/src/devices/gamepad.ts` |
| `src/devices/reconnect.ts` | `apps/fly/src/devices/reconnect.ts` |

## Local changes

1. Each file got a two-line header naming its source.
2. Imports of `@gsfpv/input` and `@gsfpv/sim-core` now point to `@owfpv/input` and `@owfpv/sim-core`.
3. `reconnect.ts`: upstream's `Profile` type is our `RadioProfile` (`import type { RadioProfile as Profile }`).
4. `hid.ts`: `makeHidReader(d)` casts the device to the reader's own descriptor type, because the WebHID typings we use
   (`@types/w3c-web-hid`) mark `reportId` optional where upstream's own typings did not. No behaviour change.
5. `gamepad.ts` (owner, 2026-10-18): a pad that the poll finds in `getGamepads()` is announced through `onConnect`
   as if `gamepadconnected` had fired (a pad touched before `start()` sends no event); `onConnect` fires once, for the
   adopted pad only, not for later pads or reconnects.
6. `gamepad.ts` (owner, 2026-10-18): the poll runs on a worker's 1 ms timer (`startClock`) instead of upstream's
   MessageChannel spin, which starved Firefox's frames (120 -> 25 fps). Measurements: `docs/evidence/2026-10-18-gamepad-clock/`.
7. `gamepad.ts` (owner, 2026-10-18): the worker clock sets each 1 ms timeout from a message task (no 4 ms timer clamp:
   ~665 ticks/s in Firefox, ~544 in Chrome) and the poll gate is 0.5 ms (was 2 ms); the stamp comment notes that
   Firefox's Gamepad.timestamp is the main-thread apply time. Evidence: `docs/evidence/2026-10-18-render-worker/`.
