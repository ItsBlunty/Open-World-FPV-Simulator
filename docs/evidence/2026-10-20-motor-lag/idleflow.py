# NeuroBEM processed data (100 Hz, all flights): motors at the bottom of their range, binned by the air along the
# thrust axis (body z velocity: negative = descending onto the props = air from behind/below; positive = climbing =
# air from in front/above) and the in-plane speed. Does the airflow drive an idling prop above its idle speed?
import sys, numpy as np
d = np.load(sys.argv[1])['d']
vel = d[:, 14:17]; mot = d[:, 20:24]
vz = vel[:, 2]; vin = np.hypot(vel[:, 0], vel[:, 1])
print('rows', len(d), '| speed max', np.linalg.norm(vel, axis=1).max().round(1), 'm/s, vz range', vz.min().round(1), vz.max().round(1))
lo = mot.min(1)
print('slowest motor rpm percentiles 0.1/1/5/50:', [round(float(np.percentile(lo, q) * 9.549)) for q in (0.1, 1, 5, 50)])
idle = mot < 360  # under ~3440 rpm: the idle command gave 2800-3090 rpm in the blackbox logs
print('motor-samples under 3440 rpm:', idle.sum())
for name, sel in (('air from below (vz < -3)', vz < -3), ('vz -3..-1', (vz >= -3) & (vz < -1)), ('vz -1..1', np.abs(vz) <= 1),
                  ('vz 1..3', (vz > 1) & (vz <= 3)), ('air from above (vz > 3)', vz > 3)):
    s = idle & sel[:, None]
    allm = mot[np.broadcast_to(sel[:, None], mot.shape)]
    print(f'  {name:26s}: rows {sel.sum():6d}, slowest-motor p1 {np.percentile(lo[sel], 1) * 9.549:6.0f} rpm, idle samples {s.sum():5d}' + (f', their rpm p5/50/95 {np.percentile(mot[s], 5) * 9.549:.0f}/{np.percentile(mot[s], 50) * 9.549:.0f}/{np.percentile(mot[s], 95) * 9.549:.0f}' if s.sum() else ''))
