// Headless Chrome on SwiftShader (software GPU: the CPU draws every pixel) as a stand-in for a laptop with barely a GPU.
// usage: node fps.mjs <url> [settingsJSON] [cpuThrottle] [seconds] [swiftshader|gpu]   env PROF=1 prints a JS profile
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [, , url, settingsJson = '', throttle = '1', secs = '10', gpu = 'swiftshader'] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'lowspec-'));
const port = 19400 + Math.floor(Math.random() * 500);
const flags = [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, '--window-size=1366,768',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
if (gpu === 'swiftshader') flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
else flags.push('--enable-gpu', '--enable-unsafe-webgpu');
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [...flags, 'about:blank'], { stdio: 'ignore' });
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
await sleep(3000);

const measure = (sec) => ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); function f(t) { n++; if (t - t0 < ${sec * 1000}) requestAnimationFrame(f); else res(+(n * 1000 / (t - t0)).toFixed(2)); } requestAnimationFrame(f); })`);
const ask = (code) => ev(`__fly.ask(${JSON.stringify(code)}).then((v) => JSON.stringify(v)).catch((e) => 'ERR ' + e.message)`);
const exps = JSON.parse(fs.readFileSync(process.env.EXPS, 'utf8'));
console.log('backend', ready, 'loadS', loadS);
for (const [name, code] of exps) { const a = !code ? '' : code.startsWith('page:') ? JSON.stringify(await ev(code.slice(5))) : await ask(code); await sleep(1500); console.log(name.padEnd(40), 'fps', await measure(Number(secs)), String(a).slice(0, 4000)); }
console.log(logs.filter((l) => /^(error|warn)|EXC|renderer/i.test(l)).slice(0, 6).join('\n'));
await cmd('Browser.close'); proc.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(0);
