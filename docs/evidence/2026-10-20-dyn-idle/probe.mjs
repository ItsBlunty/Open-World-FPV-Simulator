// Motor idle (owner, 2026-10-20), checked in headless Chrome against the dev server on :5173: ?demo=tricks (flips and
// rolls, the throttle often at zero) flown with the static idle and with dynamic idle; every 40 ms the slowest and fastest
// motor's rpm, the throttle stick and each rotor's sound level are read, and the Motor idle settings are photographed.
// node docs/evidence/2026-10-20-dyn-idle/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dynidle-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => proc.kill());
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
const shot = async (name) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(here, name), Buffer.from(r.result.data, 'base64')); };
await cdp('Page.enable'); await cdp('Runtime.enable');
const out = {};
for (const dyn of [false, true]) {
  await cdp('Page.navigate', { url: 'http://localhost:5173/?demo=tricks' }); await sleep(1500);
  await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 70, soundLowLatency: false, dynIdle: ${dyn} })); location.reload(); 1`);
  for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
  await sleep(1000);
  await js(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z' })); 1`);
  await sleep(1000);
  const p = await js(`__fly.ask('const p = fly.session.sim.p; return { idle: p.idle, dynIdle: p.dynIdle, slots: fly.session.sim.s.length }')`);
  console.log(dyn ? 'dynamic idle' : 'static idle', JSON.stringify(p), 'sound', await js('__fly.sound.running'));
  const rows = [];
  for (let k = 0; k < 600; k++) {
    const r = await js(`__fly.ask('const s = fly.session.sim.s, p = fly.session.sim.p, k = p.omegaMaxPerVolt * s[13 + 19] * 60 / (2 * Math.PI); const m = [0, 1, 2, 3].map((i) => Math.abs(s[13 + i]) * k); return [fly.session.sim.ch[2], s[34], Math.min(...m), Math.max(...m)]').then((a) => [...a, ...__fly.sound['rotors'].map((r) => r.gain.gain.value)])`);
    rows.push(r);
    await sleep(40);
  }
  // armed with the throttle stick under 10 %: the motors' rpm and the loudest rotor's level
  const low = rows.filter((r) => r[1] > 0 && r[0] < -0.8);
  const lvl = (r) => Math.max(...r.slice(4));
  const db = (g) => 20 * Math.log10(g);
  const quiet = low.filter((r) => r[3] < r[2] * 1.3), rev = low.filter((r) => r[3] > 3 * r[2]);
  const avg = (a, f) => a.reduce((s, r) => s + f(r), 0) / Math.max(1, a.length);
  out[dyn ? 'dynamic' : 'static'] = {
    samples: rows.length, lowestThrottleStick: +Math.min(...rows.map((r) => r[0])).toFixed(3), throttleDown: low.length,
    slowestRpmThrottleDown: low.length ? [Math.min(...low.map((r) => r[2])), Math.max(...low.map((r) => r[2]))].map(Math.round) : null,
    idleLevelDb: quiet.length ? +db(avg(quiet, lvl)).toFixed(1) : null, idleSamples: quiet.length,
    revvingLevelDb: rev.length ? +db(avg(rev, lvl)).toFixed(1) : null, revSamples: rev.length, revRpm: rev.length ? Math.round(avg(rev, (r) => r[3])) : null,
    hoverishLevelDb: +db(avg(rows.filter((r) => r[1] > 0 && Math.abs(r[0]) < 0.2), lvl)).toFixed(1)
  };
  console.log(JSON.stringify(out[dyn ? 'dynamic' : 'static']));
  // the Motor idle settings
  await js(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); 1`); await sleep(500);
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Settings' && b.offsetParent)?.click(); 1`); await sleep(400);
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'World and physics' && b.offsetParent)?.click(); 1`); await sleep(400);
  const found = await js(`(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent === 'Motor idle'); h?.scrollIntoView(); return !!h; })()`);
  await sleep(300);
  console.log('settings section found', found);
  await shot(`settings-${dyn ? 'dynamic' : 'static'}.png`);
}
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(out, null, 1));
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
