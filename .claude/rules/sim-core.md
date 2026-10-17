---
paths:
  - "packages/sim-core/**"
---

# Rules for sim-core

- sim-core has zero runtime dependencies. Do not add any.
- Use only `+ - * /`, `Math.sqrt` and the package's own `dmath` functions (sin, cos, atan2, exp) in simulation code.
  Other `Math` functions can differ between JavaScript engines and break cross-browser determinism.
- Any change that alters flight traces must bump `SIM_CORE_VERSION` in `src/index.ts` and get a `CHANGELOG.md` entry.
- Every new physical constant carries a comment saying where it comes from: measured, manufacturer, published source, or estimate.
- Physics changes need a test, and the owner must fly the result before it is considered done.
- Record findings about physical accuracy in `docs/physics-review.md` (SPEC.md requirement R2).
