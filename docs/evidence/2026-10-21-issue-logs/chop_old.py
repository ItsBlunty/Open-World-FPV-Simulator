# Throttle chops in Betaflight 3.x/4.0 logs (no setpoint, rpm or GPS fields): chop = throttle held in the top half of
# its range 300 ms, then to near minimum within 250 ms. In 0.15-1.0 s after (throttle still at minimum): pilot's roll /
# pitch / yaw stick (rcCommand, +-500), max |gyro| roll/pitch, rms gyro roll/pitch, top motor (0-1 of the output range),
# time with any motor above 0.15, max |I| roll/pitch. Chops with all sticks within 40 of centre are marked "centred".
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32  # orangebox leaves old logs' throttle wrapped past 2^32
    n = list(z['names']); c = lambda k: a[:, n.index(k)]
    h = dict(x.split(':', 1) for x in z['headers']); lo_m = float(h['motorOutput'].strip('[]').split(',')[0])
    t = c('time') / 1e6; thr = c('rcCommand[3]')
    mot = (np.stack([c(f'motor[{i}]') for i in range(4)], 1) - lo_m) / (2047 - lo_m)
    g = np.stack([c(f'gyroADC[{i}]') for i in range(3)], 1); rc = np.stack([c(f'rcCommand[{i}]') for i in range(3)], 1)
    I = np.stack([c(f'axisI[{i}]') for i in range(2)], 1)
    tmin, tmax = np.nanpercentile(thr, 0.5), np.nanpercentile(thr, 99.5); hi = tmin + 0.5 * (tmax - tmin); lo = tmin + 0.05 * (tmax - tmin)
    dt = np.median(np.diff(t))
    print(f"== {fn} {h.get('Craft name','')} ({h['Firmware revision']}), throttle {tmin:.0f}-{tmax:.0f}")
    i = 0; rows = []
    while i < len(t) - 1:
        if thr[i] > hi:
            j = i
            while j < len(t) - 1 and t[j] - t[i] < 0.25 and thr[j] > lo: j += 1
            k0 = np.searchsorted(t, t[i] - 0.3)
            if thr[j] <= lo and t[j] - t[i] < 0.25 and np.all(thr[k0:i] > hi * 0.9):
                w = (t >= t[i] + 0.15) & (t <= t[i] + 1.0) & (thr <= lo)
                if w.sum() > 50:
                    st = np.abs(rc[w]).max(0); centred = st.max() < 40
                    hiT = (mot[w].max(1) > 0.15).sum() * dt * 1000
                    print(f"  chop {t[i]:7.2f} s {'centred' if centred else '       '} stick r/p/y {st[0]:3.0f}/{st[1]:3.0f}/{st[2]:3.0f} | max|gyro| r/p {np.abs(g[w,0]).max():4.0f}/{np.abs(g[w,1]).max():4.0f} rms {np.sqrt(np.mean(g[w,0]**2)):3.0f}/{np.sqrt(np.mean(g[w,1]**2)):3.0f} deg/s | top motor {mot[w].max():.2f}, >0.15 for {hiT:4.0f} ms | max|I| {np.abs(I[w]).max():3.0f}")
                i = j + int(1.0 / dt); continue
        i += 1
