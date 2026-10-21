# Motor spool, ESC braking and dive speed checked against measured data (2026-10-20, gaps 4 and 5 of physics §2g)

## Data and sources (read in full)

- NeuroBEM (Bauersfeld et al., RSS 2021, https://rpg.ifi.uzh.ch/NeuroBEM.html): 752 g quad, Hobbywing XRotor 2306 motors,
  5-inch three-blade props, 4S, static thrust-to-weight 4.5, Betaflight 4.2.0 (paper §IV-B). Its `raw_data.zip` holds the
  quad's Betaflight blackbox logs: `motor[0-3]` (the DShot command) and, with `debug_mode` 45, each motor's DShot RPM
  telemetry. Not in this repo (no licence stated): `zipdir.py` lists the zip by HTTP range, `zipget.py` fetches one
  entry (each log about 1 MB), `bb2npz.py` decodes it with orangebox (GPL-3.0, `pip install orangebox numpy`).
  Logs used: `2021-02-03-13-43-38.BFL` (l1, 59 s, hover-like, command 0.055-0.38) and `2021-02-03-17-26-08.BFL`
  (l2, 115 s, command 0.055-1.0).
- Betaflight 4.2.0 source: `build/debug.h` (index 45 = `DEBUG_DSHOT_RPM_TELEMETRY`), `drivers/pwm_output_dshot_shared.c`
  and `dshot_bitbang_decode.c` (the value is eRPM / 100). Pole count 14: telemetry medians match the processed dataset's
  rad/s (1162 vs 1142); 12 poles gives 1356.
- BLHeli_32 manual Rev32.x (github.com/bitdump/BLHeli): damped light (regenerative braking, active freewheeling) is the
  default; rampup power and low-rpm power protect cap the power at low rpm; maximum acceleration (unlimited by
  default); "motors stop e.g. due to reverse flow" at very low throttle (stall protection, Rev32.9).
- AM32 source (github.com/am32-firmware/AM32, `Src/main.c`, `Inc/targets.h`, main branch 2026-10-20): complementary
  PWM; low-rpm duty cap on by default, 20 % -> 100 % between KV/100/(32/poles) and KV/12/(32/poles) k erpm
  (1750 KV, 14 poles: 8 -> 72 k erpm, 1140 -> 10 300 rpm); duty slew per 20 kHz tick 6/2000 under 40 k erpm, 16/2000
  above (6 and 16 %/ms), 2/2000 at startup.
- Hammer et al., "Free fall drag estimation of small-scale multirotor UAS", CEAS Aeronaut J 15:269-282 (2024): wind
  tunnel and CFD; free-spinning props add 75-110 % drag edge-on, but stop at fuselage pitch above 55 deg (air through
  the discs) and then match locked props; its UAS fall at about 20 m/s.

## Results

| | dead time | rise tau | fall tau | from idle: 10 % / 63 % |
|---|---|---|---|---|
| real, l1 (`spool-output.txt`) | 4 ms | 32 ms | 26 ms | 13-14 / 36-40 ms (`steps-output.txt`) |
| real, l2 | 4 ms | 24 ms | 20 ms | 13-15 / 40-41 ms |
| sim-core 0.8.0 motor driven by the same commands (`modelfit-output.txt`) | 0 | 18-20 ms | 20 ms | 2-3 / 19-20 ms (`model-step-output.txt`) |

- Peak spool acceleration from idle: real 38-58 k rad/s^2, model 47-66 k: once moving the real motor accelerates like
  the model; it starts later.
- The telemetry is not what is late (`telemlag-output.txt`): roll angular acceleration from the gyro follows the
  telemetry rpm by about 5 ms (gyro filtering) and the command by 15-18 ms (correlation 0.36-0.52; pitch weaker).
- Idle in flight: 2950 rpm median at command 0.055 (p5-p95 2800-3090); with the air from below (sinking > 3 m/s) idle
  motors 2550-3400 rpm (`idleflow-output.txt`). NeuroBEM never idles a motor with the air from in front (0 samples
  above 3 m/s climb), so there is no flight data for the chop case.
- On the owner's chop flight (sticks replayed, 4.15-7 s; `chop-inertia-output.txt`, `chop-esc-output.txt`):

| model | roll rate max | pitch rate max | pitch drift | motor > 15 % |
|---|---|---|---|---|
| 0.8.0 + NACA refit | 139 deg/s | 26 | 3.9 deg | 1514 ms |
| rotor inertia x1.5 (63 % at 26-29 ms, as measured) | 90 | 90 | 4.3 | 1510 ms |
| rotor inertia x2 (35-39 ms) | 95 | 105 | 6.0 | 1526 ms |
| AM32 low-rpm duty cap + slew (`esc-experiment.patch`, scratch copy only) | 139 | 26 | 4.0 | 1516 ms |

  The cap never acts in the chop: the air keeps the motors above 10 k rpm. From idle it delays a step by about 3 ms.

## Conclusion

Gap 4: the model's motors respond 1.3-1.6 x faster than measured and lack about 4 ms of dead time (11-13 ms from
idle). Real, but matching it does not remove the bobble. Gap 5: braking at low duty is real (both firmwares); their
low-rpm limits do not act in a chop. Dive speed: no measured 5-inch figure found (blogs only, unsourced).
Caveat: NeuroBEM's motor (2306, 4S) is not the Nazgul's (2207 1750 KV, 6S); same class and hover speed.

Run: model tests `ROOT=<repo> pnpm exec vitest run --root docs/evidence/2026-10-20-motor-lag <name>`
(`chop-esc` needs a copy of sim-core with `esc-experiment.patch` as ROOT); Python scripts take the decoded `.npz`.
