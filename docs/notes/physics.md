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



## 2f. Motor idle: zero-throttle rolls checked, dynamic idle built (owner, 2026-10-20)

Owner: "if I drop throttle, and then roll ... I can't hear any propeller noise. This is either a sound bug or a control
loop bug", and "it sounds/seems like we have no idle at all": add Betaflight's idle and a dynamic idle option, the
minimum rpm set by the game, its other settings as options.

**The control loop was right.** The airmode mixer (sim.ts, Betaflight's) lifts the motors on one side at zero
throttle. Nazgul, armed, stick down, full roll: all four at 1940 rpm (5.5 % idle), 50 ms into the roll two at
6850-7160 rpm, then 2200-3000 rpm while the roll holds at 675 deg/s, 6200 rpm for 50 ms on the stop; hover 17 900 rpm.
Whether a real quad holds its motors higher through a long zero-throttle roll is not checked (needs a blackbox log).

**The sound hid it.** `IDLE_FLOOR` (0.012) was a flat floor, and 0.012 is speed^2.75 at 20 % of top speed: every motor
speed from idle up to about 7000 rpm sounded the same. Now the whirr rises from the floor at 5.5 % as speed^0.40 and
meets the speed^2.75 law at 25 % (`WHIRR_TO`), under every preset's hover (28-55 %), so the idle and hover levels are as
before and a rev to 20 % is 4.5 dB over idle [estimate: no recording between idle and hover]. Test: `sound.test.ts`.

**Dynamic idle (sim-core `ParamOverrides.dynIdle`, no trace change when off).** Betaflight 4.5's code, read in full
for these parts: `flight/mixer.c` calculateThrottleAndCurrentMotorEndpoints (the PID on the slowest motor's rps: I rises
fast and falls at most 0.1 rps of error per loop, D on the PT1-smoothed rps), `mixer_init.c` (gains: P x 0.00015, I x
0.01 x dt, D x 3e-7 x loop Hz, increases x 0.001, rps PT1 800 x dt / 20; with dynamic idle on the static idle is
dropped, motorOutputLow = 0), `pid.c` defaults (50/50/50, max 150, start 50), `cli/settings.c` ranges, `fc/core.c`
(airmode latches when the throttle reaches 25 %, pg/rx.c, cleared on disarm), mixTable (1 % throttle at zero stick;
the endpoints run every loop, armed or not, before the crash-flip return). The sim runs it each 1 ms tick on the motors'
speed state (a real FC reads ESC telemetry). Its three state slots sit after `S.size` (`S_DYN`) and exist only with it
on, so hashes of every flight without it are unchanged. Tests: `packages/sim-core/test/dyn-idle.test.ts`.

**The minimum the game picks:** `autoDynIdleMinRpm(prop mm)` = 175 / diameter in inches (x 100 rpm): 35 on a 5-inch, 34
on the Nazgul's 5.1-inch (3400 rpm). Betaflight's 4.3 tuning notes: 30-40 (3000-4000 rpm) typically, 4000 for most
freestyle and racing; Oscar Liang by size: 7" 14-28, 5" 20-40, 3" 33-66, which scale as 1 / diameter [estimate between
the two]. The whoop presets have no prop size, so dynamic idle is unavailable on them (the game flies the Nazgul).

**Game:** Settings > World and physics > Motor idle: Dynamic idle (off, as Betaflight), then Max increase, Start
increase, P, I, D gains in Betaflight's units; off: a Motor idle slider 0-20 % (default 5.5 %). Each restarts the flight.

**Evidence** (`docs/evidence/2026-10-20-dyn-idle/`, headless Chrome, ?demo=tricks, whose lowest stick is 5 %): static
idle 72 state slots, slowest motor 2736-9772 rpm with the stick under 10 %; dynamic idle 75 slots, minRps 56.7, slowest
motor 3116-5313 rpm; screenshots of both settings layouts; no console errors. Node: idle held within 2 % of 3400 rpm
after airmode is active; 618 tests pass, pinned hashes unchanged.

