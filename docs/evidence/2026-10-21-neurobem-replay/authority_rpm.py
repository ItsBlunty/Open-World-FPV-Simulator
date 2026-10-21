# Control authority from rotor speeds: body angular acceleration (gyro) against the torque the rotor speeds should give,
# arm x kT x sum(+-w^2), divided by the inertia. kT from hover: the craft's weight over 4 x the mean w^2 while the vertical
# acceleration (acc z) is about 1 g. Both signals band-passed 3-40 Hz (zero phase), the rpm shifted by the lag that
# correlates best (0-15 ms); slope = measured / predicted acceleration (1 = the rigid-body thrust model holds).
# Args: npz mass_kg arm_roll_m arm_pitch_m Ixx Iyy [label]. Betaflight quad X: 0 RR, 1 FR, 2 RL, 3 FL.
import sys, numpy as np
fn = sys.argv[1]; mass, armR, armP, Ixx, Iyy = map(float, sys.argv[2:7]); label = sys.argv[7] if len(sys.argv) > 7 else fn
z = np.load(fn); a = z['a']; n = list(z['names']); c = lambda k: a[:, n.index(k)]
t = c('time') / 1e6
e = np.stack([c(f'debug[{i}]') for i in range(4)], 1)
ok = np.isfinite(e).all(1) & (e > 0).all(1) & np.isfinite(t)
idx = np.where(ok)[0]; br = np.where(np.diff(idx) > 50)[0]; idx = max(np.split(idx, br + 1), key=len)
tg = np.arange(t[idx[0]], t[idx[-1]], 0.001)
I = lambda x: np.interp(tg, t[idx], x[idx])
w = np.stack([I(e[:, i]) for i in range(4)], 1) * 100 / 7 * 2 * np.pi / 60
g = np.stack([I(c(f'gyroADC[{k}]')) for k in range(2)], 1) * np.pi / 180
def band(x, lo=3.0, hi=40.0):
    X = np.fft.rfft(x - x.mean()); f = np.fft.rfftfreq(len(x), 0.001)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))
# kT from hover-like stretches: the median total thrust need (weight) over the median sum of w^2 near the median rpm
w2 = (w ** 2).sum(1)
kT = float(sys.argv[8]) if len(sys.argv) > 8 else mass * 9.81 / np.median(w2)
print(f'== {label}: kT {kT:.3e} N/(rad/s)^2 (hover median rpm {np.median(w) * 60 / 2 / np.pi:.0f})')
for ax, s, arm, Iax, sign in ((0, np.array([-1, -1, 1, 1]), armR, Ixx, 1), (1, np.array([-1, 1, -1, 1]), armP, Iyy, 1)):
    pred = band(arm * kT * ((w ** 2) @ s) / Iax)
    acc = band(np.gradient(g[:, ax], 0.001))
    best = None
    for L in range(0, 16):
        x = pred[:len(pred) - L] if L else pred; y = acc[L:]
        k = np.dot(x, y) / np.dot(x, x); r = np.corrcoef(x, y)[0, 1]
        if best is None or abs(r) > abs(best[2]): best = (L, k, r)
    print(f'  {"roll" if ax == 0 else "pitch"}: best lag {best[0]} ms, measured / predicted acceleration {abs(best[1]):.2f} (r {abs(best[2]):.2f})')
