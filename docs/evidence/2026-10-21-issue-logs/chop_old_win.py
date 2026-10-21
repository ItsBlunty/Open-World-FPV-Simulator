# Centred-stick throttle chops (all of roll, pitch, yaw stick within 40 of +-500 for the whole 1.5 s after) in
# Betaflight 3.x/4.0 logs, measured like the sim's owner-chop check: over 0-1.5 s from the chop start, rms roll/pitch
# rate, peak roll/pitch rate, tilt change (the roll and pitch rates integrated, combined), how long a motor stays above
# 15 % of the output range counted from the chop start until all are below it for good, peak I.
import sys, numpy as np
allr = []; WIN = float(sys.argv[1]); sys.argv = sys.argv[1:]
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32
    n = list(z['names']); c = lambda k: a[:, n.index(k)]
    h = dict(x.split(':', 1) for x in z['headers']); lo_m = float(h['motorOutput'].strip('[]').split(',')[0])
    t = c('time') / 1e6; thr = c('rcCommand[3]')
    mot = (np.stack([c(f'motor[{i}]') for i in range(4)], 1) - lo_m) / (2047 - lo_m)
    g = np.stack([c(f'gyroADC[{i}]') for i in range(3)], 1); rc = np.stack([c(f'rcCommand[{i}]') for i in range(3)], 1)
    I = np.stack([c(f'axisI[{i}]') for i in range(2)], 1)
    hi, lo = 1500, 1050
    dt = np.median(np.diff(t)); i = 0
    print(f"== {fn} {h.get('Craft name','')} ({h['Firmware revision']}), rollPID {h['rollPID']} pitchPID {h['pitchPID']}")
    while i < len(t) - 1:
        if thr[i] > hi:
            j = i
            while j < len(t) - 1 and t[j] - t[i] < 0.25 and thr[j] > lo: j += 1
            k0 = np.searchsorted(t, t[i] - 0.3)
            if thr[j] <= lo and t[j] - t[i] < 0.25 and np.all(thr[k0:i] > hi * 0.9):
                w = (t >= t[i]) & (t <= t[i] + WIN)
                if np.all(thr[w & (t > t[j])] <= lo + 30) and np.abs(rc[w]).max() < 40:
                    gw = g[w]; tw = t[w] - t[i]
                    ang = np.cumsum(gw[:, :2], 0) * dt; tilt = np.hypot(ang[:, 0], ang[:, 1]).max()
                    above = np.where(mot[w].max(1) > 0.15)[0]; last = tw[above[-1]] * 1000 if len(above) else 0
                    r = (np.sqrt(np.mean(gw[:, 0]**2)), np.sqrt(np.mean(gw[:, 1]**2)), np.abs(gw[:, 0]).max(), np.abs(gw[:, 1]).max(), tilt, last, np.abs(I[w]).max())
                    allr.append(r)
                    print(f"  chop {t[i]:7.2f} s: rms r/p {r[0]:3.0f}/{r[1]:3.0f}, peak r/p {r[2]:4.0f}/{r[3]:4.0f} deg/s, tilt change {r[4]:4.1f} deg, a motor > 15 % until {r[5]:4.0f} ms, peak I {r[6]:3.0f}")
                i = j + int(WIN / dt); continue
        i += 1
r = np.array(allr)
print(f"\nALL {len(r)} centred chops: median / max  rms r/p {np.median(r[:,0]):.0f}/{np.median(r[:,1]):.0f} ({r[:,0].max():.0f}/{r[:,1].max():.0f}), peak {np.median(r[:,2]):.0f}/{np.median(r[:,3]):.0f} ({r[:,2].max():.0f}/{r[:,3].max():.0f}) deg/s, tilt {np.median(r[:,4]):.1f} ({r[:,4].max():.1f}) deg, motor high until {np.median(r[:,5]):.0f} ({r[:,5].max():.0f}) ms, I {np.median(r[:,6]):.0f} ({r[:,6].max():.0f})")
