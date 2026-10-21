# like bb2npz_multi.py but keeps the frames decoded before a corrupt or truncated tail
import sys, numpy as np
from orangebox import Parser
d = open(sys.argv[1], 'rb').read(); n = d.count(b'H Product:')
print('logs in file:', n)
num = lambda x: float(x) if isinstance(x, (int, float)) else float('nan')
for k in range(1, n + 1):
    try:
        p = Parser.load(sys.argv[1], k)
    except Exception as e:
        print(k, 'failed', e); continue
    names = p.field_names; w = len(names); rows = []
    try:
        for f in p.frames():
            rows.append([num(x) for x in f.data[:w]] + [np.nan] * (w - len(f.data)))
    except Exception as e:
        print(k, 'stopped at frame', len(rows), type(e).__name__)
    a = np.array(rows, dtype=np.float64)
    np.savez_compressed(f'{sys.argv[2]}_{k}.npz', a=a, names=np.array(names), headers=np.array([f'{h}:{v}' for h, v in p.headers.items()]))
    print(k, a.shape, 'span s', (np.nanmax(a[:, 1]) - np.nanmin(a[:, 1])) / 1e6 if a.size else 0)
