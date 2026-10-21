# Betaflight SITL against the sim's physics, and the 4 kHz gyro / PID loop (2026-10-21, physics §2g, review G12)

Owner's asks: "get Betaflight SITL running against the sim's physics and compare its step response and the chop with our
built-in controller", using "the latest betaflight, 2026.6.2"; then "we should emulate the real gyro sampling rate ...
typically 4khz, but sometimes 8khz".

## Setup

- Betaflight 2026.6.2 (tag `2026.6.2`, GPL-3.0) built as `TARGET=SITL` in WSL Ubuntu 24.04 (gcc 13.3), with
  `lockstep_patch.py` (our patch to `src/platform/SIMULATOR/sitl.c` and its `platform.h`, GPL-3.0 like Betaflight):
  - `OWFPV_LOCKSTEP`: the firmware's clock is virtual (20 ns per cycle-counter read, delays by their length); at every
    `OWFPV_LOCKSTEP_US` boundary it sends its motor outputs, then blocks for the simulator's next rc_packet and fdm_packet.
    Runs are repeatable and independent of the PC's speed (about 3x real time).
  - the simulator build's real-time sleep per scheduler pass (`RUN_LOOP_DELAY_US`) is off in lock-step.
  - radio frames reach the firmware every `OWFPV_LOCKSTEP_RC_US` (2000: 500 Hz, as ELRS 500 Hz). Fed every 250 us,
    Betaflight's RC smoothing left the throttle at its first value (motors stayed at idle).
  - `VIRTUAL_GYRO_SAMPLE_RATE_HZ`: the SITL's gyro, and so its PID loop, runs at 1000 Hz unless set
    (`drivers/accgyro/accgyro_virtual.h`): built with 4000 and a 250 us lock-step for the 4 kHz runs.
  - Build: `make TARGET=SITL EXTRA_FLAGS='-DOWFPV_LOCKSTEP=1 -DOWFPV_LOCKSTEP_US=250 -DVIRTUAL_GYRO_SAMPLE_RATE_HZ=4000'`
    (run `git submodule update --init` first: parallel make races on submodule hydration).
- Config `original.cli` (loaded with a plain SITL build's `--config`): the sim's "original" tune, which 2026.6.2's
  defaults already match (P 45/47, I 80/84, F 120/125, ACTUAL rates 7/67, gyro PT1 250 + 500 Hz, D-term 75-150 + 150 Hz,
  anti-gravity 80, relax 15), with D fixed at its peak (40/46) and TPA off as the built-in controller has them, airmode
  always on, arm on AUX1, any angle. No RPM filter or dynamic idle (no motor telemetry in SITL).
- `bridge.js` (node, in WSL) flies sim-core's physics (compiled to JS) with the SITL's motor outputs, one exchange per
  physics loop, or the built-in controller on the same physics and pilot. Gyro: roll -wz, pitch -wx as the built-in
  controller reads them; the yaw sign of Betaflight's Gazebo input is the opposite (first flight spun up on yaw). Motor
  order and mix are the same as Betaflight's quad X. Idle came out at 0.055 on both.
- Pilot: the step-response flight of `../2026-10-21-step-response/` (90 s, slow, and fast at 30-33 m/s); the owner's
  chop with sticks centred from the chop and 16 motor spreads (`run_chop4k.sh`, experiment copy of sim-core with K_ASYM).
- "delay": the measured ESC dead time 4 ms and the measured motor speed (rotor inertia x1.5), `../2026-10-20-motor-lag/`.

## Results

Step flights (`step-1khz-output.txt`, `step-4khz-output.txt`; tracking error = |setpoint - gyro| on roll and pitch):

| loop | controller | no delay: error rms, 50 % time | with the real delay: error rms, motors at full |
| --- | --- | --- | --- |
| 1 kHz | Betaflight SITL | 5-10 deg/s, 14-16 ms | 98-100 deg/s, 91-94 % of the time |
| 1 kHz | built-in | 3-7 deg/s, 10-12 ms | 89-93 deg/s, 85-91 % |
| 4 kHz | Betaflight SITL | 4-10 deg/s, 13-15 ms | 51-55 deg/s, 43-65 % |
| 4 kHz | built-in | 3-7 deg/s, 11-13 ms | 59-61 deg/s, 56-69 % |

Real quads on the same gains: 50 % in 16-22 ms, and they fly with that delay (`../2026-10-21-step-response/`).

The chop at 4 kHz (`chop-4khz-output.txt`, 16 spreads, 43 m/s at the chop):

| | peak rate median / max | angular acceleration median | top motor | tilt change |
| --- | --- | --- | --- | --- |
| Betaflight SITL | 64 / 88 deg/s | 5 000 deg/s^2 | 0.97 | 6.6 deg |
| built-in | 62 / 86 deg/s | 3 960 deg/s^2 | 0.91 | 6.6 deg |
| real issue logs (`../2026-10-21-issue-logs/`) | ~60 / 77 | 2 200 | 0.49 | 6 |

(The built-in controller at 1 kHz: 7 100 deg/s^2, `../2026-10-21-kick/`.)

## Conclusions

- Real Betaflight on the sim's physics behaves like the built-in controller: same chop, similar step response (a few ms
  slower: its feed-forward smoothing and the bridge's one-loop exchange), and it too cannot fly the real ESC delay. The
  flight controller emulation is not what makes the sim too lively; the physics is.
- Running the controller and physics at the real 4 kHz gyro rate makes the chop about 45 % gentler (7 100 -> 3 960 deg/s^2)
  and the delayed loop about 40 % calmer. It is now the default in the game (sim-core `loopHz`, Settings > Gyro / PID loop).
- Still open: with the real delays both controllers fight (43-69 % of the time at full); the chop still saturates the
  correcting motors (0.9-1.0 against 0.49).

## Cost of the loop rate (`perf-loop.test.ts`, `perf-map.test.ts`, `perf-output.txt`)

CPU per second of flight on the development PC: open air 2.1 / 4.3 / 8.6 ms at 1 / 4 / 8 kHz; near walls 8.5 / 21.9 /
41.6 ms; the game's session on the real map with traffic 33 / 60 / 93 ms.
