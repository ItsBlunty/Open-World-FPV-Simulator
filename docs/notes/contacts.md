# Contacts, damage, prop strikes, turtle mode

Archived work notes, moved verbatim from HANDOFF.md on 2026-10-18. Read only when working in this area;
`HANDOFF.md` has the current state. Section numbers (§0a ...) are the ones code comments cite.

## 0a. Contacts, damage, landing (owner, 2026-10-17, after flying M1): done, damage shelved

The owner's words, after the pinned-to-ceiling fix (§2b) went live: "I'm still getting stuck on surfaces, walls, etc,
and shaking inside of them, this shouldn't happen at all, timing out and moving isn't helpful, it just shouldn't
happen." Then: a simple damage model, and landing on the bottom of the drone like a real FPV drone.

1. **Fix the contact physics at the source (sim-core).** No sticking, no shaking against walls, floors or ceilings.
   Respawn rules that move a stuck quad away are NOT an acceptable fix: the owner rejected that approach. The
   "stuck, pinned" director rule added on 2026-10-17 (§2b) can be removed once contacts are right.
2. **Damage model, simple for now.** One health value, 100 % at spawn, going down with each hit, by an estimate of
   the impact from the speed (e.g. the contact's approach speed or the impact energy). Shown on the HUD. What happens
   at 0 % (crash / disarm / respawn) and whether a respawn restores it: not yet decided; propose, then ask.
3. **Land on the bottom without damage**, as a real FPV quad does, unless coming down very fast. Today any approach
   at or over `vCrash` (5 m/s for the Nazgul preset) is a crash wherever it hits, and contacts under it are free.
   A hit on the frame's underside (body-down contact normal) should be gentle up to a much higher speed than a hit on
   the props, the arms' ends or the top.

**What was learned reading the contact code** (`packages/sim-core/src/sim.ts`, `contact()` from line ~777):
- The collision shape is 5 spheres: 4 "duct" spheres at the motors (0.1 m from the centre in x and z, r = 45 mm for
  the Nazgul, so they stand in for the props) and 1 body sphere at the centre (r = 45 mm). There is no frame-bottom
  shape, so "landing on the bottom" today means landing on the prop spheres.
- Per tick: one swept test of all spheres (`world.sweep`), move to the first contact pose, ONE impulse at that one
  sphere (`impulse`: restitution 0.1 under `vBounce`, Coulomb friction `MU` 0.4), plus a 1 mm skin. Only when the
  first contact "pinned" the body (`PIN_M`) do the other touching spheres get impulses (`pinnedContacts`).
- When a sphere starts the tick overlapping (`t === 0`), the tick's motion is thrown away and spheres are pushed out
  (`pushOut`, 3 passes). Resting and sliding contacts go through this path or the single-impulse path every few
  ticks: that is the shaking. The body rocks from sphere to sphere, the ideal gyro sees rotation of several rad/s,
  and airmode answers with thrust (physics-review F1, F2; reproduction in `apps/fly/test/stuck.test.ts`).
- The invisible respawn platform already has a proper resting solver (`restOnDisc`: projected Gauss-Seidel over
  every touching sphere with accumulated normal and friction impulses). That is the model to extend to the scene:
  gather every sphere touching (within a contact margin) after the move, solve them together with accumulated
  impulses, and handle penetration by position correction rather than discarding the tick.
- `impact()` decides crash vs contact from one approach speed only; damage and the landing rule go there (and the
  sphere index / contact normal in body frame tells "bottom" from "props").

**Rules that apply** (`.claude/rules/sim-core.md`, CLAUDE.md): this changes traces, so bump `SIM_CORE_VERSION`,
add a CHANGELOG entry, list the change in `packages/sim-core/UPSTREAM.md`, comment every new constant's source
(estimates labelled), keep determinism (only `+ - * /`, `Math.sqrt`, dmath), add tests (a resting craft stays still
and the gyro reads ~0 on floors, walls and ceilings; sliding along a wall does not stick; landing at 2-3 m/s on the
bottom does no harm), re-pin hashes that legitimately change (`SELFTEST_HASH` in `apps/fly/src/selftest.ts`, upstream
log-replay tests may need their saved logs regenerated: check what they guarantee first), and ask the owner to fly it.
Record findings in `docs/physics-review.md` (F1/F2 are the starting point).

**What was built (sim-core/0.3.0, 2026-10-17).** Details: `packages/sim-core/CHANGELOG.md`; findings: physics-review
F1, F2 (fixed) and F3 (new).
- Contact solver (`sim.ts contactsAt`): every sphere's surfaces within 5 mm (new `ContactWorld.contacts()`) solved
  together each tick, speculative contacts (close the gap, no further), projected Gauss-Seidel, Coulomb-cone friction.
  The sweep only catches fast impacts (spheres 0.5 mm smaller), then the same solver at the touch pose. Leftover
  penetration is fixed by moving the pose. `MeshContactWorld.contacts` merges the triangles of a flat surface (seams
  between coplanar triangles would otherwise feel like bumps: turning that filter off breaks the wall-slide test).
- Measured: resting on a floor 3e-7 rad/s, pressed under a ceiling 1e-6, leaning into a wall 2e-5 (0.2.0: 2-3 rad/s);
  the owner's bando case lets go of the slab as soon as the throttle is down. Director's pinned rule removed.
- Damage: `S.health` (1 at every spawn), crash at 0; thresholds `vHarm`/`vCrash` (props, arms, top) and
  `vLandSafe`/`vLandCrash` (underside, normal within 30 deg of body up), blended to 60 deg. HUD shows HEALTH.
- Determinism: `?selftest` MATCH in Chrome 155 with the new hash `5115a73f…` (Node). Firefox not re-checked.
- Logs: 0.2.0 logs no longer replay to their 0.2.0 traces (`log-v2-compat.test.ts` says why); the app saves none.

**Damage shelved (owner, 2026-10-17):** "lets shelve the damage system for now, we should just bounce off of stuff
and keep flying". The app sets `crashOn: false` by default (setting `damage`, toggle "Damage and crashes" in
Settings; HUD hides HEALTH while off). sim-core keeps the model. The owner found it unrealistic: a real 5" hits on
its belly and slides without damage. Measured before shelving: belly skids at flight attitudes (0-30 deg nose down,
10-20 m/s forward, 2-3 m/s down) already took 0 %; the harsh parts were straight-down belly hits over 4 m/s, tilted
drops (F3) and hits past 60 deg counted as prop hits. When it comes back, ask the owner what a 5" survives.
**Still open for the owner:** do contacts, bounces and sliding along walls and floors feel right (friction 0.4)?

