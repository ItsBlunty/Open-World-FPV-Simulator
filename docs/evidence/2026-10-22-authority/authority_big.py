# Control authority from big moves: angular acceleration of roll and pitch against the motor-command difference the
# mixer makes on that axis, using only stretches where that difference is large (flip and roll entries, hard stops),
# where the commanded moment dwarfs disturbances and noise. Betaflight quad-X motors: 0 rear right, 1 front right,
# 2 rear left, 3 front left; roll u = (m2 + m3 - m0 - m1) / 2, pitch u = (m1 + m3 - m0 - m2) / 2 (sign as Betaflight's
# gyro), m = DShot fraction (motor - 48) / 1999 (the sim's motor command). Rates resampled to 1 kHz; acceleration the
# slope of a least-squares line over +-5 ms. For delays tau 0-30 ms: fit acc(t) = k u(t - tau) + c over samples with
# |u(t - tau)| >= UMIN and throttle inside its 10-90 % range; reports the best tau, k (deg/s^2 per unit u) and r.
# Usage: authority_big.py [--umin 0.25] file.npz ...  (npz layout of the bb2npz scripts: a, names, headers)
import sys, numpy as np
args = sys.argv[1:]; UMIN = 0.25
if args and args[0] == '--umin': UMIN = float(args[1]); args = args[2:]
for fn in args:
    z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32
    n = list(z['names']); c = lambda k: a[:, n.index(k)]
    h = dict(x.split(':', 1) for x in z['headers'])
    t = c('time') / 1e6; ok = np.isfinite(t) & np.concatenate([[True], np.diff(t) > 0])
    tt = np.arange(t[ok][0], t[ok][-1], 0.001)
    r = lambda k: np.interp(tt, t[ok], c(k)[ok])
    m = [(r(f'motor[{i}]') - 48) / 1999 for i in range(4)]
    thr = r('rcCommand[3]'); tl, th = np.nanpercentile(thr, 1), np.nanpercentile(thr, 99)
    inthr = (thr > tl + 0.10 * (th - tl)) & (thr < tl + 0.90 * (th - tl))
    U = {'roll': (m[2] + m[3] - m[0] - m[1]) / 2, 'pitch': (m[1] + m[3] - m[0] - m[2]) / 2}
    W = 5; x = np.arange(-W, W + 1) * 0.001; wts = x / (x @ x)
    out = []
    for ax, gi in (('roll', 0), ('pitch', 1)):
        g = r(f'gyroADC[{gi}]'); acc = np.convolve(g, wts[::-1], 'same')
        best = None
        for tau in range(0, 31):
            uu = np.roll(U[ax], tau); s = inthr & (np.abs(uu) >= UMIN); s[:60] = False; s[-60:] = False
            if s.sum() < 50: continue
            X = np.stack([uu[s], np.ones(s.sum())], 1); k, c0 = np.linalg.lstsq(X, acc[s], rcond=None)[0]
            rr = np.corrcoef(uu[s], acc[s])[0, 1]
            if best is None or rr > best[2]: best = (tau, k, rr, s.sum())
        out.append(f'{ax}: tau {best[0]:2d} ms, k {best[1]:7.0f} deg/s^2 per unit, r {best[2]:.2f}, n {best[3]}' if best else f'{ax}: too few samples')
    print(f"{fn.replace(chr(92), '/').split('/')[-1][:28]:28s} {h.get('Craft name', '')[:16]:16s} |u|>={UMIN} | " + ' | '.join(out))
