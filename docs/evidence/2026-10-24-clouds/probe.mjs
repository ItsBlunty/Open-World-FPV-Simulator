// Clouds and the longer view (owner, 2026-10-24: "add clouds, set longer view distance at ultra and high"), checked in
// headless Chrome (WebGPU) against the dev server on :5173: the same free-camera views at each View distance (Medium
// 1.6 km, High 3 km, Ultra 6 km), and the clouds from the park, looking up and towards the horizon.
// node docs/evidence/2026-10-24-clouds/probe.mjs
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
for (const [name, viewDistance, shadowReach] of [['medium', 'near', 'near'], ['high', 'far', 'far'], ['ultra', 'farthest', 'ultra']]) {
  await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 90, graphics: 'full', shadows: true, shadowReach: '${shadowReach}', viewDistance: '${viewDistance}' })); location.reload(); 1`);
  await sleep(1000);
  for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
  await sleep(1000);
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start flying' && b.offsetParent)?.click(); 1`);
  await sleep(2500);
  console.log(name, 'fog', await js(`__fly.ask('return JSON.stringify([fly.scene.fog.near, fly.scene.fog.far, fly.view.camera.far])')`));
  // over the city's west edge, 120 m up, looking east over the city and the airport
  await cam(-600, 120, 0, 90, -6); await sleep(2000);
  await shot(`${name}-east-from-120m`);
  if (name === 'medium') {
    // the clouds from the park: up, and to the horizon
    await cam(0, 2, 200, 0, 35); await sleep(1500);
    await shot('clouds-from-park');
    await cam(0, 2, 200, 200, 4); await sleep(1500);
    await shot('clouds-to-horizon');
  }
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
