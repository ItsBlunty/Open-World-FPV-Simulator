# Reversed band: thrust at fixed airspeed against rotor speed, as Tc = T / (rho V^2 D^2) against x = J0 / J (the share of
# the zero-thrust speed), model (axial, Sim.propLoads) vs Simmons' measured 16x8 fit (AIAA 2021-1190 Table 4, Jz = 0,
# Re_hat -0.6 and 0; tested to J about 2.1, i.e. x >= 0.34). Slope dTc/dx < 0: more rpm, less thrust.
import sys, numpy as np
m = np.genfromtxt(sys.argv[1], delimiter=',', names=True)
rho = 1.225
def simmons_ct(J, R): return 0.117 - 0.288 * J**2 + 0.0917 * J**3 + 0.0589 * R**3
for R in (-0.6, 0.0):
    Js = np.linspace(0.3, 2.1, 2000); ct = simmons_ct(Js, R)
    J0s = Js[np.argmin(np.abs(ct))]
    print(f'Simmons Re_hat {R:+.1f}: zero thrust at J0 = {J0s:.3f}')
mm = m[m['V'] == 40]
Tc_m = mm['T'] / (rho * 40**2 * (0.1295)**2)
J0m = mm['J'][np.argmin(np.abs(Tc_m[mm['J'] < 1.5]))]
print(f'model (V 40 m/s): zero thrust at J0 = {J0m:.3f}')
print('   x=J0/J |  J model  Tc model  dTc/dx model |  J Simmons Tc(Re-0.6) dTc/dx | Tc(Re 0) dTc/dx')
for x in (1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35):
    Jm = J0m / x; i = np.argmin(np.abs(mm['J'] - Jm))
    Tcm = lambda J: np.interp(J, mm['J'], Tc_m)
    dm = (Tcm(J0m / (x + 0.01)) - Tcm(J0m / (x - 0.01))) / 0.02
    out = f'   {x:4.2f}  | {Jm:5.2f} {Tcm(Jm):+8.4f} {dm:+9.4f}    |'
    for R in (-0.6, 0.0):
        Js = np.linspace(0.3, 2.1, 4000); J0s = Js[np.argmin(np.abs(simmons_ct(Js, R)))]
        Jss = J0s / x
        tc = lambda J: simmons_ct(J, R) / J**2
        ds = (tc(J0s / (x + 0.01)) - tc(J0s / (x - 0.01))) / 0.02
        flag = '' if Jss <= 2.1 else '*'
        out += f' {Jss:5.2f}{flag} {tc(Jss):+8.4f} {ds:+8.4f} |' if R == -0.6 else f' {tc(Jss):+8.4f} {ds:+8.4f}'
    print(out)
print('* beyond the tested J (extrapolated)')
