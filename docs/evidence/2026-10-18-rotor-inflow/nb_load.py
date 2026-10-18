# Load NeuroBEM processed_data (from the zip, no extraction), every 4th row (100 Hz), into one npz. Prints a summary only.
import zipfile, io, numpy as np, sys
Z = sys.argv[1]
z = zipfile.ZipFile(Z)
rows = []; files = 0
for n in z.namelist():
    if not n.endswith('.csv'): continue
    with z.open(n) as f:
        a = np.loadtxt(io.TextIOWrapper(f), delimiter=',', skiprows=1)[::4]
    seg = np.full((a.shape[0], 1), files, float)
    rows.append(np.hstack([a, seg])); files += 1
d = np.vstack(rows)
np.savez_compressed('nb100.npz', d=d)
print('files', files, 'rows', d.shape)
