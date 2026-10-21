# Control authority in ordinary flight: angular acceleration of roll and pitch against the motor-command difference the
# mixer makes on that axis, delayed by tau. Betaflight quad-X motors: 0 rear right, 1 front right, 2 rear left,
# 3 front left; roll u = (m2 + m3 - m0 - m1) / 2, pitch u = (m1 + m3 - m0 - m2) / 2, commands as a share of the output
# range. Samples with the throttle between 25 and 85 % of its range; the rates resampled to 1 kHz, acceleration a
# central difference over +-3 ms. For each tau 0-30 ms: least squares acc = k u(t - tau) + c; reports the tau with the
# best correlation (both low-passed at 30 Hz, forward and back, so without phase shift), k there (deg/s^2 per unit of u) and r. Uses gyroUnfilt when logged, else gyroADC.
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32
    n = list(z['names']); c = lambda k: a[:, n.index(k)]
    h = dict(x.split(':', 1) for x in z['headers']); lo_m = float(h['motorOutput'].strip('[]').split(',')[0]); hi_m = float(h['motorOutput'].strip('[]').split(',')[1])
    t = c('time') / 1e6; ok = np.isfinite(t) & np.concatenate([[True], np.diff(t) > 0])
    gname = 'gyroUnfilt' if 'gyroUnfilt[0]' in n else 'gyroADC'
    tt = np.arange(t[ok][0], t[ok][-1], 0.001)
    r = lambda k: np.interp(tt, t[ok], c(k)[ok])
    m = [(r(f'motor[{i}]') - lo_m) / (hi_m - lo_m) for i in range(4)]
    thr = r('rcCommand[3]'); tl, th = np.nanpercentile(thr, 1), np.nanpercentile(thr, 99)
    sel = (thr > tl + 0.25 * (th - tl)) & (thr < tl + 0.85 * (th - tl))
    u = {'roll': (m[2] + m[3] - m[0] - m[1]) / 2, 'pitch': (m[1] + m[3] - m[0] - m[2]) / 2}
    def lp(x, fc=30.0):
        k = 0.001 / (1 / (2 * np.pi * fc) + 0.001); y = x.copy()
        for _ in range(2):
            for i in range(1, len(y)): y[i] = y[i-1] + k * (y[i] - y[i-1])
            for i in range(len(y) - 2, -1, -1): y[i] = y[i+1] + k * (y[i] - y[i+1])
        return y
    res = []
    for ax, gi in (('roll', 0), ('pitch', 1)):
        g = r(f'{gname}[{gi}]'); acc = np.zeros_like(g); acc[3:-3] = (g[6:] - g[:-6]) / 0.006
        acc = lp(acc); uax = lp(u[ax])
        best = None
        for tau in range(0, 31):
            uu = np.roll(uax, tau); s = sel.copy(); s[:40] = False; s[-40:] = False
            X = np.stack([uu[s], np.ones(s.sum())], 1); y = acc[s]
            k, c0 = np.linalg.lstsq(X, y, rcond=None)[0]; rr = np.corrcoef(uu[s], y)[0, 1]
            if best is None or abs(rr) > abs(best[2]): best = (tau, k, rr)
        res.append(f'{ax}: tau {best[0]:2d} ms, k {abs(best[1]):7.0f} deg/s^2 per unit, r {abs(best[2]):.2f}')
    print(f"{fn.split('/')[-1][:40]:40s} {h.get('Craft name','')[:16]:16s} ({gname}, n {sel.sum()}) " + ' | '.join(res))
