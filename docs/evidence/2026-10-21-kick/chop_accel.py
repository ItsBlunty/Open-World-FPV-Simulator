# Centred-stick chops in old logs (as chop_old_long.py picks them): the largest roll/pitch angular acceleration over 10 ms
# steps (rate change / 10 ms) in 0-400 ms after the throttle reaches its minimum, and the top motor command in that span.
import sys, numpy as np
out = []
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32
    n = list(z['names']); c = lambda k: a[:, n.index(k)]
    h = dict(x.split(':', 1) for x in z['headers']); lo_m = float(h['motorOutput'].strip('[]').split(',')[0])
    t = c('time') / 1e6; thr = c('rcCommand[3]'); g = np.stack([c(f'gyroADC[{i}]') for i in range(2)], 1)
    rc = np.stack([c(f'rcCommand[{i}]') for i in range(3)], 1); mot = (np.stack([c(f'motor[{i}]') for i in range(4)], 1) - lo_m) / (2047 - lo_m)
    dt = np.median(np.diff(t)); i = 0
    while i < len(t) - 1:
        if thr[i] > 1500:
            j = i
            while j < len(t) - 1 and t[j] - t[i] < 0.25 and thr[j] > 1050: j += 1
            k0 = np.searchsorted(t, t[i] - 0.3)
            if thr[j] <= 1050 and t[j] - t[i] < 0.25 and np.all(thr[k0:i] > 1350):
                w = (t >= t[i]) & (t <= t[i] + 1.5)
                if np.all(thr[w & (t > t[j])] <= 1080) and np.abs(rc[w]).max() < 40:
                    ww = np.where((t >= t[j]) & (t <= t[j] + 0.4))[0]; step = max(1, int(round(0.01 / dt)))
                    acc = np.abs(g[ww[step:]] - g[ww[:-step]]).max(0) / 0.01
                    out.append((acc.max(), mot[ww].max()))
                    print(f'{fn} chop {t[i]:7.2f}: max angular acceleration roll/pitch {acc[0]:5.0f}/{acc[1]:5.0f} deg/s^2, top motor {mot[ww].max():.2f}')
                i = j + int(1.5 / dt); continue
        i += 1
o = np.array(out); print(f'ALL {len(o)}: max accel median {np.median(o[:,0]):.0f}, max {o[:,0].max():.0f} deg/s^2; top motor median {np.median(o[:,1]):.2f}')
