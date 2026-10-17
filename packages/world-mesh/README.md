# @owfpv/world-mesh

Collision against static triangle meshes for sim-core: an implementation of its `ContactWorld`
interface (`sweep`, `pushOut`), plus `queryRay`, `querySphere` and `distance` for spawning, the bot's
planner and the game.

- **Exact sweep.** A moving sphere's first contact with a triangle's face, edge or vertex is solved
  in closed form, so no speed tunnels through a wall and the contact time is not quantised.
- **Deterministic.** Only `+ - * /`, `Math.sqrt` and comparisons in anything that changes the
  simulation, and a BVH built and walked in a fixed order: same bits in every JavaScript engine.
- **Two-sided triangles, no inside.** A level may be open geometry. A sphere whose centre has already
  crossed a surface is pushed out on the side its centre is on; the sweep keeps every sphere a radius
  away from surfaces, so in flight a centre never crosses one.
- Input: vertex positions and (optionally) triangle indices, in sim-core's world frame (Y up, metres).
  Triangles with no area are dropped.

License: GPL-3.0-or-later. Written for this project from standard geometry (closest point on a triangle,
swept sphere against face, edge and vertex, ray-triangle by Cramer's rule); no code was copied.
