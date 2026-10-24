// Stylised clouds (owner, 2026-10-24: "lower stylized clouds, that players can go up and fly through"), checked in headless Chrome (WebGPU; ?webgl for WebGL 2) against the dev server on :5173.
// GPU time per frame with the clouds hidden and shown, at three views: n frames drawn back to back as the engine draws
// them, waited for on the GPU. node docs/evidence/2026-10-24-clouds/perf.mjs <dpr 1|2> <lens ids, comma separated>
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'clouds-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--window-size=1920,1080', `--force-device-scale-factor=${process.argv[2] ?? 1}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
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
// GPU time per frame: n frames drawn back to back as the engine draws them (draw: the lens if on), waited for on the GPU
const time = async (n) => {
  await js(`__fly.ask('globalThis.__t = null; const d = fly.renderer.backend.device; (async () => { const draw = () => fly.fisheye.active ? fly.fisheye.render(fly.renderer, fly.scene, fly.view.camera, fly.sun.light.shadow) : fly.renderer.render(fly.scene, fly.view.camera); draw(); await d.queue.onSubmittedWorkDone(); const t0 = performance.now(); for (let i = 0; i < ${n}; i++) draw(); await d.queue.onSubmittedWorkDone(); globalThis.__t = (performance.now() - t0) / ${n}; })(); return 1')`);
  for (let i = 0; i < 100; i++) { const v = await js('globalThis.__t'); if (v !== null && v !== undefined) return v; await sleep(100); }
};

for (const lens of (process.argv[3] ?? 'none').split(',')) {
  if (lens === 'skip') continue;
  await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: '${lens}', graphics: 'full', shadows: true, shadowReach: 'far', viewDistance: 'far', clouds: true })); location.reload(); 1`);
  await sleep(1000);
  for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
  await sleep(1000);
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start flying' && b.offsetParent)?.click(); 1`);
  await sleep(2500);
  console.log('lens', lens, await js('innerWidth + "x" + innerHeight'), await js(`__fly.ask('return fly.renderer.getPixelRatio()')`));
  console.log('puffs', await js(`__fly.ask('return fly.cloudsView.puffs.length')`));
  for (const [n, v] of Object.entries({ up: [0, 2, 200, 0, 35], horizon: [0, 2, 200, 200, 4], city: [-600, 120, 0, 90, -6], 'among-clouds': [0, 250, 400, 30, 0] })) {
    await cam(...v); await sleep(800);
    const ms = [];
    for (const on of [false, true, false, true]) {
      await js(`__fly.ask('fly.cloudsView.group.visible = ${on}; return 1')`); await sleep(300);
      ms.push(await time(60));
    }
    const off = (ms[0] + ms[2]) / 2, on = (ms[1] + ms[3]) / 2;
    console.log(`${n}: no clouds ${off.toFixed(2)} ms, clouds ${on.toFixed(2)} ms, +${(on - off).toFixed(2)} ms`);
  }
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
