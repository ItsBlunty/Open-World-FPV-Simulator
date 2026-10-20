# Blade angle of the rotor inflow model (sim-core params.ts inflowOf) against measured 5-inch props in axial flow
# (UIUC Propeller Database, volume 2: J sweeps at several rpm, static sweeps, blade geometry).
# The model: Gill and D'Andrea 2019 eq. 27 with c_l0 = 0, delta = 0.2, theta_tip = k P / (2 pi R) (their eq. 82 has
# k = 1.25), the lift slope x solidity `a` set from the static thrust at that rpm (their eq. 87), momentum theory for the
# induced inflow. For each prop: the measured zero-thrust advance ratio against its pitch, and the k that fits its
# CT(J) curves best. Usage: python -P prop_fit.py <folder with the UIUC .txt files>
import sys, os, math
import numpy as np

D = sys.argv[1]
DELTA = 0.2
# name prefix of the J sweeps, static file, geometry file, blades, diameter in inches
PROPS = [
    ('mit_5x4', 'mit_5x4_static_0362rd', 'mit_5x4_geom', 3),
    ('da4052_5x3.75_3b', 'da4052_5x3.75_3b_static_1204ga', 'da4052_5x3.75_geom', 3),
    ('da4022_5x3.75_3b', 'da4022_5x3.75_3b_static_0690md', 'da4022_5x3.75_geom', 3),
    ('gwsdd_5x4.3', 'gwsdd_5x4.3_static_0493rd', 'gwsdd_5x4.3_geom', 2),
    ('mi_5x3.5', 'mi_5x3.5_static_0368rd', 'mi_5x3.5_geom', 2),
    ('gwsdd_5x3', 'gwsdd_5x3_static_0323rd', 'gwsdd_5x3_geom', 2),
]


def load(name):
    return np.loadtxt(os.path.join(D, name + '.txt'), skiprows=1)


def pitch_over_d(geom):
    """Mean geometric pitch over the diameter (Gill and D'Andrea eq. 79 over the measured stations) and at 0.75 R."""
    g = load(geom)
    r, beta = g[:, 0], np.radians(g[:, 2])
    # P = int 2 pi R r tan(beta) dr over 0..1; P/D = pi int r tan(beta) dr
    mean = math.pi * np.trapezoid(r * np.tan(beta), r) / (r[-1] - r[0]) * 1.0
    at75 = math.pi * 0.75 * math.tan(np.interp(0.75, r, beta))
    return mean, at75


def model_ct(J, ct_static_uiuc, k, pd):
    """Model CT (UIUC normalisation, T / (rho n^2 D^4)) at advance ratios J for blade angle factor k."""
    # Gill's C_T = T / (1/2 rho pi R^2 (Omega R)^2) = CT_uiuc * 8 / pi^3; lambda_c = V / (Omega R) = J / pi
    to_g = 8 / math.pi ** 3
    theta = k * pd / math.pi  # k P / (2 pi R) with P / (2 R) = pd
    ct0 = ct_static_uiuc * to_g
    li0 = math.sqrt(ct0 / 4)
    ad = ct0 / (theta - li0)  # a (1 - delta)
    lc = np.asarray(J) / math.pi
    b = 4 * lc + ad
    li = (-b + np.sqrt(b * b + 16 * ad * (theta - lc))) / 8
    return ad * (theta - lc - li) / to_g


def sigma_eq(geom, nb):
    """Solidity of the model's chord c_tip / r that has the measured blade's thrust-weighted chord: int c r^2 dr."""
    g = load(geom)
    r, c = g[:, 0], g[:, 1]
    m = r >= DELTA
    ctip = np.trapezoid(c[m] * r[m] ** 2, r[m]) / ((1 - DELTA ** 2) / 2)
    return nb * ctip / math.pi


def model_cp(J, ct_static, cp_static, k, pd, sigma, cd0=0.05):
    """Model CP (UIUC normalisation) from Gill and D'Andrea eq. 37-38 (c_l0 = 0, mu = 0), c_d,alpha from the static torque."""
    to_g, to_gq = 8 / math.pi ** 3, 8 / math.pi ** 4
    theta = k * pd / math.pi
    ct0 = ct_static * to_g
    li0 = math.sqrt(ct0 / 4)
    ad = ct0 / (theta - li0)
    cq0 = cp_static * to_gq
    prof0 = (1 - DELTA) * sigma * cd0 * (1 + DELTA + DELTA ** 2) / 3
    cda = (cq0 - ct0 * li0 - prof0) / ((1 - DELTA) * sigma * (li0 - theta) ** 2)
    lc = np.asarray(J) / math.pi
    b = 4 * lc + ad
    li = (-b + np.sqrt(b * b + 16 * ad * (theta - lc))) / 8
    lam = lc + li
    cq = ad * lam * (theta - lam) + prof0 + (1 - DELTA) * sigma * cda * (lam - theta) ** 2
    return cq / to_gq, cda


