# bridge.js CSV to the npz layout step_response.py reads, plus tracking-error stats
import sys, numpy as np
for fn in sys.argv[1:]:
    d = np.genfromtxt(fn, delimiter=',', names=True)
    a = np.stack([d['t_ms'] * 1000, d['sp_roll'], d['sp_pitch'], d['gyro_roll'], d['gyro_pitch']], 1)
    out = fn.replace('.csv', '.npz')
    np.savez_compressed(out, a=a, names=np.array(['time', 'setpoint[0]', 'setpoint[1]', 'gyroADC[0]', 'gyroADC[1]']),
                        headers=np.array([f'Craft name:{fn.split("/")[-1][5:-4]}', 'rollPID:', 'pitchPID:']))
    e = np.hypot(d['sp_roll'] - d['gyro_roll'], d['sp_pitch'] - d['gyro_pitch'])
    m = np.stack([d[f'm{i}'] for i in range(4)], 1)
    print(f"{fn.split('/')[-1]:34s} tracking error rms {np.sqrt(np.mean(e**2)):5.1f} p99 {np.percentile(e, 99):5.0f} deg/s | motors at full {100*np.mean(m.max(1) > 0.99):4.1f} % of the time | speed median {np.median(d['speed']):4.1f} m/s")
