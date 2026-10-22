# Unsteady blade-element momentum model of the Nazgul prop, for the throttle chop's fast pass over the windmill band's hump
# (review F9, owner 2026-10-21: "try actually modeling it"). Offline study only; sim-core is untouched.
#
# Prop: sim-core's rotor inflow parameters for the Nazgul preset (../2026-10-20-windmill/inflow.json: blade angle theta_tip,
# solidity, lift slope a / sigma, c_d0, c_d,alpha), the blade of sim-core's bladeLoads: angle theta_tip / r, N_b c =
# pi R sigma / r, hub at r = 0.2. Section: the same polar as bladeLoads (linear below 15 deg, flat plate with c_d,90 1.2
# past 25 deg, blended between).
#
# Steady part: blade-element momentum in the wind-turbine frame (air entering from in front: the chop's windmill state),
# axial induction a per annulus, momentum thrust 4 a (1 - a) with Glauert's empirical branch past a = 0.4 (Buhl 2005, no
# tip loss), as ../2026-10-20-windmill/bem.py.
#
# Unsteady parts (OpenFAST AeroDyn theory pages, read 2026-10-21):
#  - dynamic inflow, Oye (DBEMT): W_int + tau1 dW_int/dt = W_qs + k tau1 dW_qs/dt, W + tau2 dW/dt = W_int, k = 0.6,
#    tau1 = 1.1 / (1 - 1.3 min(a_mean, 0.5)) R / U0, tau2 = (0.39 - 0.26 (r/R)^2) tau1; W the induced axial velocity a U0.
#  - dynamic stall, Oye (UAMod 6): df/dt = (f_st(alpha) - f) / T_f, T_f = T_f0 c / (2 W_rel), T_f0 = 6 (OpenFAST's note:
#    "usually chosen around 6"; 3 the default); f_st = min([2 sqrt(C_l / (C_l,alpha (alpha - alpha_0))) - 1]^2, 1) (0 where
#    that ratio is not positive), C_l,fs = (C_l - C_l,alpha (alpha - alpha_0) f_st) / (1 - f_st) (C_l / 2 where f_st = 1),
#    C_l,dyn = f C_l,alpha (alpha - alpha_0) + (1 - f) C_l,fs. alpha_0 = 0 (sim-core's c_l0 = 0). Drag stays steady.
#
# Library: steady(omega, V), and Rotor(...).step(omega, V, dt) for the unsteady model; thrust along the prop's push
# direction (negative = drag), torque against the rotation.
import json, math, os
import numpy as np

P = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '2026-10-20-windmill', 'inflow.json')))
RHO, R, SIG, TH = P['rho'], P['radius'], P['sigma'], P['theta']
CLA = P['a'] / SIG                     # section lift slope per rad (sim-core: a / sigma)
CD0, CDA = P['cd0'], P['cdAlpha']
STALL, FULL, CD90 = math.radians(15), math.radians(25), 1.2
HUB = 0.2
NST = 24
_e = np.linspace(HUB, 1.0, NST + 1)
RS = 0.5 * (_e[1:] + _e[:-1])          # station radii (r / R)
DR = (_e[1:] - _e[:-1]) * R            # station widths, m
NBC = math.pi * R * SIG / RS           # N_b c at each station, m
CHORD = NBC / 3                        # three blades
THS = TH / RS


def polar(al):
    """steady section c_l, c_d (sim-core bladeLoads)"""
    x = abs(al); clA = CLA * al; cdA = CD0 + CDA * al * al
    if x <= STALL: return clA, cdA
    clP = CD90 * math.sin(al) * math.cos(al); cdP = CD0 + CD90 * math.sin(al) ** 2
    if x >= FULL: return clP, cdP
    g = (x - STALL) / (FULL - STALL)
    return clA + (clP - clA) * g, cdA + (cdP - cdA) * g


