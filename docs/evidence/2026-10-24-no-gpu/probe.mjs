// No GPU: super low spec by itself (owner, 2026-10-24), checked in headless Chrome against the dev server on :5173 with
// one profile: first with hardware acceleration off (--disable-gpu: WARP), then on again. Reads the saved setting and the
// page's mode, and shoots the title card and Settings > Graphics. node docs/evidence/2026-10-24-no-gpu/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'nogpu-'));
async function visit(name, flags) {
  const port = 19800 + Math.floor(Math.random() * 90);
  const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
    '--enable-unsafe-webgpu', '--window-size=1280,900', ...flags, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (n) => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(here, `${n}.png`), Buffer.from(s.result.data, 'base64')); console.log('wrote', `${n}.png`); };
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: 'http://localhost:5173/' });
  for (let i = 0; i < 80 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
  await sleep(1500);
  const saved = await js(`(() => { const s = JSON.parse(localStorage.getItem('owfpv.settings') ?? '{}'); return JSON.stringify({ graphics: s.graphics, noGpuFrom: s.noGpuFrom }); })()`);
  console.log(name, 'engine:', await js('__fly.engine'), 'saved:', saved);
  console.log(name, 'title card:', (await js(`document.querySelector('.title-card')?.innerText ?? ''`)).split('\n').filter((l) => /graphics|GRAPHICS/i.test(l)).join(' | '));
  await shot(`${name}-title`);
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Settings' && b.offsetParent)?.click(); 1`); await sleep(500);
  await js(`[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === 'Graphics' && b.offsetParent)?.click(); 1`); await sleep(500);
  await shot(`${name}-settings`);
  ws.close(); proc.kill(); await sleep(1000);
}
await visit('1-acceleration-off', ['--disable-gpu']);
await visit('2-acceleration-off-again', ['--disable-gpu']);
await visit('3-gpu-again', []);
