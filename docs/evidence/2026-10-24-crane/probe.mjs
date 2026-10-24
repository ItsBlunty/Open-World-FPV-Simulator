// The tower crane at work (owner, 2026-10-24), checked in headless Chrome (WebGPU) against the dev server on :5173: the
// crane drawn at chosen moments of its day (the drawing's tick set, the sim untouched): a crate on the hook mid-slew seen
// from 23 m off, the hook lowering a crate into the frame, and the cab from just in front of its glass with
// the operator in it. node docs/evidence/2026-10-24-crane/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'crane-'));
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
await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 75 })); location.reload(); 1`);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await sleep(1000);
await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start flying' && b.offsetParent)?.click(); 1`);
await sleep(2500);
const cam = (x, y, z, h, p) => js(`__fly.ask('const c = fly.freeCam; c.pos.set(${x}, ${y}, ${z}); c.yaw = ${-h * Math.PI / 180}; c.pitch = ${p * Math.PI / 180}; return 1')`);
// the drawing's tick held at t s (the sim runs on; the crane is drawn where it is at t)
const at = (s) => js(`__fly.ask('const v = fly.craneView; v.__u ??= v.update.bind(v); v.update = () => v.__u(${s} * 1000); return 1')`);
const find = (cond) => js(`__fly.ask('const c = fly.session.crane; for (let t = 0; t < c.day; t += 0.5) { const s = c.state(t * 1000); if (${cond}) return t; } return -1')`);
const look = (fromX, fromY, fromZ, x, y, z) => cam(fromX, fromY, fromZ, Math.atan2(x - fromX, -(z - fromZ)) * 180 / Math.PI, Math.atan2(y - fromY, Math.hypot(x - fromX, z - fromZ)) * 180 / Math.PI);
const hookAt = (s) => js(`__fly.ask('const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0], len: 0 }; fly.session.crane.place(2, ${s} * 1000, p); return JSON.stringify([p.x, p.y, p.z])')`).then(JSON.parse);
const site = JSON.parse(await js(`__fly.ask('const s = fly.session.crane.site; return JSON.stringify(s)')`));
console.log('crane at', site.x, site.z, 'ring', site.ring.toFixed(2), 'day', await js(`__fly.ask('return fly.session.crane.day')`));
// 1: a crate on the hook while the jib turns
const t1 = await find('s.carry >= 0 && Math.abs(c.state(t * 1000 + 500).th - s.th) > 0.02');
await at(t1); const h1 = await hookAt(t1);
await look(h1[0] + 16, h1[1] + 2, h1[2] + 16, h1[0], h1[1] - 1, h1[2]); await sleep(1500);
console.log('slewing with a crate at', t1, 's, hook', h1.map((v) => v.toFixed(1)).join(', '));
await shot('1-slewing-with-crate');
// 2: lowering a crate down into the frame, seen from inside the site at the first floor
const t2 = await find('s.carry >= 0 && c.state(t * 1000 + 500).h < s.h - 0.3 && s.h < 12');
await at(t2); const h2 = await hookAt(t2);
await look(h2[0] + 4, h2[1] + 0.5, h2[2] - 7, h2[0], h2[1] - 1.5, h2[2]); await sleep(1500);
console.log('lowering into the frame at', t2, 's, hook', h2.map((v) => v.toFixed(1)).join(', '));
await shot('2-lowering-into-frame');
// 3: the cab and its operator, from 3 m in front of its glass
await at(0);
const cab = JSON.parse(await js(`__fly.ask('const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0], len: 0 }; fly.session.crane.place(0, 0, p); const w = (a, b, c) => [0, 1, 2].map((j) => [p.x, p.y, p.z][j] + a * p.f[j] + b * p.u[j] + c * p.s[j]); return JSON.stringify({ eye: w(4.6, 1.8, 2.4), op: w(1.25, 1.3, 2.05) })')`));
await look(...cab.eye, ...cab.op); await sleep(1500);
await shot('3-cab-operator');
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
