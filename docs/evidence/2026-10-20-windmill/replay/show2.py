import numpy as np, sys
d = np.genfromtxt(sys.argv[1], delimiter=',', names=True)
for k in range(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])):
    r = d[k]
    print('%.3f thr %4.2f | rr %5.0f pr %5.0f | cmd %.2f %.2f %.2f %.2f | rpm %5.0f %5.0f %5.0f %5.0f | T %5.2f %5.2f %5.2f %5.2f' % (r['tick']/1000, (r['thr']+1)/2, r['rr'], r['pr'], r['c0'], r['c1'], r['c2'], r['c3'], r['r0'], r['r1'], r['r2'], r['r3'], r['T0'], r['T1'], r['T2'], r['T3']))
