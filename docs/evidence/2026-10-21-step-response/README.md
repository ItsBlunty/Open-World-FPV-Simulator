# Step response: the sim against real 5-inch logs (2026-10-21, physics §2g, review G12)

Owner's ask: compare the sim's step response with real logs (then inertia, then thrust; stop on something big).

## Method (`step_response.py`, `step_by_speed.py`)

Setpoint-to-gyro step response by deconvolution, as PID-Analyzer (Plasmatree) and PIDtoolbox compute it: 2 s Hann
windows with enough stick, Wiener-style division in frequency, step = cumulative impulse response, each window
normalised to its 300-500 ms level, then averaged. Reported: time to 50 % and 90 %, and the peak. The same code runs on
the sim (`simstep.test.ts`: 90 s acro flight in open air, pilot-like ramps to random roll/pitch targets, gyro through
Betaflight's default PT1 250 Hz + 500 Hz like the logged gyroADC; `fast` holds the nose 70 deg down at 30-33 m/s).

## Real logs (`real-step-output.txt`, `real-step-by-speed-output.txt`)

- gimbal-ghost `LOG00001.BFL` (GPL-3.0; Betaflight 4.3.0, Matek F405, near-default tune: PIDs 45/80/40, 47/84/46,
  the sim's "original" tune): 50 % at 17-19 ms, 90 % at 29-38 ms.
- Diatone Roma F5 6S (Betaflight 4.2.9, PIDs 47/85/38, 49/90/40; logged at 250 Hz): 50 % at 16-22 ms, 90 % at 35-47.
- Fawkes (Betaflight 2025.12, much lower P and I): 50 % at 22-34 ms.
- By GPS speed (gimbal-ghost and Roma): under 16 m/s 50 % at 13-21 ms; over 16 m/s 15-31 ms (median about 19-20).
  The real quads do not get quicker at speed.

## Sim (`sim-step-output.txt`; original tune = Betaflight 4.5 defaults)

| | 50 % | 90 % | peak |
| --- | --- | --- | --- |
| slow flight, as built | 12 ms | 28-30 ms | 1.05 at 66-74 ms |
| fast flight (30-33 m/s), as built | 10-11 ms | 24-25 ms | 1.08 at 53 ms |
| fast, 4 ms ESC dead time + measured motor speed | 8-11 ms | 12-16 ms | 1.36-1.51 (oscillating) |
| fast, the same + inertia x2 | 13 ms | 22 ms | 1.18-1.20 |

## Result

The sim's quad follows the sticks about 5-8 ms sooner than real quads on the same gains (12 against 16-22 ms), and in
fast flight it gets quicker still (10 ms), while the real quads stay at about 15-31 ms. With the measured 4 ms ESC
dead time it oscillates in fast flight. So the model's control response is too strong or too fast, most of all at
speed. Candidates still to check: roll/pitch inertia (estimate 0.0016 kg m^2), thrust change per command and its growth
with airspeed (thrust-stand data), missing delays.
