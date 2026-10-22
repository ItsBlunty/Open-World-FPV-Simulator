# Fast passes over the windmill band's hump at the rates the sim's chop shows (../2026-10-21-esc-delay/trace-*.txt):
# rotor speed ramped linearly between two speeds at a fixed axial airspeed, then held. Thrust from the unsteady model
# (dynamic inflow + dynamic stall), each part alone, and quasi-steady (the steady model at each instant, as the sim does).
# Reports the largest gap to quasi-steady, the time shift that best lines the unsteady thrust up with quasi-steady, and
# the thrust every 2 ms.
import math, numpy as np
from ubem import Rotor, steady
DT = 2e-5
CASES = [  # name, V m/s, rpm from, rpm to, ramp ms
    ('climb chop 21 m/s, up over the hump in 20 ms', 21.0, 6400, 13600, 20),
    ('owner chop 37 m/s, up in 10 ms', 37.0, 14000, 21600, 10),
    ('owner chop 37 m/s, up in 5 ms', 37.0, 14000, 21600, 5),
    ('owner chop 37 m/s, down in 10 ms', 37.0, 21600, 14000, 10),
]
for name, V, r0, r1, ramp in CASES:
    T_END = (ramp + 15) / 1000; n = int(T_END / DT)
    om = lambda t: (r0 + (r1 - r0) * min(max((t - 0.005) / (ramp / 1000), 0), 1)) * math.pi / 30
    models = {'full': Rotor(om(0), V), 'inflow only': Rotor(om(0), V, dyn_stall=False), 'stall only': Rotor(om(0), V, dyn_inflow=False)}
    tr = {k: [] for k in models}; qs = []; ts = []
    for i in range(n):
        t = (i + 1) * DT
        for k, m in models.items(): tr[k].append(m.step(om(t), V, DT)[0])
        if i % 50 == 49: qs.append(steady(om(t), V)[0]); ts.append(t)
    idx = np.arange(49, n, 50)
    print(f'== {name}: steady thrust {steady(om(0), V)[0]:+.2f} N -> {steady(om(1), V)[0]:+.2f} N')
    q = np.array(qs)
    for k in models:
        u = np.array(tr[k])[idx]
        lag = min(range(0, 8), key=lambda s: np.mean((u[s:] - q[:len(q) - s]) ** 2)) * 1.0
        print(f'   {k:12s}: largest gap to quasi-steady {np.max(np.abs(u - q)):.2f} N (of a {abs(q[-1] - q[0]):.2f} N change); best time shift {lag:.0f} ms')
    print('   t ms | quasi-steady | full | inflow only | stall only')
    for j in range(1, len(ts), 2):
        print(f'   {ts[j] * 1000:4.0f} | {q[j]:+6.2f} | ' + ' | '.join(f'{np.array(tr[k])[idx][j]:+6.2f}' for k in models))
