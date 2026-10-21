# Big command steps in the NeuroBEM blackbox logs: the measured rpm response (time to 63 %, peak acceleration) by
# direction and starting rpm, and the low end: what the motors do at idle command (0.055) while flying.
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a']; n = list(z['names']); c = lambda k: a[:, n.index(k)]
    t = c('time') / 1e6
    m = np.stack([c(f'motor[{i}]') for i in range(4)], 1); e = np.stack([c(f'debug[{i}]') for i in range(4)], 1)
    ok = (m > 100).all(1) & np.isfinite(e).all(1) & (e > 0).all(1)
    idx = np.where(ok)[0]; br = np.where(np.diff(idx) > 50)[0]; idx = max(np.split(idx, br + 1), key=len)
    tg = np.arange(t[idx[0]], t[idx[-1]], 0.001)
    cmd = np.stack([np.interp(tg, t[idx], (m[idx, i] - 48) / 1999) for i in range(4)], 1)
    rpm = np.stack([np.interp(tg, t[idx], e[idx, i] * 100 / 7) for i in range(4)], 1)
    print(f'== {fn}')
    rows = []
    for i in range(4):
        dc = cmd[5:, i] - cmd[:-5, i]
        j = 0
        while j < len(dc) - 200:
            if abs(dc[j]) > 0.15:
                s = j; c0 = cmd[s, i]; c1 = cmd[s + 5, i]
                # the command must then hold within 0.05 of c1 for 80 ms
                if np.all(np.abs(cmd[s + 5:s + 85, i] - c1) < 0.05):
                    r0 = rpm[s, i]; r1 = np.mean(rpm[s + 70:s + 85, i])
                    if abs(r1 - r0) > 2000:
                        fr = (rpm[s:s + 85, i] - r0) / (r1 - r0)
                        t63 = np.argmax(fr >= 0.632); t10 = np.argmax(fr >= 0.1)
                        acc = np.max(np.abs(np.diff(rpm[s:s + 40, i]))) * 2 * np.pi / 60 / 0.001
                        rows.append((np.sign(c1 - c0), r0, r1, c0, c1, t10, t63, acc))
                j += 100
            else: j += 1
    rows.sort(key=lambda r: (r[0], r[1]))
    for r in rows: print('  %s %6.0f -> %6.0f rpm (cmd %.2f -> %.2f): 10 %% at %2d ms, 63 %% at %2d ms, peak accel %6.0f rad/s^2' % ('up  ' if r[0] > 0 else 'down', *r[1:]))
    low = cmd < 0.06
    print('  samples at idle command: %d; rpm then median %.0f, p5 %.0f, p95 %.0f' % (low.sum(), np.median(rpm[low]), np.percentile(rpm[low], 5), np.percentile(rpm[low], 95)) if low.any() else '  no idle samples')
