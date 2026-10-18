import numpy as np
d = np.load('nb100.npz')['d']
m = 0.772; rho = 1.225; R = 5 * 0.0254 / 2; A = np.pi * R * R; delta = 0.2
w = d[:, 4:7]; acc = d[:, 11:14]; vel = d[:, 14:17]; mot = d[:, 20:24]
Fz = m * acc[:, 2]                      # measured force along the thrust axis, N (specific force x mass)
s2 = (mot ** 2).sum(1)
vax = vel[:, 2]; vin = np.hypot(vel[:, 0], vel[:, 1])
calm = (np.linalg.norm(vel, axis=1) < 0.5) & (np.linalg.norm(w, axis=1) < 0.5)
k = (Fz[calm] * s2[calm]).sum() / (s2[calm] ** 2).sum()
print('quadratic fit on calm data: k = %.3e N/(rad/s)^2' % k)
sel = np.linalg.norm(w, axis=1) < 3       # skip fast rotations (body-rate effects)
ratio = Fz / (k * s2)
def gill(theta):
    cts = k / (0.5 * rho * A * R * R)
    li0 = np.sqrt(cts / 4); a = cts / ((1 - delta) * (theta - li0)); ad = a * (1 - delta)
    T = 0
    for i in range(4):
        tip = mot[:, i] * R
        lc = np.clip(vax / tip, -0.3, 0.3); mu = np.minimum(vin / tip, 0.3)
        qq = 4 * lc - ad
        li = (-4 * lc - ad + np.sqrt(qq * qq + 8 * ad * theta * (2 + mu * mu / delta))) / 8
        ct = ad * (theta - lc - li) + ad * theta * mu * mu / (2 * delta)
        T = T + 0.5 * rho * A * tip * tip * ct
    return T
def rmse(pred): return np.sqrt(np.mean((pred[sel] - Fz[sel]) ** 2))
print('samples used', sel.sum(), ' RMSE quadratic %.3f N' % rmse(k * s2))
best = None
for pin in np.arange(3.0, 6.01, 0.25):
    th = 1.25 * pin * 0.0254 / (2 * np.pi * R)
    e = rmse(gill(th)); print('  pitch %.2f in: RMSE %.3f N' % (pin, e))
    if best is None or e < best[1]: best = (pin, e, th)
print('best pitch', best[0])
G = gill(best[2]) / (k * s2)
print('\nthrust / quadratic model, binned by climb velocity along the thrust axis (in-plane < 3 m/s):')
print(' vax m/s   n   measured  model')
for lo in [-6, -4, -2, -1, 0, 1, 2, 4, 6]:
    hi = {-6:-4,-4:-2,-2:-1,-1:0,0:1,1:2,2:4,4:6,6:9}[lo]
    b = sel & (vax >= lo) & (vax < hi) & (vin < 3)
    if b.sum() > 50: print(' %3d..%-3d %6d  %.3f    %.3f' % (lo, hi, b.sum(), np.median(ratio[b]), np.median(G[b])))
print('\nbinned by in-plane speed (|vax| < 1 m/s):')
for lo, hi in [(0,2),(2,4),(4,6),(6,8),(8,10),(10,12),(12,15)]:
    b = sel & (vin >= lo) & (vin < hi) & (np.abs(vax) < 1)
    if b.sum() > 50: print(' %2d..%-2d %6d  %.3f    %.3f' % (lo, hi, b.sum(), np.median(ratio[b]), np.median(G[b])))
