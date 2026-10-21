# Throttle chops in a Betaflight log with eRPM: throttle (rcCommand[3]) falling from high to near minimum within 200 ms
# after >= 300 ms of high throttle (a punch-out: the quad climbing fast, air into the props from in front).
# Per chop: motor commands, measured rpm (eRPM x 100 / pole pairs), gyro rates, through the chop.
import sys, numpy as np
z = np.load(sys.argv[1]); a = z['a']; n = list(z['names']); H = dict(h.split(':', 1) for h in z['headers'])
c = lambda k: a[:, n.index(k)]
poles = int(str(H.get('motor_poles', 14)).strip('[] ')); pp = poles / 2
t = c('time') / 1e6; thr = c('rcCommand[3]')
mot = np.stack([c(f'motor[{i}]') for i in range(4)], 1); erpm = np.stack([c(f'eRPM[{i}]') for i in range(4)], 1)
rpm = erpm * 100 / pp
gyro = np.stack([c(f'gyroADC[{i}]') for i in range(3)], 1)
mo = [float(x) for x in H.get('motorOutput', '48,2047').strip('[]() ').split(',')]
cmd = (mot - mo[0]) / (mo[1] - mo[0])
print('frames', len(t), 'rate Hz', round(1 / np.median(np.diff(t))), '| throttle range', np.nanmin(thr), np.nanmax(thr), '| rpm max', np.nanmax(rpm).round(), '| motorOutput', mo)
print('slowest motor rpm at the lowest 5 % of throttle, p5/50:', np.nanpercentile(rpm[thr < np.nanpercentile(thr, 5)].min(1), [5, 50]).round())
tmin, tmax = np.nanmin(thr), np.nanmax(thr)
hi = tmin + float(sys.argv[3] if len(sys.argv) > 3 else 0.55) * (tmax - tmin); lo = tmin + 0.08 * (tmax - tmin)
print('punch threshold', round(hi), 'chop threshold', round(lo))
events = []
i = 0; dt = np.median(np.diff(t))
while i < len(t) - 1:
    if thr[i] > hi and thr[i + 1] <= thr[i]:
        # find drop to lo within 0.2 s
        j = i; 
        while j < len(t) - 1 and t[j] - t[i] < 0.2 and thr[j] > lo: j += 1
        if thr[j] <= lo and t[j] - t[i] < 0.2:
            k0 = np.searchsorted(t, t[i] - 0.3)
            if np.all(thr[k0:i] > hi * 0.85):
                events.append(i); i = j + int(1.0 / dt); continue
    i += 1
print('chops found:', len(events), 'at t =', [round(t[e], 2) for e in events])
for e in events[:int(sys.argv[2]) if len(sys.argv) > 2 else 6]:
    print(f'\n=== chop at {t[e]:.3f} s (throttle {thr[e]:.0f}); ms from chop start')
    print('   ms  thr | cmd0 cmd1 cmd2 cmd3 |  rpm0  rpm1  rpm2  rpm3 | roll pitch yaw deg/s')
    for ms in list(range(-20, 60, 10)) + list(range(60, 300, 20)) + list(range(300, 1000, 100)):
        k = np.searchsorted(t, t[e] + ms / 1000)
        if k >= len(t): break
        print(f'{ms:5d} {thr[k]:6.0f} | ' + ' '.join(f'{x:.2f}' for x in cmd[k]) + ' | ' + ' '.join(f'{x:5.0f}' for x in rpm[k]) + ' | ' + ' '.join(f'{x:+5.0f}' for x in gyro[k]))
