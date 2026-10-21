# Windmilling props: NACA data and the refit (2026-10-20, work in progress)

Sources (read in full): NACA Report 464 (Hartman 1933, NTRS 19930091538), NACA ARR 4H26 (Hedrick and Douglass 1944,
NTRS 19930093338), Sinnige et al. AIAA 2019-3033, Sinnige and Della Corte AIAA 2024-3520, Goyal et al. AIAA J 62(10)
2024, Candeloro et al. Fluids 7(7) 2022, Brandt and Selig AIAA 2011-1255, Deters et al. AIAA 2014-2151.

- `naca464-fig4-*.png`, `naca-arr4h26-fig10.png`: the scanned figures used.
- `trace.py`, `trace2.py`, `n464_f4b.json` -> `n464_f4_traced.json`: pixel tracing of the 12/17/22 deg thrust curves
  (x >= 0.3; below that and the torque curve were read from zoomed crops, values in `fit.py` and `wm.py`).
- `propmodel.py`: Python replica of sim-core 0.8.0 propLoads (matches the TS output exactly); `inflow.json` its inputs.
- `fit.py`, `bem.py`: section-stall and wind-turbine BEM attempts; neither reproduces the measured rise from a locked prop.
- `wm.py`: the measured-curve windmill range as built in sim-core (WINDMILL_TC/QC, kWindmill).

Status: shipped in sim-core/0.8.0 for the owner to fly (owner: "Lets test out the NACA refit"). The refit removes the
model's 7x-too-steep drag cliff, but the owner's 8 s chop flight still shows the PID fighting the (measured, real for
full-size props) reversed band. After flying: keep the refit (A) or wait for 5-inch windmill data (B).
