# Connect to the SITL's UART1 (TCP 5761), enter the CLI and print the answers to the given commands.
import socket, sys, time
cmds = sys.argv[1:] or ['status', 'tasks']
s = socket.create_connection(('127.0.0.1', 5761), timeout=5)
s.sendall(b'#\r\n')
time.sleep(1.5)
for c in cmds:
    s.sendall(c.encode() + b'\r\n')
    time.sleep(2.0)
s.settimeout(1.0)
out = b''
try:
    while True:
        d = s.recv(65536)
        if not d:
            break
        out += d
except Exception:
    pass
print(out.decode(errors='replace'))
