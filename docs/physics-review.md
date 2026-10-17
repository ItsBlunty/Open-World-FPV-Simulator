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
