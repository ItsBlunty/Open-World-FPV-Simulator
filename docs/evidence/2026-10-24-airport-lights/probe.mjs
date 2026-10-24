// The airport's lights (owner, 2026-10-24), checked in headless Chrome (WebGPU) against the dev server on :5173: the
// approach to runway 09 on, above and below the planes' 3 deg glide path (each PAPI unit's colour read back from the
// drawing), the runway seen from its west end, and the beacon's flashes over 10 s from one spot.
// node docs/evidence/2026-10-24-airport-lights/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--window-size=1280,800', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
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
await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 60, air: false })); location.reload(); 1`);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await sleep(1000);
await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start flying' && b.offsetParent)?.click(); 1`);
await sleep(2500);
// heading: 0 north (-z), 90 east (+x); pitch down negative
const cam = (x, y, z, h, p) => js(`__fly.ask('const c = fly.freeCam; c.pos.set(${x}, ${y}, ${z}); c.yaw = ${-h * Math.PI / 180}; c.pitch = ${p * Math.PI / 180}; return 1')`);
const papi = () => js(`__fly.ask('return fly.lightsView.papi.map((p) => p.mat.color.r > 0.9 && p.mat.color.g > 0.8 ? "W" : "R").join("")')`);
// the planes' path: 15 m over the threshold (x 760) at 3 deg; PAPI units listed inner (3.5 deg) to outer (2.5 deg)
const tan3 = Math.tan(3 * Math.PI / 180);
for (const [name, dy] of [['on-path', 0], ['above', 25], ['below', -12]]) {
  const x = 160, y = 0.05 + 15 + (760 - x) * tan3 + dy;
  await cam(x, y, 40, 90, -Math.atan2(y, 1046 - x) * 180 / Math.PI);
  await sleep(1500);
  console.log(name.padEnd(8), `camera ${x} m, ${y.toFixed(1)} m up: PAPI inner to outer`, await papi());
  await shot(`approach-${name}`);
}
await cam(640, 6, 40, 90, -4); await sleep(1500); await shot('runway-from-west-end');
await cam(1036, 2.5, 7, 90, -8); await sleep(1500); await shot('papi-close');
// the beacon: from 300 m north-west of the tower, how often it flashes, and its colours (sampled every 50 ms of sim time)
const flashes = await js(`__fly.ask('const v = fly.lightsView, e = new fly.view.camera.position.constructor(500, 40, 0); const seen = []; let was = false; for (let t = 0; t < 10; t += 0.005) { v.update(e, t); const on = v.beacon.mesh.visible; if (on && !was) seen.push((v.beacon.mat.color.g > 0.9 && v.beacon.mat.color.r < 0.5 ? "G" : "W") + t.toFixed(2)); was = on; } return seen.join(" ")')`);
console.log('beacon flashes in 10 s:', flashes);
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
