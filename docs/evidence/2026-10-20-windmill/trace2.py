import sys, json
import numpy as np
from PIL import Image
cfg = json.load(open(sys.argv[1]))
d = np.asarray(Image.open(cfg['image']).convert('L')).astype(float) < cfg.get('thr', 140)
gy0, gdy = cfg['gridy']; gx0, gdx = cfg['gridx']
def isgrid(v, v0, dv, tol=2.5):
    k = round((v - v0) / dv); return abs(v - (v0 + k * dv)) <= tol
(x0px, x0), (x1px, x1) = cfg['xcal']; (y0px, y0), (y1px, y1) = cfg['ycal']
X = lambda px: x0 + (px - x0px) * (x1 - x0) / (x1px - x0px)
Y = lambda py: y0 + (py - y0px) * (y1 - y0) / (y1px - y0px)
out = {}
for name, (sx, sy, ex) in cfg['curves'].items():
    x, y, step, pts, slope = sx, sy, (-1 if ex < sx else 1), [], 0.0
    while (x - ex) * step < 0:
        if not isgrid(x, gx0, gdx):
            col = d[:, x]; pred = y + slope
            c = [r for r in range(int(pred) - 4, int(pred) + 5) if col[r] and not isgrid(r, gy0, gdy)]
            if c:
                r = min(c, key=lambda q: abs(q - pred)); lo = hi = r
                while col[lo - 1] and not isgrid(lo - 1, gy0, gdy): lo -= 1
                while col[hi + 1] and not isgrid(hi + 1, gy0, gdy): hi += 1
                ny = (lo + hi) / 2 if hi - lo < 10 else r
                if pts: slope = 0.7 * slope + 0.3 * (ny - y) / max(1, abs(x - pts[-1][0]))
                y = ny; pts.append((x, y))
            else:
                y = pred
        else:
            y = y + slope
        x += step
    out[name] = [(X(px), Y(py)) for px, py in pts]
    xs = np.array([p[0] for p in out[name]]); ys = np.array([p[1] for p in out[name]])
    o = np.argsort(xs)
    grid = [g for g in cfg['sample'] if xs.min() <= g <= xs.max()]
    print(name, ' '.join(f'{g:.2f}:{np.interp(g, xs[o], ys[o]):.4f}' for g in grid))
json.dump(out, open(cfg['out'], 'w'))
