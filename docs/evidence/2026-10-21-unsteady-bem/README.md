# Modelling the fast pass over the windmill band's hump: unsteady blade-element momentum (2026-10-21, review F9)

Owner: "why don't we try actually modeling it? Aren't there simulations that can model this stuff?" and "Yes let's try 1
and then move the CFD if it's not satisfactory" (1: an unsteady blade-element model as wind-turbine codes use; a chopped
prop is in the windmill state, a wind turbine's working state). Offline study; nothing in sim-core changed.

## The model (`ubem.py`)

The Nazgul prop with sim-core's own rotor parameters (`../2026-10-20-windmill/inflow.json`) and bladeLoads' blade and
polar, 24 stations, blade-element momentum in the turbine frame with Glauert's high-induction branch. Unsteady parts from
NREL OpenFAST AeroDyn's theory pages (Apache-2.0 code; equations in `ubem.py`'s header):

- dynamic inflow, Oye (DBEMT): two cascaded lags on the induced velocity, tau1 = 1.1 / (1 - 1.3 a) R / U0 (about 2-3 ms
  here), tau2 = (0.39 - 0.26 (r/R)^2) tau1, k = 0.6;
- dynamic stall, Oye (UAMod 6): the separation state lags its steady value with T_f = 6 c / (2 W_rel) (about 0.3 ms here).

## Steady limit (`steady_check.py`, `steady_check-output.txt`)

Over the hump range (x 0.45-0.9 of the zero-thrust speed) the shape matches Simmons' measured low-Re fit within about 10 %
(the sim's curve as well, `../2026-10-21-esc-delay/band_shape-output.txt`); it peaks near x 0.5 and its locked prop makes
0.43 of the peak drag (NACA Report 464: 0.47). Its slope at zero thrust is 0.72 of the sim's closed form (zero thrust at
J 0.75 against 0.70); the closed form is the one checked against UIUC's measured 5-inch curves, so that difference is
noted, not acted on.

## Fast passes (`transits.py`, `transits-output.txt`)

Rotor speed ramped at the chop's own rates (from `../2026-10-21-esc-delay/trace-*.txt`), against quasi-steady (what the
sim does):

| pass | thrust change | largest gap, full model | dynamic stall alone | time shift |
| --- | --- | --- | --- | --- |
| 21 m/s, 6.4 -> 13.6 k rpm in 20 ms | 1.38 N | 0.10 N | 0.00 N | 0 ms (leads slightly) |
| 37 m/s, 14 -> 21.6 k rpm in 10 ms | 2.61 N | 0.19 N | 0.00 N | 0 ms (leads) |
| 37 m/s, the same in 5 ms | 2.61 N | 0.34 N | 0.00 N | 0 ms (leads) |
| 37 m/s, down in 10 ms | 2.61 N | 0.15 N | 0.00 N | 0 ms (leads) |

Dynamic stall does nothing measurable on a blade this small: its flow settles in about 0.3 ms against a 5-20 ms pass.
Dynamic inflow runs the thrust ahead of quasi-steady by about 0.7 ms (the induced flow lags the rpm, so the blades first
see more angle): a lead, the opposite of the load lag tried before (`../2026-10-21-public-logs/`, 1-20 ms lags, which made
it worse).

## That lead in the sim's chop (`knobs-lead.patch`, `lead-output.txt`)

A scratch copy adds T + 0.7 ms x dT/dt on every prop's thrust (the size found above; in hover the induced flow is larger,
so its lead there is likely larger and not measured here), the 4 ms ESC dead time on:

| | no lead | 0.7 ms lead | real |
| --- | --- | --- | --- |
| owner's chop, Betaflight defaults | 95 / 141 deg/s | 64 / 98 | ~60 / 77 |
| owner's chop, SupaFly | 163 / 206 | 132 / 171 | |
| chops at 20-40 m/s, Betaflight defaults | 36-66 / 48-96 | 35-63 / 47-91 | |

## Conclusion

- Route 1 answers the question: unsteady aerodynamics on a 5-inch prop is fast (0.3-3 ms). Dynamic stall can be left out;
  dynamic inflow is a real, missing effect that leads the thrust and calms the delayed chop, most on the owner's flight
  (Betaflight defaults close to the real logs), less elsewhere.
- Not yet a physics change: the lead here is a stand-in. Done properly it is a lag on the induced velocity inside
  sim-core's closed form (all flight, hover included) and on the windmill range's induction. CFD is not needed for this;
  it stays the fallback if the proper model still leaves the chop too strong.
