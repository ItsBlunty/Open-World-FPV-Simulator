# Read a zip split into consecutive chunks (each a byte slice of one zip) over HTTP range requests:
#   splitzip.py list <assets.txt> <prefix>            -> entries (name, size)
#   splitzip.py get  <assets.txt> <prefix> <regex> <outdir>  -> extract matching entries
import re, struct, sys, os, zlib, urllib.request
mode, assets, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
chunks = [l.split() for l in open(assets) if l.startswith(prefix)]
chunks.sort(key=lambda c: c[0])
sizes = [int(c[1]) for c in chunks]; urls = [c[2] for c in chunks]
starts = [sum(sizes[:i]) for i in range(len(sizes))]; total = sum(sizes)
def rng(a, b):
    out = b''
    for i, (s, z) in enumerate(zip(starts, sizes)):
        lo, hi = max(a, s), min(b, s + z - 1)
        if lo > hi: continue
        req = urllib.request.Request(urls[i], headers={'Range': f'bytes={lo - s}-{hi - s}'})
        out += urllib.request.urlopen(req).read()
    return out
tail = rng(total - 66000, total - 1)
e = tail.rfind(b'PK\x05\x06')
n, cdsize, cdoff = struct.unpack('<HII', tail[e + 10:e + 20])
if cdoff == 0xFFFFFFFF or n == 0xFFFF:
    l = tail.rfind(b'PK\x06\x07'); z64 = struct.unpack('<Q', tail[l + 8:l + 16])[0]
    rec = rng(z64, z64 + 56 - 1)
    n = struct.unpack('<Q', rec[32:40])[0]; cdsize = struct.unpack('<Q', rec[40:48])[0]; cdoff = struct.unpack('<Q', rec[48:56])[0]
cd = rng(cdoff, cdoff + cdsize - 1)
entries = []; p = 0
while p < len(cd) and cd[p:p + 4] == b'PK\x01\x02':
    meth = struct.unpack('<H', cd[p + 10:p + 12])[0]; csz, usz = struct.unpack('<II', cd[p + 20:p + 28])
    fl, el, cl = struct.unpack('<HHH', cd[p + 28:p + 34]); off = struct.unpack('<I', cd[p + 42:p + 46])[0]
    name = cd[p + 46:p + 46 + fl].decode('utf8', 'replace'); extra = cd[p + 46 + fl:p + 46 + fl + el]
    q = 0; vals = []
    while q < len(extra) - 4:
        hid, hsz = struct.unpack('<HH', extra[q:q + 4])
        if hid == 1:
            data = extra[q + 4:q + 4 + hsz]; k = 0
            if usz == 0xFFFFFFFF: usz = struct.unpack('<Q', data[k:k + 8])[0]; k += 8
            if csz == 0xFFFFFFFF: csz = struct.unpack('<Q', data[k:k + 8])[0]; k += 8
            if off == 0xFFFFFFFF: off = struct.unpack('<Q', data[k:k + 8])[0]; k += 8
        q += 4 + hsz
    entries.append((name, meth, csz, usz, off)); p += 46 + fl + el + cl
if mode == 'list':
    for name, meth, csz, usz, off in entries: print(usz, csz, name)
else:
    pat = re.compile(sys.argv[4]); outdir = sys.argv[5]; os.makedirs(outdir, exist_ok=True)
    for name, meth, csz, usz, off in entries:
        if not pat.search(name): continue
        h = rng(off, off + 29); fl, el = struct.unpack('<HH', h[26:30])
        data = rng(off + 30 + fl + el, off + 30 + fl + el + csz - 1)
        if meth == 8: data = zlib.decompress(data, -15)
        open(os.path.join(outdir, os.path.basename(name)), 'wb').write(data); print('got', name, len(data))
