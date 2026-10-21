# Chop statistics from bridge.js CSVs (the owner's chop, sticks centred from 4187 ms): per controller, over the 16 motor
# spreads: speed at the chop, peak roll/pitch rate 0-1.5 s, largest angular acceleration over 10 ms (rates through a further
# 100 Hz PT1) in 45-445 ms, top motor command then, until when a motor stays above 15 %, tilt change (integrated rates).
import sys, glob, numpy as np
T0 = 4187
for fc in ('sitl', 'builtin'):
    rows = []
    for fn in sorted(glob.glob(f'{sys.argv[1]}_{fc}_*.csv')):
        d = np.genfromtxt(fn, delimiter=',', names=True)
        t = d['t_ms'] - T0; w = (t >= 0) & (t <= 1500)
        r, p = d['gyro_roll'], d['gyro_pitch']
        k = 0.001 / (1 / (2 * np.pi * 100) + 0.001); fr = np.zeros_like(r); fp = np.zeros_like(p)
        for i in range(1, len(r)): fr[i] = fr[i-1] + (r[i] - fr[i-1]) * k; fp[i] = fp[i-1] + (p[i] - fp[i-1]) * k
        a = np.maximum(np.abs(fr[10:] - fr[:-10]), np.abs(fp[10:] - fp[:-10])) / 0.01
        ta = t[10:]; aw = (ta >= 45) & (ta <= 445)
        m = np.stack([d[f'm{i}'] for i in range(4)], 1); mw = (t >= 45) & (t <= 445)
        above = np.where(w & (m.max(1) > 0.15))[0]
        ang = np.cumsum(np.stack([r[w], p[w]], 1), 0) * 0.001
        rows.append((d['speed'][np.argmin(np.abs(t))], max(np.abs(r[w]).max(), np.abs(p[w]).max()), a[aw].max(), m[mw].max(), t[above[-1]] if len(above) else 0, np.hypot(ang[:, 0], ang[:, 1]).max()))
    x = np.array(rows); med = np.median(x, 0)
    print(f"{fc:8s} n {len(x)} | speed at chop {med[0]:.1f} m/s | peak rate median {med[1]:.0f} max {x[:,1].max():.0f} deg/s | accel median {med[2]:.0f} max {x[:,2].max():.0f} deg/s^2 | top motor median {med[3]:.2f} | motor > 15 % until {med[4]:.0f} ms | tilt {med[5]:.1f} deg")
print('real, 11 centred chops (Betaflight 3.2-4.0 issue logs): peak ~60 max 77 deg/s, accel median 2200 max 3700 deg/s^2, top motor 0.49, motor high 1.5-2.5 s, tilt 6 deg')
