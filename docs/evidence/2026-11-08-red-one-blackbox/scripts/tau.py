import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
from numpy.lib.stride_tricks import sliding_window_view as sw
base=sys.argv[1]
def ssmap(c, rpm, V, fs):
    win=int(0.06*fs); s=np.std(sw(c,win),axis=1); idx=np.where(s<0.01)[0]+win-1
    x=c[idx]; r=rpm[idx]/V[idx]
    bins=np.linspace(0.05,1.0,20); cen=[];val=[]
    for lo,hi in zip(bins[:-1],bins[1:]):
        m=(x>=lo)&(x<hi)
        if m.sum()>30: cen.append(np.median(x[m])); val.append(np.median(r[m]))
    cen=np.array(cen); val=np.array(val)
    # rpm/V as function of cmd, linear extrapolation at the ends
    def f(cc):
        out=np.interp(cc,cen,val)
        hi=cc>cen[-1]; sl=(val[-1]-val[-2])/(cen[-1]-cen[-2]); out[hi]=val[-1]+sl*(cc[hi]-cen[-1])
        lo=cc<cen[0]; sl0=(val[1]-val[0])/(cen[1]-cen[0]); out[lo]=val[0]+sl0*(cc[lo]-cen[0])
        return np.maximum(out,0)
    return f
def simlag(target, tu, td, dt, delay):
    n=len(target); y=np.empty(n); y[0]=target[0]
    tgt=np.concatenate([np.full(delay,target[0]),target[:n-delay]]) if delay>0 else target
    au=dt/tu; ad=dt/td
    for k in range(1,n):
        e=tgt[k]-y[k-1]; y[k]=y[k-1]+e*(au if e>0 else ad)
    return y
for li in (2,):
    d=load(base,li); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
    print(f"=== log {li}")
    for i in range(4):
        c=d["cmd"][:,i]; rpm=d["rpm"][:,i]; V=d["V"]
        f=ssmap(c,rpm,V,fs); target=f(c)*V
        # active segments only: where cmd changes fast
        dc=np.abs(np.gradient(lp(c,50,fs),dt))
        act=lp((dc>2.0).astype(float),5,fs)>0.05
        best=None
        for delay in (0,2,4,6,8,10,14):
            for tu in (0.006,0.008,0.01,0.012,0.014,0.016,0.018,0.02,0.022,0.025,0.03):
                for td in (0.008,0.01,0.012,0.014,0.016,0.018,0.02,0.022,0.025,0.03):
                    y=simlag(target,tu,td,dt,delay)
                    e=np.sqrt(np.mean((y[act]-rpm[act])**2))
                    if best is None or e<best[0]: best=(e,delay,tu,td)
        e,delay,tu,td=best
        # symmetric best
        bs=min(((np.sqrt(np.mean((simlag(target,tt,tt,dt,delay)[act]-rpm[act])**2)),tt) for tt in (0.008,0.012,0.016,0.02,0.025,0.03,0.035,0.04,0.05)))
        e0=np.sqrt(np.mean((target[act]-rpm[act])**2))
        print(f" M{i+1}: active {act.mean()*100:.0f}% of log; best delay {delay*dt*1000:.1f} ms, tau up {tu*1000:.0f} ms, tau down {td*1000:.0f} ms, rms {e:.0f} rpm (no lag: {e0:.0f}); same both ways: {bs[1]*1000:.0f} ms rms {bs[0]:.0f}")
