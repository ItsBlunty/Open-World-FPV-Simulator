# Throttle chops in the logs pilots attached to Betaflight's chop-bob issues, against the sim (2026-10-21, physics §2g)

Owner's ask: "SURELY there must be public logs from someone tuning throttle chop bobble right?"

## Logs (GitHub issue attachments, licence not stated: not committed; decoded with orangebox, `bb2npz_tol.py`)

| file | issue, pilot, what they said | firmware | quad |
| --- | --- | --- | --- |
| L2 `BTFL_BLACKBOX_LOG_raptor_foxtrot dshot 300 .BBL` | #6018, theSkonk 2018-06-02: chop after flips, rolls, loops "performs a dip to the right ... like the PID loop has no authority at zero throttle" | 3.4.0 | stretch X, BLHeli_32, 48 kHz |
| L4 `... rpm log.BBL` | same pilot, DShot1200 | 3.4.0 | same |
| L5 `LOG00008.BFL` | #3723 (files/1896003) | 3.3.1 | "Martian2" |
| L6 `LOG00077.BFL` | #3723 (files/1193834) | 3.2.0 | QAV-X 220 |
| L7, L8 `rav airmode fix vs master 1097.zip` (two .bbl) | #6018, flint723 2018-10-27: the airmode PR "did not seem to change the arm drop issue" | 4.0.0 | "FLINT TF2722" |
| L9 Google Drive `1SZy9g98...` | #6148 | 3.4.0 | no name |

Not reachable: three Dropbox logs in #3723, four Google Drive / OneDrive links in #6018 and #6148 (deleted).
None has GPS or rpm fields. Two raptor logs end in a truncated block (frames before it kept). orangebox leaves the old
logs' throttle wrapped past 2^32 (fixed in the scripts by subtracting 2^32).

## Results

- **All chops** (`chop_old.py`, `chops-all-output.txt`, 97 chops): after nearly every chop a motor stays above 15 %
  for the whole 0.15-1.0 s window, often at 0.5-1.0 command, I-term 40-160.
- **Centred sticks, throttle at minimum 1.5 s** (`chop_old_long.py`, `chops-centred-1500-output.txt`; roll, pitch, yaw
  stick within 40 of 500 throughout): 11 chops from three quads (most from flint723's TF2722). Median (max): rms
  roll/pitch rate 10/15 (23/37) deg/s, peak 32/60 (66/77) deg/s, tilt change 6.0 (34) deg, a motor above 15 % until
  1.5 s (the window end), I 125 (150). The two that stayed at minimum longer kept a motor above 15 % until 1.9 and
  2.5 s (`chops-centred-long-windows-output.txt`).
- **How hard the air pushed** (`chop_acc.py`, `chops-acc-output.txt`): with the motors near idle the accelerometer reads
  the air's force only. TF2722 chops: 1.9-3.0 g mean 0.1-0.4 s after (peaks 3.1-5.1 g), 0.9-2.8 g of it backwards along
  the thrust axis (props windmilling, braking). Martian2 and QAV-X: 1.4-1.7 g.

## The sim, measured the same way (`sim-owner-chop-cmp.test.ts`, `sim-owner-chop-acc.test.ts`)

The owner's chop (41.6 m/s, yaw stick up to 0.11 = 55 of 500, so just outside "centred"):

| | rms rate | peak rate | tilt change 0-1.5 s | motor > 15 % until | air push after |
| --- | --- | --- | --- | --- | --- |
| real, 11 centred chops (median) | 10/15 | 32/60 (max 77) | 6.0 deg | 1.5-2.5 s | 1.4-3.0 g |
| sim, original tune | 6/17 | 26/139 | 5.8 deg | 1.55 s | 2.72 g (2.64 back along thrust) |
| sim, SupaFly | 15/6 | 111/28 | 3.9 deg | 1.53 s | 2.73 g |

So the TF2722 chops were in the same airflow as the owner's (same backwards push on the props), and the sim matches
them in rms wobble, tilt change and how long a motor stays high. One thing does not match: the sim's single sharpest
kick, 111-139 deg/s, is about twice the largest in the real centred chops (77 deg/s).

## What this does not show

- These are 2017-2018 quads on Betaflight 3.2-4.0 (no dynamic idle, older ESC firmware), and they came from pilots
  reporting the dip as a fault. Modern public logs (Roma F5 4.2.9 at 14-22 m/s, Fawkes 2025) keep a motor high
  0.45-1 s (`../2026-10-21-public-logs/`); no modern log at the owner's airflow was found.
- Speed is not known; the air push only says the airflow was similar.
