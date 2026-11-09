# BetaFPV Air75 II presets: sources, the bench table, the arithmetic (2026-11-09)

Three presets, one per version BetaFPV sells: `packages/sim-core/presets/air75ii-freestyle-1s.json`,
`air75ii-racing-1s.json`, `air75ii-champion-1s.json`, written by `make-presets.py` here from one table. The note is
`docs/notes/physics.md` §2w; the physics finding the bench gave is `docs/physics-review.md` F9.

## Files

| File | What |
|---|---|
| `make-presets.py` | writes the three preset files (run from the repo root); the shared numbers, the per-version ones, every note |
| `probe.test.ts` | the derivation probe: thrust-to-weight fixed point, hover, current, top speed, climb, roll and yaw response, angle mode, the throttle-curve fits (copy into `packages/sim-core/test/` to run) |
| `probe-output.txt` | its output on the final presets |

## Sources (all read 2026-11-09)

- Product page: https://betafpv.com/products/air75-ii-brushless-whoop-quadcopter (versions, motors, weights 20.2 /
  20.9 / 21.3 g without battery, flight times 6:50 / 7:00 / 7:30 on the LAVA II 1S 480 mAh, Matrix 1S 5IN1 II FC with a
  12 A ESC, C03 camera, 25-400 mW VTX, Gemfan 1614 3-blade props). Read through its retailer copies (the page rate-limited
  direct reads): getfpv.com, unmannedtechshop.co.uk, rotorvillage.ca.
- Motors: https://betafpv.com/products/0802-brushless-motors-2026 (KV, max power 34.3 / 31.15 / 22.73 W, max current 9 /
  8.15 / 5.90 A, 1.95 / 1.88 g, bearings, and the load-performance table below as the image
  `0802_Brushless_Motors_2026_load_performance.jpg`).
- Prop: https://betafpv.com/products/gemfan-1614-3-blade-propellers-1-0mm-shaft (40 mm, 1.4 in pitch, 0.24 g, 4 mm hub,
  7.7 mm max blade width, polycarbonate).
- Frame: https://betafpv.com/products/air75-ii-brushless-whoop-frame (75 mm wheelbase, 4.00 g, duct 42.0 mm by 4.5 mm
  high, 99.1 x 99.1 x 16.2 mm, FC holes 25.5 mm, "11 % more thrust" than the Air75 duct).
- Battery: https://betafpv.com/products/lava-ii-1s-battery (LAVA II 1S 480 mAh LiHV, 95C, 12.6 g, 61 x 15.5 x 6 mm).
- Camera: https://betafpv.com/products/c03-fpv-micro-camera (1/3 in CMOS, 2.1 mm lens, 160 deg, 4:3, 1.45 g); canopy:
  the Air II canopy, camera tilt 15-45 deg in 10 deg steps.
- CLI files: https://support.betafpv.com/hc/en-us/articles/54653618858521-CLI-and-Firmware-for-Air75-II, the `diff all`
  per version dated 20260515 for Betaflight 2026.6.0 (target BETAFPVG473_V2); an older set of 20260421 differs in PIDs.
- Betaflight defaults the files leave alone: `src/main/pg/motor.c` (motor_idle 550 for digital protocols),
  `src/main/fc/controlrate_profile.c` (ACTUAL rates, rc_rate 7, rates 67, thr_mid 50, thr_expo 0, thr_hover 50),
  `src/main/fc/rc.c` generateThrottleCurve (the three-point curve).
