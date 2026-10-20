// The time trial creator (owner, 2026-10-20), checked in headless Chrome (WebGPU) against the dev server on :5173:
// open the creator, lay a course out with the free camera (pad, two race gates, an opening), save it, and look at it
// from outside; then the Time Trials list and the stored course. node docs/evidence/2026-10-20-course-creator/probe.mjs
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
// a flat lens, so the picture is not bent
await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 70 })); location.reload(); 1`);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await sleep(1000);
console.log('engine', await js('__fly.engine'));
const helpers = `
  window.click = (t) => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t && b.offsetParent); b?.click(); return !!b; };
  window.key = (code, shiftKey = false) => { dispatchEvent(new KeyboardEvent('keydown', { code, key: code, shiftKey })); dispatchEvent(new KeyboardEvent('keyup', { code, key: code })); };
  window.cam = (x, y, z, headingDeg, pitchDeg = 0) => __fly.ask('const c = fly.freeCam; c.pos.set(' + x + ',' + y + ',' + z + '); c.yaw = ' + (-headingDeg * Math.PI / 180) + '; c.pitch = ' + (pitchDeg * Math.PI / 180) + '; return 1');
  1`;
await js(helpers);
console.log('creator opened', await js(`click('Course creator')`));
await sleep(300);
console.log('new course', await js(`click('New course')`));
await sleep(800);
// the park, east of the fountain: the pad at (40, 60) facing north, two race gates and the gazebo's west side
await js(`cam(40, 3, 64, 0, -20)`); await sleep(400); await js(`key('KeyP')`); await sleep(300);
await js(`cam(40, 2.2, 45, 0)`); await sleep(400); await js(`key('KeyB')`); await sleep(300);
await js(`cam(30, 2.6, 25, 300)`); await sleep(400); await js(`key('KeyB')`); await sleep(300);
await js(`key('Period', true)`); await sleep(200);
await js(`cam(-50, 1.5, 114, 270)`); await sleep(400);
await js(`__fly.ask('fly.editing.ed.reach = 16; return 1')`);
await js(`key('KeyG')`); await sleep(300);
const course = await js(`__fly.ask('return fly.editing.ed.course')`);
console.log('course', JSON.stringify(course));
// the editor from behind and above the pad
await js(`cam(52, 14, 78, 330, -25)`); await sleep(2500);
await shot('1-editor');
console.log('panel', JSON.stringify(await js(`document.querySelector('.editor-panel').innerText`)));
// save it, then look at it as it stands in the world (outside the creator)
console.log('saved', await js(`click('Save')`));
await sleep(1500);
console.log('stored', await js(`localStorage.getItem('owfpv.courses')`));
console.log('session courses', JSON.stringify(await js(`__fly.ask('return fly.session.courses.map((t) => [t.id, t.name, t.custom === true, t.gates.length])')`)));
console.log('collision', await js(`__fly.ask('return fly.session.collisionSha256.slice(0, 12) + " life header " + fly.session.runner.current().header.collisionSha256.slice(0, 12) + " " + fly.session.runner.current().header.format')`));
await js(`cam(52, 14, 78, 330, -25)`); await sleep(2500);
await shot('2-saved');
await js(`key('Escape')`); await sleep(500);
await js(`click('Time trials')`); await sleep(600);
console.log('trials screen', JSON.stringify(await js(`[...document.querySelectorAll('.trial-head')].map((e) => e.innerText)`)));
await shot('3-time-trials');
await js(`click('Course creator')`); await sleep(600);
await shot('4-creator-list');
// fly it: the quad is set down on its pad
await js(`click('Fly it')`); await sleep(1500);
console.log('quad', JSON.stringify(await js(`__fly.ask('const s = fly.session.sim.s; return [s[0], s[1], s[2]].map((v) => Math.round(v * 100) / 100)')`)));
console.log('errors', logs.length ? logs : 'none');
ws.close(); proc.kill();
