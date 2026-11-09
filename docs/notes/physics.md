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

## 2v. The owner's quad measured from a blackbox log, and its preset (owner, 2026-11-08): built, waiting for the owner to fly

Owner: "This is a custom 5 inch freestyle frame, R29 props, 2207.5 1750kv motors, 700g AUW. Closest I can get for
now." Then: "also its squashed X, if it matters." Log `red one.BBL`: Betaflight 4.5.5, 8 kHz loop, ~1970 Hz logging,
bidirectional DShot eRPM, 14 poles; flight 1 is 15 s of hover on a part-used pack, flight 2 is 88 s of freestyle on a
fresh one (low rates: 540 deg/s max). Scripts and output: `docs/evidence/2026-11-08-red-one-blackbox/`.

| | measured (red one) | Nazgul preset |
|---|---|---|
| motor lag, command -> rpm | 16-20 ms first order (up 14-22, down 18-20; all four motors) + 2-3 ms delay (partly the telemetry) | 17 ms, no delay |
| rpm / (command x pack V) | ~1950 at 10-20 % command falling to ~1460 at full: speed is not linear in command | constant: 1750 KV x 0.8 = 1400 |
| hover | ~11 400 rpm per motor, motor command 0.30 at 21.4 V, 5.7 A, 123 W | command 0.35 at any V (sqrt(1/TWR)) |
| thrust per motor / rpm^2 (accel x 700 g) | 1.20e-8 at hover rising to 1.45e-8 N at 27 000 rpm | constant (thrust ~ speed^2) |
| peak specific force in punches | 6.2-6.8 g (95 % command, part-used pack sagging to 19.9 V at 101 A) | - |
| TWR on a fresh pack (extrapolated) | about 8 (rpm 1458/V at full, 26.7 mOhm sag, thrust curve above) | 8.0 |
| pack resistance (6S + wiring) | 26.7 mOhm, 4.4 mOhm per cell | 5 mOhm per cell |
| roll accel per N of left-right thrust difference | ~30 rad/s^2 (halves 25 / 36) | 52.8 (arm 84.5 mm / 1.6e-3) |
| pitch accel per N of front-back thrust difference | ~23 rad/s^2 (halves 23.5 / 23.0) | 52.8 |
| yaw: kappa / I_yaw (m per kg m^2) | ~2.96 | 0.012 / 2.8e-3 = 4.3 |
| yaw: rotor inertia / I_yaw | ~1.56e-3 | 6e-6 / 2.8e-3 = 2.1e-3 |

**Method.** Motor lag: each motor's steady command -> rpm map from the log, then a first-order lag with delay fitted to
the measured rpm over the 68 % of the flight where commands move (rms 173-399 rpm against 1260-1538 with no lag).
Thrust: accelerometer z x 700 g against the sum of rpm^2 at rotation under 3 rad/s. Roll, pitch and yaw: angular
acceleration (gyro, 20 Hz low-pass, differentiated) against thrust differences from rpm. A plain least-squares fit gives
only ~6 (roll) and ~4 (pitch) rad/s^2 per N with r^2 0.2: the flight controller works against gusts and prop wash, so
its torque and the air's are opposed and the fit is pulled low (a closed-loop identification bias). Physically
impossible too: 199 rad/s^2 peaks with at most 10 N differences need at least ~20. The pilot's setpoint acceleration is
used as the instrument instead (the air does not move the sticks): stable against the instrument's lag (-20 to +20 ms:
roll 28.3-29.7, pitch 21.3-23.4). Yaw uses the same instrument with two terms (prop drag torque and rotor spin-up).

**Meaning.** Motor lag, TWR and the full-throttle speed per volt agree with the Nazgul's estimates. The red one turns
about 0.57x (roll) and 0.44x (pitch) as hard per newton of thrust difference as the preset: more inertia for its arm
length. As inertia = arm / (accel per N), a squashed X with half-spacings of ~95 mm side to side and ~70 mm front to back
would give I_roll ~3.2e-3 and I_pitch ~3.0e-3 kg m^2 (NeuroBEM's 772 g quad: 2.5e-3 / 2.1e-3) - **the frame's real motor
spacing is needed to turn these into inertia**. If I_yaw is near I_roll + I_pitch (~6e-3), kappa ~0.018 m and rotor
inertia ~9e-6 kg m^2; with the preset's 6e-6 rotor inertia, I_yaw = 3.8e-3 and kappa = 0.0114 m.

**Not measured:** drag (no airspeed in the log), prop wash, mass split.

**Preset built** (owner's answers: "225 corner to corner, and 138 front to rear"; "HQProp FlowerPig R29"; pack "either a
1300 or a 1450mah, 6s"; camera angle not relevant - the game's Settings > Camera sets it):
`packages/sim-core/presets/redone-6s.json`. Squashed X from the new optional field `motor_spacing_front_rear_mm`: motors
at 88.9 mm to the side and 69 mm fore and aft. Prop 5.1x2.9 3-blade, 4.4 g (HQProp's own R29V3 page). Inertia roll and
pitch both 3.0e-3 (30 x 88.9 mm and 23 x 69 mm give the same: the weaker pitch is the shorter arm). Yaw: rotor inertia
from its parts, 5.9e-6 (prop 3.7e-6 + bell 2.2e-6), then the measured ratios give I_yaw 3.8e-3 and kappa 0.0112 m, and
the hover power agrees (92 W of prop power from 123 W drawn, so efficiency 0.75; a larger I_yaw would need more prop
power than the battery gave). Motor lag 18 ms, rpm_loaded_fraction 0.833, pack 4.4 mOhm per cell, TWR 8.0, capacity
1300 mAh (the smaller of the two; only with Battery simulation on). The owner's own rates (Actual 180 / 540 deg/s, expo
0.36; yaw 140 / 430) and PIDs from the log header. Drag, prop wash and crash numbers are the Nazgul's estimates.
**Game:** Settings > World and physics > Quad (Nazgul by default; a change reloads the page; quads.ts). The self-test
stays on the Nazgul. Saved flights embed their preset, so old ones replay unchanged.

**Evidence:** `packages/sim-core/test/redone-preset.test.ts` (geometry, Nazgul's true X unchanged, the compiled numbers
against the log, flies pitch slower than roll: 20 ms after a full stick 348 deg/s roll / 287 pitch, Nazgul 522 / 496);
654 tests pass, typecheck clean; in the dev server the engine flies `redone-6s` with those motor positions and rates,
the dropdown switches back to the Nazgul, no console errors (`settings-quad.jpg`).

**Known differences from the real quad:** the model turns command into rotor speed in a straight line, so the red one
hovers at about 35 % motor command instead of the measured 30 %, and holds thrust per rpm^2 constant (real: +20 % from
hover to full). Betaflight's d_min, TPA and thrust_linear from the log are not modelled. Time trial times are not kept
apart by quad.
