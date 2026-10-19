// Headless Chrome on SwiftShader (software GPU: the CPU draws every pixel) as a stand-in for a laptop with barely a GPU.
// usage: node fps.mjs <url> [settingsJSON] [cpuThrottle] [seconds] [swiftshader|gpu]   env PROF=1 prints a JS profile
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [, , url, settingsJson = '', throttle = '1', secs = '10', gpu = 'swiftshader'] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'lowspec-'));
const port = 19400 + Math.floor(Math.random() * 500);
const flags = [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, '--window-size=1366,768',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
if (gpu === 'warp') flags.push('--disable-gpu');
else if (gpu === 'swiftshader') flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
else flags.push('--enable-gpu', '--enable-unsafe-webgpu');
const CH='C:/Program Files/Google/Chrome/Application/chrome.exe'; const proc = process.env.AFF ? spawn('cmd', ['/c', 'start', '""', '/affinity', process.env.AFF, CH, ...flags, 'about:blank'], { stdio: 'ignore', windowsVerbatimArguments: false }) : spawn(CH, [...flags, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + m.params.exceptionDetails.exception?.description);
};
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description } : r.result.result.value;
};
await cmd('Runtime.enable'); await cmd('Page.enable');
const origin = new URL(url).origin;
if (settingsJson) { await cmd('Page.navigate', { url: origin + '/blank.html' }); for (let i = 0; i < 20; i++) { await sleep(250); const ok = await ev(`(() => { try { localStorage.setItem('owfpv.settings', ${JSON.stringify(settingsJson)}); return location.pathname; } catch (e) { return null; } })()`); if (ok === '/blank.html') break; } }
if (Number(throttle) > 1) await cmd('Emulation.setCPUThrottlingRate', { rate: Number(throttle) });
const t0 = Date.now();
await cmd('Page.navigate', { url });
const READY = `(() => { const e = globalThis.__fly && globalThis.__fly.engine; if (document.body.innerText.includes('renderer failed')) return 'FAILED'; return e && !e.includes('starting') ? e : null; })()`;
let ready = null;
for (let i = 0; i < 40 && !ready; i++) { await sleep(500); ready = await ev(READY); }
const loadS = (Date.now() - t0) / 1000;
if (process.env.PRE) await ev(`__fly.ask(${JSON.stringify(fs.readFileSync(process.env.PRE,"utf8"))})`);
await sleep(3000);
let profile;
if (process.env.PROF) {
    await cmd('Profiler.enable'); await cmd('Profiler.start'); await sleep(4000);
    const pr = (await cmd('Profiler.stop')).result.profile;
    const byId = new Map(pr.nodes.map((n) => [n.id, n])); const self = new Map();
    pr.samples.forEach((s, i) => { const f = byId.get(s).callFrame; const k = `${f.functionName} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) || 0) + pr.timeDeltas[i] / 1000); });
    profile = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
}
const r = await ev(`new Promise((res) => { const ts = []; let last = performance.now(); const end = last + ${Number(secs) * 1000};
  function f(t) { ts.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); const n = ts.length;
  res({ frames: n, fps: +(n / ${Number(secs)}).toFixed(1), p50: +ts[Math.floor(n * 0.5)].toFixed(1), p95: +ts[Math.floor(n * 0.95)].toFixed(1), max: +ts[n - 1].toFixed(1) }); } }
  requestAnimationFrame(f); })`);
if (process.env.SHOT) { const sh = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.env.SHOT, Buffer.from(sh.result.data, 'base64')); }
const extra = process.env.EXTRA ? await ev(process.env.EXTRA) : undefined;
console.log(JSON.stringify({ url, settings: settingsJson ? JSON.parse(settingsJson) : null, throttle: Number(throttle), gpu, backend: ready, loadS, ...r, extra, logs: logs.slice(0, 6) }));
if (profile) console.log(profile.join('\n'));
await cmd('Browser.close'); proc.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(0);
