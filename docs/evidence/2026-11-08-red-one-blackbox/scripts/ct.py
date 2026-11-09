import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
for li in (1,2):
    d=load(base,li); t=d["t"]; fs=1/np.mean(np.diff(t))
    az=lp(d["acc"][:,2],10,fs); w2=lp((d["rpm"]**2).sum(1),10,fs)
    rate=np.linalg.norm(lp(d["gyro"],10,fs),axis=1)
    air=(d["cmd"].min(1)>0.05)&(t>2)&(rate<3)
    rpm=np.sqrt(w2/4)
    print(f"=== log {li}: thrust per motor / rpm^2 (from accel x mass), rotation < 3 rad/s")
    for lo in range(6000,32000,2000):
        m=air&(rpm>=lo)&(rpm<lo+2000)
        if m.sum()>200:
            k=MASS*az[m]/w2[m]
            print(f"  rpm {lo:5d}-{lo+2000:5d}: n {m.sum()/fs:5.1f} s  kT median {np.median(k):.3e}  (p25 {np.percentile(k,25):.2e} p75 {np.percentile(k,75):.2e})  az median {np.median(az[m])/G:.2f} g")
    # high stick runs
    hi=d["thr"]>1700; st=None
    for k in range(len(hi)):
        if hi[k] and st is None: st=k
        if (not hi[k]) and st is not None:
            if (k-st)/fs>0.1:
                seg=slice(st,k); azf=lp(d["acc"][:,2],20,fs)
                print(f"  stick>1700 t={t[st]:.2f}+{(k-st)/fs:.2f}s: stick max {d['thr'][seg].max():.0f}, mean cmd max {d['cmd'][seg].mean(1).max():.2f}, peak az {azf[seg].max()/G:.2f} g, rpm max {rpm[seg].max():.0f}, V min {d['V'][seg].min():.2f}, I max {d['I'][seg].max():.0f}")
            st=None