- Independent: Oscar Liang, review of the original Air75 (https://oscarliang.com/betafpv-air75/): 21 g, 33.5 g with a
  450 mAh pack, 35.2 g with a 550, 5:30-6:00 and about 7:00 flights, hover at 31 % stick on the stock 65 / 35 curve.
  Motor resistances of other makers' 0802s (T-Motor 180 mOhm, RCinPower 117 / 105 mOhm, VCI 190 / 150 mOhm) as a
  cross-check of the fitted 180-240 mOhm.

## BetaFPV's load-performance table (GF 1614-3P, supply)

| Version | Throttle % | V | A | g | W | g/W | rpm |
|---|---|---|---|---|---|---|---|
| Champion 28000KV | 20 | 3.93 | 0.45 | 4.1 | 1.76 | 2.33 | 12533 |
| | 30 | 3.92 | 1.17 | 10 | 4.58 | 2.19 | 19627 |
| | 40 | 3.90 | 2.11 | 17.2 | 8.25 | 2.08 | 25700 |
| | 50 | 3.89 | 3.06 | 24.2 | 11.91 | 2.03 | 30500 |
| | 60 | 3.88 | 4.04 | 31 | 15.67 | 1.98 | 34632 |
| | 70 | 3.86 | 5.16 | 38.5 | 19.94 | 1.93 | 38552 |
| | 80 | 3.85 | 6.35 | 45.7 | 24.42 | 1.87 | 42097 |
| | 90 | 3.83 | 7.52 | 51.8 | 28.82 | 1.80 | 45134 |
| | 100 | 3.81 | 9.00 | 58.2 | 34.30 | 1.70 | 47888 |
| Racing 25000KV | 20 | 3.93 | 0.40 | 3.4 | 1.55 | 2.19 | 11977 |
| | 30 | 3.92 | 1.03 | 9.5 | 4.04 | 2.35 | 19704 |
| | 40 | 3.91 | 1.86 | 16.3 | 7.26 | 2.25 | 25026 |
| | 50 | 3.90 | 2.70 | 22.9 | 10.53 | 2.17 | 29812 |
| | 60 | 3.88 | 3.58 | 29.6 | 13.89 | 2.13 | 33859 |
| | 70 | 3.87 | 4.56 | 36.8 | 17.65 | 2.08 | 37678 |
| | 80 | 3.86 | 5.66 | 43.3 | 21.84 | 1.98 | 41072 |
| | 90 | 3.84 | 6.75 | 49.2 | 25.98 | 1.89 | 43874 |
| | 100 | 3.82 | 8.15 | 55 | 31.15 | 1.77 | 46481 |
| Freestyle 22000KV | 20 | 3.93 | 0.27 | 2.3 | 1.04 | 2.21 | 10080 |
| | 30 | 3.92 | 0.69 | 7.1 | 2.70 | 2.63 | 16629 |
| | 40 | 3.92 | 1.25 | 12.4 | 4.90 | 2.53 | 22122 |
| | 50 | 3.91 | 1.87 | 18 | 7.31 | 2.46 | 26640 |
| | 60 | 3.90 | 2.48 | 24 | 9.67 | 2.48 | 30692 |
| | 70 | 3.89 | 3.18 | 29.9 | 12.36 | 2.42 | 34253 |
| | 80 | 3.88 | 3.96 | 36.3 | 15.36 | 2.36 | 37649 |
| | 90 | 3.87 | 4.76 | 41.7 | 18.43 | 2.26 | 40563 |
| | 100 | 3.86 | 5.90 | 47.7 | 22.73 | 2.10 | 43292 |

BetaFPV's remark: "The above data represents the test samples only."

## The stock tunes (CLI files of 20260515, Betaflight 2026.6.0)

| | Freestyle | Racing | Champion |
|---|---|---|---|
| roll P / I / D / F | 33 / 60 / 21 / 35 | 35 / 76 / 21 / 43 | 33 / 60 / 22 / 31 |
| pitch P / I / D / F | 33 / 59 / 21 / 35 | 31 / 68 / 25 / 38 | 33 / 59 / 22 / 31 |
| yaw P / I / F | 33 / 60 / 35 | 35 / 76 / 43 | 33 / 60 / 31 |
| d_max roll / pitch (not modelled) | 23 / 24 | 24 / 29 | 24 / 25 |
| rates (ACTUAL, rc_rate 7 default): srate roll / pitch / yaw, expo | 75 / 75 / 70, 10 / 10 / 5 | 58 / 58 / 50, 0 | 58 / 58 / 50, 0 |
| motor_idle | default 550 | 600 | 350 |
| thr_mid / thr_expo / thr_hover | default 50 / 0 / 50 | 28 / 25 / 17 | 25 / 45 / 16 |
| anti_gravity_gain, TPA | 60, 60 % from 1220 | 50, 60 % from 1180 | 50, 60 % from 1160 |
| shared | DSHOT300, bidirectional, 12 poles, yaw_motors_reversed, small_angle 180, gyro lpf2 550 Hz, 2 dynamic notches | | |

The 20260421 Freestyle file had P 38 / 41, I 68 / 74, D 26 / 31, F 40 / 44 and d_max 30 / 36; BetaFPV lowered the tune.
WhoopTool's dumps of the shipped Betaflight 4.5.3 (whooptool.com/samples/air75ii-*) match the 20260421 numbers for the
Freestyle (with dshot_idle_value 600) and differ for the others; the 20260515 files are the current official tune.

## Arithmetic

- **Mass:** dry + 12.6 g pack: 33.9 / 33.5 / 32.8 g. Parts check (Freestyle): 4 x 2.12 g motors with props + 4.0 frame
  + about 4.1 FC + 1.45 camera + about 1.2 canopy + wires, antenna, screws about 2 = 21.2 g (21.3 listed).
- **Thrust-to-weight:** T(V) = T_bench x (V / V_bench)^2 at full throttle (speed proportional to volts, thrust to speed
  squared); V is the model's own loaded voltage, the fixed point `compileParams` finds with the current it draws
  (`twr = 4 T(vNom) / (m g)`, iterated: probe.test.ts). With 35 mOhm per cell and the cell at 4.20 V: Freestyle 4.61 at
  3.494 V and 20.2 A, Racing 4.95 at 3.316 V and 25.2 A, Champion 5.15 at 3.244 V and 27.3 A; presets 4.6 / 5.0 / 5.1.
  With no pack resistance the fixed points would be 4 x 47.7 x (4.2 / 3.86)^2 / 33.9 = 6.7 and so on: the sag is most
  of the story on 1S, and it eats most of the higher-KV versions' bench advantage.
- **Speed per volt:** rpm / (KV x V) at 100 %: 0.51 / 0.49 / 0.45. Fitting rpm = Kv' (throttle x V - I R) to the 50 %
  and 100 % rows: R 0.24 / 0.20 / 0.18 ohm, Kv' 17 670 / 21 070 / 21 870 rpm/V (0.80 / 0.84 / 0.78 of the rated KV); the
  70 % row then comes out within 1-2 %, the 30 % row 7 % low (the idle offset and the ESC's low-duty behaviour).
- **Torque per thrust (kappa):** mechanical power = input - I^2 R - iron (0.5 W at 31 k rpm from Happymodel's no-load
  figures of the same class, scaled with rpm^1.5); Q = P_mech / omega; kappa = Q / T. Freestyle: 0.0064 m at 100 %
  (eta 0.60, figure of merit 0.42), 0.0078 at 80 % (eta 0.71, FoM 0.35), 0.012 at 50 % (FoM 0.22), about 0.02 at 30 %.
  Preset kappa 0.0075 for all three (one prop); efficiency 0.67 / 0.62 / 0.60 so that kappa / eta = input power /
  (T omega) at 70-100 %: 0.0107-0.0118 (Freestyle), 0.0119-0.0124 (Racing), 0.0120-0.0131 (Champion).
- **Inertia** (kg m^2, about the centre of mass, Freestyle): motors + props 4 x 2.12e-3 x 0.0265^2 = 6.0e-6 per axis
  (1.2e-5 yaw); frame as four 1 g rings of 23 mm at 26.5 mm: roll / pitch 4 x (2.2e-7 + 7.0e-7) = 3.7e-6, yaw 7.4e-6;
  pack 12.6 g, 61 x 15.5 x 6 mm lying along the pitch axis 9 mm above the motor plane (the centre of mass 3.3 mm up):
  pitch 5.2e-6, roll 1.6e-6, yaw 4.2e-6; FC 4 g 30 mm square: 3e-7 per axis; camera and canopy 2.5 g 25 mm ahead,
  10 mm up: pitch 1.8e-6, roll 0.3e-6, yaw 1.6e-6. Roll 1.2e-5, pitch 1.7e-5 (preset 1.45e-5 for both), yaw 2.6e-5.
- **Rotor inertia:** blades 0.146 g from 2.5 to 20 mm, tapered, about 1.3e-4 m^2 mean r^2: 1.9e-8; hub negligible;
  bell, magnets and shaft about 0.85 g at 4.3 mm: 1.6e-8. J 3.5e-8.
- **Motor lag:** tau = J / (Kt^2 / R + 2 Q0 / w0): Kt = 60 / (2 pi KV) = 4.34e-4 N m/A (Freestyle), Kt^2 / R = 7.9e-7;
  hover Q0 = 0.0075 x 0.083 N = 6.2e-4 N m at w0 about 1900 rad/s: 6.5e-7; tau = 3.5e-8 / 1.44e-6 = 24 ms; Racing 26,
  Champion 27. Preset 25 ms (15-35).
- **Rotor drag:** sqrt(g rho A_rotors / m) with A_rotors = 4 pi 0.02^2 = 5.03e-3 m^2: 1.34 / 1.35 / 1.36 1/s; x 0.68 as
  the Air65 preset: 0.91 / 0.92 / 0.93.
- **Drag areas:** side 99 x 16 mm frame + pack end-on + canopy + motors about 20 cm^2 at Cd 1.1 = 22 cm^2. From above,
  outside the prop discs: about 35 cm^2 at Cd 1.1 = 40 cm^2 (inflow); classic 70 cm^2. Probe: level top speed 59-61 km/h
  (inflow) and 64-66 (classic); climb after 8 s of full throttle 14.6-15.4 m/s.
- **Collider:** duct outer radius = (99.1 - 2 x 26.5) / 2 = 23.05 mm; spheres of 23 mm at (26.5, 26.5) mm reach 49.5 mm
  on each axis and 60.5 mm on the diagonal, the round duct's own corner; body 25 mm.
- **Throttle curve fit** (Racing, Champion): the sim's `throttleCurve(mid, expo)` against Betaflight 2026's Bezier at
  101 points, every whole mid and expo: Racing mid 1 / expo 32 (rms 1.4 %, max 3.0 %), Champion mid 2 / expo 38 (rms
  0.8 %, max 1.2 %). The real curve passes under the diagonal (28 % stick -> 17 % throttle); the two-parameter curve
  passes through (mid, mid), so the fit is nearly a plain expo curve from zero.
- **Hover (model, fresh pack):** motor 0.393 / 0.360 / 0.346, 1.72-1.84 A, 13-14 min on 85 % of 480 mAh. The bench
  puts 8.5 g per motor at about 32 % throttle and 3.3 W, so a real hover draws about 3.4 A for the motors and BetaFPV's
  7-minute flights fit; the model's constant kappa / eta cannot have both the sag at full throttle and this.

## Not found

A measured internal resistance of a 1S 480 mAh LiHV pack (estimate 35 mOhm with the connector and wiring, 25-50); any
flight log of an Air75 II (lag, in-flight thrust, sag); a published top speed; whether BetaFPV's bench was in the duct.
