# The sim-core 0.8.0 motor (Nazgul: Ke 0.0054567, R 0.113987, J 6e-6, static torque kappa x thrust, thrust 14.44 N at
# 3007 rad/s x V/Vnom... taken as kq w^2) driven by the REAL logged motor commands of a NeuroBEM flight, then the same
# delay + rise/fall fit as for the real telemetry. Pack voltage held at 22.2 V (6S under load).
import sys, numpy as np
ke, R, J = 0.005456740906007841, 0.11398716333359125, 6e-6
kappa, tmax, wmax = 0.0136, 14.44032, 146.60765716752368 * 20.51201581844598
kq = kappa * tmax / wmax ** 2
V = 22.2
z = np.load(sys.argv[1]); a = z['a']; n = list(z['names']); c = lambda k: a[:, n.index(k)]
t = c('time') / 1e6
m = np.stack([c(f'motor[{i}]') for i in range(4)], 1); e = np.stack([c(f'debug[{i}]') for i in range(4)], 1)
ok = (m > 100).all(1) & np.isfinite(e).all(1) & (e > 0).all(1)
idx = np.where(ok)[0]; br = np.where(np.diff(idx) > 50)[0]; idx = max(np.split(idx, br + 1), key=len)
tg = np.arange(t[idx[0]], t[idx[-1]], 0.001)
cmd = np.stack([np.interp(tg, t[idx], (m[idx, i] - 48) / 1999) for i in range(4)], 1)
wreal = np.stack([np.interp(tg, t[idx], e[idx, i] * 100 / 7 * 2 * np.pi / 60) for i in range(4)], 1)
# model rotor speeds, 0.1 ms Euler substeps, the ESC braking as in sim-core (current may reverse)
w = np.full(4, ke * 0 + (cmd[0] * V / ke) * 0.9)
wm = np.empty_like(cmd)
for j in range(len(tg)):
    for _ in range(10):
        i_ = (cmd[j] * V - ke * w) / R
        w = w + 1e-4 * (ke * i_ - kq * w * w) / J
    wm[j] = w
def fit(wv, label):
    sm = np.abs(np.gradient(wv, axis=0)) < 5
    X = np.stack([np.ones(cmd[sm].size), np.sqrt(cmd[sm]), cmd[sm]], 1)
    k = np.linalg.lstsq(X, wv[sm], rcond=None)[0]
    wss = k[0] + k[1] * np.sqrt(cmd) + k[2] * cmd
    TU = np.arange(0.004, 0.06, 0.002)[:, None, None]; TD = np.arange(0.004, 0.08, 0.002)[None, :, None]
    AU = 1 - np.exp(-0.002 / TU); AD = 1 - np.exp(-0.002 / TD)
    W = wv[::2]; S = wss[::2]; N = len(W); out = []
    for delay in range(0, 22, 2):
        sh = delay // 2
        y = np.broadcast_to(W[0], (TU.shape[0], TD.shape[1], 4)).copy(); err = np.zeros_like(y)
        for j in range(N):
            tgt = S[max(j - sh, 0)]
            y += (tgt - y) * np.where(tgt > y, AU, AD); err += (y - W[j]) ** 2
        e2 = err.sum(2) / (4 * N); iu, idn = np.unravel_index(np.argmin(e2), e2.shape)
        out.append((np.sqrt(e2[iu, idn]) / np.std(wv), delay, TU[iu, 0, 0] * 1e3, TD[0, idn, 0] * 1e3))
    b = min(out)
    print(f'  {label}: best delay {b[1]} ms, rise {b[2]:.0f} ms, fall {b[3]:.0f} ms (rms/std {b[0]:.3f}); delay 0: rise {out[0][2]:.0f}, fall {out[0][3]:.0f}; delay 10: rise {out[5][2]:.0f}, fall {out[5][3]:.0f}')
    # the cross-correlation lag of the speed's change against the command's change
    dc = np.diff(cmd, axis=0).ravel('F'); dw = np.diff(wv, axis=0).ravel('F')
    lags = [(np.corrcoef(dc[:len(dc) - L], dw[L:])[0, 1], L) for L in range(0, 40)]
    pk = max(lags)
    half = next(L for r, L in lags if L >= pk[1] and r < pk[0] / 2)
    print(f'     d(speed) vs d(command): peak at {pk[1]} ms (r {pk[0]:.2f}), falls to half by {half} ms')
print(f'== {sys.argv[1]}')
fit(wreal, 'real motors (telemetry)')
fit(wm, 'sim-core 0.8.0 motor, same commands')
