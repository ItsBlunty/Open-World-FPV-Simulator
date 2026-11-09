import sys, numpy as np
sys.path.insert(0, sys.argv[2]); from common import *
base=sys.argv[1]
for li in (1,2):
    d=load(base,li); r=d["rpm"]; t=d["t"]
    dr=np.abs(np.diff(r,axis=0))
    print(f"log{li}: rpm step per sample p50 {np.percentile(dr,50):.0f} p99 {np.percentile(dr,99):.0f} p99.9 {np.percentile(dr,99.9):.0f} max {dr.max():.0f}; steps>3000 rpm: {(dr>3000).sum(0)}")
    # rpm vs neighbours: spikes = sample differs from median of +-3 by > 3000
    from scipy.ndimage import median_filter
    med=median_filter(r,size=(7,1))
    print(f"   spikes (>2000 from local median) per motor: {(np.abs(r-med)>2000).sum(0)} of {len(r)}")
    # where log1 M2 fit failed: segments where rpm is far from map
    print("   motor 2 rpm and cmd first 4 s every 0.25 s:", " ".join(f"{t[k]:.2f}:{r[k,1]:.0f}/{d['cmd'][k,1]:.2f}" for k in range(0,int(4*1968),490)))
