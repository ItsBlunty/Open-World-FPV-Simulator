# Python replica of sim-core 0.8.0 propLoads (closedLoads + bladeLoads blend), for refitting the high advance-ratio range
import json, math
import numpy as np
P = json.load(open(__file__.rsplit('/', 1)[0] + '/inflow.json'))
D_ = 0.2; RMAX = 0.3; RFULL = 0.45
GX = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526]
GW = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]

def closed(f, tip, uy, side):
    lc = uy / tip; mu = min(side / tip, RMAX); d = D_
    ad = f['a'] * (1 - d); ct0 = ad * (f['theta'] - lc) + ad * f['theta'] * mu * mu / (2 * d); mu2 = mu * mu
    start = -lc if lc < 0 else 0.0
    lo, hi = (start, ct0 / ad) if ct0 / ad > start else (0.0, start)
    if ct0 <= 0 and start <= 0: lo, hi = 0.0, 0.0
    for _ in range(32):
        li = (lo + hi) / 2; s = lc + li
        if 4 * li * math.sqrt(mu2 + s * s) > ct0 - ad * li: hi = li
        else: lo = li
    li = (lo + hi) / 2; ct = ct0 - ad * li; lam = lc + li; dl = lam - f['theta']
    cq = ad * lam * (f['theta'] - lam) + (1 - d) * f['sigma'] * (f['cd0'] * (1 + d + d * d) / 3 + f['cdAlpha'] * dl * dl + mu2 * (f['cd0'] * d + f['cdAlpha'] * f['theta'] ** 2) / (2 * d))
    q = 0.5 * P['rho'] * f['area'] * tip * tip
    return q * ct, q * f['radius'] * cq

def section_orig(f, al):
    STALL, FULL, CD90 = math.radians(15), math.radians(25), 1.2
    x = abs(al); clA = f['a'] / f['sigma'] * al; cdA = f['cd0'] + f['cdAlpha'] * al * al
    if x <= STALL: return clA, cdA
    clP = CD90 * math.sin(al) * math.cos(al); cdP = f['cd0'] + CD90 * math.sin(al) ** 2
    if x >= FULL: return clP, cdP
    g = (x - STALL) / (FULL - STALL); return clA + (clP - clA) * g, cdA + (cdP - cdA) * g

def blade(f, omega, uy, section=section_orig):
    d = D_; R = f['radius']; t = q = 0.0
    for k in range(4):
        r = (1 - d) / 2 * GX[k] + (1 + d) / 2; wr = (1 - d) / 2 * GW[k]
        ut = omega * R * r; w2 = ut * ut + uy * uy; phi = math.atan2(uy, ut); al = f['theta'] / r - phi
        cl, cd = section(f, al)
        k0 = 0.5 * P['rho'] * w2 * (math.pi * R * f['sigma'] / r) * R * wr
        t += k0 * (cl * math.cos(phi) - cd * math.sin(phi)); q += k0 * (cl * math.sin(phi) + cd * math.cos(phi)) * R * r
    return t, q

def loads(f, omega, uy, side=0.0, blade_fn=blade):
    tip = omega * f['radius']; along = abs(uy) / tip
    if along >= RFULL: return blade_fn(f, omega, uy)
    t, q = closed(f, tip, uy, side)
    if along <= RMAX: return t, q
    b = (along - RMAX) / (RFULL - RMAX); tb, qb = blade_fn(f, omega, uy)
    return t + (tb - t) * b, q + (qb - q) * b

def tc_curve(xs, V=25.0, f=P, blade_fn=blade):
    D = 2 * f['radius']; out = []
    for x in xs:
        n = x * V / D; T, Q = loads(f, n * 2 * math.pi, V, 0.0, blade_fn)
        out.append(T / (P['rho'] * V * V * D * D))
    return np.array(out)

if __name__ == '__main__':
    xs = [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
    print(' '.join(f'{x}:{v:.4f}' for x, v in zip(xs, tc_curve(xs))))
