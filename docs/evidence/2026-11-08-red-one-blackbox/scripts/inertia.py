import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
def kT_of(rpm):  # measured thrust per rpm^2 by rpm (ct.py, log 2)
    return np.interp(rpm,[11000,13000,15000,17000,19000,21000,23000,25000,27000],[1.20e-8,1.20e-8,1.29e-8,1.37e-8,1.35e-8,1.43e-8,1.43e-8,1.44e-8,1.45e-8])
d=load(base,2); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
# battery: V = Voc(slow) - R I ; high-pass both at 0.5 Hz and regress
V=d["V"]; I=d["I"]
from scipy.signal import butter, filtfilt
b,a=butter(2,0.3/(fs/2),'high'); vh=filtfilt(b,a,V); ih=filtfilt(b,a,I)
air=(d["cmd"].min(1)>0.05)&(t>3)
R=-np.sum(vh[air]*ih[air])/np.sum(ih[air]**2)
print(f"pack resistance (6S, incl. wiring): {R*1000:.1f} mOhm = {R/6*1000:.1f} mOhm per cell; fresh rest V {np.median(V[t<1.5]):.2f}")
print(f"  -> at 100 A from a fresh pack: {np.median(V[t<1.5])-100*R:.2f} V")
for shift in (0,3,5,8):
    rpm=np.roll(d["rpm"],-shift,axis=0)
    T=kT_of(rpm)*rpm**2
    F=30
    alpha=np.gradient(lp(d["gyro"],F,fs),dt,axis=0)
    Tf=lp(T,F,fs)
    left=Tf[:,2]+Tf[:,3]; right=Tf[:,0]+Tf[:,1]; rear=Tf[:,0]+Tf[:,2]; front=Tf[:,1]+Tf[:,3]
    m=air.copy()
    out=[]
    for name,ax,x in (("roll",0,left-right),("pitch",1,rear-front)):
        y=alpha[m,ax]; X=np.stack([x[m],np.ones(m.sum())],1)
        c,*_=np.linalg.lstsq(X,y,rcond=None); pred=X@c; r2=1-np.var(y-pred)/np.var(y)
        out.append(f"{name}: alpha/dT {c[0]:+.1f} rad/s^2 per N (r2 {r2:.3f})")
    # yaw: torque = kappa * sum(s*T) + Jr * sum(s*domega) ; sign s: + for M2,M3 (props-in default: they spin CCW? fit decides)
    s=np.array([-1,1,1,-1])
    yT=(Tf*s).sum(1)
    om=lp(rpm,F,fs)*2*np.pi/60; dom=(np.gradient(om,dt,axis=0)*s).sum(1)
    y=alpha[m,2]; X=np.stack([yT[m],dom[m],np.ones(m.sum())],1)
    c,*_=np.linalg.lstsq(X,y,rcond=None); pred=X@c; r2=1-np.var(y-pred)/np.var(y)
    out.append(f"yaw: kappa/Iyaw {c[0]:+.2f}, Jr/Iyaw {c[1]:+.2e} (r2 {r2:.3f})")
    X1=X[:,[0,2]]; c1,*_=np.linalg.lstsq(X1,y,rcond=None); r21=1-np.var(y-X1@c1)/np.var(y)
    out.append(f"yaw thrust-only: kappa/Iyaw {c1[0]:+.2f} (r2 {r21:.3f})")
    print(f"rpm shifted {shift/fs*1000:.1f} ms earlier: "+" | ".join(out))