def fst(al):
    """Oye separation function from the steady polar, and the fully separated c_l"""
    cl, _ = polar(al)
    inv = CLA * al
    if abs(inv) < 1e-9: return 1.0, cl / 2
    ratio = cl / inv
    f = 0.0 if ratio <= 0 else min((2 * math.sqrt(ratio) - 1) ** 2, 1.0)
    if ratio > 0 and 2 * math.sqrt(ratio) - 1 < 0: f = 0.0
    clfs = cl / 2 if f >= 1.0 else (cl - inv * f) / (1 - f)
    return f, clfs


def mom_ct(a):
    if a <= 0.4: return 4 * a * (1 - a)
    return 8 / 9 + (4 - 40 / 9) * a + (50 / 9 - 4) * a * a


def element(j, omega, V, w, f=None):
    """loads per unit span at station j with induced axial velocity w (turbine sense: the air slows by w); f: dynamic
    separation state (None: steady polar). Returns prop thrust per span, torque-force per span, alpha, W_rel."""
    ut = omega * R * RS[j]; ua = V - w
    w2 = ut * ut + ua * ua; phi = math.atan2(ua, ut); al = THS[j] - phi
    if f is None:
        cl, cd = polar(al)
    else:
        _, clfs = fst(al)
        cl = f * CLA * al + (1 - f) * clfs
        cd = polar(al)[1]
    k = 0.5 * RHO * w2 * NBC[j]
    return k * (cl * math.cos(phi) - cd * math.sin(phi)), k * (cl * math.sin(phi) + cd * math.cos(phi)), al, math.sqrt(w2)


def qs_induction(j, omega, V, f=None):
    """quasi-steady induced velocity at station j: blade thrust = momentum thrust, bisection on a"""
    def g(a):
        fn = element(j, omega, V, a * V, f)[0]
        return -fn - 2 * math.pi * RS[j] * R * 0.5 * RHO * V * V * mom_ct(a)
    lo, hi = -1.0, 0.95
    for _ in range(40):
        m = (lo + hi) / 2
        if g(m) > 0: lo = m
        else: hi = m
    return (lo + hi) / 2 * V


def steady(omega, V):
    """steady thrust (N, prop push direction) and torque (N m) at rotor speed omega (rad/s), axial airspeed V (m/s, from in front)"""
    t = q = 0.0
    for j in range(NST):
        w = qs_induction(j, omega, V)
        fn, fq, _, _ = element(j, omega, V, w)
        t += fn * DR[j]; q += fq * RS[j] * R * DR[j]
    return t, q


class Rotor:
    """the unsteady model; dyn_inflow / dyn_stall switch the two parts"""
    def __init__(self, omega, V, dyn_inflow=True, dyn_stall=True, tf0=6.0, k=0.6):
        self.di, self.ds, self.tf0, self.k = dyn_inflow, dyn_stall, tf0, k
        self.w = np.array([qs_induction(j, omega, V) for j in range(NST)])
        self.wint = self.w.copy(); self.wqs_prev = self.w.copy()
        self.f = np.array([fst(element(j, omega, V, self.w[j])[2])[0] for j in range(NST)])

    def step(self, omega, V, dt):
        wqs = np.array([qs_induction(j, omega, V) for j in range(NST)])
        if self.di:
            amean = float(np.mean(wqs)) / V if V > 0 else 0.0
            tau1 = 1.1 / (1 - 1.3 * min(max(amean, 0.0), 0.5)) * R / max(V, 1e-3)
            tau2 = (0.39 - 0.26 * RS ** 2) * tau1
            dqs = (wqs - self.wqs_prev) / dt
            self.wint += dt * (wqs + self.k * tau1 * dqs - self.wint) / tau1
            self.w += dt * (self.wint - self.w) / tau2
        else:
            self.w = wqs
        self.wqs_prev = wqs
        t = q = 0.0
        for j in range(NST):
            _, _, al, wrel = element(j, omega, V, self.w[j])
            if self.ds:
                tf = self.tf0 * CHORD[j] / (2 * wrel)
                self.f[j] += (fst(al)[0] - self.f[j]) * (1 - math.exp(-dt / tf))
                fn, fq, _, _ = element(j, omega, V, self.w[j], self.f[j])
            else:
                fn, fq, _, _ = element(j, omega, V, self.w[j])
            t += fn * DR[j]; q += fq * RS[j] * R * DR[j]
        return t, q
