import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
d=load(base,2); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
air=(d["cmd"].min(1)>0.05)&(t>3)
F=40
alpha=np.gradient(lp(d["gyro"],F,fs),dt,axis=0)
for src in ("rpm","cmd"):
    v=d["rpm"]**2 if src=="rpm" else d["cmd"]**2
    v=lp(v,F,fs)
    xs=[(v[:,2]+v[:,3])-(v[:,0]+v[:,1]),(v[:,0]+v[:,2])-(v[:,1]+v[:,3]),(v[:,1]+v[:,2])-(v[:,0]+v[:,3])]
    for ax in range(3):
        best=[]
        for lag in range(-80,81,2):  # samples; positive: alpha later than x
            x=np.roll(xs[ax],lag)
            c=np.corrcoef(x[air],alpha[air,ax])[0,1]; best.append((c,lag))
        c,lag=max(best)
        print(f"{src} axis {ax}: best corr {c:.3f} with alpha {lag/fs*1000:+.1f} ms after; corr at 0: {[b for b in best if b[1]==0][0][0]:.3f}")
