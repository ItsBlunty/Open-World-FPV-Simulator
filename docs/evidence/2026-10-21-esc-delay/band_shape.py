# Is the model's windmill band too strong for a small prop? Shape comparison with Simmons' measured low-Re fit
# (AIAA 2021-1190 Table 4, 16x8 props at Re 4e4-1.4e5, tested to J about 2.1, i.e. x >= 0.34). Amplitudes differ by
# prop (solidity, lift slope), so each curve is divided by its own slope dTc/dx at zero thrust (x = 1), the part the
# model takes from Gill and D'Andrea's closed form, which matches UIUC's measured 5-inch CT(J) curves near zero thrust
# (../2026-10-20-motor-model/prop_fit-output.txt). Model values: ../2026-10-21-public-logs/gap1-band-output.txt (V 40 m/s).
# x = J0 / J, the share of the zero-thrust rotor speed; Tc = T / (rho V^2 D^2).
import numpy as np
model = {1.00: 0.0026, 0.90: -0.0618, 0.80: -0.1129, 0.70: -0.1489, 0.60: -0.1611, 0.50: -0.1473, 0.45: -0.1409, 0.40: -0.1335, 0.35: -0.1244}
model_slope1 = 0.5874
def simmons_ct(J, R): return 0.117 - 0.288 * J**2 + 0.0917 * J**3 + 0.0589 * R**3
print('   x  | model Tc/slope | Simmons Tc/slope (Re_hat -0.6) | (Re_hat 0) | model/Simmons')
for x, tcm in model.items():
    row = f' {x:4.2f} | {tcm / model_slope1:+8.3f}      |'
    rs = []
    for R in (-0.6, 0.0):
        Js = np.linspace(0.3, 2.1, 20000); J0 = Js[np.argmin(np.abs(simmons_ct(Js, R)))]
        tc = lambda xx: simmons_ct(J0 / xx, R) / (J0 / xx)**2
        slope1 = (tc(1.001) - tc(0.999)) / 0.002
        r = tc(x) / slope1; rs.append(r)
        row += f' {r:+8.3f}' + ('*' if J0 / x > 2.1 else ' ') + ' |'
    row += f' {tcm / model_slope1 / rs[0]:5.2f}' if abs(rs[0]) > 0.02 else '   -'
    print(row)
print('* beyond the tested J (extrapolated)')
