// The airport (owner, 2026-10-20), checked in headless Chrome (WebGPU) against the dev server on :5173: the ATR 72's
// approach over the park, touchdown, the tug's push-in, the tower cab, the air ambulance on the hospital roof, a take-off
// and an overview. node docs/evidence/2026-10-20-airport/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'airport-'));
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
await js(`click('Start flying')`); await sleep(3000);
await js(`window.at = (t) => __fly.ask('const v = fly.airView; v.__u ??= v.update.bind(v); v.update = (k) => v.__u(' + t + ' * 1000); return 1')`);
// when things happen: scan the day (s) for each scene
const find = (cond) => js(`__fly.ask('const a = fly.session.air; const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0] }; const at = (i, t) => (a.place(i, t * 1000, p), p); for (let t = 0; t < 3000; t += 0.5) { if (${cond}) return t; } return -1')`);
const atr = await js(`__fly.ask('return fly.session.air.planes[0]')`);
const heli = await js(`__fly.ask('return fly.session.air.heli')`);
console.log('events', JSON.stringify(await js(`__fly.ask('return fly.session.air.events.map((e) => [e.kind, Math.round(e.touchdown), Math.round(e.liftoff)])')`)));
const shots = [
  // the ATR 72 over the park on its approach, seen from the fountain
  ['1-approach-over-park', `at(${atr}, t).x > -60 && !p.hidden`, (t) => [`cam(-10, 4, 120, 330, 28)`]],
  // touching down on runway 09
  ['2-touchdown', `at(${atr}, t).x > 950 && p.y < 0.3`, () => [`cam(1080, 5, 0, 130, -3)`]],
  // the tug pushing it back into hangar 3, tail first
  ['3-tug-push-in', `at(${atr}, t).z > 175 && at(${atr}, t).z < 185`, () => [`cam(985, 10, 125, 150, -14)`]],
  // inside the tower cab, the controllers at the north consoles, the runway beyond
  ['4-tower-cab', `t > 1`, () => [`cam(722, 23.9, 225.3, 0, -8)`]],
  // the air ambulance on the hospital roof, the medics wheeling the stretcher to the stair house
  ['5-hospital-roof', `at(${heli + 1}, t).hidden === false && p.x > 361`, () => [`cam(352, 27, -205, 20, -30)`]],
  // the ATR taking off
  ['6-takeoff', `t > 1000 && at(${atr}, t).y > 6 && p.y < 25 && p.x < 1800`, () => [`cam(1500, 8, -20, 125, 0)`]],
  // the whole apron: planes, tugs, the heliport, from above the railway
  ['7-overview', `t > 1340`, () => [`cam(640, 90, 280, 66, -18)`]]
];
for (const [name, cond, cams] of shots) {
  const t = await find(cond);
  console.log(name, 't', t);
  if (t < 0) continue;
  await js(`at(${t})`);
  for (const c of cams(t)) await js(c);
  await sleep(2500);
  await shot(name);
}
console.log('fps', await js(`document.body.innerText.match(/(\d+) fps/)?.[1]`));
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
