# Per throttle chop (from >= 50 % of the throttle range held 300 ms, to near minimum within 250 ms), in the 0.15-1.0 s
# after the chop starts with the throttle at minimum: the pilot's largest rate demand, the largest tracking error
# (setpoint - gyro), the largest gyro rate, the highest motor command and rpm while the slowest motor is near idle,
# the largest |I|; and the same error statistic over steady normal flight for comparison.
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a']; n = list(z['names']); c = lambda k: a[:, n.index(k)]
    t = c('time') / 1e6; thr = c('rcCommand[3]')
    mot = (np.stack([c(f'motor[{i}]') for i in range(4)], 1) - 48) / 1999
    rpm = np.stack([c(f'eRPM[{i}]') for i in range(4)], 1) * 100 / 7
    g = np.stack([c(f'gyroADC[{i}]') for i in range(3)], 1); sp = np.stack([c(f'setpoint[{i}]') for i in range(3)], 1)
    I = np.stack([c(f'axisI[{i}]') for i in range(2)], 1)
    err = sp - g
    tmin, tmax = np.nanmin(thr), np.nanmax(thr); hi = tmin + 0.5 * (tmax - tmin); lo = tmin + 0.05 * (tmax - tmin)
    dt = np.median(np.diff(t))
    normal = (thr > tmin + 0.25 * (tmax - tmin)) & (np.abs(sp[:, :2]).max(1) < 30)
    print(f'== {fn}: normal flight with sticks near centre, |error| roll/pitch p99: {np.nanpercentile(np.abs(err[normal, :2]), 99, axis=0).round()} deg/s')
    i = 0
    while i < len(t) - 1:
        if thr[i] > hi:
            j = i
            while j < len(t) - 1 and t[j] - t[i] < 0.25 and thr[j] > lo: j += 1
            k0 = np.searchsorted(t, t[i] - 0.3)
            if thr[j] <= lo and t[j] - t[i] < 0.25 and np.all(thr[k0:i] > hi * 0.9):
                w = (t >= t[i] + 0.15) & (t <= t[i] + 1.0) & (thr <= lo)
                if w.sum() > 50:
                    print(f'  chop {t[i]:7.2f} s: stick demand max |sp| r/p {np.abs(sp[w, 0]).max():4.0f}/{np.abs(sp[w, 1]).max():4.0f}, max |error| r/p {np.abs(err[w, 0]).max():4.0f}/{np.abs(err[w, 1]).max():4.0f}, '
                          f'max |gyro| r/p {np.abs(g[w, 0]).max():4.0f}/{np.abs(g[w, 1]).max():4.0f} deg/s | top motor cmd {mot[w].max():.2f} at {rpm[w].max():5.0f} rpm, slowest {np.nanmin(rpm[w]):4.0f} | max |I| {np.abs(I[w]).max():3.0f}')
                i = j + int(1.0 / dt); continue
        i += 1
