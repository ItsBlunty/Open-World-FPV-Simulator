# Measured motor response of NeuroBEM's quad (Betaflight blackbox: motor command and DShot RPM telemetry, 14 poles).
# For each motor: dead time and first-order time constants (rise, fall) fitted by simulating the logged commands.
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a']; n = list(z['names']); c = lambda k: a[:, n.index(k)]
    t = c('time') / 1e6
    m = np.stack([c(f'motor[{i}]') for i in range(4)], 1); e = np.stack([c(f'debug[{i}]') for i in range(4)], 1)
    ok = (m > 100).all(1) & np.isfinite(e).all(1) & (e > 0).all(1)
    # resample to a uniform 1 ms grid over the longest armed stretch
    idx = np.where(ok)[0]; br = np.where(np.diff(idx) > 50)[0]
    parts = np.split(idx, br + 1); idx = max(parts, key=len)
    tg = np.arange(t[idx[0]], t[idx[-1]], 0.001)
    cmd = np.stack([np.interp(tg, t[idx], (m[idx, i] - 48) / 1999) for i in range(4)], 1)
    w = np.stack([np.interp(tg, t[idx], e[idx, i] * 100 / 7 * 2 * np.pi / 60) for i in range(4)], 1)
    print(f'== {fn}: {len(tg) / 1000:.1f} s armed, cmd {cmd.min():.3f}-{cmd.max():.3f}, rpm {w.min() * 9.549:.0f}-{w.max() * 9.549:.0f}')
    # steady-state map from the data: w_ss = k0 + k1 sqrt(cmd) + k2 cmd, least squares on slowly varying samples
    sm = np.abs(np.gradient(w, axis=0)) < 5  # under 5000 rad/s^2
    X = np.stack([np.ones(cmd[sm].size), np.sqrt(cmd[sm]), cmd[sm]], 1)
    k = np.linalg.lstsq(X, w[sm], rcond=None)[0]
    wss = k[0] + k[1] * np.sqrt(cmd) + k[2] * cmd
    print('  steady map w = %.0f + %.0f sqrt(d) + %.0f d (rad/s); idle d=0.055: %.0f rpm' % (*k, (k[0] + k[1] * 0.055 ** 0.5 + k[2] * 0.055) * 9.549))
    TU = np.arange(0.004, 0.06, 0.002)[:, None, None]; TD = np.arange(0.004, 0.08, 0.002)[None, :, None]
    AU = 1 - np.exp(-0.002 / TU); AD = 1 - np.exp(-0.002 / TD)
    W = w[::2]; S = wss[::2]; N = len(W)
    best = None
    for delay in range(0, 12, 1):
        sh = delay // 2 if delay % 2 == 0 else None
        if sh is None: continue
        y = np.broadcast_to(W[0], (TU.shape[0], TD.shape[1], 4)).copy(); err = np.zeros_like(y)
        for j in range(N):
            tgt = S[max(j - sh, 0)]
            up = tgt > y
            y += (tgt - y) * np.where(up, AU, AD)
            err += (y - W[j]) ** 2
        e2 = err.sum(2) / (4 * N)
        iu, idn = np.unravel_index(np.argmin(e2), e2.shape)
        if best is None or e2[iu, idn] < best[0]: best = (e2[iu, idn], delay, TU[iu, 0, 0], TD[0, idn, 0])
        print(f'  delay {delay} ms: rms {np.sqrt(e2[iu, idn]):.1f} rad/s, rise {TU[iu,0,0]*1e3:.0f} ms, fall {TD[0,idn,0]*1e3:.0f} ms', flush=True)
    print(f'  BEST: delay {best[1]} ms, rise tau {best[2] * 1e3:.0f} ms, fall tau {best[3] * 1e3:.0f} ms, rms {np.sqrt(best[0]):.1f} rad/s')
