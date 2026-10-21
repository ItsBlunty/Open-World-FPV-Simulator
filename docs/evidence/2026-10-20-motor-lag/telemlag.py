# How late is the DShot rpm telemetry? The body's angular acceleration (gyro, its own sensor) against the roll and
# pitch torque implied by the telemetry rpm (sum of +-w^2 by motor position, Betaflight quad X: 0 rear right,
# 1 front right, 2 rear left, 3 front left), and against the motor command, cross-correlated over lags.
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a']; n = list(z['names']); c = lambda k: a[:, n.index(k)]
    t = c('time') / 1e6
    m = np.stack([c(f'motor[{i}]') for i in range(4)], 1); e = np.stack([c(f'debug[{i}]') for i in range(4)], 1)
    ok = (m > 100).all(1) & np.isfinite(e).all(1) & (e > 0).all(1)
    idx = np.where(ok)[0]; br = np.where(np.diff(idx) > 50)[0]; idx = max(np.split(idx, br + 1), key=len)
    tg = np.arange(t[idx[0]], t[idx[-1]], 0.001)
    I = lambda x: np.interp(tg, t[idx], x[idx])
    w = np.stack([I(e[:, i]) for i in range(4)], 1) * 100 / 7 * 2 * np.pi / 60
    cmd = np.stack([I(m[:, i]) for i in range(4)], 1)
    g = np.stack([I(c(f'gyroADC[{k}]')) for k in range(3)], 1) * np.pi / 180
    print(f'== {fn}')
    for ax, name, s in ((0, 'roll', np.array([-1, -1, 1, 1])), (1, 'pitch', np.array([-1, 1, -1, 1]))):
        k = np.ones(15) / 15; sm = lambda v: np.convolve(v, k, 'same')
        acc = sm(np.gradient(sm(g[:, ax]), 0.001))
        def best(x, label):
            x = sm(x); x = np.gradient(x) * 0 + x - x.mean(); y = acc - acc.mean()
            res = []
            for L in range(-15, 31):
                # x leads y by L ms if x[t - L] matches y[t]
                if L >= 0: xs, ys = x[:len(x) - L], y[L:]
                else: xs, ys = x[-L:], y[:len(y) + L]
                res.append((np.corrcoef(xs, ys)[0, 1], L))
            r = max(res, key=lambda q: abs(q[0]))
            print(f'  {name}: {label} best correlation {r[0]:+.3f} with the gyro\'s acceleration {r[1]:+d} ms later')
        best((w ** 2) @ s, 'telemetry torque')
        best((cmd ** 2) @ s, 'command^2 torque')
