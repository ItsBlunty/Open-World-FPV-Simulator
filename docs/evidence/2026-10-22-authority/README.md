# The Nazgul's authority with the ESC dead time, checked with real Betaflight (2026-10-21, review G12 / F9)

Owner's choice: research the "too much authority" gap (`../2026-10-21-esc-delay/`) with public data first. Nothing in
sim-core or the presets changed.

## 1. Authority from public logs: not usable (`authority_big.py`, `authority_big-output.txt`)

Angular acceleration against the motor-command difference, only where the difference is large (flip entries): the
Roma F5 logs are 250 Hz and the pilots rarely push |u| past 0.25; fits swing from 600 to 270 000 deg/s^2 per unit with
r 0.2-0.9 and a few dozen samples. Like the closed-loop fit before (`../2026-10-21-kick/` §6), no usable number.

## 2. Betaflight SITL on today's Nazgul (`run_steps_now.sh`, `steps-output.txt`)

The lock-step SITL of `../2026-10-21-sitl/` (Betaflight 2026.6.2, 4 kHz, `original.cli`: Betaflight's default gains, D at
its peak, TPA off) and the built-in controller (same gains, TPA off), on the current preset (measured motor, inertia
0.0022) compiled from this branch, with the bridge's 4 ms dead time:

| flight | controller | no dead time: error rms, 50 % | 4 ms dead time: error rms, 50 %, peak |
| --- | --- | --- | --- |
| steps (hover, pilot-like ramps) | SITL | 11.3 deg/s, 15-16 ms | 12.9, 14-15 ms, 1.08-1.10 |
| steps | built-in | 9.1, 13-14 ms | 15.6, 12-13 ms, 1.07-1.08 |
| fast (30 m/s) | SITL | 4.4, 14-15 ms | 7.1, 13-14 ms, 1.11-1.13 |
| fast | built-in | 3.2, 12 ms | 14.7, 10-11 ms, 1.13-1.17 |

On the old preset the same flights with the delay gave 51-61 deg/s with motors pinned (`../2026-10-21-sitl/`). With the
measured motor and inertia, real Betaflight flies the real delay calmly and lands near real quads' 16-22 ms. The 1.5-1.65
overshoot of `../2026-10-21-esc-delay/` §4 came from an unsmoothed instant stick step into the built-in feedforward, not
from the physics. Normal-flight authority is not the gap.

## 3. The chop through real Betaflight (`run_chop_now.sh`, `run_chop_tpa.sh`, `chop-output.txt`, `punchout-output.txt`)

The owner's flight, sticks centred from the chop, 16 motor spreads (+-2.5 %), 4 kHz:

| | peak median / max deg/s | angular acceleration median deg/s^2 | top motor |
| --- | --- | --- | --- |
| TPA off, no dead time: SITL / built-in | 46 / 62, 44 / 64 | 2 700, 2 570 | 0.71, 0.70 |
| TPA off, 4 ms: SITL / built-in | 229 / 240, 166 / 170 | 27 600, 22 800 | 1.00 |
| Betaflight's default TPA, 4 ms: SITL / built-in | 117 / 172, 95 / 138 | 10 950, 10 060 | 0.95, 0.93 |
| real issue logs | ~60 / 77 | 2 200 | 0.49 |

With TPA off and the delay, both controllers already shake through the full-throttle punch-out at 27-35 m/s (error
38-51 deg/s against 0-10), so the chop starts from a shaking quad; Betaflight's default TPA (D lowered above 35 %
throttle, as real Betaflight ships) removes that (error 0-12). The chop itself stays about 2x the real kick and 5x its
angular acceleration, and real Betaflight is no calmer than the built-in controller.

## Conclusion

- With the delay, normal flight is right: real Betaflight's step response and tracking on the sim Nazgul look like real
  quads. The authority gap of `../2026-10-21-esc-delay/` is withdrawn.
- What is left is the chop alone: real Betaflight with the real delay kicks about twice as hard as real quads do. With
  the band's hump flattened the built-in controller gives real-like chops (`../2026-10-21-esc-delay/` §3), so the open
  question is how a real prop behaves while it is pushed back over the hump fast (a few ms), which steady-state data
  (NACA, Simmons, UIUC) cannot show. Caveat: the real chop logs are Betaflight 3.2-4.0 at unknown speeds.
