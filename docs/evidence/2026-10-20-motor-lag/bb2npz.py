# decode a Betaflight blackbox log to npz (field names + rows): bb2npz.py in.BFL out.npz
import sys, numpy as np
from orangebox import Parser
p = Parser.load(sys.argv[1])
names = p.field_names
rows = [list(f.data) for f in p.frames()]
w = len(names)
num = lambda x: float(x) if isinstance(x, (int, float)) else float("nan")
a = np.array([[num(x) for x in r[:w]] + [np.nan] * (w - len(r)) for r in rows], dtype=np.float64)
np.savez_compressed(sys.argv[2], a=a, names=np.array(names))
print(len(names), names)
print(a.shape)
