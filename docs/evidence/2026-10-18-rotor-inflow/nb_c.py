# same as nb_b, but the inflow from Glauert's momentum theory: C_T = 4 li sqrt(mu^2 + (lc + li)^2) (NeuroBEM eq. 5),
# solved with the blade-element C_T (Gill eq. 27) by bisection; optional blend s between Gill (s=0) and Glauert (s=1)
import numpy as np
exec(open('nb_b.py').read().split("def rmse")[0])
def rmse(pred): return np.sqrt(np.mean((pred[sel] - Fz[sel]) ** 2))
def glauert(theta, s=1.0, iters=40):
    cts = k / (0.5 * rho * A * R * R)
    li0 = np.sqrt(cts / 4); a = cts / ((1 - delta) * (theta - li0)); ad = a * (1 - delta)
    T = 0
    for i in range(4):
        tip = mot[:, i] * R
        lc = np.clip(vax / tip, -0.3, 0.3); mu = np.minimum(vin / tip, 0.3)
        lo = np.zeros_like(lc); hi = np.full_like(lc, 0.5)
        for _ in range(iters):
            li = (lo + hi) / 2
            ct = ad * (theta - lc - li) + ad * theta * mu * mu / (2 * delta)
            mom = 4 * li * np.sqrt((s * mu) ** 2 + (lc + li) ** 2)
            big = mom > ct
            hi = np.where(big, li, hi); lo = np.where(big, lo, li)
        li = (lo + hi) / 2
        ct = ad * (theta - lc - li) + ad * theta * mu * mu / (2 * delta)
        T = T + 0.5 * rho * A * tip * tip * ct
    return T
for s in [0.0, 0.25, 0.5, 1.0]:
    best = None
    for pin in np.arange(3.0, 6.01, 0.25):
        th = 1.25 * pin * 0.0254 / (2 * np.pi * R)
        e = rmse(glauert(th, s, 30))
        if best is None or e < best[1]: best = (pin, e, th)
    G = glauert(best[2], s) / (k * s2)
    climb = [np.median(G[sel & (vax >= lo) & (vax < hi) & (vin < 3)]) for lo, hi in [(-4,-2),(2,4),(6,9)]]
    fwd = [np.median(G[sel & (vin >= lo) & (vin < hi) & (np.abs(vax) < 1)]) for lo, hi in [(6,8),(10,12),(12,15)]]
    print('in-plane weight %.2f: best pitch %.2f RMSE %.3f | climb -4..-2 %.3f 2..4 %.3f 6..9 %.3f | fwd 6..8 %.3f 10..12 %.3f 12..15 %.3f' % (s, best[0], best[1], *climb, *fwd))
print('measured:                                    | climb -4..-2 1.046 2..4 0.961 6..9 0.905 | fwd 6..8 1.051 10..12 1.087 12..15 1.125')
