import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
def kT_of(rpm): return np.interp(rpm,[11000,13000,15000,17000,19000,21000,23000,25000,27000],[1.20e-8,1.20e-8,1.29e-8,1.37e-8,1.35e-8,1.43e-8,1.43e-8,1.44e-8,1.45e-8])
d=load(base,2); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
air=(d["cmd"].min(1)>0.05)&(t>3)
for F in (10,20,40):
    rpm=d["rpm"]; T=lp(kT_of(rpm)*rpm**2,F,fs)
    alpha=np.gradient(lp(d["gyro"],F,fs),dt,axis=0)
    om=lp(rpm,F,fs)*2*np.pi/60; s=np.array([-1,1,1,-1])
    dom=(np.gradient(om,dt,axis=0)*s).sum(1)
    spd=np.gradient(lp(d["sp"]*np.pi/180,F,fs),dt,axis=0)  # setpoint acceleration (pilot)
    xs=[(T[:,2]+T[:,3])-(T[:,0]+T[:,1]),(T[:,0]+T[:,2])-(T[:,1]+T[:,3]),None]
    res=[]
    for ax in (0,1):
        best=None
        for lag in range(0,60,4):  # instrument: setpoint accel shifted later (response follows)
            z=np.roll(spd[:,ax],lag)
            cz=np.cov(z[air],xs[ax][air])[0,1]
            slope=np.cov(z[air],alpha[air,ax])[0,1]/cz
            corr=np.corrcoef(z[air],xs[ax][air])[0,1]
            if best is None or abs(corr)>abs(best[2]): best=(slope,lag,corr)
        res.append(f"{['roll','pitch'][ax]} IV {best[0]:.2f} rad/s^2 per N (instrument lag {best[1]/fs*1000:.0f} ms, strength {best[2]:.2f})")
    # yaw IV with 2 regressors, instruments: setpoint accel and its derivative
    z1=np.roll(spd[:,2],10); z2=np.gradient(lp(z1,F,fs),dt)
    Z=np.stack([z1[air],z2[air],np.ones(air.sum())],1); X=np.stack([( T*s).sum(1)[air],dom[air],np.ones(air.sum())],1)
    b=np.linalg.solve(Z.T@X, Z.T@alpha[air,2])
    res.append(f"yaw IV kappa/Iyaw {b[0]:.2f}, Jr/Iyaw {b[1]:.2e}")
    print(f"F{F}: "+" | ".join(res))
