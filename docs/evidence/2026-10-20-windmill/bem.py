import math, numpy as np
from propmodel import P, closed, tc_curve
from fit import NX, NT, viterna
D_ = 0.2
GX = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526]
GW = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]

def make_sec(stall_pos, stall_neg, cdmax=1.2):
    def sec(f, al):
        cla = f['a'] / f['sigma']; s = stall_pos if al >= 0 else stall_neg
        if abs(al) <= s: return cla * al, f['cd0'] + f['cdAlpha'] * al * al
        a = min(abs(al), math.pi / 2); sg = 1 if al > 0 else -1
        cls = cla * s; cds = f['cd0'] + f['cdAlpha'] * s * s
        A1 = cdmax / 2; A2 = (cls - cdmax * math.sin(s) * math.cos(s)) * math.sin(s) / math.cos(s) ** 2
        B2 = (cds - cdmax * math.sin(s) ** 2) / math.cos(s)
        return sg * (A1 * math.sin(2 * a) + A2 * math.cos(a) ** 2 / math.sin(a)), cdmax * math.sin(a) ** 2 + B2 * math.cos(a)
    return sec

def mom_ct(a):
    # local turbine thrust coefficient from momentum, Glauert's empirical branch (Buhl 2005 form, F = 1) past a = 0.4
    if a <= 0.4: return 4 * a * (1 - a)
    return 8 / 9 + (4 - 40 / 9) * a + (50 / 9 - 4) * a * a

def bem_blade(f, omega, V, sec, steps=40):
    # V > 0: airflow through the disc in the propeller's forward direction; turbine-frame induction a, Ua = V (1 - a)
    R = f['radius']; d = D_; t = q = 0.0
    for k in range(4):
        r = (1 - d) / 2 * GX[k] + (1 + d) / 2; wr = (1 - d) / 2 * GW[k]
        ut = omega * R * r; th = f['theta'] / r
        chordN = math.pi * R * f['sigma'] / r          # N_b c
        def be(a):
            ua = V * (1 - a); w2 = ut * ut + ua * ua; phi = math.atan2(ua, ut); cl, cd = sec(f, th - phi)
            fn = 0.5 * P['rho'] * w2 * chordN * (cl * math.cos(phi) - cd * math.sin(phi))   # prop thrust per unit span
            fq = 0.5 * P['rho'] * w2 * chordN * (cl * math.sin(phi) + cd * math.cos(phi))   # drag-torque force per unit span
            return fn, fq
        def g(a):
            fn, _ = be(a)
            # turbine thrust per unit span from blades (-fn) minus momentum (2 pi r R) rho V^2 CT(a)
            return -fn - 2 * math.pi * r * R * 0.5 * P['rho'] * V * V * mom_ct(a)
        lo, hi = -1.0, 0.95
        for _ in range(steps):
            m = (lo + hi) / 2
            if g(m) > 0: lo = m
            else: hi = m
        fn, fq = be((lo + hi) / 2)
        t += fn * R * wr; q += fq * R * r * R * wr
    return t, q

def curve(xs, sec, V=25.0):
    D = 2 * P['radius']; out = []
    for x in xs:
        n = x * V / D; T, Q = bem_blade(P, n * 2 * math.pi, V, sec)
        out.append(T / (P['rho'] * V * V * D * D))
    return np.array(out)

if __name__ == '__main__':
    xs = [0.02] + list(NX[1:])
    n = NT / NT[0]
    print('NACA 12   ', ' '.join(f'{v:.2f}' for v in n))
    for sn in [5, 8, 10, 12, 15, 20]:
        m = curve(xs, make_sec(math.radians(15), math.radians(sn)))
        r = m / m[0]
        print(f'BEM st-{sn:>2} rms {np.sqrt(np.mean((r - n) ** 2)):.3f} locked {m[0]:.4f} zero~', ' '.join(f'{v:.2f}' for v in r))
