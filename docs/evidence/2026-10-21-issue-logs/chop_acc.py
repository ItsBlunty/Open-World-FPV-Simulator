# Specific force (accelerometer, in g) around each centred-stick chop: with the motors near idle the accelerometer reads
# the air's push (drag, windmilling props) only, which grows with airspeed; compare with the sim's in the owner's chop.
# Before: mean |acc| over 0.3 s before the chop (thrust + drag); after: mean over 0.1-0.4 s after it, and its peak.
import sys, numpy as np
for fn in sys.argv[1:]:
    z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32
    n = list(z['names']); c = lambda k: a[:, n.index(k)]
    if 'accSmooth[0]' not in n: print('==', fn, 'no accelerometer'); continue
    h = dict(x.split(':', 1) for x in z['headers']); g1 = float(h.get('acc_1G', 2048))
    t = c('time') / 1e6; thr = c('rcCommand[3]'); rc = np.stack([c(f'rcCommand[{i}]') for i in range(3)], 1)
    acc = np.stack([c(f'accSmooth[{i}]') for i in range(3)], 1) / g1; am = np.linalg.norm(acc, axis=1)
    print(f"== {fn} {h.get('Craft name','')} acc_1G {g1:.0f}")
    dt = np.median(np.diff(t)); i = 0
    while i < len(t) - 1:
        if thr[i] > 1500:
            j = i
            while j < len(t) - 1 and t[j] - t[i] < 0.25 and thr[j] > 1050: j += 1
            k0 = np.searchsorted(t, t[i] - 0.3)
            if thr[j] <= 1050 and t[j] - t[i] < 0.25 and np.all(thr[k0:i] > 1350):
                w = (t >= t[i]) & (t <= t[i] + 1.5)
                if np.all(thr[w & (t > t[j])] <= 1080) and np.abs(rc[w]).max() < 40:
                    b = (t >= t[i] - 0.3) & (t < t[i]); af = (t >= t[i] + 0.1) & (t <= t[i] + 0.4)
                    print(f"  chop {t[i]:7.2f} s: |acc| before {am[b].mean():.2f} g, after {am[af].mean():.2f} g (peak {am[af].max():.2f}), body x/y/z after {acc[af].mean(0).round(2)}")
                i = j + int(1.5 / dt); continue
        i += 1
