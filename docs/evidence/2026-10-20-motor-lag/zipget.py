# fetch one entry of a remote zip by HTTP range and inflate it: zipget.py url offset csize outfile
import struct, sys, urllib.request, zlib
url, off, csz, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
def rng(a, b):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}'})).read()
h = rng(off, off + 29)
fl, el = struct.unpack('<HH', h[26:30])
data = rng(off + 30 + fl + el, off + 30 + fl + el + csz - 1)
open(out, 'wb').write(zlib.decompress(data, -15))
