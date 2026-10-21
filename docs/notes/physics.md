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
2. *Crossflow ignored past the edge:* CHECKED, not the cause (below, "Gap 2 checked"): within 15 deg of the axis in
   the first half second; measured crossflow terms change the control moment by at most about 5 %.
3. *Steady curves used for fast changes:* NACA is steady state; no dynamic inflow or unsteady blade aerodynamics. The
   short-term effect of an rpm step (blade angle of attack changes at once, the wake later) may have the normal sign.
4. *Motor spool:* CHECKED, not the cause (below, "Gaps 4 and 5 checked"). The model is 1.3-1.6 x faster than
   measured, without the real 4 ms dead time; slowing it to match leaves the bobble.
5. *ESC at low duty with a windmilling prop:* CHECKED, not the cause. Active braking is the BLHeli_32 and AM32 default;
   their low-rpm limits never act in a chop. No flight data of an idle motor with the air from in front.
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

**Gaps 4 and 5 checked (owner: "Start with gaps 4 and 5", 2026-10-20; `docs/evidence/2026-10-20-motor-lag/`).**
NeuroBEM's raw Betaflight blackbox logs (752 g, 2306 motors, 5-inch tri-blades, 4S) log each motor's command and DShot
RPM telemetry. Fitted on the same commands: real dead time 4 ms, time constants 24-32 ms up and 20-26 ms down; the
0.8.0 motor 0 ms and 18-20 ms. From idle the real motor reaches 10 % of a step at 13-15 ms (model 2-3) and 63 % at
36-41 ms (model 19-20), with the same peak acceleration (38-58 k vs 47-66 k rad/s^2): it starts later. The gyro
follows the telemetry by about 5 ms, so the telemetry is not what is late. BLHeli_32's manual and AM32's source:
braking by default, with low-rpm power caps and duty slew limits (AM32: 6-16 %/ms). On the owner's chop: rotor inertia
x1.5 and x2 (matching the measured lag) keep a motor above 15 % for 1.5 s, drift 4.3-6.0 deg (3.9 now); AM32's
limits change nothing (the air holds the motors above 10 k rpm, where the cap is 100 %). So neither gap causes the
bobble. The lag mismatch itself is real and affects handling everywhere; correcting it (inertia or a dead time) is a
separate decision for the owner. Dive speed: no measured 5-inch zero-throttle dive found (only unsourced blog figures);
Hammer et al. 2024 (wind tunnel): free-spinning props stop with the air through the discs and add no drag then.
Left: gaps 1, 2, 3, 6, 7 (8-11 untouched).

**Gap 2 checked (owner: "Next check gap 2", 2026-10-20; `docs/evidence/2026-10-20-crossflow/`).** The model has no
in-plane prop force or hub moment anywhere and drops crossflow past the edge. In the owner's chop the flow is 5-15 deg
off the prop axis for the first 0.55 s (31-42 m/s axial, 4-6 sideways), 32 deg median later. Measured data (Simmons
and Hatke, NASA TM-20210014010, 16x8 props at Re 4e4-1.4e5; Simmons AIAA 2021-1190's fitted coefficients; NACA TN
3228): at low incidence axial loads follow the axial advance ratio; in-plane force and pitching moment add across the
props, yaw-plane moments cancel. Scaled to the Nazgul's driven motors (inside the tested range), per +10 % rpm the
crossflow terms move the control moment by at most 0.001 N m against 0.011-0.057 N m from thrust x arm, and the
crossflow's axial term does not depend on rpm. Not the cause. The idle motor (J 2.5-5.3) has no numeric data. Side
finding: the same measured fit reverses (more rpm, less thrust) above Jx 1.37 on a small low-Re prop, near the
model's own onset (J 1.41): evidence for gap 1's band at small scale, though only to J 2.1. Left: gaps 1, 3, 6, 7.

**Public logs and the remaining gaps (owner: "do the rest of the gaps", "Look up data on this", 2026-10-21;
`docs/evidence/2026-10-21-public-logs/`).** Real Betaflight logs with eRPM (Fawkes, bbx-analyzer) and with GPS (Diatone
Roma F5, gimbal-ghost) show the model's chop pattern is real: all four motors fall together, then one pair is raised to
0.2-0.4 while the other sits at idle, a motor stays above 15 % for 0.45-0.8 s, the I-term swings by about 100, and at
14-22 m/s the attitude holds within tens of deg/s. The model at those speeds, sticks centred, with a 2-5 % spread
between motors, gives the same numbers, and stays under 42 deg/s up to 37 m/s. Real quads sometimes kick too (364 deg/s
on one centred-stick chop). So the motor firing up is ordinary; what is unexplained is the size of the owner's 40 m/s
kick (139 deg/s), at a speed no public log reaches. Whether props act backwards could not be read from closed-loop
logs. The other gaps: band depth x0.65 (measured small prop), load lag (Peters: about 1 ms), frame damping, inertia,
torque ratio, stick inputs, dynamic idle: none removes the long motor-high phase; Betaflight's mixer and anti-gravity
match 4.5.1 line by line. Next: a log of the owner's own quad at speed (with eRPM and GPS) would compare like for like.

