# Changelog

Versions follow `SIM_CORE_VERSION` in `src/index.ts`. It changes whenever a change alters flight traces.

## sim-core/0.3.0: contact solver, damage, landing (2026-10-17)

Changes traces: every flight that touches anything, and every trace hash (the state has one more slot).
Logs recorded by sim-core/0.2.0 no longer replay to their 0.2.0 trace.

- **Contacts** (`sim.ts`, `contactsAt`): every body sphere's surfaces within 5 mm are gathered each tick and
  solved together (projected Gauss-Seidel with accumulated normal impulses and Coulomb-cone friction, the method
  of the platform's former resting solver, extended to any surface). A contact may close its gap in the tick and
  no further (speculative contacts), so a craft arrives on a surface instead of bouncing off a 1 mm skin.
  Faster impacts are still found by the swept test, now with spheres 0.5 mm smaller so a resting sphere is not
  "overlapping"; the craft stops at that pose and the contacts there are solved together. Penetration left over
  is undone by moving the pose (`pushClear`), never by discarding the tick's motion or adding speed.
  Result: a craft resting on a floor, against a wall or pressed under a ceiling is still and its gyro reads
  ~1e-6 rad/s (0.2.0: several rad/s of rocking); a level impact is shared by every sphere that meets the surface
  (physics-review F1); a quad no longer stays pinned under a ceiling with the throttle down (F2).
  Removed: the single impulse at the first sphere, `pinnedContacts` and the `Sim.pinnedPass` test seam, the 1 mm
  skin, the start-overlap branch, `restOnDisc` (the platform now uses the same solver).
- **`ContactWorld.contacts()`** (new, required): the surfaces within a distance of a point, as normal and
  distance. `PlatformContact` implements it; `PlatformContact.hitDisc` is gone.
- **Damage** (`S.health`, a new state slot at index 70, `S.size` 71): 1 at every spawn and respawn, down by
  each impact. A hit takes nothing up to a safe speed, then grows with the impact energy (speed squared) to all
  of the health at the crash speed. A hit whose contact normal is within 30 deg of the body's up axis is a
  landing on the frame's underside: safe up to `vLandSafe` (default 0.8 x `vCrash`), all of the health at
  `vLandCrash` (2 x `vCrash`); beyond 60 deg it is the props, arms or top: `vHarm` (default `vBounce`) and
  `vCrash`; blended in between. Health 0 is a crash (as before: disarmed, motors stopped). With crashes off
  nothing is damaged. A fresh craft crashes on the same single hit as before on its props; a landing on the
  underside now crashes at 2 x `vCrash` instead of `vCrash`. New overrides: `vHarm`, `vLandSafe`, `vLandCrash`.
- **Events**: `contact` events gain `damage` (the share of the health the hit took). A contact already touching
  that the tick's forces press in (under 1 m/s) is no impact: no event, no damage. Restitution is 0 under
  0.25 m/s approach.
- **Respawn director**: the "stuck, pinned" rule (below) is removed; the contacts no longer pin a craft.

## Unreleased before 0.3.0 (traces unchanged, still sim-core/0.2.0)

- The bot pilot from upstream's `packages/input` is part of this package, exported as `./bot`.
- `Sim.step()` is split into the flight controller and the physics, which meet only at the four motor
  commands. Traces are bit-identical.
- Tests that needed upstream's voxel collision moved to `packages/world-mesh`.
- Respawn director: a new "stuck, pinned" rule (armed, still, touching something above, throttle stick
  below hover, 1.5 s: rewind, reason `stuck-wedged`). It works around physics-review finding F2
  (removed in sim-core/0.3.0, which fixes F2). The
  physics is unchanged and every log replays as before (replays apply logged respawns, never the
  director); only live runs that get pinned under a ceiling now respawn where they stayed stuck before.

## sim-core/0.2.0: vendored (2026-10-17)

Copied unchanged from ShramkoGSFPV at commit `8c90f535a92ac63ada655772772f7f382ed1a5c9`. See `UPSTREAM.md`.
