# Throttle chops in public Betaflight logs vs the model; the remaining gaps (2026-10-21, physics §2g)

## Public logs used (not committed; fetch from the repositories)

- `mdimitri/bbx-analyzer` `logs/` (licence not stated): seven flights of "Fawkes", Betaflight 2025.12.0-RC4, 1960 KV,
  14 poles, bidirectional DShot, `motor[]` and `eRPM[]` (eRPM/100) logged at 2-4 kHz, no GPS. rpm scale checked: the
  lowest rpm logged, 1800, equals `dyn_idle_min_rpm` 18. Top speed about 17 700 rpm (prop and cell count not given).
- `gimbal-ghost/gimbal-ghost` `test/btfl_001.bbl` (GPL-3.0): "DIATONE ROMA F5", Betaflight 4.2.9, three flights at
  250 Hz with GPS (speed cm/s), motor commands, gyro, setpoints, no rpm. `test/LOG00001.BFL`: Betaflight 4.3.0, GPS.
- Not usable: `hillbilly1975/Blackbox_Lab` samples (header says "synthetic"); `fc-blackbox` test data (no rpm).
- Decoded with orangebox (GPL-3.0, `bb2npz_multi.py`; GPS fields come appended to each frame).

## Results

- **The motor pattern after a chop is real Betaflight behaviour.** In the Fawkes logs (eRPM) all four motors fall
  together, then one pair is raised to command 0.2-0.4 (7-9 k rpm) and the other sits at the dynamic-idle floor
  (1.6-2.3 k rpm) for 0.5-1 s while the I-term swings by up to 130 (`fawkes-chop-timelines.txt`, 91.36 s: attitude
  held within 34 deg/s). The Roma F5 at 14-22 m/s by GPS: after nearly every chop a motor stays above 15 % for 450-820
  ms at 0.25-0.41, the I-term reaches 60-126, and on axes the pilot is not moving the tracking error is 4-65 deg/s
  (`roma-gps-chop-summary.txt`).
- **Real quads sometimes kick hard too.** Fawkes 124526 at 40.84 s, sticks centred: pitch 364 deg/s, a motor pair to
  0.28 (7.7 k rpm), I to 96; other centred-stick chops stay at 80-160 deg/s (`fawkes-chop-summary.txt`).
- **Whether the props act backwards could not be settled** from closed-loop data (`authority.py`): pooled 160-260 ms
  after chops, pitch acceleration runs against the rpm split (r -0.62), per chop mostly with it; the controller's own
  response to a disturbance confounds the sign.
- **The model at the same speeds** (`sim-chop-sweep*.test.ts`): perfectly symmetric, nothing happens (no seed). With a
  2-5 % thrust/torque spread between motors (`knobs-experiment.patch`, K_ASYM), sticks centred: 16-25 m/s gives
  8-36 deg/s, top motor 0.13-0.52, a motor above 15 % for 0-790 ms, I 19-117: the same as the real logs. Up to 37 m/s
  it stays under 42 deg/s. The owner's 139 deg/s needs more than speed (his flight: 40 m/s, 74 deg nose down, yaw stick,
  dynamic idle on); no public log found at that speed.

## The remaining gaps (scratch copy of sim-core with switches, `knobs-experiment.patch`, `gaps-sensitivity-output.txt`)

- Gap 1, small props: Simmons' measured 16x8 fit (AIAA 2021-1190) reaches zero thrust at J 0.68-0.73 (model 0.70);
  its braking is about 0.65 x the model's and peaks at 0.5 instead of 0.6 of the zero-thrust speed (`gap1-band-output.txt`).
  Band x0.65 or x0.3 in the owner's chop: still a motor high 1.8-2.3 s.
- Gap 3, unsteady aero: Peters (NASA N88-27156, read in full) gives the dynamic-inflow time constant from an
  impermeable disc's apparent mass, K_M = 8/(3 pi), t = 0.42 R / V_massflow: about 1 ms here. Lagging the prop loads
  1/5/20 ms does not remove the bobble (5 and 20 ms make it oscillate throughout).
- Gap 6, flight controller: the mixer (`mixTable`, `applyMixerAdjustment`, `applyMixToMotors`, `mixerQuadX`, PID sum
  limits, /1000) and anti-gravity (gain 80, 5 Hz PT2, KI 0.34, KP 0.0034, the throttle-change formula, P boost
  attenuation, none on yaw, on by default) match Betaflight 4.5.1 line by line. `transient_throttle_limit` (airmode
  throttle offset) is 0 by default, so off in both.
- Gap 7, frame damping: NeuroBEM regression inconclusive (closed loop, R^2 0.2-0.46, `gap7-nb-damping-output.txt`);
  damping of 2e-3 and 1e-2 N m s at 40 m/s changes nothing.
- Gaps 9-11: inertia x0.7/x0.5, the Nazgul F5 prop's measured torque ratio, no yaw / all sticks centred, dynamic idle
  off: the bobble changes shape, a motor stays high 1.2-2.9 s in every case; only classic physics removes it.

Run: `ROOT=<repo or patched copy> pnpm exec vitest run --root docs/evidence/2026-10-21-public-logs <name>`; Python
scripts take the decoded npz.
