# Step response of roll and pitch from setpoint and gyro, by deconvolution as PID-Analyzer (Plasmatree, GPL-3.0) and
# PIDtoolbox do: 2 s windows (Hann, 50 % overlap) with enough stick, H = FFT(gyro) conj(FFT(sp)) / (|FFT(sp)|^2 + eps),
# impulse response = IFFT(H), step response = cumulative sum over the first 500 ms; windows averaged, each normalised
# by its own steady value (300-500 ms). Data resampled to 1 kHz. Reports the 50 % time (latency), the 90 % time, the
# peak and its time, per axis. Usage: step_response.py file.npz [file2 ...]  (fields time, setpoint[0/1], gyroADC[0/1])
import sys, numpy as np
def step(t, sp, g, win=2.0, fs=1000.0):
    n = int(win * fs); hop = n // 2; L = int(0.5 * fs)
    w = np.hanning(n); out = []
    for i in range(0, len(sp) - n, hop):
        s = sp[i:i + n]; y = g[i:i + n]
        if np.abs(s).max() < 50 or np.std(s) < 15: continue
        S = np.fft.rfft(s * w); Y = np.fft.rfft(y * w)
        eps = 1e-4 * np.max(np.abs(S))**2 + 1e-9
        h = np.fft.irfft(Y * np.conj(S) / (np.abs(S)**2 + eps), n)
        st = np.cumsum(h[:L]); ss = st[300:500].mean()
        if not np.isfinite(ss) or ss < 0.5 or ss > 2.0: continue
        out.append(st / ss)
    return np.array(out)
def metrics(r):
    m = r.mean(0); t = np.arange(len(m))
    t50 = t[np.argmax(m >= 0.5)]; t90 = t[np.argmax(m >= 0.9)]; pk = m[:300].max(); tp = t[np.argmax(m[:300])]
    return m, t50, t90, pk, tp
if __name__ == '__main__':
    for fn in sys.argv[1:]:
        z = np.load(fn); a = z['a'].copy(); a[a > 2**31] -= 2**32
        n = list(z['names']); c = lambda k: a[:, n.index(k)]
        h = dict(x.split(':', 1) for x in z['headers'])
        t = c('time') / 1e6; ok = np.isfinite(t) & np.concatenate([[True], np.diff(t) > 0]); t = t[ok]
        tt = np.arange(t[0], t[-1], 0.001)
        res = []
        for ax, k in (('roll', 0), ('pitch', 1)):
            sp = np.interp(tt, t, c(f'setpoint[{k}]')[ok]); g = np.interp(tt, t, c(f'gyroADC[{k}]')[ok])
            r = step(tt, sp, g)
            if len(r) == 0: res.append(f'{ax}: no windows'); continue
            m, t50, t90, pk, tp = metrics(r)
            res.append(f'{ax}: n {len(r):3d}, 50 % at {t50:3d} ms, 90 % at {t90:3d} ms, peak {pk:.2f} at {tp:3d} ms')
            np.save(fn.replace('.npz', f'_step_{ax}.npy'), m)
        print(f"{fn.split('/')[-1][:44]:44s} {h.get('Craft name','')[:14]:14s} PID {h.get('rollPID','')}/{h.get('pitchPID','')} | " + ' | '.join(res))
