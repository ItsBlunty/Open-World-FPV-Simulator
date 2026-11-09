import sys, numpy as np
from orangebox import Parser
path, out = sys.argv[1], sys.argv[2]
p = Parser.load(path)
print("logs:", p.reader.log_count)
for li in range(1, p.reader.log_count+1):
    p.set_log_index(li)
    names = p.field_names; n = len(names)
    rows = []
    it = p.frames()
    while True:
        try: f = next(it)
        except StopIteration: break
        except Exception as e:
            print("log", li, "stopped at a damaged frame after", len(rows), "rows:", type(e).__name__); break
        d = list(f.data)[:n]
        if len(d) == n:
            rows.append([float(x) if x != "" else np.nan for x in d])
    a = np.array(rows)
    print(li, a.shape, "dur s", (a[-1,1]-a[0,1])/1e6)
    np.savez_compressed(f"{out}_log{li}.npz", data=a, names=np.array(names))
