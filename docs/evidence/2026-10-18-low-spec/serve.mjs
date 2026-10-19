import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [, , dir, port] = process.argv;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const p = path.join(dir, u);
  if (!p.startsWith(path.resolve(dir)) || !fs.existsSync(p)) { s.statusCode = 404; return s.end(); }
  s.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); s.end(fs.readFileSync(p));
}).listen(Number(port), '127.0.0.1');
