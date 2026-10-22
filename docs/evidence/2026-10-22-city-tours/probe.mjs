// The small planes' city tours (owner, 2026-10-22), checked in headless Chrome (WebGPU) against the dev server on :5173:
// a plan of the Cub's, the 172's and the SR22's tracks over the day, each one seen from behind over the city, and the Cub
// from the street. node docs/evidence/2026-10-22-city-tours/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tours-'));
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

const planes = JSON.parse(await js(`__fly.ask('const a = fly.session.air; return JSON.stringify(a.planes.filter((i) => ["cub", "c172", "sr22"].includes(a.movers[i].type.kind)).map((i) => [i, a.movers[i].type.kind]))')`));
console.log('tour planes', JSON.stringify(planes));
// the plan: each tour plane's track over the day, every 2 s, and the city's blocks
const track = (i) => js(`__fly.ask('const a = fly.session.air; const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0] }; const o = []; for (let t = 0; t < 3000; t += 2) { a.place(${i}, t * 1000, p); o.push([Math.round(p.x), Math.round(p.z), Math.round(p.y)]); } return JSON.stringify(o)')`).then(JSON.parse);
const colours = { cub: '#d9a400', c172: '#2a4f9a', sr22: '#8a1c2b' };
let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2400 -1500 4800 2300" width="1200" height="575" style="background:#eef3e8">';
svg += '<rect x="-489" y="-499" width="978" height="418" fill="#c8c8c8"/><text x="-470" y="-470" font-size="60">city</text>';
svg += '<rect x="660" y="25" width="1400" height="30" fill="#555"/><text x="700" y="140" font-size="60">runway 09</text>';
for (const [i, kind] of planes) {
  const pts = await track(i);
  svg += `<polyline fill="none" stroke="${colours[kind]}" stroke-width="10" points="${pts.map(([x, z]) => x + ',' + z).join(' ')}"/>`;
  svg += `<text x="-2350" y="${-1400 + 80 * planes.findIndex((p) => p[0] === i)}" font-size="70" fill="${colours[kind]}">${kind} (${Math.max(...pts.map((p) => p[2]))} m)</text>`;
}
svg += '<text x="-2350" y="700" font-size="50">north is up (-z); 1 unit = 1 m</text></svg>';
fs.writeFileSync(path.join(here, '0-plan.svg'), svg);
console.log('wrote 0-plan.svg');
// for each: a moment over the city, mid-straight (level), and a chase view from behind and above it
for (const [i, kind] of planes) {
  const t = await find(`at(${i}, t).x > -150 && p.x < 150 && p.z < -100 && p.z > -480 && Math.abs(p.s[1]) < 0.01`);
  console.log(kind, 't', t);
  if (t < 0) continue;
  const q = JSON.parse(await js(`__fly.ask('const a = fly.session.air; const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0] }; a.place(${i}, ${t} * 1000, p); return JSON.stringify(p)')`));
  await js(`at(${t})`);
  const cx = q.x - q.f[0] * 45, cz = q.z - q.f[2] * 45, cy = q.y + 8;
  const h = Math.atan2(q.x - cx, -(q.z - cz)) * 180 / Math.PI;
  await js(`cam(${cx}, ${cy}, ${cz}, ${h}, -9)`);
  await sleep(2500);
  await shot(`1-${kind}-chase`);
}
// from the street: the Cub going over the north-south road at x 0, looked up at from its middle
{
  const [i] = planes.find((p) => p[1] === 'cub');
  const t = await find(`at(${i}, t).x > -15 && p.x < 0 && p.z < -100 && p.z > -480`);
  const q = JSON.parse(await js(`__fly.ask('const a = fly.session.air; const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0] }; a.place(${i}, ${t} * 1000, p); return JSON.stringify(p)')`));
  await js(`at(${t})`);
  const cx = 0, cz = q.z + 75;
  const h = Math.atan2(q.x - cx, -(q.z - cz)) * 180 / Math.PI;
  const pitch = Math.atan2(q.y - 2, Math.hypot(q.x - cx, q.z - cz)) * 180 / Math.PI;
  await js(`cam(${cx}, 2, ${cz}, ${h}, ${pitch})`);
  await sleep(2500);
  await shot('2-cub-from-street');
}
console.log('fps', await js(`document.body.innerText.match(/(\d+) fps/)?.[1]`));
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