**The real-world record (2026-10-21; `docs/evidence/2026-10-21-public-logs/README.md`).** Betaflight issues #3723
(2017), #6018 (2018-2020) and #6148 document an attitude bob or arm dip after hard throttle chops from fast forward
flight and flat punch-outs on many real 5-inch quads, not cured by tuning or hardware swaps, eased by higher idle,
throttle expo or chopping to 10-15 %. Betaflight's developers ended at "offset centre of gravity and motors not
re-starting properly in negative inflow" (2020) and answered with dynamic idle (PR #10294, Betaflight 4.3) and a
reworked anti-gravity. So the effect the owner sees in the sim has a documented real counterpart; the open questions
are how strong it should be on current Betaflight with dynamic idle, and whether the sim's version is too strong
(the sim with dynamic idle at 3400 rpm still bobs; real logs at 14-22 m/s hold attitude within tens of deg/s).

**Top speed and Betaflight's tuning fixes (owner, 2026-10-21; `docs/evidence/2026-10-21-tuning-topspeed/`).** Level
top speed on this branch: 157 km/h at full throttle (143-166 km/h with the estimated drag area x1.5 / x0.75); no
measured figure for a 6S 5-inch found (only unsourced "about 150 km/h"), so plausible, not verified. Betaflight's
docs treat chop wobble as a tuning item (punch-and-cut test; anti-gravity, Pitch Tracking, enough P with not too much
I, dynamic idle 3500-4000 rpm, thrust linear, 24 kHz PWM). In the sim those changes act in the documented direction
(all PIDs +30 %: 139/26 -> 11/66 deg/s; anti-gravity x2: drift 3.9 -> 2.1 deg; x0.5 worse) but none removes the
long motor-high phase, matching the issue threads ("helps, not a complete remedy").

**A published tune: SupaflyFPV Freestyle 5 Inch (owner's ask, 2026-10-21; `docs/evidence/2026-10-21-tuning-topspeed/` §4).**
The official Betaflight preset (4.5) with its PIDs from Betaflight's slider maths, thrust linear 30, TPA PD with
low-throttle TPA always on, dynamic idle 3000 rpm, relax cutoff 10, anti-gravity 120: the owner's chop still bobbles,
about a third less (tilt change 6.9 -> 4.6 deg, RMS rate 13 -> 11 deg/s), a motor still high about 1.5 s. Thrust
linear helps; the always-on low TPA hurts. The sim's controller lacks TPA, thrust linear, a relax-cutoff setting and
dynamic D (tested only in a scratch copy).

**Betaflight tuning features built, SupaFly the default tune (owner, 2026-10-21).** sim-core 0.8.0 gains Betaflight
4.5.1's TPA (pid_init.c / `pidUpdateTpaFactor`, PD or D mode, low-throttle TPA with its fade latch), thrust
linearization (`pidCompensateThrustLinearization` on the throttle after dynamic idle, `pidApplyThrustLinearization` on
each motor before the clamp, as mixer.c orders them), the I-term relax cutoff and the anti-gravity gain as
`ParamOverrides` in CLI units; absent, traces are unchanged (`test/tune-features.test.ts`, hand-worked values). No
dynamic D: the SupaFly preset turns it off (dmax 0). The game has Settings > World and physics > Tune: SupaflyFPV
Freestyle 5" (default, dynamic idle 3000 rpm), Betaflight defaults (TPA D 65 % from 1350), Original simulator tune;
a minimum-rpm slider for dynamic idle (`apps/fly/src/tunes.ts`). On the owner's chop through the real sim-core:
original RMS 13.2 deg/s, tilt change 6.9 deg; Betaflight defaults 12.9, 6.2; SupaFly 11.5, 4.6 (same as the scratch
copy); a motor above 15 % about 1.5 s in all three. Flight feel: for the owner to fly (build at `/next/` on Pages).
Owner flew it: "still unrealistic".

**Logs from the Betaflight chop-bob issues (owner's ask, 2026-10-21; `docs/evidence/2026-10-21-issue-logs/`).** Seven logs
pilots attached to #3723, #6018, #6148 (Betaflight 3.2-4.0, 2017-2018). 11 chops with centred sticks: rms rate 10/15
deg/s, peak 32/60 (max 77), tilt change 6 deg, a motor above 15 % for 1.5-2.5 s, I about 125. Their accelerometers
read 1.9-3.0 g of air push after the chop (0.9-2.8 g backwards along the thrust axis); the sim's owner chop reads 2.7 g
(2.6 back): the same airflow. The sim matches those chops in wobble, tilt and motor-high time; its sharpest kick
(111-139 deg/s) is about twice the real maximum. Caveat: old firmware, pilots reporting a fault; no modern log at that airflow.

**The kick (owner's ask, 2026-10-21; `docs/evidence/2026-10-21-kick/`).** Traced ms by ms: the props spin down into the
windmill band, a small spread starts a roll, the controller drives the other side to full, and a windmilling prop brakes
harder as it speeds up, so for about 25 ms the correction pushes the wrong way. Over 16 seeded centred-stick chops the
peak is 83 / 113 deg/s (original) and 59 / 88 (SupaFly) against about 60 / 77 real: the owner's 139 was a high case.
What does not match: the sim's angular acceleration in the first 400 ms (median 7 200 deg/s^2) is about 3x the real
chops' (2 200), and its correcting motors go to full (real 0.49). Measured motor speed, Simmons' thrust shape, a 1 ms
load lag, the measured torque ratio, inertia x2: none fixes it. Side finding: with the real ESCs' 4 ms dead time the
sim oscillates in ordinary flight (rms 112-135 deg/s against 2); it needs inertia x2 to fly steadily with it. The
preset inertia (0.0016) is an estimate; no measured 5-inch inertia found.
