# Rotor inflow evidence (sim-core/0.6.0, 2026-10-18)

## The model checked on measured flight: NeuroBEM

Data: NeuroBEM (Bauersfeld, Kaufmann, Foehn, Sun, Scaramuzza, RSS 2021, https://rpg.ifi.uzh.ch/NeuroBEM.html):
96 flights, 1 h 15 min, of a 772 g quadrotor on 5-inch three-blade props (2306 motors) in a Vicon hall, with each
motor's speed at 400 Hz. Not in this repo (627 MB, no licence stated in its readme): download `processed_data.zip`
from https://download.ifi.uzh.ch/rpg/NeuroBEM/ to reproduce.

- `nb_load.py <processed_data.zip>`: every 4th row (100 Hz) of every flight into `nb100.npz` (449 714 rows).
- `nb_a.py`: conventions. The body acceleration is the specific force (9.81 m/s^2 in a hover), so mass x acc z is the
  measured thrust along the thrust axis.
- `nb_b.py`: thrust / (k sum omega^2), k fitted on calm data, binned by climb and in-plane speed, against Gill and
  D'Andrea's closed form (eq. 69). Climb matches; forward flight gains more thrust than that form predicts.
- `nb_c.py`: the same with Glauert's momentum theory (and blends): Glauert fits best.
- `nb_d.py`: the exact algorithm in `Sim.inflowThrust` (bisection on the normal working state's branch): best pitch
  3.5 in, thrust RMSE 0.713 N (samples rotating < 3 rad/s) against 1.173 N for thrust from rotor speed alone; all
  samples 0.849 N against 1.365 N.

## The sim, classic and with inflow

`sim-probe.test.ts` (run: `pnpm exec vitest run --root docs/evidence/2026-10-18-rotor-inflow`), output in
`sim-probe-output.txt`: the Nazgul's falls, dive, climb and punch-outs with both models.
