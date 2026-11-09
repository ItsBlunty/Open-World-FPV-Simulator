import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
def kT_of(rpm): return np.interp(rpm,[11000,13000,15000,17000,19000,21000,23000,25000,27000],[1.20e-8,1.20e-8,1.29e-8,1.37e-8,1.35e-8,1.43e-8,1.43e-8,1.44e-8,1.45e-8])
d=load(base,2); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
F=20
rpm=d["rpm"]; T=lp(kT_of(rpm)*rpm**2,F,fs); alpha=np.gradient(lp(d["gyro"],F,fs),dt,axis=0)
spd=np.gradient(lp(d["sp"]*np.pi/180,F,fs),dt,axis=0)
xs=[(T[:,2]+T[:,3])-(T[:,0]+T[:,1]),(T[:,0]+T[:,2])-(T[:,1]+T[:,3])]
air=(d["cmd"].min(1)>0.05)&(t>3)
for ax in (0,1):
    line=[]
    for lagms in (-20,-10,0,10,20,40):
        lag=int(lagms/1000*fs); z=np.roll(spd[:,ax],lag)
        line.append(f"{lagms:+d}ms:{np.cov(z[air],alpha[air,ax])[0,1]/np.cov(z[air],xs[ax][air])[0,1]:.1f}")
    # halves of the flight
    halves=[]
    for lo,hi in ((3,45),(45,88)):
        m=air&(t>=lo)&(t<hi); z=spd[:,ax]
        halves.append(f"{lo}-{hi}s:{np.cov(z[m],alpha[m,ax])[0,1]/np.cov(z[m],xs[ax][m])[0,1]:.1f}")
    print(f"{['roll','pitch'][ax]}: by instrument lag "+" ".join(line)+" | by half "+" ".join(halves))
