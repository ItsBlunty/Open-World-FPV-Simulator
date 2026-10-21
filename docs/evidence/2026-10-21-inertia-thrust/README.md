# Inertia and thrust per command checked (2026-10-21, physics §2g, review G3, G12)

Owner's ask: after the step response (`../2026-10-21-step-response/`), look for measured 5-inch inertia and check motor
thrust against stand data, including how thrust per command changes with airspeed.

## Inertia

- The one comparable figure found: UZH's "Kingfisher" (NeuroBEM and Agilicious quad; Armattan Chameleon 6-inch frame,
  Hobbywing XRotor 2306 2400 KV, 5.1-inch three-blade props, 4S, 752 g, about 33 N static thrust; NeuroBEM paper
  arXiv 2106.08015 §IV, Agilicious arXiv 2307.06100 Table 1, both read). Inertia diag(0.0025, 0.0021, 0.0043) kg m^2,
  motors at (+-0.0775, +-0.1) m: uzh-rpg/agile_flight `envsim/parameters/quads/kingfisher.yaml` (MIT). NeuroBEM says
  only that inertia was "identified from the real platform", not how.
- Scaled to the Nazgul F5 (motors at +-0.084 m, 736 g): the motors and props (4 x 37 g) give 4 x 0.037 x 0.084^2 =
  0.00104 kg m^2 per axis; the Kingfisher's body share (its total less 4 x 32.5 g at its arm positions) is 0.0012-0.0013,
  carrying a Jetson compute stack the Nazgul lacks; a 244 g pack about 3.5 cm above the centre of mass gives about
  0.0004, frame, plates and air unit 0.0002-0.0004. So 0.0016-0.0019 kg m^2: the preset's 0.0016 is plausible, at most
  about 20 % low. Not the factor 2 that made the sim fly steadily with the real ESC delay.
- Not found: any other published measured inertia of a 5-inch quad (searched papers and hobby sources; the bifilar
  examples found are larger craft).

## Thrust per command (`thrust-gain.test.ts`, `thrust-gain-output.txt`)

One motor and prop of the model held still in an axial airflow V, steady state:

- Static (V 0): command 1.0 gives 28 717 rpm and 14.4 N; AOS-RC's stand sweep of the real Nazgul F5 prop gave 15.1 N
  at 28 728 rpm (physics §2g). Hover (1.8 N per motor) at command about 0.24 and about 10 100 rpm. Gain dT/dcommand:
  6 N per unit at 0.1, 11-15 around hover, 18 at 0.5-0.7, 14 at full.
- With airflow: at the commands that fly fast (0.5-0.7) the gain stays 15-18 N per unit from 0 to 40 m/s: it does not
  grow with speed. At low command and 30-40 m/s it turns negative (-8 to -10 N per unit: the windmill band of the chop).
- The prop's thrust against advance ratio was fitted earlier to UIUC wind-tunnel data of three 5-inch three-blade props
  (5-9 % rms, `../2026-10-20-motor-model/prop_fit-output.txt`).
- AOS-RC's thrust coefficient rises from 0.15 at 8 600 rpm to 0.19 at 28 700; the model's is constant (about 0.18). The
  real quad then hovers about 9 % higher in rpm, but with the hover thrust fixed its thrust per rpm there is the same
  (about 0.35 N per 1000 rpm both).
- No throttle-to-thrust table for the XING2 2207 1750 KV was found (retailer pages blocked or without data; one forum
  figure, 1613 g on 6S with a 5050 prop, is in line with 14.4-15.1 N).

## Result

Neither the inertia (at most about 20 % low) nor the thrust per command (in line with stand data, not growing with
speed outside the windmill band) explains why the sim's quad answers the sticks 5-8 ms sooner than real quads and why it
cannot fly the real ESC delay. What remains is timing: the real motor chain is slower (4 ms dead time and 24-32 ms
spool against the model's 0 and 18-20, `../2026-10-20-motor-lag/`), and real quads fly Betaflight's default gains with
it, which the sim cannot. Running real Betaflight (SITL) against the sim's physics would show whether the flight
controller emulation is where the difference lies.
