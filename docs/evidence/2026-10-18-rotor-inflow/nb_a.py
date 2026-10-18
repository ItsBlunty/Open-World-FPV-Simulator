import numpy as np
d = np.load('nb100.npz')['d']
w = d[:, 1+3:1+6+0] if False else d[:, 4:7]
acc = d[:, 11:14]; vel = d[:, 14:17]; mot = d[:, 20:24]; vbat = d[:, 28]
q = d[:, 7:11]  # x y z w
speed = np.linalg.norm(vel, axis=1); rate = np.linalg.norm(w, axis=1)
# body z axis in world (rotation matrix third column) for q = (x,y,z,w) body->world
x, y, z, ww = q.T
bz_w = np.stack([2*(x*z+ww*y), 2*(y*z-ww*x), 1-2*(x*x+y*y)], 1)
calm = (speed < 0.5) & (rate < 0.5)
print('calm samples', calm.sum())
print('acc body z in calm: mean %.2f  (9.81 => specific force; 0 => kinematic)' % acc[calm, 2].mean())
print('acc body x,y calm mean %.2f %.2f' % tuple(acc[calm, :2].mean(0)))
print('body z up component calm mean %.3f' % bz_w[calm, 2].mean())
print('motor speed calm mean %.0f rad/s, vbat %.1f V' % (mot[calm].mean(), vbat[calm].mean()))
print('motor speed range p1 %.0f p99 %.0f max %.0f' % (np.percentile(mot, 1), np.percentile(mot, 99), mot.max()))
print('speed p99 %.1f max %.1f' % (np.percentile(speed, 99), speed.max()))
print('body vel z (axial) p1 %.1f p99 %.1f; in-plane p99 %.1f' % (np.percentile(vel[:,2],1), np.percentile(vel[:,2],99), np.percentile(np.hypot(vel[:,0],vel[:,1]),99)))
