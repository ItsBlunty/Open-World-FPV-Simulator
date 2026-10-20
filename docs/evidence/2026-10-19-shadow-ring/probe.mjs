// The shadow ring (owner, 2026-10-19): the same views with the old shadow bias and the new one, in headless Chrome
// (WebGPU), against the dev server on :5173. node docs/evidence/2026-10-19-shadow-ring/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--window-size=1280,800', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let seq = 0; const wait = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable');
await cdp('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(1500);
// a flat lens, so the picture is not bent
await js(`localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 70 })); location.reload(); 1`);
await sleep(8000);
await js(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Start flying')?.click(); 1`);
await sleep(4000);
console.log('renderer', await js(`__fly.ask('return fly.renderer.constructor.name + " shadows " + fly.renderer.shadowMap.enabled')`));
// views: [name, camera x, y, z, look-at x, y, z]
// the sun is from (-300, 500, 200): shadows fall along (0.83, -0.55) on the ground; views from across that line
const views = [
  ['pole', -25 + 1.6 * 0.55 + 0.4 * 0.83, 0.8, -40 + 1.6 * 0.83 - 0.4 * 0.55, -25 + 0.3 * 0.83, 0.0, -40 - 0.3 * 0.55],
  ['tree', -21.6 + 2.6 * 0.55 + 0.6 * 0.83, 1.4, 47 + 2.6 * 0.83 - 0.6 * 0.55, -21.6 + 0.6 * 0.83, 0.05, 47 - 0.6 * 0.55]
];
for (const [name, x, y, z, lx, ly, lz] of views) {
  for (const [label, bias, nb] of [['old', -0.0002, 0.04], ['new', -0.00001, null]]) {
    await js(`__fly.ask(\`const c = fly.freeCam; c.pos.set(${x}, ${y}, ${z}); const dx = ${lx} - ${x}, dy = ${ly} - ${y}, dz = ${lz} - ${z};
      c.yaw = Math.atan2(-dx, -dz); c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const s = fly.sun.light.shadow; s.bias = ${bias}; s.normalBias = ${nb === null ? '0.7 * 2 * 120 / s.mapSize.x' : nb}; return s.normalBias;\`)`);
    await sleep(2500);
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(here, `${name}-${label}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log('wrote', `${name}-${label}.png`);
  }
}
ws.close(); proc.kill();
