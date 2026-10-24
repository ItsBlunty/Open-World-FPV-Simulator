// Stylised clouds (owner, 2026-10-24: "lower stylized clouds, that players can go up and fly through. Make them cloud
// the vision like flying in a cloud would really do"), checked in headless Chrome (WebGPU; ?webgl for WebGL 2) against
// the dev server on :5173. Screenshots: from the park looking up and to the horizon, over the city from 120 m, and
// flying level into the biggest puff over the map from 40 m out to 20 m in (the fog read back); the airport's lights from
// inside the puff nearest the runway's middle and from 30 m up off its west end (hazed: owner, 2026-10-24); the same view
// 20 s apart (the clouds drift); a cloud and its shadow, and the shadows from 900 m up.
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
  // into the biggest puff over the map, level, along +x: from 40 m outside its edge to 20 m inside
  const k = await js(`__fly.ask('const ps = fly.cloudsView.puffs; let k = 0; ps.forEach((p, i) => { if (Math.abs(p.x - 300) < 2300 && Math.abs(p.z) < 2000 && p.r > ps[k].r) k = i; }); return k')`);
  // the clouds drift: the puff read again, and the camera placed against it, just before each look
  const puff = async () => JSON.parse(await js(`__fly.ask('return JSON.stringify(fly.cloudsView.puffs[${k}])')`));
  const f = await puff();
  console.log('puff', f.x.toFixed(0), f.y.toFixed(0), f.z.toFixed(0), 'r', f.r.toFixed(0));
  for (const d of [-40, -8, -2, 4, 20]) {
    const g = await puff();
    await cam(g.x - g.r + d, g.y, g.z, 90, 0); await sleep(150);
    console.log(`${d} m in: fog`, await js(`__fly.ask('return JSON.stringify([Math.round(fly.scene.fog.near), Math.round(fly.scene.fog.far)])')`));
    await shot(`into-cloud-${d < 0 ? 'out' : 'in'}${Math.abs(d)}m${tag}`);
  }
}
if (!q) {
  // the runway lights from deep in the cloud nearest the runway's middle (x 1360, z 40), looking at that middle
  const c = JSON.parse(await js(`__fly.ask('const ps = fly.cloudsView.puffs.filter((p) => p.r > 20); const p = ps.reduce((a, b) => Math.hypot(b.x - 1360, b.z - 40) < Math.hypot(a.x - 1360, a.z - 40) ? b : a); return JSON.stringify(p)')`));
  const lookAt = (fx, fy, fz, x, y, z) => cam(fx, fy, fz, Math.atan2(x - fx, -(z - fz)) * 180 / Math.PI, Math.atan2(y - fy, Math.hypot(x - fx, z - fz)) * 180 / Math.PI);
  await lookAt(c.x, c.y, c.z, 1360, 0, 40); await sleep(300);
  console.log('in cloud at', c.x.toFixed(0), c.y.toFixed(0), c.z.toFixed(0), 'r', c.r.toFixed(0), 'runway', Math.hypot(c.x - 1360, c.y, c.z - 40).toFixed(0), 'm off; fog', await js(`__fly.ask('return JSON.stringify([Math.round(fly.scene.fog.near), Math.round(fly.scene.fog.far)])')`));
  await shot(`lights-from-in-cloud${tag}`);
  await cam(300, 30, 40, 90, -3); await sleep(1500);
  await shot(`lights-from-west${tag}`);
  // a cloud's shadow (owner, 2026-10-24: "they should cast shadows like real clouds"): the biggest cloud south of the
  // city, from the side with its shadow, and low over the ground looking at where the shadow should fall
  const sun = [-300, 500, 200].map((v, _, a) => v / Math.hypot(...a));
  const sc = JSON.parse(await js(`__fly.ask('const ps = fly.cloudsView.puffs.filter((p) => p.r > 25 && Math.abs(p.x - 300) < 1500 && p.z > 0 && p.z < 1500); const p = ps.reduce((a, b) => b.r > a.r ? b : a); return JSON.stringify(p)')`));
  const g = [sc.x - sun[0] * sc.y / sun[1], 0, sc.z - sun[2] * sc.y / sun[1]];
  console.log('cloud', sc.x.toFixed(0), sc.y.toFixed(0), sc.z.toFixed(0), 'its shadow along the sun at', g[0].toFixed(0), g[2].toFixed(0));
  await lookAt(g[0] + 350, 60, g[2] + 350, (g[0] + sc.x) / 2, sc.y * 0.35, (g[2] + sc.z) / 2); await sleep(1500); await shot('shadow-side');
  await lookAt(g[0] - 250, 15, g[2] + 120, g[0], 0, g[2]); await sleep(1500); await shot('shadow-low');
  await cam(300, 900, 900, 0, -55); await sleep(1500); await shot('shadows-from-900m');
  // the clouds drift: the same view 20 s apart
  await cam(0, 150, 400, 30, 12); await sleep(1500);
  await shot('drift-0s');
  await sleep(20000);
  await shot('drift-20s');
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
