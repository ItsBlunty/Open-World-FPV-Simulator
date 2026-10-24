// Volumetric clouds (owner, 2026-10-24: "3d pillowy clouds"; "lets test volumetric for performance") and the View
// distance, checked in headless Chrome (WebGPU; ?webgl for WebGL 2) against the dev server on :5173.
// Screenshots: from the park looking up and to the horizon, over the city from 120 m, a close crop of cloud edges.
// node docs/evidence/2026-10-24-clouds/probe.mjs [?webgl]
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
const q = process.argv[2] ?? '';
const tag = q ? '-webgl' : '';
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: `http://localhost:5173/${q}` });
await sleep(1500);
const cam = (x, y, z, h, p) => js(`__fly.ask('const c = fly.freeCam; if (!c.active) c.enter(fly.view.camera); c.pos.set(${x}, ${y}, ${z}); c.yaw = ${-h * Math.PI / 180}; c.pitch = ${p * Math.PI / 180}; return 1')`);
await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 90, graphics: 'full', shadows: true, shadowReach: 'far', viewDistance: 'far', clouds: true })); location.reload(); 1`);
await sleep(1000);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await sleep(1000);
await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start flying' && b.offsetParent)?.click(); 1`);
await sleep(2500);
for (const [n, v] of Object.entries({ 'park-up': [0, 2, 200, 0, 35], 'park-horizon': [0, 2, 200, 200, 4], 'city-120m': [-600, 120, 0, 90, -6] })) {
  await cam(...v); await sleep(1500); await shot(`${n}${tag}`);
}
if (!q) {
  // cloud edges at 3x: the grain the march's jitter leaves
  await cam(-600, 120, 0, 90, -6); await sleep(1000);
  const s = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 560, y: 40, width: 300, height: 200, scale: 3 } });
  fs.writeFileSync(path.join(here, 'edges-3x.png'), Buffer.from(s.result.data, 'base64')); console.log('wrote edges-3x.png');
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
