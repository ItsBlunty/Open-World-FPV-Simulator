# Timeline (every 5 ms, 0-300 ms from the chop start) of the centred-stick chops in an old log: throttle, roll/pitch
# gyro, the four motor commands (share of the output range), I roll/pitch. Args: npz then chop times (s).
import sys, numpy as np
z = np.load(sys.argv[1]); a = z['a'].copy(); a[a > 2**31] -= 2**32
n = list(z['names']); c = lambda k: a[:, n.index(k)]
h = dict(x.split(':', 1) for x in z['headers']); lo_m = float(h['motorOutput'].strip('[]').split(',')[0])
t = c('time') / 1e6; thr = c('rcCommand[3]'); g = np.stack([c(f'gyroADC[{i}]') for i in range(2)], 1)
mot = (np.stack([c(f'motor[{i}]') for i in range(4)], 1) - lo_m) / (2047 - lo_m); I = np.stack([c(f'axisI[{i}]') for i in range(2)], 1)
for tc in map(float, sys.argv[2:]):
    i0 = np.searchsorted(t, tc); print(f'== chop {tc} s  (t_ms thr | gyro roll pitch | motors | I roll pitch)')
    for ms in range(-20, 301, 5):
        k = np.searchsorted(t, t[i0] + ms / 1000)
        print(f'{ms:4d} {thr[k]:5.0f} | {g[k,0]:5.0f} {g[k,1]:5.0f} | {" ".join(f"{v:.2f}" for v in mot[k])} | {I[k,0]:4.0f} {I[k,1]:4.0f}')
