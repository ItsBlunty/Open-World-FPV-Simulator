// The shadow block from high up (owner, 2026-10-24: "there is a shadow big ... it makes a giant rectangle shadow"), checked in
// headless Chrome against the dev server on :5173: the free camera 300 / 1200 / 2500 m up, looking down 60 deg, at a shadow reach.
// node docs/evidence/2026-10-24-shadow-high/probe.mjs <near|far|farthest|ultra> [heights, comma separated]
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'clouds-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--window-size=1280,720', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let seq = 0; const wait = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(`error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
};
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result?.result?.value;
};
const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 88 }); fs.writeFileSync(path.join(here, `${name}.jpg`), Buffer.from(s.result.data, 'base64')); console.log('wrote', `${name}.jpg`); };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(1500);
const cam = (x, y, z, h, p) => js(`__fly.ask('const c = fly.freeCam; if (!c.active) c.enter(fly.view.camera); c.pos.set(${x}, ${y}, ${z}); c.yaw = ${-h * Math.PI / 180}; c.pitch = ${p * Math.PI / 180}; return 1')`);
const reach = process.argv[2] ?? 'ultra';
await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 90, graphics: 'full', shadows: true, shadowReach: '${reach}', viewDistance: 'farthest', clouds: false })); location.reload(); 1`);
await sleep(1000);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await sleep(1000);
await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start flying' && b.offsetParent)?.click(); 1`);
await sleep(2500);
for (const h of (process.argv[3] ?? '300,600,1200,2500').split(',').map(Number)) {
  await cam(500, h, 600, 0, -60); await sleep(1500); await shot(`h${h}-${reach}`);
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
