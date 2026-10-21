# Thrust-stand sweeps (Chris Rosser, AOS-RC) against the Nazgul's motor model (2026-10-21, review G12)

Owner's ask: "research online sources for thrust stand test data? Chris roster of AOS RC has a spreadsheet with simple
data for props." Data: Chris Rosser's (AOS-RC) prop-testing spreadsheet, the owner's copy (`Prop Testing.xlsx`, 2022; not
committed: third-party data, his raw data is shared through https://www.patreon.com/chris_rosser). 44 five-inch props,
one sheet each: a slow throttle ramp (ESC signal 1000-2000 us, one sample per step at about 10 Hz) with thrust, torque,
bench voltage (about 23-24 V, 6S), current and optical rpm. No other public 6S 5-inch sweep with throttle was found.

## The motor on the stand (`motor_fit.py`, `motor_fit-output.txt`)

The spreadsheet does not name the motor. Fitting a DC motor + ESC to every sheet (duty d = (signal - 1000) / 1000,
torque Q = Kt (I - I0), d V = Ke w + R I + c): the same motor on all 44 props, Kt and Ke both at about 1 850 KV,
effective resistance (winding, ESC, wiring) 0.15-0.17 ohm, and an offset c of about 0.95 V (about 4 % of the duty
lost in the ESC). On the Nazgul F5 prop at full: 28 900 rpm, 15.4 N, 36.4 A at 23.1 V.

The sim's Nazgul motor (XING2 2207 1750 KV): R 0.114 ohm, derived from the preset's estimated `rpm_loaded_fraction`
0.80. Scaled to 1750 KV (R ~ 1/KV^2) the stand's 0.163 ohm is 0.18 ohm. A lower R makes a motor spool faster (the
back-EMF term Ke^2 / R): the sim's motor is about 1.4-1.6x quicker than this measurement, the same gap as NeuroBEM's
measured motors (`../2026-10-20-motor-lag/`).

## The Nazgul with the measured resistance (`frac.test.ts`, `frac-output.txt`)

`rpm_loaded_fraction` 0.70 gives R 0.176 ohm: spool 0.25 -> 0.40 in 24 ms (63 %) instead of 18 ms. The static thrust at
full stays 1 396 g (the stand's Nazgul F5 prop on 1850 KV: 1 572 g at 28 900 rpm, about 1 405 g scaled to 1750 KV).
The full-throttle rpm drops to 25 200 (about 27 300 expected for 1750 KV): one parameter cannot match both, since the
model has no ESC duty offset (the fitted c).

Thrust against throttle, Nazgul F5 prop (stand, 1850 KV, 24 V) and the model (1750 KV, 24 V, f 0.80 / 0.70):

| command | stand rpm / thrust | model f 0.80 | model f 0.70 |
| --- | --- | --- | --- |
| 0.2 | 7 070 / 69 g | 7 930 / 112 g | 7 530 / 125 g |
| 0.3 | 11 190 / 188 g | 11 480 / 235 g | 10 720 / 253 g |
| 0.5 | 17 760-18 150 / 533-558 g | 17 690 / 559 g | 16 150 / 575 g |
| 0.7 | 23 730 / 1 005 g | 22 680 / 918 g | 20 470 / 924 g |
| 1.0 | 28 840 / 1 563 g | 27 930 / 1 393 g | 25 170 / 1 396 g |

Below mid throttle the model makes more thrust than the stand: the ESC's duty offset again.

## The real Nazgul tunes with the measured motor (`nazgul-tunes.test.ts`, `nazgul-tunes-output.txt`)

4 kHz, the measured 4 ms ESC dead time, the 60 s step flight (as `../2026-10-21-nazgul-public-data/`), error rms:

| inertia | iFlight's tune, f 0.80 | iFlight's tune, f 0.70 | Betaflight defaults, f 0.70 |
| --- | --- | --- | --- |
| 0.0016 | 134 deg/s | 110 | 76 |
| 0.0019 | 108 | 53 | 48 |
| 0.0022 | 71 | 16 | 11.5 |

With the measured motor, the real tunes fly with the real delay at inertia 0.0022 kg m^2, inside the plausible range
(UZH's larger, heavier Kingfisher measured 0.0021-0.0025), where before it took 0.0028.

## Conclusion

The Nazgul preset's motor is too stiff: its resistance came from an estimated `rpm_loaded_fraction` (0.80); a 6S 2207
on a stand measures about 0.70. With that, the measured ESC dead time and inertia 0.0022, the sim Nazgul flies real
Nazgul tunes the way real quads do. Still not modelled: the ESC's duty offset (about 4 %, which sets low-throttle thrust
and idle rpm).

## Applied to the Nazgul (owner: "Yes put it on next", 2026-10-21)

sim-core gains optional preset fields for the ESC: `esc_duty_offset` (the winding sees max(0, d - offset) x V; the motor
model's R formula includes it) and `esc_delay_ms` (the motors act on the command of that many ms ago, a buffer in the
hashed state), and an optional preset `tpa` (Betaflight CLI units). Absent: as before, bit for bit.

The Nazgul preset now has rpm_loaded_fraction 0.66 with esc_duty_offset 0.04 (R 0.178 ohm, the stand's 0.18 at 1750 KV;
spool 25 ms, `frac-offset.test.ts`), inertia 0.0022 / yaw 0.0038, and Betaflight 4.5's default TPA (D 65 % from 1350),
which real Betaflight ships and without which the default gains shake at full throttle (`tpa-full-throttle.test.ts`,
`tpa-full-throttle-output.txt`).

**The ESC dead time is not applied** (`chop-new-nazgul.test.ts`, `chop-variants-output.txt`): with it the throttle chop
at 43 m/s turns violent (SupaFly: peak 163 / 206 deg/s, angular acceleration 19 800 deg/s^2); without it the new numbers
give the calmest chop yet. The delay is real, so the windmill band (the props' braking at speed) is still too strong in
the model; the delay goes in once that is right.

As shipped (`chop-final-output.txt`, `step-final-output.txt`; 4 kHz, 16 motor spreads, sticks centred):

| | peak median / max | angular acceleration median | top motor | tilt |
| --- | --- | --- | --- | --- |
| SupaFly (game default) | 40 / 62 deg/s | 3 840 deg/s^2 | 0.80 | 5.0 deg |
| Betaflight defaults | 44 / 63 | 2 590 | 0.68 | 4.6 |
| previous build (`../2026-10-21-sitl/`) | 62 / 86 | 3 960 | 0.91 | 6.6 |
| real issue logs | ~60 / 77 | 2 200 | 0.49 | 6 |

Step response with SupaFly: 50 % in 10-11 ms with 15-21 % overshoot (real quads on default-like gains 16-22 ms; the
missing dead time makes the sim quicker). Level top speed with TPA tunes 142 km/h, as before.
