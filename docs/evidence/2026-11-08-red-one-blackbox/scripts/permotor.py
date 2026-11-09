import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
d=load(base,2); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
air=(d["cmd"].min(1)>0.05)&(t>3)
for F in (15,30,60):
    rpm=d["rpm"]; T=1.4e-8*rpm**2
    alpha=np.gradient(lp(d["gyro"],F,fs),dt,axis=0); Tf=lp(T,F,fs)
    X=np.concatenate([Tf[air]-Tf[air].mean(1,keepdims=True), np.ones((air.sum(),1))],1)
    for ax,name in enumerate(("roll","pitch","yaw")):
        y=alpha[air,ax]; c,*_=np.linalg.lstsq(X,y,rcond=None); r2=1-np.var(y-X@c)/np.var(y)
        print(f"F{F} {name:5s}: per-motor coef M1..M4 "+" ".join(f"{v:+7.2f}" for v in c[:4])+f"  r2 {r2:.3f}")
    # also: PID sum based check
z=np.load(f"{base}_log2.npz"); names=list(z["names"]); a=z["data"]
for ax in range(3):
    pidsum=sum(a[:,names.index(f"{k}[{ax}]")] for k in ("axisP","axisI","axisF") )+ (a[:,names.index(f"axisD[{ax}]")] if ax<2 else 0)
    print(f"axis {ax}: corr(pidsum, alpha30) {np.corrcoef(lp(pidsum,30,fs)[air], np.gradient(lp(d['gyro'],30,fs),dt,axis=0)[air,ax])[0,1]:+.3f}")
