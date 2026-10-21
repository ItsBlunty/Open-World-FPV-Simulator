# What makes the sim's kick after a throttle chop (2026-10-21, physics §2g)

Owner's ask: find what in the sim makes the 111-139 deg/s kick when real quads in the same airflow stay under about
77 deg/s (`../2026-10-21-issue-logs/`). Experiments run on a scratch copy of sim-core with switches
(`kick-experiment.patch`: K_ASYM motor spread, K_BAND windmill depth, K_LAG prop-load lag, K_SIMMONS measured
thrust shape, K_CMD fixed motor commands, K_DEAD motor dead time); run with `ROOT=<patched copy>`.

## 1. The mechanism (`trace.test.ts`, `trace-original.txt`, `trace-supafly5.txt`)

The owner's chop, ms by ms. In 40 ms all four props spin down from 25 000 to about 9 000 rpm; at 38-41 m/s of air
along the thrust axis they windmill, about -4 N each. One side spins down slightly faster (spread from before the
chop), brakes slightly less, and the quad starts to roll. The controller raises the other side to full command within
15 ms. In the model a windmilling prop brakes harder as it speeds up (-3.4 N at 7 000 rpm to -4.8 N at 17 000), so for
about 25 ms the correction pushes the wrong way and the roll grows to 139 deg/s; past about 20 000 rpm the thrust turns
positive and the correction wins (0.49 N m the other way at 80 ms). Thrust there changes about 0.6 N per 1000 rpm.

## 2. The owner's 139 deg/s is a high case (`sweep.test.ts`, `sweep-output.txt`)

The owner's chop with the sticks centred from the chop on, repeated with 16 small motor spreads (each rotor's thrust
and torque within +-2.5 %): peak rate median / max 83 / 113 deg/s (original tune), 59 / 88 (SupaFly). Real centred
chops (11): about 60 / 77. Tilt change 5-7 deg both.

## 3. What does not match: how violent the fight is (`accel.test.ts`, `chop_accel.py`, `real-chop-timelines.txt`)

Largest angular acceleration over 10 ms steps (rates through a 100 Hz PT1 in the sim) in the 400 ms after the throttle
reaches minimum, and the top motor command then:

| | acceleration median / max | top motor (median) |
| --- | --- | --- |
| real, 11 centred chops (`real-chops-accel-output.txt`) | 2 200 / 3 700 deg/s^2 | 0.49 |
| sim, 16 seeded chops, original / SupaFly | 7 100 / 10 800, 7 200 / 11 500 | 1.00 / 0.97 |

In the real logs the quad starts to tip, the controller raises the opposite pair to 0.35-0.5 and the rate turns
around; in the sim the pair goes to full and the rate keeps growing for 10-15 ms.

## 4. Candidate causes tried (`variants.test.ts`, `variants-output.txt`; 16 seeds each)

None brings the acceleration near 2 200 or the top motor near 0.5: motors at the measured speed (rotor inertia x1.5,
gap 4), Simmons' measured thrust shape past zero thrust (AIAA 2021-1190, gap 1), prop loads lagged 1 ms (Peters,
gap 3), the measured torque ratio (AOS-RC), roll/pitch inertia x2, and all of them together (acceleration 5 500-8 300).

## 5. Side finding: the sim is stable only because it has almost no delay (`deadflight.test.ts`, `deadinertia.test.ts`)

Real ESCs and motors add about 4 ms of dead time (NeuroBEM telemetry, `../2026-10-20-motor-lag/`); the sim has none.
With it, the sim's quad oscillates in ordinary flight (owner's flight 0.5-4.1 s, rate error rms 2 deg/s as built,
112-135 with 4 ms, 53-67 with 2 ms), while real quads fly the same Betaflight gains (the sim's P, I, D scaling and
filters are Betaflight's) with that delay. With 4 ms dead time and measured motor speed, it takes roll/pitch inertia
x2 (0.0032 kg m^2) to fly steadily again (rms 3-4). The preset's 0.0016 is an estimate (sum of parts). No measured
inertia of a 5-inch quad was found yet (NeuroBEM's 2.5/2.1 x 10^-3 is a 6-inch frame at 772 g). Even with inertia x2
the chop's acceleration stays at 7 500-8 300 deg/s^2 (section 4).

## 6. Closed-loop authority fit (`authority_fit.py`, `simlog.test.ts`, `authority-fit-output.txt`)

Acceleration against motor-command difference in ordinary flight: correlations 0.03-0.67 on the real logs (feedback
and noise), so not usable to compare authority. Kept for the record.

## Where this leaves the kick

The kick is the controller fighting props in the windmill band. Its final size is mostly in the real range (SupaFly),
but it starts about 3x harder than in real quads and always saturates the correcting motors. No single measured
correction fixes that. Open: why the sim needs no delay to be stable (inertia, or something else too strong in the
model), which a measured inertia of a 5-inch quad would settle.
