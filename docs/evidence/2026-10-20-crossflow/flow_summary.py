# Summary of chop-flow.test.ts's output (flow.csv): each prop's airflow at a few moments and over the chop (4.15-7 s).
import sys, numpy as np
d = np.genfromtxt(sys.argv[1], delimiter=',', names=True)
for t0 in (4000, 4150, 4200, 4300, 4500, 4800, 5200, 6000, 6800):
    s = d[d['tick'] == t0]
    print(f'{t0/1000:.2f} s:', ' | '.join(f"m{int(r['i'])} ax {r['uy']:5.1f} side {np.hypot(r['ux'], r['uz']):4.1f} tip {r['tip']:5.1f} lc {r['uy']/r['tip']:5.2f} mu {np.hypot(r['ux'], r['uz'])/r['tip']:4.2f} T {r['T']:5.2f}" for r in s))
w = d[(d['tick'] >= 4150) & (d['tick'] < 7000)]
side = np.hypot(w['ux'], w['uz']); lc = w['uy'] / w['tip']; mu = side / w['tip']
print('chop 4.15-7 s: flow angle from the axis deg p5/50/95:', np.percentile(np.degrees(np.arctan2(side, w['uy'])), [5, 50, 95]).round(1))
print('  side m/s p5/50/95', np.percentile(side, [5, 50, 95]).round(1), '| mu p5/50/95', np.percentile(mu, [5, 50, 95]).round(2), '| lc p5/50/95', np.percentile(lc, [5, 50, 95]).round(2))
print('  share past the edge (lc >= 0.45, NACA path):', np.mean(lc >= 0.45).round(3), ' blended (0.3-0.45):', np.mean((lc > 0.3) & (lc < 0.45)).round(3))
e = w[(w['tick'] < 4700)]; se = np.hypot(e['ux'], e['uz'])
print('first 0.55 s (4.15-4.7 s): flow angle deg p5/50/95', np.percentile(np.degrees(np.arctan2(se, e['uy'])), [5, 50, 95]).round(1))
