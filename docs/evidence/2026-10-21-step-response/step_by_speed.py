# step_response.py's deconvolution on logs with GPS, windows split by their mean GPS speed: under 8 m/s, 8-16, over 16.
import sys, numpy as np
sys.argv, files = sys.argv[:1], sys.argv[1:]
exec(open(__file__.replace('step_by_speed.py', 'step_response.py')).read().split("if __name__ == '__main__':")[0])
def step_sel(sp, g, spd, lo, hi, win=2.0, fs=1000.0):
    n = int(win * fs); hop = n // 2; L = int(0.5 * fs); w = np.hanning(n); out = []
    for i in range(0, len(sp) - n, hop):
        v = np.nanmean(spd[i:i + n])
        if not (lo <= v < hi): continue
        s = sp[i:i + n]; y = g[i:i + n]
        if np.abs(s).max() < 50 or np.std(s) < 15: continue
        S = np.fft.rfft(s * w); Y = np.fft.rfft(y * w); eps = 1e-4 * np.max(np.abs(S))**2 + 1e-9
        h = np.fft.irfft(Y * np.conj(S) / (np.abs(S)**2 + eps), n); st = np.cumsum(h[:L]); ss = st[300:500].mean()
        if not np.isfinite(ss) or ss < 0.5 or ss > 2.0: continue
        out.append(st / ss)
    return np.array(out)
for fn in files:
    z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32
    n = list(z['names']); c = lambda k: a[:, n.index(k)]
    t = c('time') / 1e6; ok = np.isfinite(t) & np.concatenate([[True], np.diff(t) > 0]); t = t[ok]; tt = np.arange(t[0], t[-1], 0.001)
    gs = c('GPS_speed')[ok] / 100; gok = np.isfinite(gs); spd = np.interp(tt, t[gok], gs[gok])
    for lo, hi in ((0, 8), (8, 16), (16, 99)):
        res = []
        for ax, k in (('roll', 0), ('pitch', 1)):
            sp = np.interp(tt, t, c(f'setpoint[{k}]')[ok]); g = np.interp(tt, t, c(f'gyroADC[{k}]')[ok])
            r = step_sel(sp, g, spd, lo, hi)
            if len(r) < 3: res.append(f'{ax}: {len(r)} windows'); continue
            m, t50, t90, pk, tp = metrics(r)
            res.append(f'{ax}: n {len(r):3d}, 50 % {t50:3d} ms, 90 % {t90:3d} ms, peak {pk:.2f} at {tp:3d} ms')
        print(f"{fn.split('/')[-1][:20]:20s} GPS {lo:2d}-{hi:2d} m/s | " + ' | '.join(res))
