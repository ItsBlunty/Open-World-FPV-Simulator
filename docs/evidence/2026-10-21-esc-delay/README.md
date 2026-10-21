# The ESC dead time and the throttle chop (2026-10-21, physics §2g, review F9 / F10 / G12)

Owner's ask: "Let's work on the esc delay issue". HANDOFF's plan was "fix the windmill band, then add the delay": with
the measured 4 ms ESC dead time (`esc_delay_ms`) the chop at speed turns violent, which the previous session read as the
band (props braking harder as they speed up) being too strong. This pass checks that reading. Nothing in sim-core or the
presets changed.

Run: `ROOT=<sim-core copy with knobs.patch> pnpm exec vitest run --root docs/evidence/2026-10-21-esc-delay --silent=false <name>`.
`knobs.patch` adds switches to a scratch copy only (K_ASYM motor spread, K_TRACE, K_FLAT, K_LAG). The game's Nazgul
preset throughout; 4 kHz loop; 16 motor spreads of +-2.5 % (thrust and torque, as in `../2026-10-21-kick/`).
Env for `speeds.test.ts`: TUNE, DELAYS, SPEEDS, OX (overrides JSON), NODYN, FLAT, LAG, ONE (trace one spread).

## 1. What turns violent (`trace-owner-chop-delay4.txt`, `trace-climb20-delay4.txt`)

The props spin down from about s 1.1 (s: rotor speed over its zero-thrust speed; NACA's drag peak is near s 0.58) into
the band, where a small moment starts a roll. The controller raises one pair: from s 0.45 to 0.6 its drag stays flat or
rises (no authority or the wrong sign), the error and the I-term grow, the pair is driven to 0.5-1.0 and crosses the
hump, then its thrust swings by 2-5 N within 10 ms (above the hump the prop is about 1.5-2.7x as sensitive to rpm as in
hover) and the 4 ms late controller overshoots: a swing to the other side, where the other pair crosses the hump.
At the end both pairs make the same drag at very different speeds (21 m/s: 9 k and 3.2 k rpm, s 0.8 and 0.28).

## 2. The band itself is not shown to be too strong (`band_shape.py`, `band_shape-output.txt`)

Simmons' measured low-Re fit (AIAA 2021-1190, 16x8 props at Re 4e4-1.4e5) looked 0.65x the model's band
(`../2026-10-21-public-logs/gap1-band-output.txt`), but the amplitudes belong to different props. Divided by each curve's
own slope at zero thrust (where the model's closed form matches UIUC's measured 5-inch CT(J)), the shapes agree within
-10 to +14 % over x 0.35-0.9 (the measured range). Real logs show the same end state: the Fawkes chops (eRPM) hold one
pair at 7.4-8.4 k rpm and the other at 1.8-3.2 k (`../2026-10-21-public-logs/fawkes-chop-timelines.txt`), and Fawkes
124526 at 40.84 s shows the band's lost authority on a real quad: the front pair held at 0.18-0.27 while pitch kept
rising to 340 deg/s for 100 ms. So there is no measured basis for weakening the band.

## 3. Chops at set speeds, 4 ms dead time on and off (`speeds.test.ts`, `speeds-output.txt`)

Peak |gyro| roll/pitch, median / max over 16 spreads, sticks centred (level: thrust axis leaned forward; climb: thrust
axis 30 deg off the velocity; climbs reach about 21-40 m/s along the axis). Real: Roma F5 at 14-22 m/s (GPS) 4-65 deg/s
on unmoved axes; issue logs (similar air push) about 60 / 77, top motor 0.49.

| tune (runs at 20-40 m/s) | no dead time | 4 ms dead time |
| --- | --- | --- |
| SupaFly (game default, dynamic idle 3000 rpm) | 20-41 / 27-64 | 33-134 / 44-175 (87 and up from level 25 m/s and in every climb) |
| Betaflight defaults | 30-50 / 40-67 | 36-66 / 48-96 |
| Betaflight defaults + dynamic idle 3000 rpm | 22-61 / 29-82 | 22-93 / 30-145 |

The owner's own chop (43 m/s, 74 deg nose down; `ownerchop.test.ts`, `ownerchop-output.txt`): SupaFly 40 / 62 -> 163 / 206;
Betaflight defaults 44 / 63 -> 95 / 141.

With the hump flattened (`speeds-flat-output.txt`, x held at 0.85 or above) SupaFly with the dead time gives 27-53 / 50-81:
the more-rpm-more-drag range plus the delay is what turns it violent. SupaFly's parts (`tune-variants-output.txt`, 4 ms, median at
40 m/s level / climb; SupaFly as is 134 / 122): without dynamic idle 101 / 95; without anti-gravity 113 / 107; thrust
linear off 147 / 131; Betaflight's PIDs with SupaFly's other settings 118 / 109; Betaflight's TPA (P not lowered at low
throttle) 199 / 197. The violence grows steeply with P at low throttle
(SupaFly's always-on low TPA lowers it there; without it, the worst case); dynamic idle adds to it.

## 4. Step response with the dead time (`stepchk.test.ts`, `stepchk-output.txt`)

A roll stick step to 0.3 in hover: Betaflight defaults with 4 ms reach 50 % at 12 ms (17 ms without feedforward), SupaFly
12 / 16 ms, with overshoot 1.50 / 1.65 (feedforward on, an unsmoothed step). Real 6S 5-inch quads on near-default gains
(Roma F5, `../2026-10-21-step-response/`) reach 50 % at 16-22 ms and are well damped. Adding a lag between rotor speed and
thrust (NeuroBEM's logs show the body's acceleration 4-8 ms behind the rotor speed, the sim 0) slows the step toward the real
times but makes the overshoot worse (2 ms: 1.73 / 1.89; 4 ms: 1.89 / 2.30). So more lag is not what real quads have more of;
for its gains the sim Nazgul has too much control authority (angular acceleration per command), and the ESC dead time exposes it.

## Conclusion

- The windmill band's shape agrees with measured small-prop data; "fix the band, then add the delay" has no measured basis.
- With the real delay, Betaflight's defaults give chops near the real logs; SupaFly with dynamic idle gives about twice the
  real kick, and its step response overshoots. Both point to the same gap as review G12: the Nazgul preset's authority per
  command is too high for real gains (inertia 0.0022 is already fitted at the top of the plausible range; thrust per command
  matches AOS-RC's stand).
- The dead time stays out of the game until the authority gap is found. What would settle it: the owner's quad's inertia
  (swing test), its `diff all`, and a blackbox log with eRPM of a fast chop and some stick steps.
