import sys, numpy as np
for li in (1,2):
    z = np.load(f"{sys.argv[1]}_log{li}.npz"); a = z["data"]; names = list(z["names"])
    c = lambda k: a[:, names.index(k)]
    t = (c("time")-c("time")[0])/1e6
    print(f"--- log {li}: {len(t)} rows, {t[-1]:.1f} s, mean dt {np.mean(np.diff(t))*1e6:.0f} us")
    print("names:", names[42:])
    for k in ["rcCommand[3]","vbatLatest","amperageLatest","motor[0]","motor[1]","motor[2]","motor[3]","eRPM[0]","eRPM[1]","eRPM[2]","eRPM[3]","gyroADC[0]","gyroADC[1]","gyroADC[2]","accSmooth[2]","debug[0]","debug[1]"]:
        v = c(k); print(f"{k:16s} min {np.nanmin(v):9.1f} p5 {np.nanpercentile(v,5):9.1f} med {np.nanmedian(v):9.1f} p95 {np.nanpercentile(v,95):9.1f} max {np.nanmax(v):9.1f}")
    # 1-second timeline of throttle and vbat
    sec = np.floor(t).astype(int)
    line = []
    for s in range(sec.max()+1):
        m = sec==s
        line.append(f"{s}:{np.mean(c('rcCommand[3]')[m]):.0f}/{np.mean(c('vbatLatest')[m])/100:.1f}V/{np.mean(c('amperageLatest')[m])/100:.0f}A")
    print(" ".join(line))
