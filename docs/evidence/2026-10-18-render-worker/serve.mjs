import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const types = { '.html': 'text/html', '.js': 'text/javascript' };
http.createServer((q, s) => {
  if (q.method === 'POST') { let b=''; q.on('data',d=>b+=d); q.on('end',()=>{ fs.appendFileSync(path.join(dir,'results.txt'), b+'\n'); s.end('ok'); }); return; }
  const p = path.join(dir, (q.url.split('?')[0] === '/' ? '/index.html' : q.url.split('?')[0]));
  if (!fs.existsSync(p)) { s.statusCode = 404; return s.end(); }
  s.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); s.end(fs.readFileSync(p));
}).listen(18932, '127.0.0.1');
