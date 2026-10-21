# Public data for a 6S 5-inch freestyle quad, and the Nazgul preset against it (2026-10-21, review G12)

Owner's ask: "look for a nazgul, or any other similar 6s 5\" freestyle quad that has public data enough to be useable."

## What was found

- **Real Nazgul Evoque F5 tunes** (both 6S, IFLIGHT_BLITZ_F722, XING2 2207):
  - Betaflight 4.2.11 dump of the Nazgul Evoque F5 HD posted on IntoFPV by SnowLeopardFPV (2024-05-03) as "the latest one
    that iFlight have published for that particular BNF quad" (https://intofpv.com/printthread.php?tid=25822): P 62/64,
    I 94/99, D 45/48 (d_min 32/35), F 115/120 (roll/pitch), yaw 52/99/0/110; TPA 60 % from 1280 on D; dshot_idle 600;
    ACTUAL rates 19/90/60.
  - Betaflight 4.5.0 `diff all` of a Nazgul Evoque F5D V2 O3 6S on waltercedric.com (2023-08-09, probably the owner's
    own tune): P 59/62, D 50/57, F 134/139, simplified master 140, TPA 60 % from 1300, dyn_idle_min_rpm 35, D-term LPF
    52-105 Hz.
  Both fly well above Betaflight's default P 45 / D 40.
- **Diatone Roma F5 6S** (the gimbal-ghost logs, `../2026-10-21-public-logs/`): its Betaflight 4.2.9 header gives the
  tune (4 kHz PID, P 47/49, I 85/90, D 38/40 with d_min 23/25, F 90/95, TPA 65 % from 1350, BETAFLIGHT rates 1.0 / 0.70),
  but its hardware is too loosely known to rebuild (motor 1700 or 1770 KV in different listings, one weight of 400 g for
  one version, no rpm in the logs).
- **Measured inertia of a 6S 5-inch freestyle quad**: none found (papers and hobby pages give bifilar methods and other
  craft only). The closest measured quad is UZH's Kingfisher (`../2026-10-21-neurobem-replay/`), 0.0021-0.0025 kg m^2.
- **Real flight calmness** (`../2026-10-21-step-response/` logs): tracking error rms about 6-7 deg/s, p99 16-43 deg/s,
  motors at full 0.1-2 % of flying time (Roma F5, a Betaflight 4.3 default-tuned 5-inch).

## The sim Nazgul with these tunes (`inertia.test.ts`, `inertia-output.txt`)

4 kHz loop, the 60 s step-response flight, without and with the measured 4 ms ESC dead time, roll/pitch/yaw inertia
scaled (the pilot script's throttle trim holds full throttle about 15 % of the time even without delay, so that column
is not comparable to the real logs):

| inertia | iFlight's tune, 4 ms: error rms / p99 | Betaflight defaults, 4 ms |
| --- | --- | --- |
| 0.0016 (preset) | 134 / 185 deg/s | 96 / 140 |
| 0.0020 | 103 / 172 | 75 / 118 |
| 0.0024 | 43 / 114 | 53 / 106 |
| 0.0028 | 13.5 / 60 | 12.7 / 57 |
| 0.0032 | 12.5 / 56 | 12.2 / 57 |

Without the dead time every case flies (error 5-11 deg/s).

## Conclusion

The real Nazgul flies tunes stronger than Betaflight's defaults; the sim Nazgul flies neither with the real ESC delay
unless it is about 1.75x harder to turn. Inertia alone cannot be that (0.0028 would exceed the larger, heavier Kingfisher's
measured 0.0021-0.0025), so the Nazgul's thrust and motor numbers (6S, estimated thrust-to-weight 8, its spool) are also
suspect. The Kingfisher, whose numbers are measured, flies its own tune with the delay as its logs do. What would settle
the Nazgul: a 6S 2207 1750 KV thrust-stand sweep with throttle (thrust and rpm against command), a measured spool, or the
owner's own quad (swing test, `diff all`, a blackbox log with rpm).
