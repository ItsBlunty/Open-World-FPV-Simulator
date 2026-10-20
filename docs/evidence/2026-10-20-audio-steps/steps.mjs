// node steps.mjs: headless Chrome; a DC level whose gain is set each frame by each method; records the output and
// counts sample-to-sample jumps (a smooth curve moves ~2e-5 per sample; a click is a jump far above that)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const srv = createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>t</title>'); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
const dir = mkdtempSync(join(tmpdir(), 'stp-'));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--autoplay-policy=no-user-gesture-required', url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws = null;
for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const call = (method, params) => new Promise((res) => { const my = ++id; const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener('message', on); res(m); } }; ws.addEventListener('message', on); ws.send(JSON.stringify({ id: my, method, params })); });
await call('Page.navigate', { url }); await sleep(1500);
const page = `(async () => {
const wk = 'registerProcessor("rec", class extends AudioWorkletProcessor { constructor(){super(); this.b=[]; this.port.onmessage=()=>{this.port.postMessage(this.b); this.b=[];};} process(i){ if(i[0][0]) this.b.push(new Float32Array(i[0][0])); return true; } });';
const RAMP = { s: 1/60 };
const methods = {
  'cancelAndHold+linear (now)': (p, v, t) => { p.cancelAndHoldAtTime(t); p.linearRampToValueAtTime(v, t + RAMP.s); },
  'setTarget 20 ms (before)': (p, v, t) => p.setTargetAtTime(v, t, 0.02),
  'setTarget 6 ms': (p, v, t) => p.setTargetAtTime(v, t, 0.006),
  'setTarget 8 ms': (p, v, t) => p.setTargetAtTime(v, t, 0.008),
  'setTarget 10 ms': (p, v, t) => p.setTargetAtTime(v, t, 0.010),
};
const out = [];
for (const [name, set] of Object.entries(methods)) {
  const c = new AudioContext({ latencyHint: 'interactive' });
  await c.audioWorklet.addModule(URL.createObjectURL(new Blob([wk], { type: 'text/javascript' })));
  const src = new ConstantSourceNode(c, { offset: 1 }); const g = new GainNode(c, { gain: 0.5 });
  const rec = new AudioWorkletNode(c, 'rec'); const mute = new GainNode(c, { gain: 0 });
  src.connect(g).connect(rec).connect(mute).connect(c.destination); src.start(); await c.resume();
  const t0 = performance.now(); let n = 0;
  await new Promise((done) => { const tick = () => { const now = performance.now(); if (now - t0 > 3000) return done();
    // the game's frame: some main-thread work of random length, then the set
    const w = now + Math.random() * 6; while (performance.now() < w) {}
    set(g.gain, 0.5 + 0.3 * Math.sin(2 * Math.PI * 2 * now / 1000), c.currentTime); n++; setTimeout(tick, 16); }; tick(); });
  const chunks = await new Promise((r) => { rec.port.onmessage = (e) => r(e.data); rec.port.postMessage(0); });
  let max = 0, big = 0, N = 0; let prev = null;
  for (const ch of chunks.slice(40)) for (const x of ch) { if (prev !== null) { const d = Math.abs(x - prev); if (d > max) max = d; if (d > 1e-3) big++; } prev = x; N++; }
  const all = []; for (const ch of chunks.slice(40)) for (const x of ch) all.push(x);
  const W = Math.round(c.sampleRate / 30); let acc = 0, rr = 0, m = 0; for (let i = 0; i < all.length; i++) { acc += all[i]; if (i >= W) acc -= all[i - W]; if (i >= W) { const d = all[i - (W >> 1)] - acc / W; rr += d * d; m++; } }
  out.push('ripple rms ' + Math.sqrt(rr / m).toExponential(2) + ' ' + name + ': frames ' + n + ', samples ' + N + ', max jump ' + max.toExponential(2) + ', jumps > 1e-3: ' + big + ', base ' + (c.baseLatency*1000).toFixed(1) + ' ms');
  await c.close();
}
return out.join(' || '); })()`;
const r = await call('Runtime.evaluate', { expression: page, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r).slice(0, 3000));
ws.close(); chrome.kill(); srv.close(); await sleep(500); try { rmSync(dir, { recursive: true, force: true }); } catch {}