## 0b. Stuck on walls after 0.3.0 (owner, 2026-10-17): prop strikes, sim-core/0.3.1

The owner's words after flying 0.3.0: "When I hit a wall or floor or anything like that, my whole quad gets stuck".
Reproduced in Node (details and numbers: `docs/physics-review.md` F4): in forward flight the quad's top leans towards
the wall, so a hit swings it flat against the wall props first; the props kept full thrust into the wall, friction
held it up, and the acro controller's saturated corrections (airmode included) kept those props busy. Floor hits at
normal flight angles recover; steep nose-first ones flip it on its back, as in real crashes.
Fix: prop strikes (`sim.ts propStrikes`). Test: `contact-solver.test.ts`, "a forward-flight hit on a wall" (fails on
0.3.0: hangs at 2.83 m; passes on 0.3.1). Ported bot tests (`model-pinned`, `b12-dash`) now see the craft drop off the
wall it leans on; each says why. Open: after a hit the quad lies on its back at the foot of the wall (turtled):
turtle mode, bouncier hits or a prop-strike kick are the options to put to the owner.

## 0c. Turtle mode (owner, 2026-10-17): sim-core/0.4.0

The owner chose turtle mode over bouncier hits or a prop-strike kick, with Betaflight's default exit (turtle switch off
while armed disarms; arm again) and no automatic rewind of a flipped quad (SPEC.md §7).
- Source read in full: Betaflight 2026.6.2 (current release) `mixer.c applyCrashFlipModeToMotors`, `core.c`
  (arming, crash flip, small_angle), `imu.c isUpright`, `mixer_init.c` defaults; 4.5-maintenance compared (it had an
  expo and read the switch only at arming). Ported mix: `packages/sim-core/src/crashflip.ts` with Betaflight's header.
- Seam: `Sim.motorDir` next to `motorCmd`, as DShot's spin-direction command; SITL later sends the same.
- Input: channel 6 is the turtle switch. Radio setup has an optional turtle step (button or axis); T toggles it on
  radios without one; the HUD shows TURTLE, and TILTED with what to do when arming is refused. Old profiles have no
  turtle switch until Radio setup is run again.
- The game's director has the stuck-flipped rule off (`QUICK_RESPAWN.flipped`). The stuck-wedged rule (throttle up,
  not moving, 3 s) still rewinds, also a quad on its back with the throttle up (the self-test flight shows it).
- Findings: physics-review F4, "Turtle mode added".
- Seeing through surfaces after a crash (owner, 2026-10-17): the FPV camera sits at the body's centre, 45 mm from a
  surface the quad rests on, inside the old 5 cm near plane. Now 1 cm (`view.ts CAMERA_NEAR`) with a reversed depth
  buffer (`main.ts`); checked in Chrome on WebGPU and WebGL 2 against a tree trunk. The chase camera still has no
  collision of its own and can end up inside a building.


