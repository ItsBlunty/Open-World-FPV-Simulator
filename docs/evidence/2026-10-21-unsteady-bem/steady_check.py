# Steady limit of ubem.py against the sim's prop curve and measured shapes: thrust coefficient Tc = T / (rho V^2 D^2)
# against x = J0 / J (share of the zero-thrust rotor speed) at 25 and 40 m/s; each curve also divided by its own slope
# at zero thrust (as ../2026-10-21-esc-delay/band_shape.py). Sim curve and Simmons' shape: band_shape-output.txt there.
import math, numpy as np
from ubem import steady, R, RHO
D = 2 * R
sim_shape = {0.9: -0.105, 0.8: -0.192, 0.7: -0.253, 0.6: -0.274, 0.5: -0.251, 0.45: -0.240, 0.4: -0.227, 0.35: -0.212}
simmons_shape = {0.9: -0.092, 0.8: -0.169, 0.7: -0.227, 0.6: -0.264, 0.5: -0.275, 0.45: -0.267, 0.4: -0.247, 0.35: -0.211}
for V in (25.0, 40.0):
    tc = lambda n: steady(n * 2 * math.pi, V)[0] / (RHO * V * V * D * D)
    lo, hi = 50.0, 2000.0          # rev/s bracket for zero thrust
    for _ in range(50):
        m = (lo + hi) / 2
        if tc(m) < 0: lo = m
        else: hi = m
    n0 = (lo + hi) / 2; J0 = V / (n0 * D)
    slope = (tc(n0 * 1.01) - tc(n0 * 0.99)) / 0.02
    print(f'V {V:.0f} m/s: zero thrust at {n0 * 60:.0f} rpm, J0 {J0:.3f}; slope dTc/dx at x 1: {slope:.3f} (sim 0.587)')
    print('   x  |  Tc BEM  | BEM/slope | sim/slope | Simmons/slope')
    for x in (1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.2, 0.1, 0.03):
        v = tc(n0 * x)
        print(f' {x:4.2f} | {v:+.4f} | {v / slope:+.3f}    | ' + (f'{sim_shape[x]:+.3f}    | {simmons_shape[x]:+.3f}' if x in sim_shape else '   -      |   -'))
