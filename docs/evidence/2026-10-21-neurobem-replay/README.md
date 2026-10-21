# Is the physics too lively? The NeuroBEM quad rebuilt in the sim and flown with its own sticks (2026-10-21, review G12)

Owner's ask: "if the physics is clearly too lively, lets work that out." Data: NeuroBEM's raw Betaflight logs
(`../2026-10-20-motor-lag/`: l1 hover-like 59 s, l2 aggressive 115 s; not committed, no licence stated).

## 1. The delay chain (`sim-lag.test.ts`, `sim-lag-output.txt`; method `../2026-10-20-motor-lag/telemlag.py`)

Cross-correlation of the body's angular acceleration (Betaflight-filtered gyro) with the torque from the motor commands
and from the rotor speeds:

| | command -> acceleration | rotor speed -> acceleration |
| --- | --- | --- |
| real NeuroBEM quad (l1, l2) | 15-21 ms | 4-8 ms |
| sim Nazgul, 1 kHz / 4 kHz | 9 / 11 ms | 0 to -1 ms |

The real chain is 6-10 ms slower, consistent with the measured ESC dead time (4 ms) plus slower motors: the "real delay"
of the SITL and step tests was in the measured range, not counted twice.

## 2. Authority from rotor speeds (`authority_rpm.py`, `authority-output.txt`)

Measured angular acceleration over what arm x kT x sum(+-w^2) / inertia predicts: real NeuroBEM 0.4-0.9 depending on the
kT taken (from hover, or from its config's 8.5 N at 2800 rad/s), sim 0.7-0.8. Not conclusive either way.

## 3. The NeuroBEM quad in the sim (`neurobem.json`, `hover.test.ts`, `spool.test.ts`, `replay.test.ts`)

- Preset from the Nazgul's with NeuroBEM's: 752 g, Hobbywing XRotor 2306 2400 KV, 4S, 5.1-inch three-blade (pitch 4.4:
  the windmill tables refuse its real 4.8, a limit of the model), motors at +-77.5 mm forward / +-100 mm lateral and
  inertia 2.5 / 2.1 / 4.3 x 10^-3 kg m^2 (uzh-rpg/agile_flight `kingfisher.yaml`, MIT), thrust fitted so it hovers at
  the logs' 11 100-11 500 rpm (twr 5.6; 4.5 from the paper's 33 N gave 13 000 rpm).
- Its motors in the model already match its measured spool (63 % in 23-24 ms; measured 24-32 rise, 20-26 fall after the
  4 ms dead time, `spool-output.txt`), so the only addition is the dead time.
- Controller: the built-in one set as its log header (Betaflight 4.2.0: P40 I80 D20, F0, yaw P30 I60, rc_rate 2.2 /
  2.04 with no super rate or expo, no TPA, anti-gravity 1.0), loop 4 kHz (real 3.2 kHz), gyro logged through PT1 200 +
  250 Hz (its gyro_lowpass dynamic minimum and lowpass2). Sticks and throttle replayed from the log.

Results (`replay-output.txt`):

| | tracking error rms / p99 | step response 50 % roll / pitch |
| --- | --- | --- |
| real l2 (aggressive) | 10.9 / 44 deg/s | 28 / 22 ms |
| sim, no dead time | 7.3 / 33 | 26 / 21 |
| sim, 4 ms dead time | 8.9 / 39 | 26 / 22 |
| real l1 (hover-like) | 2.4 / 6 | 32 / 35 |
| sim, 4 ms dead time | 9.5 / 26 | 27 / 35 |

(l1's sim error is higher: the replayed sticks fly the sim quad from 2000 m with no position loop, so it drifts and
falls where the real pilot held a hover; its step response still matches.)

## Conclusion

With a real quad's measured mass, inertia, geometry and hover thrust, its own Betaflight tune and the real ESC dead time,
the sim's physics reproduces the real step response and stays calm. The physics engine is not generally too lively. The
Nazgul preset is: its numbers (inertia 0.0016 kg m^2 estimated, 14.4 N per motor at full, 84 mm arms) give about 1.9x the
NeuroBEM quad's angular acceleration per motor command, and with Betaflight's default gains and the real dead time it
oscillates, where real 6S 5-inch quads (Roma F5) fly near-default gains at 16-22 ms. Open: measure the Nazgul's (or the
owner's quad's) inertia and real tune; add the measured ESC dead time to the motor model once the preset is right.

## 4. The game preset (`packages/sim-core/presets/uzh-kingfisher-4s.json`, owner 2026-10-21: "add the zurich drone as an option")

Written by `make_kingfisher_preset.py`; sim-core reads the stretched X and per-axis inertia from the optional preset fields
`motor_forward_mm`, `motor_lateral_mm`, `inertia_roll_kgm2`, `inertia_pitch_kgm2`. With UZH's torque ratio kappa 0.022
the hover fit is twr 4.6: hover 11 400 rpm (logs 11 100-11 500), static 31.6 N (paper about 33 N). Its logged flights
replayed with the final preset (`replay-preset.test.ts`, `replay-preset-output.txt`): l2 step response 24 / 21 ms with
the 4 ms dead time (real 28 / 22), tracking error 8.3 deg/s (real 10.9). (Sections 3's numbers used an earlier fit, twr
5.6 with kappa 0.0136.)
