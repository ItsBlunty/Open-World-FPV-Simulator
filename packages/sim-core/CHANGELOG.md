# Changelog

Versions follow `SIM_CORE_VERSION` in `src/index.ts`. It changes whenever a change alters flight traces.

## Unreleased (no trace change)

- `ParamOverrides.smallAngleDeg` (`SimParams.smallAngleDeg`): Betaflight's small_angle, 0-180 deg (clamped). Arming
  needs the craft within it of level unless the turtle switch is on; 180 arms at any tilt. Absent: 25, the exact
  constant as before (hashes unchanged). The game's "Arming angle" setting (default 180, owner 2026-10-20). Test:
  `test/crashflip.test.ts` "arming angle".

- `ContactWorld.movingNear?(x, y, z, r)`: is a moving surface (car, person, train) within r of the point at this tick.
  The respawn director keeps respawns clear of them (owner, 2026-10-20): a rewind skips kept spots with one there now and
  goes further back (`StateHistory.pickBefore` takes an optional `free` test); a start with one on it is raised in
  0.25 m steps, up to 8 m, until clear of it and of the scene. Respawns are log records, so replays and traces are
  unchanged; a world without movingNear behaves as before. Test: `test/respawn-movers.test.ts`.

- `Sim.bladeBrake(i)`: reads how hard a surface brakes each prop this tick (the game's prop-strike sound). Traces and
  hashes are unchanged, so `SIM_CORE_VERSION` stays 0.7.0.
- `ParamOverrides.batteryDrain` (`SimParams.batteryDrain`): `false` keeps the pack's state of charge where the life set
  it (the voltage still sags under load); absent or `true` drains it as before, bit for bit (self-test hashes
  unchanged). The game's "Battery simulation" switch. Test: `test/model-physics.test.ts` "battery drain switch".

## sim-core/0.7.0: wall bounces and blade strikes (2026-10-19)

Changes traces of any flight that touches something (new self-test hashes `1eb33767…`, classic physics `c1c4280b…`).
Free flight is bit for bit 0.6.0. `docs/physics-review.md` F6.

- **Restitution of hits on the props, arms, sides and top** (`E_WALL`, `V_WALL`): 0.526 up to 1.85 m/s, measured for a
  rigid quadrotor on a wall (Liu and Karydis 2023, arXiv:2307.11309), then falling as (1.85 / v)^(1/4) (estimate):
  0.34 at 10 m/s (was 0.10), 0.31 at 15 (was 0.07). Underside hits keep upstream's landing curve; between 30 and
  60 deg from the body's up axis the two blend. A wall hit now bounces the quad off instead of leaving it flat on it.
- **Blade strikes** (`BRAKE_*`, `Sim.brake`): a prop whose disc meets a surface edge-on (its normal more than 60 deg
  from the thrust axis) stalls: the rotor speed decays with a 5 ms time constant (estimate) while it touches, and the
  motor lag spins it back up once clear. Surfaces over or under the prop (within 30 deg of its axis) do not brake it.
- Tests: new bounce tests in `packages/world-mesh/test/contact-solver.test.ts`; tests that recorded a quad resting
  against a wall, slab or ceiling now record the bounce or the stall (each says why).

## sim-core/0.6.0: rotor inflow (2026-10-18)

Changes traces of presets that opt in (the Nazgul `nazgulf5v3-6s`, the game's drone: new self-test hash `af127b88…`).
Every other preset, and the Nazgul with `classicPhysics`, flies bit for bit as in 0.5.0 (the self-test with classic
physics keeps `cd45c59c…`). `docs/physics-review.md` G1.

- **Rotor inflow** (`Sim.inflowThrust`, `RotorInflow`): each forward-spinning prop's thrust follows the air through
  it: the airspeed at its hub (with the body rotation's w x r, so a roll is damped a little) split into climb and
  in-plane parts. Blade-element thrust from Gill and D'Andrea 2019 (Drones 3(4):77, eq. 27, parameters predicted from
  the static thrust and the prop pitch, their Section 4) with Glauert's momentum theory for the induced inflow,
  solved by bisection (32 halvings, only + - * / and sqrt). At rest the thrust is exactly the classic model's, so
  hover throttle and thrust-to-weight are unchanged. Checked against NeuroBEM's 75 min of measured flight of a 772 g
  5-inch quad (Bauersfeld et al. 2021): thrust error 0.85 N RMS against 1.37 N for thrust from rotor speed alone.
- Presets opt in with `prop_pitch_in` (with `prop_diameter_mm`) and `cda_vertical_inflow_cm2`, the frame's own drag
  from above: the classic `cda_vertical_cm2` stood in for the props unloading at speed. The Nazgul: 3.5 in, 150 cm^2.
- **`ParamOverrides.classicPhysics`**: the 0.5.0 model even for a preset with inflow, to compare (owner's request).
- The reaction (yaw) torque and the battery power keep following the thrust the rotor makes at its speed in still
  air. A reversed prop (turtle mode) keeps the classic model.
- The airspeed is computed before the motors (it was after them); the arithmetic is the same, so traces without
  inflow do not change.

## sim-core/0.5.0: moving surfaces (2026-10-17)

Changes traces only in worlds whose surfaces move (new). A still world flies bit for bit as in 0.4.0: every earlier
test and saved hash passes unchanged, the self-test hash included (`cd45c59c…`).

- **`ContactWorld.at?(tick)`** (optional): a world with moving surfaces places them where they are at that tick. The
  sim calls it at the start of every `step`, before any query, also while parked at the spawn. The surfaces must be a
  function of the tick alone, so replays stay exact from the sticks.
- **Surface velocity** (optional `vel` out-array on `ContactWorld.contacts()`, 3 numbers per contact, m/s world):
  the sim zeroes it before each query, so a still world can ignore it. The contact solver works on the craft's
  velocity relative to the surface: the speculative gap, the bounce of an impact and Coulomb friction all use it. A
  craft resting on a box that drives off is dragged at μg until it matches the box's speed, then rides with it,
  still; a box driving into a craft shoves it ahead (`test/moving-surface.test.ts`). A moving surface may be
  reported up to its own travel in one tick beyond the query radius, so the solver sees an approach coming.
- The contact record grows by the surface velocity (`CN` 25). `PlatformContact` passes `vel` to the world it wraps
  (the disc itself stands still).

## sim-core/0.4.0: turtle mode (2026-10-17)

Changes traces: every trace hash (the state has one more slot, `S.flip` at index 71, `S.size` 72). Flights that never
use the turtle switch fly the same, except that arming now needs the craft level (below). The self-test hash is
`cd45c59c…` (Node and Chrome 155 match).

- **Turtle mode** (Betaflight's FLIP OVER AFTER CRASH, from Betaflight 2026.6.2 with its defaults): channel 6 is the
  turtle switch (> 0.5 on). Its position when the craft arms decides turtle mode (`S.flip`). In turtle mode the motors
  spin backwards and only the sticks drive them (`crashflip.ts`, ported from `applyCrashFlipModeToMotors`, GPL header
  kept): roll or pitch spins the pair on that side, a diagonal one motor, yaw a diagonal pair, by the stick deflection
  past a 15 % deadband; throttle does nothing. Turning the switch off while armed in turtle mode disarms (event reason
  `crashflip`); arming again needs the arm switch off and on (crashflip_auto_rearm off, Betaflight's default).
- **Arming needs the craft level**: within 25 deg (Betaflight's small_angle default), unless the turtle switch is on.
- **Reversed motors in the physics**: `Sim.motorDir` (1 or -1 per motor) joins `motorCmd` at the controller-to-physics
  seam (DShot sends the direction as its own command). The motor state is signed; a prop spun backwards makes its
  thrust and reaction torque the other way at 0.73 of the forward value (`REVERSE_THRUST`, measured on one 7" prop, an
  estimate for 5"). Prop strikes follow the direction: a reversed prop draws its air from below.
- **Respawn director**: a `flipped` policy flag turns the stuck-flipped rule off (default on; the game sets it off).

## sim-core/0.3.1: prop strikes (2026-10-17)

Changes traces: flights in which a prop comes within 0.5 mm of a surface over it (the side its thrust points to).
Free flight, landings on the underside and the self-test flight are bit-identical (the self-test hash is unchanged).

- **Prop strikes** (`sim.ts`, `propStrikes`): a prop (duct sphere) touching a surface on its intake side makes no
  thrust: fully when the surface is within 30 deg of straight over the prop, not at all past 60 deg, and fading in
  over the last 0.5 mm of the gap (`STRIKE_COS_HI`, `STRIKE_COS_LO`, `STRIKE_GAP`, estimates). Before it, a forward
  hit on a wall left the quad flat against the wall on its props, their full thrust pushed it in, and friction held
  it up there at any throttle, and in airmode with the throttle down and a stick held (the owner's "my whole quad
  gets stuck", physics-review F4). Now it falls off. Climbing into a ceiling ends a fraction of a millimetre under
  it, where the thrust left balances the weight (it bobs there by 1-2 mm), instead of pressing into it.
- The contacts near the body at the start of the tick are now gathered before the motors (`gatherContacts`) and
  solved after the forces (`solveContacts`); `contactsAt` does both for the fast-impact sweep as before.

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
