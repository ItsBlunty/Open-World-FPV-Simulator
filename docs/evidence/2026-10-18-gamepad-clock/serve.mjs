import http from 'node:http'; import fs from 'node:fs';
const page = fs.readFileSync(new URL('./page.html', import.meta.url));
http.createServer((q, s) => {
  if (q.method === 'POST') { let b=''; q.on('data',d=>b+=d); q.on('end',()=>{ fs.appendFileSync(new URL('./results.txt', import.meta.url), b+'\n'); s.end('ok'); }); return; }
  s.setHeader('content-type','text/html'); s.end(page);
}).listen(18931, '127.0.0.1');
