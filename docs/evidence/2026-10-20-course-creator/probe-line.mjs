// The time trial creator (owner, 2026-10-20), checked in headless Chrome (WebGPU) against the dev server on :5173:
// (the flown line) open the creator in the demo, fly with the free camera (pad, two race gates, an opening), save it, and look at it
// from outside; then the Time Trials list and the stored course. node docs/evidence/2026-10-20-course-creator/probe-line.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--window-size=1280,800', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let seq = 0; const wait = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
};
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result?.result?.value;
};
const shot = async (name) => {
  const s = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(here, `${name}.png`), Buffer.from(s.result.data, 'base64'));
  console.log('wrote', `${name}.png`);
};
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(1500);
await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 70 })); location.href = '/?demo'; 1`);
await sleep(1500);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await js(`window.click = (t) => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t && b.offsetParent); b?.click(); return !!b; }; 1`);
// the demo flies the self-test's sticks; open the creator from the pause menu, then fly (the engine's own switch: the
// page asks for a radio before it lets a pilot fly in the creator, and the demo has none)
await js(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); 1`); await sleep(300);
console.log('creator', await js(`click('Course creator')`)); await sleep(300);
console.log('new', await js(`click('New course')`)); await sleep(500);
await js(`__fly.ask('fly.editing.mode = "fly"; return 1')`);
await sleep(9000);
console.log('line segments', await js(`__fly.ask('return fly.editing.line.segments')`));
console.log('quad', JSON.stringify(await js(`__fly.ask('const s = fly.session.sim.s; return [s[0], s[1], s[2]].map((v) => Math.round(v))')`)));
await js(`__fly.ask('fly.editing.mode = "camera"; const p = fly.session.sim.s; fly.freeCam.enter(fly.view.camera); fly.freeCam.pos.set(p[0] + 25, p[1] + 12, p[2] + 25); fly.freeCam.yaw = Math.PI / 4; fly.freeCam.pitch = -0.35; return 1')`);
await sleep(2000);
await shot('5-flown-line');
console.log('errors', logs.length ? logs : 'none');
ws.close(); proc.kill();
