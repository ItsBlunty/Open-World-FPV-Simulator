# M2 physics review and rotor inflow (sim-core/0.6.0)

Archived work notes, moved verbatim from HANDOFF.md on 2026-10-18. Read only when working in this area;
`HANDOFF.md` has the current state. Section numbers (§0a ...) are the ones code comments cite.

## 0o. M2 physics review (owner, 2026-10-18): done; next the airflow fix

**Asked:** "Lets proceed with M2, but report back to me before changes are made." Claude reviewed sim-core/0.5.0
(`sim.ts`, `params.ts`, `wake.ts`, `wind.ts`, the Nazgul preset) and reported before writing anything. **Owner's
answers:** no blackbox logs now ("maybe we could attempt to correct later"); commit the review; start with the
airflow fix.

**Built:** `docs/physics-review.md` part 1: a table of every modelled effect (equation, source, rating, feel), findings
G1-G8 and a ranked list; F1-F5 kept as part 2. Probe: `docs/evidence/2026-10-18-physics-review/probe.test.ts`
(run: `pnpm exec vitest run --root docs/evidence/2026-10-18-physics-review`; its output is `probe-output.txt`, re-run
and identical). No code changed.

**Key findings:** G1, thrust ignores the airflow through the props, and a 430 cm^2 vertical drag area stands in for
it (punch-out 39.7 m/s after 1 s, flat fall capped at 16.2 m/s); G3, inertia possibly 20-50 % high by a rough
parts check (estimate, waits for logs); G4 prop wash and G2 rotor-drag moment build on G1; G5 ground/ceiling effect.

**Left open:** G1 next (sources to read in full before building: a propeller model of thrust against inflow); G3
when logs exist; "(to read)" claims in the review are still unverified against their primary sources.

## 0p. Airflow fix: rotor inflow, sim-core/0.6.0 (owner, 2026-10-18): built, waiting for the owner to fly

**Asked:** "150 is fine, Nazgul only, go ahead and build it, however we should make a toggle for 'classic physics' that
loads the physics right now to go back/compare against". Then: "Have you tried looking online ... finding someone's test
log from the same or a similar drone?" Claude had not; it searched (no Nazgul logs, no XING2 1750KV + F5 prop thrust
table, no measured 5-inch free fall found) and found NeuroBEM; the owner allowed the 627 MB download ("be careful
loading it all because of the token/context budget") and chose to leave the motor lag at 17 ms. The flat-drop question
(below) was not answered.

**Sources read in full:** Gill and D'Andrea 2019, Drones 3(4):77 (via Claude in Chrome: MDPI blocks curl; its equations
from the page's MathJax source); Johnson 2004, "Model for Vortex Ring State Influence on Rotorcraft Flight Dynamics"
(NASA; its simple baseline descent model was not built, see "Left open"); Bauersfeld et al. 2021, NeuroBEM (arXiv
2106.08015) and its dataset readme.

**Built:**
- `packages/sim-core/src/sim.ts` `inflowThrust`: per forward-spinning prop, the air at the hub (airspeed + w x r) gives
  the climb ratio and advance ratio (held within 0.3); blade-element C_T (Gill and D'Andrea eq. 27, c_l0 = 0) and
  Glauert's momentum theory, solved by 32 bisection halvings on the normal working state's branch. Thrust and the
  roll/pitch torques use it; the yaw torque and the battery power keep the still-air thrust.
- `params.ts`: `RotorInflow` (a, theta, radius, area) from the preset's static thrust and `prop_pitch_in`
  (theta_tip = 1.25 P / 2 pi R, delta 0.2); `ParamOverrides.classicPhysics`; the vertical drag area becomes
  `cda_vertical_inflow_cm2`. Nazgul preset: `prop_pitch_in` 3.5 (manufacturer), `cda_vertical_inflow_cm2` 150
  (estimate, owner agreed). Other presets have no pitch field and fly as before.
- App: `settings.classicPhysics` (default off), Settings > Physics checkbox (restarts at the spawn), a "Physics" line
  in the menu's Settings section, `?selftest` checks both hashes.
- `SIM_CORE_VERSION` 0.6.0; CHANGELOG, UPSTREAM item 11; `docs/physics-review.md` G1 (results) and G3 (corrected).

**Evidence:**
- `pnpm test`: 49 files, 440 tests (new `packages/sim-core/test/model-inflow.test.ts`: classic = 0.5.0 bit for bit on a
  hashed flight, rest thrust = preset thrust, climb/sink/forward/rotor-damping signs and sizes, punch-outs, each with a
  control; `apps/fly/test/selftest.test.ts`: classic keeps `cd45c59c…`). Typecheck clean, production build OK.
- NeuroBEM check (`docs/evidence/2026-10-18-rotor-inflow/`): thrust RMSE 0.713 N vs 1.173 N for the classic model
  (rotation < 3 rad/s; all samples 0.849 vs 1.365); the table is in physics-review G1.
- The Nazgul (`sim-probe-output.txt`, classic in brackets): punch 24.2 m/s at 0.5 s (27.7), climb top 37.4 (43.1),
  75 deg punch top 145 km/h (164), level top speed 134 km/h (150), flat drop 26 m/s (16), dive unchanged.
- Pages build (CI run 39143821831), Chrome 155 `?selftest`: MATCH (flight `af127b88…`, classic `cd45c59c…`, traffic
  `80f0c9aa…`); the menu's Settings section shows the new "Physics" line.

**For the owner to fly (Pages build):** punch-outs, fast forward flight (less throttle needed to hold height), dives
and the catch, and a flat throttle-cut drop; then tick Settings > Physics > Classic physics and compare.

**Left open:** flat drops with the throttle cut are faster (no source covers idle props in a fast fall: blades stalled);
rotor speed does not rise as the props unload (top speed a little low); yaw torque and power from the still-air thrust;
no front/rear rotor interaction; no inflow lag; Johnson's descent model (the vortex ring) is not built, prop wash
(wake.ts) still supplies that loss; NeuroBEM's measured 33 ms motor lag not applied (owner). The NeuroBEM data
(`processed_data.zip`) lives only in the session scratchpad: download it again to re-run the scripts.


