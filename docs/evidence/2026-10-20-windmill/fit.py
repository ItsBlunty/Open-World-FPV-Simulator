import math, numpy as np
from propmodel import P, blade, tc_curve, section_orig
# NACA 464 fig 4/2, nacelle alone, blade angle 12 deg (zero thrust at nD/V 1.47): digitised (x<0.35 read from a zoomed crop, rest traced)
NX = np.array([0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4])
NT = np.array([-0.023, -0.025, -0.0287, -0.0313, -0.0359, -0.0401, -0.0441, -0.0473, -0.0490, -0.0490, -0.0485, -0.0444, -0.0368, -0.0260, -0.0128])
def viterna(stall_pos, stall_neg, cdmax=1.2):
    def sec(f, al):
        cla = f['a'] / f['sigma']
        s = stall_pos if al >= 0 else stall_neg
        if abs(al) <= s: return cla * al, f['cd0'] + f['cdAlpha'] * al * al
        a = abs(al); sg = 1 if al > 0 else -1
        cls = cla * s; cds = f['cd0'] + f['cdAlpha'] * s * s
        B1 = cdmax; A1 = B1 / 2
        A2 = (cls - cdmax * math.sin(s) * math.cos(s)) * math.sin(s) / math.cos(s) ** 2
        B2 = (cds - cdmax * math.sin(s) ** 2) / math.cos(s)
        aa = min(a, math.pi / 2)
        cl = A1 * math.sin(2 * aa) + A2 * math.cos(aa) ** 2 / math.sin(aa)
        cd = B1 * math.sin(aa) ** 2 + B2 * math.cos(aa)
        return sg * cl, cd
    return lambda f, om, uy: blade(f, om, uy, sec)
xs = list(NX[1:]) 
def score(bf):
    m = tc_curve([0.02] + xs, blade_fn=bf); r = m / m[0]; n = NT / NT[0]
    return r, float(np.sqrt(np.mean((r - n) ** 2)))
r0, e0 = score(lambda f, om, uy: blade(f, om, uy, section_orig))
print('original     rms', round(e0, 3), ' '.join(f'{v:.2f}' for v in r0))
print('NACA 12      ', ' '.join(f'{v:.2f}' for v in NT / NT[0]))
for sn in [2, 3, 4, 5, 6, 7, 8, 10, 12, 15]:
    r, e = score(viterna(math.radians(15), math.radians(sn)))
    print(f'stall- {sn:>2} deg rms {e:.3f}', ' '.join(f'{v:.2f}' for v in r))
