# Same chops as chops.py, with the pilot's rate setpoints and the tracking error (setpoint - gyro) per axis, and the
# I terms: commanded moves track (small error), disturbances show as error the pilot did not ask for.
import sys, numpy as np
z = np.load(sys.argv[1]); a = z['a']; n = list(z['names']); H = dict(h.split(':', 1) for h in z['headers'])
c = lambda k: a[:, n.index(k)]
t = c('time') / 1e6; thr = c('rcCommand[3]')
mot = np.stack([c(f'motor[{i}]') for i in range(4)], 1); rpm = np.stack([c(f'eRPM[{i}]') for i in range(4)], 1) * 100 / 7
g = np.stack([c(f'gyroADC[{i}]') for i in range(3)], 1); sp = np.stack([c(f'setpoint[{i}]') for i in range(3)], 1)
I = np.stack([c(f'axisI[{i}]') for i in range(3)], 1)
cmd = (mot - 48) / 1999
for tc in [float(x) for x in sys.argv[2].split(',')]:
    e = np.searchsorted(t, tc)
    print(f'\n=== chop at {t[e]:.3f} s')
    print('   ms  thr  | cmd0 cmd1 cmd2 cmd3 |  rpm0  rpm1  rpm2  rpm3 | setpoint r/p/y  | gyro r/p/y      | error r/p/y     | I r/p')
    for ms in list(range(0, 160, 40)) + list(range(160, 320, 10)) + list(range(320, 1001, 40)):
        k = np.searchsorted(t, t[e] + ms / 1000)
        if k >= len(t): break
        err = sp[k] - g[k]
        print(f'{ms:5d} {thr[k]:6.0f} | ' + ' '.join(f'{x:.2f}' for x in cmd[k]) + ' | ' + ' '.join(f'{x:5.0f}' for x in rpm[k]) + ' | ' + ' '.join(f'{x:+5.0f}' for x in sp[k]) + ' | ' + ' '.join(f'{x:+5.0f}' for x in g[k]) + ' | ' + ' '.join(f'{x:+5.0f}' for x in err) + f' | {I[k,0]:+4.0f} {I[k,1]:+4.0f}')
