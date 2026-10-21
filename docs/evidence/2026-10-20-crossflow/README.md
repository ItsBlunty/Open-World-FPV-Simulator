# Crossflow past the inflow edge checked (2026-10-20, gap 2 of physics §2g)

What the model drops: past `INFLOW_RATIO_MAX` the loads come from the axial airflow only (`windmillLoads`,
`bladeLoads`: "no crossflow"); the closed form holds the advance ratio at 0.3; nowhere does a prop make an in-plane
force or a hub moment (thrust along its axis and torque about it only).

## Sources (read in full)

- Simmons and Hatke, NASA/TM-20210014010 (2021), https://ntrs.nasa.gov/citations/20210014010: 16x8 three-blade props
  (CW and CCW), Re 4e4-1.4e5, airflow to 21.6 m/s, 1500-6000 rpm, incidence 0-180 deg. Measured: at low incidence the
  axial thrust and torque follow the axial advance ratio Jx; the normal (in-plane) force grows about linearly with the
  tangential advance ratio Jz and has the same sign for both spin directions (additive on a vehicle); the pitching
  moment too; the yaw-plane moment flips with spin direction.
- Simmons, "System Identification for Propellers at High Incidence Angles", AIAA 2021-1190 / J. Aircraft (NTRS
  20205010582): polynomial models of those data with numbers, Tables 4-5 (0-60 deg, CW prop), used here.
- McLemore and Cannon, NACA TN 3228 (1954), NTRS 19930084170: full-scale four-blade prop, 0-180 deg, J' 0-6.2. Text
  read; its data are in scanned figures (not digitised). At a given axial advance ratio, thrust, power and normal
  force rise with incidence (unstalled); side force negligible; Ribner's normal-force theory only to about 15 deg;
  strip theory with extrapolated section data off by up to 50 % at 75 deg.
- Also cited by these (not read): Yaggy and Rogallo, NASA TN D-318 (1960): axial coefficients nearly constant against
  Jx over a wide incidence range, less so as Jx rises.

## The airflow in the owner's chop (`chop-flow.test.ts` wraps Sim.propLoads; `flow-output.txt`)

- First 0.55 s (4.15-4.7 s), when the bobble starts: 5-15 deg off the prop axis (median 9); axial 31-42 m/s, side
  4-6 m/s. Driven motors: crossflow ratio mu 0.02-0.09, axial ratio about 0.28. The idle motor: mu 0.16-0.26 (its tip
  is only 23 m/s), axial ratio 1.0-1.7.
- Whole chop (to 7 s): median 32 deg, up to 63 deg as the quad slows; 21 % of samples on the measured-curve path,
  30 % blended.

## Size of the crossflow terms (`simmons_chop.py`, `simmons_chop-output.txt`)

Simmons' measured model scaled to the 5.1-inch prop at each prop's chop airflow (Reynolds-number terms bracketed at
Re_hat -0.6 and 0; the 5-inch prop runs below the tested Re). Per +10 % rpm, for the driven motors (Jx 0.83-0.99,
inside the tested range):

| | N m |
|---|---|
| thrust change x arm (what the flight controller uses) | 0.011-0.057 |
| hub pitching moment change | <= 0.0007 |
| hub yaw-plane moment change | <= 0.0010 |
| in-plane force change x 3 cm | 0.0002-0.0003 |

- The crossflow's own axial term, +0.0387 Jz^2, is 0.0387 rho D^2 V_side^2: independent of rpm, so it does not change
  how thrust responds to rpm.
- Static values: in-plane force about -0.15 N per prop, hub pitching moment about 0.002 N m (same sign on all four),
  yaw-plane moments about 0.01 N m (cancel between CW and CCW): steady loads of a few percent of the bobble's moments.
- The idle motor (Jx 2.5-5.3) is far outside the fit (it even gives positive thrust there); no data at incidence for
  that range was found in numeric form (TN 3228's figures reach J' 6.2 at some incidences).

Side finding (gap 1): Simmons' measured axial fit, CTx = 0.117 - 0.288 Jx^2 + 0.0917 Jx^3, gives less thrust for more
rpm above Jx = 1.37, inside its tested range (to about 2.1): a small low-Re prop with the reversed band. The model's
closed form reverses above axial ratio 2 theta = 0.448, J = 1.41.

## Conclusion

Crossflow does not cause the bobble: where the data reach (the driven motors), its terms change the control moment
by at most about 5 %, whatever their sign; in the first half second the flow is within 15 deg of the axis, where
axial loads follow the axial advance ratio (measured). Open: the idle motor at J 2.5-5.3 with crossflow (no numeric
data); in-plane forces and hub moments are still absent from the model everywhere (a few percent in this case;
larger in edgewise flight, which this check did not cover).

Run: `ROOT=<repo> OUT=flow.csv pnpm exec vitest run --root docs/evidence/2026-10-20-crossflow chop-flow`, then the
two Python scripts on flow.csv.
