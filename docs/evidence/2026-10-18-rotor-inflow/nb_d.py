# the exact algorithm planned for sim.ts: bisection on the normal-working-state branch (lc + li >= 0), 32 steps
import numpy as np
exec(open('nb_b.py').read().split("def rmse")[0])
def rmse(pred): return np.sqrt(np.mean((pred[sel] - Fz[sel]) ** 2))
def bem(theta, iters=32):
    cts = k / (0.5 * rho * A * R * R)
    li0 = np.sqrt(cts / 4); a = cts / ((1 - delta) * (theta - li0)); ad = a * (1 - delta)
    T = 0
    for i in range(4):
        tip = mot[:, i] * R
        lc = np.clip(vax / tip, -0.3, 0.3); mu = np.minimum(vin / tip, 0.3)
        f = lambda li: 4 * li * np.sqrt(mu * mu + (lc + li) ** 2) - (ad * (theta - lc - li) + ad * theta * mu * mu / (2 * delta))
        lo = np.maximum(0, -lc); hi = theta * (1 + mu * mu / (2 * delta)) - lc
        flo = f(lo) > 0
        hi = np.where(flo, lo, hi); lo = np.where(flo, 0, lo)
        for _ in range(iters):
            li = (lo + hi) / 2
            big = f(li) > 0
            hi = np.where(big, li, hi); lo = np.where(big, lo, li)
        li = (lo + hi) / 2
        ct = ad * (theta - lc - li) + ad * theta * mu * mu / (2 * delta)
        T = T + 0.5 * rho * A * tip * tip * ct
    return T
best = None
for pin in np.arange(3.0, 5.01, 0.25):
    th = 1.25 * pin * 0.0254 / (2 * np.pi * R); e = rmse(bem(th))
    print('pitch %.2f RMSE %.3f' % (pin, e))
    if best is None or e < best[1]: best = (pin, e, th)
G = bem(best[2]) / (k * s2)
print('best', best[0], '%.3f' % best[1])
for lo_, hi_ in [(-6,-4),(-4,-2),(-2,-1),(1,2),(2,4),(4,6),(6,9)]:
    b = sel & (vax >= lo_) & (vax < hi_) & (vin < 3); print(' climb %3d..%-3d measured %.3f model %.3f' % (lo_, hi_, np.median(ratio[b]), np.median(G[b])))
for lo_, hi_ in [(2,4),(6,8),(10,12),(12,15)]:
    b = sel & (vin >= lo_) & (vin < hi_) & (np.abs(vax) < 1); print(' fwd   %2d..%-2d measured %.3f model %.3f' % (lo_, hi_, np.median(ratio[b]), np.median(G[b])))
# whole-envelope check including fast rotations
allr = np.sqrt(np.mean((bem(best[2]) - Fz) ** 2)); allq = np.sqrt(np.mean((k * s2 - Fz) ** 2))
print('all samples incl. fast rotations: RMSE quadratic %.3f, inflow %.3f N' % (allq, allr))
