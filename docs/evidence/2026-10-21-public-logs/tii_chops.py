# TII "Race Against the Machine" piloted flights (Betaflight 4.3.1 5-inch racer, motion capture): throttle chops
# (stick from >= 50 % of its range held 0.3 s to <= 5 % within 0.3 s). At the chop: speed and the airflow along the
# thrust axis (mocap velocity in the body frame, FLU: + = moving towards the props' intake side, air from in front);
# in 0.15-1.0 s after it with the stick low: largest stick deflection roll/pitch (us from centre), largest |gyro|,
# motor output max/min, time with a motor above 15 %.
import sys, glob, os, numpy as np
def load(p):
    d = np.genfromtxt(p, delimiter=',', names=True); return d
for fl in sorted(glob.glob(os.path.join(sys.argv[1], 'channels_flight-*.csv'))):
    name = os.path.basename(fl)[len('channels_'):-4]
    ch = load(fl); mt = load(fl.replace('channels_', 'motors_thrust_')); imu = load(fl.replace('channels_', 'imu_')); ds = load(fl.replace('channels_', 'drone_state_'))
    t = imu['timestamp'] / 1e6; t0 = t[0]
    I = lambda d, k: np.interp(t, d['timestamp'] / 1e6, d[k])
    thr = I(ch, 'thrust'); rs = I(ch, 'roll') - 1500; ps = I(ch, 'pitch') - 1500
    mot = np.stack([I(mt, f'thrust{i}') for i in range(4)], 1)
    g = np.stack([imu['gyro_x'], imu['gyro_y'], imu['gyro_z']], 1) * 57.2958
    qx, qy, qz, qw = (I(ds, f'pose_orientation_{k}') for k in 'xyzw')
    vw = np.stack([I(ds, f'velocity_linear_{k}') for k in 'xyz'], 1)
    # body z axis (thrust, FLU) in world: third column of R(q)
    zb = np.stack([2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy)], 1)
    axial = (vw * zb).sum(1); speed = np.linalg.norm(vw, axis=1)
    dt = np.median(np.diff(t)); tmin, tmax = np.nanmin(thr), np.nanmax(thr); hi = tmin + 0.5 * (tmax - tmin); lo = tmin + 0.05 * (tmax - tmin)
    print(f'== {name}: {t[-1]-t0:.0f} s, {1/dt:.0f} Hz, top speed {np.nanmax(speed):.1f} m/s, throttle {tmin:.0f}-{tmax:.0f}')
    i = 0
    while i < len(t) - 1:
        if thr[i] > hi:
            j = i
            while j < len(t) - 1 and t[j] - t[i] < 0.3 and thr[j] > lo: j += 1
            k0 = np.searchsorted(t, t[i] - 0.3)
            if thr[j] <= lo and t[j] - t[i] < 0.3 and np.all(thr[k0:i] > hi * 0.9):
                w = (t >= t[i] + 0.15) & (t <= t[i] + 1.0) & (thr <= lo + 0.05 * (tmax - tmin))
                if w.sum() > 30:
                    print(f'  chop {t[i]-t0:6.2f} s: {speed[i]:4.1f} m/s, {axial[i]:+5.1f} along the thrust axis | stick r/p {np.abs(rs[w]).max():3.0f}/{np.abs(ps[w]).max():3.0f} us | |gyro| r/p/y {np.abs(g[w,0]).max():4.0f}/{np.abs(g[w,1]).max():4.0f}/{np.abs(g[w,2]).max():4.0f} deg/s | motor max {mot[w].max():.2f} min {mot[w].min():.2f}, >15 % {1000*dt*(mot[w].max(1) > 0.15).sum():4.0f} of {1000*dt*w.sum():4.0f} ms')
                i = j + int(1.0 / dt); continue
        i += 1
