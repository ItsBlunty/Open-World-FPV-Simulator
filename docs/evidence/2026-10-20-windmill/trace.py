import sys, json
import numpy as np
from PIL import Image
def load(path):
    a = np.asarray(Image.open(path).convert('L')).astype(float)
    return a < 140
def gridlines(d, axis, frac=9):
    # rows (axis=1) or columns (axis=0) dark across most of the plot
    m = d.mean(axis=axis)
    return set(np.where(m > frac)[0])
def trace(d, seed, x_end, step=-1, win=5, grid_rows=(), grid_cols=()):
    x, y = seed
    pts = []
    while (x - x_end) * step < 0:
        col = d[:, x]
        cands = [yy for yy in range(int(y) - win, int(y) + win + 1) if 0 <= yy < d.shape[0] and col[yy] and yy not in grid_rows]
        if cands and x not in grid_cols:
            # nearest run centre
            y = min(cands, key=lambda c: abs(c - y))
            # centre of the dark run around y
            lo = y
            while lo - 1 >= 0 and col[lo - 1]: lo -= 1
            hi = y
            while hi + 1 < d.shape[0] and col[hi + 1]: hi += 1
            if hi - lo < 8: y = (lo + hi) / 2
            pts.append((x, y))
        x += step
    return pts
if __name__ == '__main__':
    cfg = json.load(open(sys.argv[1]))
    d = load(cfg['image'])
    gr = gridlines(d, 1); gc = gridlines(d, 0)
    (x0px, x0), (x1px, x1) = cfg['xcal']; (y0px, y0), (y1px, y1) = cfg['ycal']
    X = lambda px: x0 + (px - x0px) * (x1 - x0) / (x1px - x0px)
    Y = lambda py: y0 + (py - y0px) * (y1 - y0) / (y1px - y0px)
    out = {}
    for name, (sx, sy, ex) in cfg['curves'].items():
        pts = trace(d, (sx, sy), ex, step=-1 if ex < sx else 1, grid_rows=gr, grid_cols=gc)
        out[name] = [(round(X(px), 3), round(Y(py), 4)) for px, py in pts]
        # print samples
        s = {}
        for xv, yv in out[name]:
            k = round(xv * 10) / 10
            if abs(xv - k) < 0.004 and k not in s: s[k] = yv
        print(name, ' '.join(f'{k:.1f}:{v:.4f}' for k, v in sorted(s.items())))
    json.dump(out, open(cfg['out'], 'w'))
