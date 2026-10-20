# The prop torque model (Gill and D'Andrea eq. 37-38, sim-core/0.8.0 Sim.closedLoads) against NeuroBEM's measured yaw
# dynamics. The yaw torque the four rotors put on the body, from the measured motion (Euler's equation, body z up):
#   tau_z = Izz dw_z/dt + (Iyy - Ixx) w_x w_y
# and from the rotors: sum_i s_i (Q_i + J dOmega_i/dt), s_i the spin direction. Q_i is either the static model
# kq Omega_i^2 (torque from rotor speed alone, as sim-core 0.7.0 had it) or eq. 37-38 at the measured airflow, with the
# thrust's parameters fitted as in docs/evidence/2026-10-18-rotor-inflow/nb_d.py (pitch by thrust RMSE), the solidity of
# the measured 5-inch three-blade props (0.092-0.140, three values tried) and c_d,alpha from the static torque.
# Usage: python -P nb_torque.py <nb100.npz from nb_load.py>
import sys
import numpy as np

d = np.load(sys.argv[1])['d']
m = 0.772; rho = 1.225; R = 5 * 0.0254 / 2; A = np.pi * R * R; delta = 0.2
Ixx, Iyy, Izz = 0.0025, 0.0021, 0.0043  # NeuroBEM readme
dw = d[:, 1:4]; w = d[:, 4:7]; acc = d[:, 11:14]; vel = d[:, 14:17]; mot = d[:, 20:24]; dmot = d[:, 24:28]
tau = Izz * dw[:, 2] + (Iyy - Ixx) * w[:, 0] * w[:, 1]
Fz = m * acc[:, 2]
s2 = (mot ** 2).sum(1)
vax = vel[:, 2]; vin = np.hypot(vel[:, 0], vel[:, 1])
calm = (np.linalg.norm(vel, axis=1) < 0.5) & (np.linalg.norm(w, axis=1) < 0.5)
k = (Fz[calm] * s2[calm]).sum() / (s2[calm] ** 2).sum()
sel = np.linalg.norm(w, axis=1) < 3
print(f'samples {len(d)}, used (|w| < 3 rad/s) {sel.sum()}; thrust k {k:.3e} N/(rad/s)^2')


def thrust_and_lambda(theta, a):
    """thrust per rotor and its total inflow ratio, closed form + Glauert (sim-core closedLoads; mu held at 0.3)"""
    ad = a * (1 - delta)
    T = np.zeros_like(mot); lam = np.zeros_like(mot); mu_ = np.zeros_like(mot)
    for i in range(4):
        tip = mot[:, i] * R
        lc = np.clip(vax / tip, -0.45, 0.45); mu = np.minimum(vin / tip, 0.3)
        f = lambda li: 4 * li * np.sqrt(mu * mu + (lc + li) ** 2) - (ad * (theta - lc - li) + ad * theta * mu * mu / (2 * delta))
        lo = np.maximum(0, -lc); hi = np.maximum(theta * (1 + mu * mu / (2 * delta)) - lc, lo)
        flo = f(lo) > 0
        hi = np.where(flo, lo, hi); lo = np.where(flo, 0, lo)
        for _ in range(40):
            li = (lo + hi) / 2
            big = f(li) > 0
            hi = np.where(big, li, hi); lo = np.where(big, lo, li)
        li = (lo + hi) / 2
        T[:, i] = 0.5 * rho * A * tip * tip * (ad * (theta - lc - li) + ad * theta * mu * mu / (2 * delta))
        lam[:, i] = lc + li; mu_[:, i] = mu
    return T, lam, mu_


