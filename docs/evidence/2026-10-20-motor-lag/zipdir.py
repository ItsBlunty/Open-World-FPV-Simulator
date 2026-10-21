# list a remote zip's entries via HTTP range requests (reads only the central directory)
import struct, sys, urllib.request
url = sys.argv[1]
def rng(a, b):
    r = urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}'})
    return urllib.request.urlopen(r).read()
size = int(urllib.request.urlopen(urllib.request.Request(url, method='HEAD')).headers['Content-Length'])
tail = rng(size - 65536, size - 1)
i = tail.rfind(b'PK\x05\x06')
_, _, _, _, n, cdsize, cdoff, _ = struct.unpack('<IHHHHIIH', tail[i:i + 22])
if cdoff == 0xFFFFFFFF or n == 0xFFFF:
    j = tail.rfind(b'PK\x06\x06'); n = struct.unpack('<Q', tail[j+32:j+40])[0]; cdsize = struct.unpack('<Q', tail[j+40:j+48])[0]; cdoff = struct.unpack('<Q', tail[j+48:j+56])[0]
cd = rng(cdoff, cdoff + cdsize - 1)
p = 0
while p < len(cd) and cd[p:p+4] == b'PK\x01\x02':
    meth, = struct.unpack('<H', cd[p+10:p+12]); csz, usz = struct.unpack('<II', cd[p+20:p+28])
    fl, el, cl = struct.unpack('<HHH', cd[p+28:p+34]); off, = struct.unpack('<I', cd[p+42:p+46])
    name = cd[p+46:p+46+fl].decode()
    print(f'{off}\t{csz}\t{usz}\t{meth}\t{name}')
    p += 46 + fl + el + cl
