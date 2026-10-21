# Top speed, and Betaflight's documented fixes for throttle-chop wobble tried in the sim (2026-10-21)

## 1. Top speed (`topspeed.test.ts`, `topspeed-output.txt`)

Nazgul on this branch (sim-core 0.8.0, airflow physics), full throttle, acro, sticks centred, 10 s per tilt:
level-flight top speed 43.6 m/s (157 km/h), thrust axis about 84 deg from vertical. With the frame's drag area
(`cda_*`, all estimates) scaled 0.75 / 1.5: 166 / 143 km/h. The owner's chop flight was at about 41 m/s.

Measured data: none found. Public GPS logs (Diatone Roma F5 6S, `../2026-10-21-public-logs/`) reach 27-32 m/s only in
short dives at 30-50 % throttle; their full-throttle bursts are short punch-outs ending at 14-23 m/s, so they never
measure top speed. Oscar Liang ("How to Make an FPV Drone Faster", read in full) gives about 150 km/h for a typical
6S 5-inch freestyle quad, without a method; other web figures (140-170 km/h) are unsourced. iFlight's 190 km/h
claim (preset note) is marketing. So 157 km/h is in the claimed range, not verified.

## 2. Betaflight's documented fixes (sources read in full, `betaflight/betaflight.com` docs)

- PID Tuning Guide: the punch-and-cut test; "Punch throttle and cut. If there is movement then add anti-gravity
  gain"; raise I until attitude holds through throttle moves, then anti-gravity for the throttle coupling.
- PID Tuning Tab: Pitch Tracking (pitch P/I relative to roll) "Increase to stabilise pitch (nose) bobble with sharp
  pitch inputs or throttle chops. Also consider raising Anti-Gravity gains"; Drift-Wobble (I): too much I with too
  little P "may cause wobbles or bounceback ... on chopping the throttle to 0%"; Anti Gravity higher "may improve
  stability on low authority machines or those with an offset centre of gravity"; Dynamic Idle around 3000-3500 rpm.
- 4.3 Tuning Notes: anti-gravity "now increases P during hard throttle chops", with very high values risking "P and
  I wobble during throttle chops"; "Zero throttle instability": 24 kHz ESC PWM, dynamic idle 3500-4000 rpm, thrust
  linear 25, slightly higher PIDs; dynamic idle 4000 rpm "usually works really well".
- Dynamic Idle guide: low idle gives "reduced stability when chopping throttle hard after a punch"; higher minimum
  rpm, better zero-throttle stability.
- Freestyle Tuning Principles (5-inch): P 60-70, I 90-100, D 40-50, I-term relax setpoint cutoff 7-12, idle 3-4 %
  with dynamic idle, thrust linear 20-25; higher ESC PWM "can introduce wobbles at zero or low throttle".

## 3. Those fixes in the sim (`tunefix.test.ts`, `tunefix-output.txt`; anti-gravity scale via `knobs-experiment.patch`)

On the owner's chop (4.15-7 s) and on clean chops (sticks centred, 2 % motor spread) at 30 / 37 m/s level and 27 m/s
climbing: every change moves the result the way the docs say, none removes it. All PIDs +30 %: owner chop 139/26 ->
11/66 deg/s, motor-high 1514 -> 1246 ms, I 191 -> 115. Anti-gravity x2: drift 3.9 -> 2.1 deg; x0.5: roll 160 deg/s
(worse). Static idle 7 %: drift 2.5 deg. Throttle expo 30: 84/62 deg/s. Freestyle values + dynamic idle 4000:
34/84 deg/s, I 136. Dynamic idle 4000 alone and I -30 %: little change. Clean chops stay at 11-24 / 26-61 deg/s in
every case. Not modelled: thrust linear, ESC PWM frequency. The sim's default tune is Betaflight's stock defaults
(45/80/40 roll, 47/84/46 pitch).

## 4. A published preset: SupaflyFPV Freestyle 5 Inch (owner's ask, 2026-10-21)

Source: `betaflight/firmware-presets` `presets/4.5/tune/supafly_fpv/SupaflyFPV_Freestyle_5_Inch_EasyTune.txt` (GPL-3.0,
copy here, read in full). It sets simplified-tuning sliders, thrust_linear 30, TPA PD 50 % from 1250 with the low
breakpoint at 1100 always on (tpa_low_rate default 20), dyn_idle_min_rpm 30, iterm_relax_cutoff 10, anti_gravity_gain
120 (action-camera option, the default) or 110, dynamic D off. PIDs from Betaflight 4.5.1 `simplified_tuning.c` on the
4.5 defaults: camera option roll 56/86/36/117, pitch 71/108/49/146, yaw 56/86/0/117; no camera roll 51/78/33/112,
pitch 59/90/41/128. TPA, thrust linear and the relax cutoff were added to the scratch copy from 4.5.1 `pid.c`
(`pidUpdateTpaFactor`, `pidCompensateThrustLinearization`, `pidApplyThrustLinearization`) and `mixer.c` order
(`knobs-experiment.patch`).

Result (`supafly.test.ts`, `supafly-output.txt`, `supafly-owner-chop-output.txt`): it bobbles the same way, somewhat
less. Owner's chop: stock RMS 13 deg/s, tilt change 6.9 deg; SupaFly (camera) 11 deg/s, 4.6 deg; no-camera option
13, 7.2; motor above 15 % about 1.5 s in every case. Without thrust linear: 6.7 deg (worse); without its always-on
low-throttle TPA (20 % less P and D at zero throttle): 4.2 deg (better). Clean chops 30-37 m/s: 11-17 / 22-35 deg/s
with SupaFly against 14-22 / 33-53 stock. Peak rates on the single owner flight swap between roll and pitch from
small changes, so RMS and tilt change are the steadier measures.

Found on the way (gap 6 correction): the sim's flight controller has no TPA (not even Betaflight's default, D 65 %
from 1350), no thrust linear, a fixed I-term relax cutoff (15) and fixed D (no dynamic D); the earlier line-by-line
check covered the mixer and anti-gravity only.
