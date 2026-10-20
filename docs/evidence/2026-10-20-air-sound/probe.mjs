// The airport's sounds (owner, 2026-10-20), checked in headless Chrome against the dev server on :5173: for each scene
// the airport's day is shifted so the moment comes a few seconds after it starts, the free camera is put beside it, and
// the game's own mix (after its limiter) is recorded to a .webm here, with what each voice played and the loudest
// spectrum peaks. node docs/evidence/2026-10-20-air-sound/probe.mjs [scene ...]
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'airsound-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
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
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(1500);
await js(`localStorage.clear(); localStorage.setItem('owfpv.settings', JSON.stringify({ version: 1, lens: 'none', fovDeg: 70, soundLowLatency: false })); location.reload(); 1`);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await sleep(1000);
console.log('engine', await js('__fly.engine'));
await js(`
  window.click = (t) => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t && b.offsetParent); b?.click(); return !!b; };
  window.cam = (x, y, z, headingDeg, pitchDeg = 0) => __fly.ask('const c = fly.freeCam; c.pos.set(' + x + ',' + y + ',' + z + '); c.yaw = ' + (-headingDeg * Math.PI / 180) + '; c.pitch = ' + (pitchDeg * Math.PI / 180) + '; return 1');
  // shift the airport's day so its second t comes now (drawing, sound and contacts all place movers through air.place)
  window.at = (t) => __fly.ask('const a = fly.session.air; a.__p ??= a.place.bind(a); const off = ' + t + ' * 1000 - fly.session.sim.tick; a.place = (i, k, o) => a.__p(i, k + off, o); return off');
  window.where = (i, t) => __fly.ask('const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0] }; const a = fly.session.air; (a.__p ?? a.place.bind(a))(' + i + ', ' + t + ' * 1000, p); return [p.x, p.y, p.z, p.e, p.v, p.hidden]');
  window.rec = async (ms) => {
    const s = __fly.sound, c = s.ctx, d = c.createMediaStreamDestination();
    s.analyser.connect(d);
    const r = new MediaRecorder(d.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 }), ch = [];
    r.ondataavailable = (e) => ch.push(e.data);
    r.start();
    const looks = [];
    for (let k = 0; k < ms / 1000; k++) {
      await new Promise((x) => setTimeout(x, 1000));
      const sp = s.spectrum();
      // the loudest bins under 2 kHz, one per 15 Hz
      const peaks = sp.db.map((v, i) => [i * sp.binHz, v]).filter(([f]) => f > 15 && f < 2000).sort((a, b) => b[1] - a[1])
        .reduce((o, p) => (o.length < 5 && o.every((q) => Math.abs(q[0] - p[0]) > 15) ? [...o, p] : o), []);
      looks.push({ rmsDb: +sp.rmsDb.toFixed(1), voices: s.airNow().filter((v) => v.mover >= 0).map((v) => v.kind + ' ' + v.hz.toFixed(1) + ' Hz g ' + v.gain.toFixed(3)), peaks: peaks.map(([f, v]) => f.toFixed(0) + ' Hz ' + v.toFixed(0)) });
    }
    r.stop();
    await new Promise((x) => { r.onstop = x; });
    s.analyser.disconnect(d);
    const buf = new Uint8Array(await new Blob(ch).arrayBuffer());
    let str = '';
    for (let i = 0; i < buf.length; i += 8192) str += String.fromCharCode(...buf.subarray(i, i + 8192));
    return { b64: btoa(str), looks };
  };
  1`);
await js(`click('Start flying')`); await sleep(2500);
// the sound starts on a key press
await js(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z' })); 1`);
await sleep(1500);
console.log('sound', await js(`__fly.sound.running`));
const air = await js(`__fly.ask('const a = fly.session.air; return { planes: a.planes.map((i) => [i, a.movers[i].type.kind]), heli: a.heli, tugs: a.movers.map((m, i) => m.kind === "tug" ? i : -1).filter((i) => i >= 0), events: a.events }')`);
const where = (i, t) => js(`where(${i}, ${t})`);
const plane = (k) => air.planes.find(([, kind]) => kind === k)[0];
const ev = (k) => air.events.find((e) => e.kind === k);
const find = (cond) => js(`__fly.ask('const a = fly.session.air; const p = { x: 0, y: 0, z: 0, f: [0, 0, 0], u: [0, 0, 0], s: [0, 0, 0] }; const P = a.__p ?? a.place.bind(a); const at = (i, t) => (P(i, t * 1000, p), p); for (let t = 0; t < 3000; t += 0.5) { if (${cond}) return t; } return -1')`);
const scenes = [
  // the ATR 72 on short final over the railway, heard from beside the threshold
  ['atr72-landing', async () => { const t = ev('atr72').touchdown; const p = await where(plane('atr72'), t - 4); return [t - 9, [p[0], 3, p[2] - 60, 0, 10]]; }, 12000],
  // a tug moving (towing or going to a job): its diesel
  ['tug-moving', async () => { const g = air.tugs[0]; const t = await find(`t > 5 && at(${g}, t).v > 1 && !p.hidden`); const p = await where(g, t + 2); return [t, [p[0] + 12, 3, p[2] - 12, 0, -5]]; }, 8000],
  // a Cessna 172 taking off, from beside the runway at its lift-off
  ['c172-takeoff', async () => { const t = ev('c172').liftoff; const p = await where(plane('c172'), t); return [t - 10, [p[0], 3, p[2] - 50, 0, 5]]; }, 14000],
  // the Phenom 300 jet taking off
  ['phenom-takeoff', async () => { const t = ev('phenom').liftoff; const p = await where(plane('phenom'), t); return [t - 10, [p[0], 3, p[2] - 60, 0, 5]]; }, 14000],
  // the King Air taxiing out, props turning at taxi power
  ['kingair-taxi', async () => { const t = await find(`t > ${ev('kingair').touchdown + 100} && at(${plane('kingair')}, t).v > 3 && p.e > 0.2 && p.y < 1`); const p = await where(plane('kingair'), t + 3); return [t, [p[0] + 30, 3, p[2] + 30, 0, 0]]; }, 10000],
  // the EC135 settling onto the hospital roof
  ['ec135-hospital', async () => { const t = await find(`at(${air.heli}, t).y > 50 && p.e > 0.5 && !p.hidden`); const p = await where(air.heli, t); return [t - 4, [p[0] - 25, p[1] + 3, p[2] + 25, 0, -5]]; }, 10000]
];
const out = {};
process.on('exit', () => proc.kill());
// node probe.mjs [scene ...]: only those
const only = process.argv.slice(2);
const prev = fs.existsSync(path.join(here, 'looks.json')) ? JSON.parse(fs.readFileSync(path.join(here, 'looks.json'), 'utf8')) : {};
for (const [name, plan, ms] of scenes) {
  if (only.length && !only.includes(name)) { if (prev[name]) out[name] = prev[name]; continue; }
  const [t, c] = await plan();
  console.log(name, 'at', t);
  if (!(t > 0)) continue;
  await js(`at(${t})`);
  await js(`cam(${c.join(',')})`);
  const r = await js(`rec(${ms})`);
  fs.writeFileSync(path.join(here, `${name}.webm`), Buffer.from(r.b64, 'base64'));
  out[name] = r.looks;
  console.log(' ', JSON.stringify(r.looks));
}
fs.writeFileSync(path.join(here, 'looks.json'), JSON.stringify(out, null, 1));
console.log('counts', JSON.stringify(await js('__fly.sound.counts')));
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
