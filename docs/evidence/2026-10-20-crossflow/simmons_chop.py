# Simmons (J. Aircraft 2021 / AIAA 2021-1190) measured local model, clockwise 16x8 three-blade prop, 0-60 deg incidence
# (Tables 4-5), applied to the Nazgul's 5.1-inch prop at the airflow each prop met in the owner's chop (flow.csv from the
# wrapped Sim.propLoads). Per prop: off-axis force Tz and hub moments Qy, Qz, and their change with rpm, against the
# lever-arm moment of the thrust change (arm 0.0845 m) that the flight controller uses.
# Re_hat = (Re - 1e5) / 1e5 enters some terms; the 5-inch prop runs at Re 1e4-6e4, below the tested 4e4-1.4e5, so
# those terms are evaluated at Re_hat = -0.6 (the tested low end) and at 0 as a bracket.
import sys, numpy as np
rho, D, ARM = 1.225, 0.1295, 0.0845
def coeffs(Jx, Jz, R):
    CTx = 0.117 - 0.288 * Jx**2 + 0.0387 * Jz**2 + 0.0589 * R**3 + 0.0917 * Jx**3
    CTz = -0.0197 * Jz - 0.0106 * Jz**3 - 0.0196 * Jx * Jz
    CQy = -0.0135 * Jx * Jz - 0.0290 * Jx * Jz * R + 0.0125 * Jz - 0.00533 * Jz**3 + 0.0202 * Jz * R - 0.0187 * Jz * R**2
    CQz = -0.0156 * Jz - 0.0183 * Jx * Jz * R - 0.0395 * Jx**2 * Jz + 0.0151 * Jz * R + 0.0308 * Jx * Jz
    return CTx, CTz, CQy, CQz
def loads(n, Vx, Vz, R):
    Jx, Jz = Vx / (n * D), Vz / (n * D)
    CTx, CTz, CQy, CQz = coeffs(Jx, Jz, R)
    f = rho * n * n * D**4; m = f * D
    return np.array([CTx * f, CTz * f, CQy * m, CQz * m])
d = np.genfromtxt(sys.argv[1], delimiter=',', names=True)
print('per prop: n rps, Jx, Jz | Tx N | Tz N | Qy, Qz N m | per +10 % rpm: dTx*arm, dQy, dQz, dTz*0.03 m (N m)')
for t0 in (4300, 4500, 4800, 5200):
    for r in d[d['tick'] == t0]:
        n = r['tip'] / (np.pi * D); Vx = r['uy']; Vz = np.hypot(r['ux'], r['uz'])
        for R in (-0.6, 0.0):
            L0 = loads(n, Vx, Vz, R); L1 = loads(n * 1.1, Vx, Vz, R); dL = L1 - L0
            print(f"{t0/1000:.2f} s m{int(r['i'])} Re^{R:+.1f}: n {n:6.1f}, Jx {Vx/(n*D):4.2f}, Jz {Vz/(n*D):4.2f} | Tx {L0[0]:6.2f} | Tz {L0[1]:6.2f} | Qy {L0[2]:+.4f} Qz {L0[3]:+.4f} | "
                  f"arm*dTx {dL[0]*ARM:+.4f}, dQy {dL[2]:+.4f}, dQz {dL[3]:+.4f}, 0.03*dTz {dL[1]*0.03:+.4f}" + ('   (Jx beyond the tested ~2.1)' if Vx / (n * D) > 2.1 else ''))
