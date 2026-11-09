import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
for li in (1,2):
    d=load(base,li); t=d["t"]; dt=np.mean(np.diff(t)); fs=1/dt
    az=lp(d["acc"][:,2],5,fs); w2=lp((d["rpm"]**2).sum(1),5,fs)
    rate=np.linalg.norm(lp(d["gyro"],5,fs),axis=1)
    airborne=(d["cmd"].min(1)>0.05)&(t>2)
    print(f"=== log {li}")
    # hover-like: rotation small, az ~ 1g +-15%, steady
    hov=airborne&(rate<0.5)&(np.abs(az-G)<1.5)
    if hov.sum()>100:
        kT=np.sum(MASS*az[hov]*w2[hov])/np.sum(w2[hov]**2)
        print(f" hover-like samples {hov.sum()/fs:.1f} s: kT = {kT:.3e} N/rpm^2 per motor; mean rpm {np.sqrt(w2[hov]/4).mean():.0f}, cmd {d['cmd'][hov].mean():.3f}, thr stick {d['thr'][hov].mean():.0f}, V {d['V'][hov].mean():.2f}, I {d['I'][hov].mean():.1f} A")
        # 1g-hover rpm and command
        m=hov&(np.abs(az-G)<0.3)
        print(f"   exactly ~1g: rpm {np.sqrt(w2[m]/4).mean():.0f}, motor cmd {d['cmd'][m].mean():.3f}, V {d['V'][m].mean():.2f} -> cmd*V {np.mean(d['cmd'][m].mean(1)*d['V'][m]):.2f}, current {d['I'][m].mean():.1f} A, power {np.mean(d['I'][m]*d['V'][m]):.0f} W")
    if li==1: kT1=kT
    # full throttle: all four motors at high cmd
    ft=airborne&(d["cmd"].mean(1)>0.9)
    print(f" full-throttle samples: {ft.sum()/fs:.2f} s")
    azf=lp(d["acc"][:,2],20,fs)
    # find punches: contiguous runs of thr stick > 1900
    hi=d["thr"]>1850
    edges=np.flatnonzero(np.diff(hi.astype(int)))
    runs=[]; st=None
    for k in range(len(hi)):
        if hi[k] and st is None: st=k
        if (not hi[k]) and st is not None: runs.append((st,k)); st=None
    for a,b in runs:
        if (b-a)/fs<0.15: continue
        seg=slice(a,b)
        pk=np.argmax(azf[seg])+a
        rp=np.sqrt(w2[seg]/4)
        print(f"  punch t={t[a]:.2f}-{t[b]:.2f}s: peak az {azf[pk]/G:.2f} g at +{(pk-a)/fs*1000:.0f} ms; az at start+150ms {azf[min(a+int(.15*fs),b-1)]/G:.2f} g, end {azf[b-1]/G:.2f} g; rpm start {rp[0]:.0f} max {rp.max():.0f}; V min {d['V'][seg].min():.2f}; I max {d['I'][seg].max():.0f} A; static-k prediction at peak {kT1*w2[pk]/MASS/G:.2f} g")
