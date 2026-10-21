# chop_summary.py for logs with GPS and no rpm: per chop, the GPS speed and climb rate at the chop (GPS_speed cm/s,
# GPS_altitude differentiated over 1 s), then in 0.15-1.0 s after it at minimum throttle: stick demand, tracking error,
# gyro, highest and lowest motor command, |I|; and normal-flight error for comparison.
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a']; n = list(z['names']); c = lambda k: a[:, n.index(k)]
    t = c('time') / 1e6; thr = c('rcCommand[3]')
    mot = (np.stack([c(f'motor[{i}]') for i in range(4)], 1) - 48) / 1999
    g = np.stack([c(f'gyroADC[{i}]') for i in range(3)], 1); sp = np.stack([c(f'setpoint[{i}]') for i in range(3)], 1)
    I = np.stack([c(f'axisI[{i}]') for i in range(2)], 1); err = sp - g
    spd = c('GPS_speed') / 100; alt = c('GPS_altitude')
    tmin, tmax = np.nanmin(thr), np.nanmax(thr); hi = tmin + 0.45 * (tmax - tmin); lo = tmin + 0.05 * (tmax - tmin)
    dt = np.median(np.diff(t))
    normal = (thr > tmin + 0.25 * (tmax - tmin)) & (np.abs(sp[:, :2]).max(1) < 30)
    print(f'== {fn}: {len(t)} frames, {1/dt:.0f} Hz; normal flight sticks centred |error| r/p p99 {np.nanpercentile(np.abs(err[normal, :2]), 99, axis=0).round()} deg/s')
    i = 0
    while i < len(t) - 1:
        if thr[i] > hi:
            j = i
            while j < len(t) - 1 and t[j] - t[i] < 0.3 and thr[j] > lo: j += 1
            k0 = np.searchsorted(t, t[i] - 0.3)
            if thr[j] <= lo and t[j] - t[i] < 0.3 and np.all(thr[k0:i] > hi * 0.9):
                w = (t >= t[i] + 0.15) & (t <= t[i] + 1.0) & (thr <= lo)
                ka = np.searchsorted(t, t[i] - 1.0)
                climb = (alt[i] - alt[ka]) / max(t[i] - t[ka], 1e-3)
                if w.sum() > 20:
                    print(f'  chop {t[i]:7.2f} s: GPS {spd[i]:4.1f} m/s, climb {climb:+5.1f} | demand |sp| r/p {np.abs(sp[w,0]).max():4.0f}/{np.abs(sp[w,1]).max():4.0f}, |error| r/p {np.abs(err[w,0]).max():4.0f}/{np.abs(err[w,1]).max():4.0f}, |gyro| r/p {np.abs(g[w,0]).max():4.0f}/{np.abs(g[w,1]).max():4.0f} | motor cmd max {mot[w].max():.2f} min {mot[w].min():.2f} | >15 % {1000 * dt * (mot[w].max(1) > 0.15).sum():4.0f} of {1000 * dt * w.sum():4.0f} ms | |I| {np.abs(I[w]).max():3.0f}')
                i = j + int(1.0 / dt); continue
        i += 1
