# Dynamic inflow in sim-core (2026-10-21, review G13 / F9)

Owner: "1" (build dynamic inflow properly into sim-core, then test the ESC dead time with it), after the unsteady
blade-element study (`../2026-10-21-unsteady-bem/`) found dynamic inflow missing and dynamic stall negligible.

## What was built (`packages/sim-core/src/sim.ts`, `ParamOverrides.dynamicInflow`; test `test/dynamic-inflow.test.ts`)

Pitt and Peters' uniform inflow mode, the standard first state of rotor flight-dynamics models: each prop's induced
velocity v is a state that lags its steady value, dv/dt = (v_qs - v) / tau, tau = K_M R / (2 V_m) = 0.42 R / V_m
(K_M = 8 / (3 pi), an impermeable disc's apparent mass; V_m the airflow through the disc; Peters, NASA N88-27156).
v_qs is the closed form's own induced inflow where it has one, else Glauert's momentum on the steady loads with the air
from in front (the windmill state). The blades then meet the lagging airflow: the closed form with its induced inflow
moved, the windmill and blade-element ranges at the axial airflow shifted by the same amount. Steady loads are unchanged
(a settled state gives exactly the old thrust). Off (absent): every flight bit for bit (pinned hashes pass); the game
turns it on (`apps/fly/src/main.ts`).

## Checks

- Fast rotor-speed changes (`transits.test.ts`, `transits-output.txt`; run with ROOT = the repo):
  - hover, 11 -> 15 k rpm at once: thrust overshoots 1.3-1.5x the steady change (frozen-inflow theory 1.54 for a true
    step) and settles in a few ms (tau about 3-4 ms in hover);
  - the chop's passes (37 m/s, 14 -> 21.6 k rpm in 10 / 5 ms): thrust leads quasi-steady by 12 / 23 % of the change; the
    unsteady blade-element study (Oye's model) gave 7 / 13 %. The sim's windmill drag is about twice that study's
    (NACA's table), so more induction; same sign and order.
- CPU (`perf.test.ts`, `perf-output.txt`): 6.6 -> 9.1 ms per second of flight at 4 kHz.

## The chop and stick steps with the 4 ms ESC dead time (ROOT = a copy with `spread.patch`, the +-2.5 % motor spread)

Owner's chop (`ownerchop.test.ts`, `ownerchop-output.txt`), peak deg/s median / max:

| | no dead time | 4 ms, no dynamic inflow | 4 ms, dynamic inflow | real |
| --- | --- | --- | --- | --- |
| Betaflight defaults | 44 / 63 (42 / 59 with it) | 95 / 141 | 64 / 99 | ~60 / 77 |
| SupaFly (game default) | 40 / 62 (37 / 59 with it) | 163 / 206 | 132 / 173 | |

Chops at 20-40 m/s with the dead time and dynamic inflow (`speeds.test.ts`, `speeds-output.txt`): Betaflight defaults
35-64 / 48-92 (without dynamic inflow 36-66 / 48-96); SupaFly 28-112 / 40-150 (33-134 / 44-175).

Stick step in hover (`stepchk.test.ts`, `stepchk-output.txt`), 4 ms dead time: overshoot 1.50 -> 1.39 (defaults),
1.65 -> 1.53 (SupaFly), 50 % about 1 ms sooner.

## Conclusion

Dynamic inflow is in, on in the game, a small change without the dead time (the owner's chop 40 -> 37 deg/s) and a real
help with it: Betaflight defaults now chop like the real logs with the real delay. SupaFly still kicks about twice the
real logs at 30-40 m/s (its low-throttle gains are higher; no real SupaFly chop log to compare). The dead time is still
not in the game: whether to add it is the owner's call after flying.