**Limits:** rotor speed in the sim does not change with the airflow through the prop (physics-review open gap), so the
case dynamic idle exists for on real quads (props unloading or windmilling in a dive, desyncs) is not in the model;
here it raises and holds the idle floor. Betaflight's I-term reset at low throttle before airmode activates is not
modelled (the sim's mixer always runs airmode).

## 2g. Throttle-chop bobble: what was learned, what is built, what is still unknown (owner, 2026-10-20; OPEN)

**The issue (owner).** In real flights a quad cut to zero throttle at speed keeps its attitude and its motors stay
near idle. In every model here (0.7.0, 0.8.0, the NACA refit) it bobbles and motors ramp up. Classic physics does not do
it. Physics-review F9, F10. Owner flew the refit (branch `main-bng8wu`): still wrong. Next: find the gap.

**Built (branch `main-bng8wu`, commits bdf7042, 7f51317; sim-core/0.8.0, not merged, 2 hash tests fail on purpose):**
motor/ESC torque-balance model (Ke = 1/Kv, R from rpm_loaded_fraction, complementary-PWM braking), prop torque
(Gill and D'Andrea eq. 37-38, kappa 0.0136 and pitch factor 1.025 from UIUC 5-inch data), Betaflight 4.5 anti-gravity
and throttle boost, and the NACA windmill curves past along-axis ratio 0.3 with the air from in front (air from behind
still blade-element). Evidence: `docs/evidence/2026-10-20-motor-model/`, `docs/evidence/2026-10-20-windmill/` (sources,
digitised curves, replay harness, the owner's chop flight).

**On the owner's chop flight** (sticks replayed with no world; 4.15-7 s):

| model | max roll rate | max pitch rate | pitch drift | motor > 15 % |
|---|---|---|---|---|
| 0.7.0 as flown | 49 deg/s | 88 | 9.8 deg | 2.1 s |
| 0.8.0 | 68 | 131 | 3.1 | 1.7 s |
| 0.8.0 + NACA refit | 139 | 26 | 3.9 | 1.5 s |

Anti-gravity and throttle boost off: the kick stays (not their cause). The owner moved yaw (-0.11) at the chop.

**Learned (sources read in full):** NACA Report 464 and ARR 4H26: a windmilling prop's drag rises with rpm from locked
to a peak (1.2-2.7 x locked, lower pitch higher), so the reversed band is real for full-size props (Re ~1e6). UIUC
(Brandt and Selig 2011, Deters et al. 2014) stop every sweep at the windmill state: no 5-inch data past zero thrust.
Goyal et al. 2024: BEM and lifting-line fail past the maximum-power point (blade separation). Sinnige 2019 / 2024:
negative-thrust CFD and tests at J/J0 up to 1.8. Neither blade-element with stall nor wind-turbine BEM reproduces NACA's
rise from a locked prop (`fit.py`, `bem.py`). Chris Rosser's AOS-RC static stand sweeps (owner's spreadsheet, not
committed: third-party data) give the Nazgul F5 prop: 15.1 N at 28 728 rpm (model 14.4), Q/T 12.3-12.7 mm (model
13.6), CT rising 0.15 -> 0.19 from 8.6 k to 28.7 k rpm (model constant).

**Gaps and assumptions to test next** (none ruled out; each needs evidence, not a fit to the symptom):
1. *Small props in the windmill band:* 5-inch at Re 3-6e4 may not share the full-size reversed band, or not its size.
   No data found. A thrust stand in airflow, or a published small-prop windmill test, would settle it.
2. *Crossflow ignored past the edge:* the windmill range and blade-element range drop in-plane flow (mu up to 0.4 at
   idle in the chop). Asymmetric blade loading, H-force and hub moments may add damping or moments.
3. *Steady curves used for fast changes:* NACA is steady state; no dynamic inflow or unsteady blade aerodynamics. The
   short-term effect of an rpm step (blade angle of attack changes at once, the wake later) may have the normal sign.
4. *Motor spool:* rotor inertia 6e-6 kg m^2, R 0.114 ohm and the spool-up (5 k -> 15 k rpm in 15 ms in the trace) are
   estimates; no ESC current limit, no DShot/ESC latency. Faster-than-real motors feed the PID's runaway.
5. *ESC at low duty with a windmilling prop:* complementary-PWM braking to duty x V / Ke assumed for all ESCs; regen
   current limits, BLHeli/AM32/Bluejay specifics, and what "idle" holds (duty, not rpm) are not checked.
6. *Flight controller emulation:* 1 kHz loop on an ideal gyro (real 4-8 kHz with filters, RPM filter); airmode mix at
   the bottom of the range, iterm_windup, I-term relax, anti-gravity (new) and throttle boost read from Betaflight 4.5
   formulas but never compared against a real Betaflight trace (SITL would).
7. *Frame aerodynamics:* drag acts at the centre of mass, no aerodynamic moments or damping from the frame, camera and
   pack; at 40 m/s a real frame may weathervane and damp pitch/yaw.
8. *Drag and thrust levels:* the chop makes up to ~5 N drag per prop (3 g braking); frame CdA (cda_horizontal 200 cm^2,
   vertical 150) and the 0.8.0 unloaded-prop speed at full throttle (34 k rpm at 40 m/s vs 28.7 k static) unchecked.
9. *Inertia:* G3 may be 20-50 % off (physics-review G3).
10. *Static calibration:* thrust and torque coefficients from other props' data; AOS-RC has the real prop (and CT falls
   at low rpm, which the model ignores).
11. *Air model and inputs:* no wind/gusts in the trace; the owner's yaw input at the chop; whether the instability
   needs a disturbance the real quad never gets.

Ways to get evidence: a Betaflight SITL run of the same sticks (separates controller from physics, SPEC R1); a
blackbox log with RPM telemetry of a chop at speed (owner: not now); a 5-inch prop on a stand in airflow; small-prop
negative-thrust papers not yet found.
