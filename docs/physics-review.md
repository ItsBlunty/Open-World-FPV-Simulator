# Physics review

The full review is milestone M2 (`SPEC.md` R2). Until then, this file collects findings about the
flight model's physical accuracy as they come up, so the review starts from them.

## Findings to review

### F1. A near-level impact on a flat surface becomes a lopsided one (found 2026-10-17, M0)

**What happens.** sim-core resolves one contact point per 1 ms step (`Sim.contact` in
`packages/sim-core/src/sim.ts`: the sweep's first sphere gets the impulse). A craft that hits a flat
surface almost level touches it with one duct a fraction of a millimetre before the others. That duct
takes the whole impulse, which spins the body, and the opposite duct then hits faster than the craft
was moving.

**Measured.** In the mesh test room (`packages/world-mesh/test/respawn-room.test.ts`), pavo20pro-3s
climbing at hover + 0.2 hits the flat ceiling at 2.84 m/s; one tick later the opposite duct hits at
4.56 m/s, over `vCrash` (4 m/s): a crash. It matches the rigid-body result for a rod struck at one end
(the far end gains about (1 + e) / 2 of the approach speed: 1.6 x for e = 0.2). The voxel scan
upstream tested on did not show it, because its ceiling is uneven.

**Why it matters.** A real quad hitting nearly level shares the impact between its ducts, so this
may turn gentle touches of ceilings and floors into crashes, and make landings bouncier than real.
Mesh levels are full of flat surfaces, so pilots will meet it often.

**For the review.** Check against real behaviour (does a level 2.8 m/s ceiling touch crash?), then
consider resolving simultaneous contacts together, as the platform's resting solver already does
(`restOnDisc`, projected Gauss-Seidel over all touching spheres).

### F2. Pinned under a flat ceiling with the throttle at zero (found 2026-10-17, owner's first M1 flight)

**What happens.** A 5-inch quad (nazgulf5v3-6s, acro, airmode) that touches a flat mesh ceiling gently
can stay pressed against it indefinitely with the throttle stick fully down. While it sits there,
level, the gyro reads 2-3 rad/s of roll or yaw that alternate sign (the single-contact solver of F1
rocking the body from tick to tick); the rate PID answers with full mixer authority (mix range up to
2, motor commands swinging between idle and 1.0, mean about 0.5), and that mean thrust is above the
craft's weight, so it presses itself back into the ceiling. Self-sustaining: watched for 127 s in the
owner's browser, and 8 s in the test.

**Measured.** In the bando (storey 2, slab underside at 10.5 m) from a respawn at y = 10.245 m: a 0.4 s
throttle blip at stick -0.25 (near hover) reaches the slab in about 0.1 s; with the stick then at -1
the centre stays at y = 10.453-10.454 m (4.6 cm below the slab, a prop sphere's radius) with
v_y = +0.2-0.3 m/s reported each contact. Reproduction and negative control:
`apps/fly/test/stuck.test.ts`. A firmer blip (stick 0.2) crashes instead.

**Why it matters.** A real quad does not hover against a ceiling at zero throttle; its props would
strike, and with real gyro readings airmode would not see phantom rates. Indoor mesh levels (the bando)
make gentle ceiling touches common.

**Mitigation now (not a physics fix; the owner rejected this kind of fix, see HANDOFF.md §0a).** The respawn director got a "stuck, pinned" rule (armed, still,
touching from above, stick below hover, 1.5 s: rewind), and the game asks rewind spots for 0.5 m of
room beyond the bounding radius instead of 0.05 m (`REWIND_MARGIN_M`, `apps/fly/src/session.ts`), so a
rewind no longer puts the quad 25 cm under a slab.

**For the review.** Fix it at the source together with F1: resolve simultaneous contacts, so a body
resting against a plane does not rock; then check that the gyro reads near zero against a ceiling.
Consider prop strikes: a spinning prop touching a surface should brake its motor or count as a crash.