# the thrust's blade angle, as nb_d.py: pitch by RMSE, theta = 1.025 P / (2 pi R) (sim-core/0.8.0's factor)
cts = k / (0.5 * rho * A * R * R); li0 = np.sqrt(cts / 4)
best = None
for pin in np.arange(3.0, 6.01, 0.25):
    th = 1.025 * pin * 0.0254 / (2 * np.pi * R)
    a = cts / ((1 - delta) * (th - li0))
    T, _, _ = thrust_and_lambda(th, a)
    e = np.sqrt(np.mean((T.sum(1)[sel] - Fz[sel]) ** 2))
    if best is None or e < best[1]: best = (pin, e, th, a)
pin, e, theta, a = best
print(f'thrust: best pitch {pin} in (factor 1.025), RMSE {e:.3f} N; quadratic {np.sqrt(np.mean((k * s2[sel] - Fz[sel]) ** 2)):.3f} N')
T, lam, mu = thrust_and_lambda(theta, a)

# spin directions: the sign pattern that explains the measured yaw torque best (static model + rotor inertia + bias)
best_s = None
for s in ([1, -1, -1, 1], [-1, 1, 1, -1], [1, -1, 1, -1], [-1, 1, -1, 1], [1, 1, -1, -1], [-1, -1, 1, 1]):
    s = np.array(s, float)
    X = np.stack([(mot ** 2) @ s, dmot @ s, np.ones(len(d))], 1)
    coef, *_ = np.linalg.lstsq(X[sel], tau[sel], rcond=None)
    r = np.sqrt(np.mean((X[sel] @ coef - tau[sel]) ** 2))
    if coef[0] > 0 and (best_s is None or r < best_s[1]): best_s = (s, r, coef)
s, r_static, (kq, J, bias) = best_s
print(f'spin directions {s.astype(int).tolist()}; static model: kq {kq:.3e} N m/(rad/s)^2, rotor inertia {J:.2e} kg m^2, bias {bias:.2e} N m')
print(f'  kappa = kq / k = {kq / k * 1000:.2f} mm (torque / thrust at rest; the UIUC three-blade props: 0.105 x 127 mm = 13.3 mm)')
print(f'yaw torque RMSE, torque from rotor speed alone: {r_static:.5f} N m (std of the measured yaw torque {np.std(tau[sel]):.5f})')

cq_static = kq / (0.5 * rho * A * R ** 3)
for sigma in (0.092, 0.115, 0.140):
    prof0 = (1 - delta) * sigma * 0.05 * (1 + delta + delta * delta) / 3
    cda = (cq_static - cts * li0 - prof0) / ((1 - delta) * sigma * (li0 - theta) ** 2)
    ad = a * (1 - delta)
    dl = lam - theta
    cq = ad * lam * (theta - lam) + (1 - delta) * sigma * (0.05 * (1 + delta + delta ** 2) / 3 + cda * dl * dl + mu * mu * (0.05 * delta + cda * theta ** 2) / (2 * delta))
    Q = 0.5 * rho * A * (mot * R) ** 2 * R * cq
    X = np.stack([Q @ s, dmot @ s, np.ones(len(d))], 1)
    coef, *_ = np.linalg.lstsq(X[sel], tau[sel], rcond=None)
    pred = X @ coef
    r = np.sqrt(np.mean((pred[sel] - tau[sel]) ** 2))
    print(f'eq. 37-38, solidity {sigma}: c_d,alpha {cda:.2f}; yaw torque RMSE {r:.5f} N m (scale fitted {coef[0]:.3f}, rotor inertia {coef[1]:.2e})')
    # where the airflow matters most: climbing, sinking, fast forward
    Xs = np.stack([(mot ** 2) @ s, dmot @ s, np.ones(len(d))], 1) @ best_s[2]
    for name, b in [('climb > 3 m/s', sel & (vax > 3)), ('sink > 3 m/s', sel & (vax < -3)), ('forward > 8 m/s', sel & (vin > 8))]:
        print(f'   {name:16s} n {b.sum():6d}: RMSE inflow {np.sqrt(np.mean((pred[b] - tau[b]) ** 2)):.5f}, rotor speed alone {np.sqrt(np.mean((Xs[b] - tau[b]) ** 2)):.5f}')
