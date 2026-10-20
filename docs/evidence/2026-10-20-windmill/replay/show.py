import numpy as np, sys
d = np.genfromtxt(sys.argv[1], delimiter=',', names=True)
print('  t    thr |  spd pitch |  rr   pr | cmd0 cmd1 cmd2 cmd3 | rpm0  rpm1  rpm2  rpm3 | T0    T1    T2    T3  |  iP')
for k in range(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])):
    r = d[k]
    print('%.2f %4.2f | %4.1f %5.0f | %4.0f %4.0f | %.2f %.2f %.2f %.2f | %5.0f %5.0f %5.0f %5.0f | %5.2f %5.2f %5.2f %5.2f | %4.0f' % (r['tick']/1000, (r['thr']+1)/2, r['spd'], r['pitch'], r['rr'], r['pr'], r['c0'], r['c1'], r['c2'], r['c3'], r['r0'], r['r1'], r['r2'], r['r3'], r['T0'], r['T1'], r['T2'], r['T3'], r['iP']))
