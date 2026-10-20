import math, numpy as np
from propmodel import P, closed
from fit import NX, NT
X0N = 1.47   # NACA 464, 12 deg: zero thrust at nD/V 1.47
S = list(NX / X0N)
TC = list(NT)
QX = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1]
QC = [-0.0026, -0.00264, -0.0028, -0.0029, -0.0030, -0.0031, -0.0031, -0.0030, -0.0029, -0.0026, -0.0022, -0.0016]
QS = [x / X0N for x in QX]
th = P['theta']; R = P['radius']; rho = P['rho']
def coeff_closed(lc):
    tip = 1.0; T, Q = closed(P, tip, lc, 0.0)
    q = 0.5 * rho * P['area'] * tip * tip
    return T / q, Q / (q * R)          # C_T, C_Q (Gill normalisation)
SB = 0.3
ct_b, cq_b = coeff_closed(SB)
tc_b = math.pi / 8 * ct_b / SB ** 2
kT = tc_b / np.interp(th / SB, S, TC)
print('kT', round(kT, 3), 'Tc closed at blend', round(tc_b, 4), 'implied locked Tc', round(kT * TC[0], 4))
def wm(uy, omega):
    along = uy / (omega * R); s = th / along
    T = 4 * rho * uy * uy * R * R * kT * np.interp(s, S, TC)
    Q = 8 * rho * uy * uy * R ** 3 * kT * np.interp(s, QS, QC)
    return T, Q
def loads(uy, omega, band):
    tip = omega * R; along = uy / tip
    if along <= SB: return closed(P, tip, uy, 0.0)
    if along >= SB + band: return wm(uy, omega)
    b = (along - SB) / band; t, q = closed(P, tip, uy, 0.0); tw, qw = wm(uy, omega)
    return t + (tw - t) * b, q + (qw - q) * b
D = 2 * R; V = 25.0
xs = [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4]
x0 = 1 / (math.pi * th)
naca = np.interp(np.array(xs) / x0, S, TC, right=np.nan)
for band in [0.0, 0.05, 0.15]:
    T = []; Q = []
    for x in xs:
        n = x * V / D; t, q = loads(V, 2 * math.pi * n, band if band > 0 else 1e-9)
        T.append(t / (rho * V * V * D * D)); Q.append(q / (rho * V * V * D ** 3))
    T = np.array(T); print(f'band {band}: Tc/locked', ' '.join(f'{v:.2f}' for v in T / T[0]))
    print('          Qc       ', ' '.join(f'{v:+.4f}' for v in Q))
print('NACA (same s)  ', ' '.join(f'{v:.2f}' for v in naca / naca[0]))
