# Control authority sign: angular acceleration (gyro, differentiated over 4 ms, 10 ms moving average) regressed on the
# measured rpm^2 split the mixer makes on that axis (Betaflight quad X: 0 rear-right, 1 front-right, 2 rear-left,
# 3 front-left; mixer roll [-1,-1,+1,+1], pitch [+1,-1,+1,-1]), split into: normal flight (throttle above 25 % of
# range) and the window 150-500 ms after a chop from a punch-out (throttle at minimum). A negative slope after chops
# and a positive one in normal flight = the props' response to rpm reversed.
import sys, numpy as np
z = np.load(sys.argv[1]); a = z['a']; n = list(z['names'])
c = lambda k: a[:, n.index(k)]
t = c('time') / 1e6; thr = c('rcCommand[3]')
rpm = np.stack([c(f'eRPM[{i}]') for i in range(4)], 1) * 100 / 7
g = np.stack([c(f'gyroADC[{i}]') for i in range(2)], 1)
dt = np.median(np.diff(t)); w = max(1, int(0.010 / dt))
k = np.ones(w) / w; sm = lambda v: np.convolve(v, k, 'same')
acc = np.stack([sm(np.gradient(sm(g[:, i]), t)) for i in range(2)], 1)
r2 = rpm ** 2 / 1e6
split = {'roll': r2 @ np.array([-1, -1, 1, 1]), 'pitch': r2 @ np.array([1, -1, 1, -1])}
tmin, tmax = np.nanmin(thr), np.nanmax(thr)
normal = thr > tmin + 0.25 * (tmax - tmin)
chops = [float(x) for x in sys.argv[2].split(',')]
post = np.zeros(len(t), bool)
W0, W1 = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0.15, 0.5)
for tc in chops: post |= (t >= tc + W0) & (t <= tc + W1)
post &= thr < tmin + float(sys.argv[5] if len(sys.argv) > 5 else 0.03) * (tmax - tmin)
for ax, name in ((0, 'roll'), (1, 'pitch')):
    for lab, sel in (('normal flight', normal), (f'{W0*1000:.0f}-{W1*1000:.0f} ms after chops', post)):
        x = split[name][sel]; y = acc[sel, ax]; ok = np.isfinite(x) & np.isfinite(y)
        x, y = x[ok], y[ok]
        slope = np.sum((x - x.mean()) * (y - y.mean())) / np.sum((x - x.mean()) ** 2)
        r = np.corrcoef(x, y)[0, 1]
        print(f'{name:5s} {lab:24s}: n {len(x):6d}, slope {slope:+9.0f} deg/s^2 per 1e6 rpm^2, correlation {r:+.2f}')
