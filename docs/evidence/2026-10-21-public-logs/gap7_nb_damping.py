# Aerodynamic roll/pitch damping of a real 5-inch quad (NeuroBEM, 100 Hz, all flights). Measured torque from the motion:
# tau = I dw/dt + w x (I w) (body x fwd, y left, z up; I = diag(0.0025, 0.0021, 0.0043)). Regressed on each motor's w_i^2
# (the thrust's lever arms, fitted), plus the body rate p (or q) times the airspeed |v| and the rate alone: the part of the
# torque proportional to the rate is the aerodynamic damping (rotors' differential airflow plus frame). Speeds binned.
import sys, numpy as np
d = np.load(sys.argv[1])['d']
dw = d[:, 1:4]; w = d[:, 4:7]; v = d[:, 14:17]; mot = d[:, 20:24]
I = np.array([0.0025, 0.0021, 0.0043])
tau = I * dw + np.cross(w, I * w)
V = np.linalg.norm(v, axis=1)
m2 = mot ** 2
for ax, name in ((0, 'roll p'), (1, 'pitch q')):
    for lo, hi in ((0, 3), (3, 8), (8, 18)):
        s = (V >= lo) & (V < hi)
        X = np.column_stack([m2[s], w[s, ax], np.ones(s.sum())])
        c, res, *_ = np.linalg.lstsq(X, tau[s, ax], rcond=None)
        pred = X @ c; r2 = 1 - np.sum((tau[s, ax] - pred) ** 2) / np.sum((tau[s, ax] - tau[s, ax].mean()) ** 2)
        # damping as a time constant of the bare body: I / (-c_rate)
        cr = c[4]
        print(f'{name}, |v| {lo:2d}-{hi:2d} m/s (n {s.sum():6d}): rate coefficient {cr:+.2e} N m s, I/(-c) = {I[ax] / -cr if cr < 0 else float("inf"):6.3f} s, R^2 {r2:.3f}, median |v| {np.median(V[s]):.1f}')
