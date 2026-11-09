import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
from scipy.signal import find_peaks
base=sys.argv[1]
def kT_of(rpm): return np.interp(rpm,[11000,13000,15000,17000,19000,21000,23000,25000,27000],[1.20e-8,1.20e-8,1.29e-8,1.37e-8,1.35e-8,1.43e-8,1.43e-8,1.44e-8,1.45e-8])
d=load(base,2); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
air=(d["cmd"].min(1)>0.05)&(t>3)
F=25
rpm=d["rpm"]; T=lp(kT_of(rpm)*rpm**2,F,fs); alpha=np.gradient(lp(d["gyro"],F,fs),dt,axis=0)
xs=[(T[:,2]+T[:,3])-(T[:,0]+T[:,1]),(T[:,0]+T[:,2])-(T[:,1]+T[:,3])]
for ax in (0,1):
    x=xs[ax]; y=alpha[:,ax]
    # peaks of |dT| (big commanded torque), separated by 150 ms
    pk,_=find_peaks(np.abs(x)*air, height=3.0, distance=int(.15*fs))
    ratios=[]
    for p in pk:
        # window +-15 ms, compare averages (alpha lags torque by ~0)
        w=slice(p-30,p+30)
        if np.sign(np.mean(x[w]))==0: continue
        ratios.append(np.mean(y[w])/np.mean(x[w]))
    ratios=np.array(ratios)
    print(f"{['roll','pitch'][ax]}: {len(pk)} torque peaks >3 N: alpha/dT median {np.median(ratios):.1f} (p25 {np.percentile(ratios,25):.1f}, p75 {np.percentile(ratios,75):.1f}) rad/s^2 per N")
    # top alpha peaks
    pk2,_=find_peaks(np.abs(y)*air, height=80, distance=int(.15*fs))
    r2=[y[p]/x[p] for p in pk2 if abs(x[p])>0.5]
    print(f"      {len(pk2)} accel peaks >80 rad/s^2: alpha/dT at the peak median {np.median(r2):.1f} (p25 {np.percentile(r2,25):.1f}, p75 {np.percentile(r2,75):.1f})")