out = []
allk = []
KFIT = 1.03
kappas = []
for pre, stat, geom, nb in PROPS:
    mean_pd, pd75 = pitch_over_d(geom)
    pd_name = float(pre.split('x')[1].split('_')[0]) / 5.0
    st = load(stat)
    files = sorted(f[:-4] for f in os.listdir(D) if f.startswith(pre + '_') and 'static' not in f and 'geom' not in f and f[len(pre) + 1].isdigit())
    j0s, best = [], []
    for f in files:
        d = load(f)
        rpm = float(f.split('_')[-1])
        J, CT = d[:, 0], d[:, 1]
        cts = float(np.interp(rpm, st[:, 0], st[:, 1]))
        # zero-thrust J (linear between the bracketing points)
        s = np.where((CT[:-1] > 0) & (CT[1:] <= 0))[0]
        j0 = float(J[s[0]] - CT[s[0]] * (J[s[0] + 1] - J[s[0]]) / (CT[s[0] + 1] - CT[s[0]])) if len(s) else float('nan')
        j0s.append(j0)
        ks = np.linspace(0.7, 1.5, 161)
        errs = [float(np.sqrt(np.mean((model_ct(J, cts, k, pd_name) - CT) ** 2))) / cts for k in ks]
        kb = float(ks[int(np.argmin(errs))])
        e125 = float(np.sqrt(np.mean((model_ct(J, cts, 1.25, pd_name) - CT) ** 2))) / cts
        best.append((rpm, kb, min(errs), e125, j0, float(J.max())))
    sig = sigma_eq(geom, nb)
    # torque / thrust at rest over the diameter: kappa / D = CP / (2 pi CT)
    kd = float(np.median(st[:, 2] / (2 * math.pi * st[:, 1])))
    cps = []
    for f in files:
        d = load(f)
        rpm = float(f.split('_')[-1])
        cts = float(np.interp(rpm, st[:, 0], st[:, 1])); cpst = float(np.interp(rpm, st[:, 0], st[:, 2]))
        pred, cda = model_cp(d[:, 0], cts, cpst, KFIT, pd_name, sig)
        cps.append((rpm, float(np.sqrt(np.mean((pred - d[:, 2]) ** 2))) / cpst, cda))
    if pre != 'mi_5x3.5':  # its name's pitch is not its blade's (geometry: P/D 0.40)
        allk += [b[1] for b in best]
        if nb == 3: kappas.append(kd)
    out.append(f'{pre}: {nb} blades, P/D by name {pd_name:.3f}, geometric mean {mean_pd:.3f}, at 0.75 R {pd75:.3f}; solidity {sig:.3f}; static torque / thrust = {kd:.4f} x D')
    for rpm, e, cda in cps:
        out.append(f'   {rpm:5.0f} rpm torque (eq. 37-38, k {KFIT}, c_d0 0.05): c_d,alpha {cda:.2f}, CP rms error {e * 100:.1f} % of static')
    for rpm, kb, eb, e125, j0, jmax in best:
        z = f'zero thrust at J {j0:.3f} = {j0 / pd_name:.2f} x P/D' if not math.isnan(j0) else f'thrust still positive at J max {jmax:.3f} ({jmax / pd_name:.2f} x P/D)'
        out.append(f'   {rpm:5.0f} rpm: {z}; best k {kb:.3f} (rms error {eb * 100:.1f} % of static), k = 1.25: {e125 * 100:.1f} %')
out.append(f'best k over all sweeps (mi_5x3.5 left out): median {np.median(allk):.3f}, mean {np.mean(allk):.3f}, range {min(allk):.3f}-{max(allk):.3f}')
out.append(f'3-blade static torque / thrust: {", ".join(f"{k:.4f}" for k in kappas)} x D; mean {np.mean(kappas):.4f} x D')
print('\n'.join(out))
