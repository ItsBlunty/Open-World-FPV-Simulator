import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
for li in (1,2):
    d=load(base,li); t=d["t"]; fs=1/np.mean(np.diff(t))
    print(f"=== log {li}  fs {fs:.0f} Hz")
    # A. static map: rpm / (cmd*V) where command was steady for 60 ms
    cmdf=d["cmd"]; rpm=d["rpm"]; V=d["V"]
    win=int(0.06*fs)
    for i in range(4):
        c=cmdf[:,i]
        # steadiness: rolling std of cmd
        from numpy.lib.stride_tricks import sliding_window_view as sw
        s=np.std(sw(c,win),axis=1); idx=np.where(s<0.01)[0]+win-1
        x=c[idx]; y=rpm[idx,i]; v=V[idx]
        m=x>0.1
        k=y[m]/(x[m]*v[m])
        # linearity: fit rpm = a*cmd*V + b*V
        A=np.stack([x[m]*v[m], v[m]],1); coef,*_=np.linalg.lstsq(A,y[m],rcond=None)
        bins=[0.1,0.2,0.3,0.4,0.5,0.6,0.8,1.01]
        rows=[]
        for lo,hi in zip(bins[:-1],bins[1:]):
            mm=(x>=lo)&(x<hi)
            if mm.sum()>20: rows.append(f"{lo:.1f}-{hi:.1f}:{np.median(y[mm]/(x[mm]*v[mm])):.0f}(n{mm.sum()})")
        print(f" M{i+1} steady n={m.sum()} rpm/(cmd*V) median {np.median(k):.0f}  fit rpm={coef[0]:.0f}*cmd*V+{coef[1]:.0f}*V   by cmd: "+" ".join(rows))
