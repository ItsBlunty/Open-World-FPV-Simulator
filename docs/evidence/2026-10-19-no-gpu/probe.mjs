import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(label, extra) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'nogpu-'));
  const port = 19900 + Math.floor(Math.random() * 90);
  const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, ...extra, 'about:blank'], { stdio: 'ignore' });
  let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
  const ver = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  const res = await new Promise((r) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m.result.result.value); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => { const o = {}; for (const k of ['webgl2','webgl']) { const gl = document.createElement('canvas').getContext(k); if (!gl) { o[k] = null; continue; } const e = gl.getExtension('WEBGL_debug_renderer_info'); o[k] = gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); } return o; })()` } })); });
  console.log(label, ver, JSON.stringify(res));
  ws.close(); proc.kill(); await sleep(500);
}
await run('normal GPU      ', []);
await run('--disable-gpu   ', ['--disable-gpu']);
await run('disable+unsafe  ', ['--disable-gpu', '--enable-unsafe-swiftshader']);
