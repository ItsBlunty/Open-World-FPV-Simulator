// Replay radio controls end to end (owner, 2026-10-24: "finish and try them"), in headless Chrome against the dev server
// on :5173 with a stand-in radio: navigator.getGamepads gives a fake 8-axis pad whose sticks this script moves, with a
// saved radio profile for it (mode 2: roll axis 0, pitch 1, throttle 2, yaw 3). Flies 12 s, opens the replay, ticks Radio
// controls, then: a small jitter, roll right, roll left, pitch pushes, the box off and on. Logs the playhead each step
// and shoots the viewer. node docs/evidence/2026-10-24-replay-radio/probe.mjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-'));
const port = 19800 + Math.floor(Math.random() * 90);
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--headless=new', '--no-first-run',
  '--enable-unsafe-webgpu', '--window-size=1280,800', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let seq = 0; const wait = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(`error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
};
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result?.result?.value;
};
const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(here, `${name}.png`), Buffer.from(s.result.data, 'base64')); console.log('wrote', `${name}.png`); };
await cdp('Page.enable'); await cdp('Runtime.enable');
const ID = 'Fake Radio (probe)';
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: [
  'window.__pad = { axes: [0, 0, -1, 0, 0, 0, 0, 0] };',
  'const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));',
  `navigator.getGamepads = () => [{ id: ${JSON.stringify(ID)}, index: 0, connected: true, mapping: '', axes: window.__pad.axes.slice(), buttons, timestamp: performance.now(), vibrationActuator: null }];`
].join('\n') });
await cdp('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(1500);
const cal = (index) => ({ index, invert: false, min: -1, center: 0, max: 1 });
const profile = { version: 1, deviceKey: `gp:${ID}:8:16:`, deviceName: ID, stickMode: 2, axes: { roll: cal(0), pitch: cal(1), throttle: cal(2), yaw: cal(3) }, arm: null, mode: null, reset: null, turtle: null, deadband: 0, created: new Date().toISOString() };
const store = { 'owfpv.radioProfiles': JSON.stringify({ [profile.deviceKey]: profile }), 'owfpv.settings': JSON.stringify({ version: 1, lens: 'none', fovDeg: 90, lastDevice: profile.deviceKey }) };
await js(`localStorage.clear(); for (const [k, v] of Object.entries(${JSON.stringify(store)})) localStorage.setItem(k, v); location.reload(); 1`);
for (let i = 0; i < 60 && !(await js(`!!window.__fly && !__fly.engine.includes('starting')`)); i++) await sleep(500);
await sleep(2500);
await js([
  "window.click = (t) => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t && b.offsetParent); b?.click(); return !!b; };",
  "window.key = (code) => { dispatchEvent(new KeyboardEvent('keydown', { code, key: code })); dispatchEvent(new KeyboardEvent('keyup', { code, key: code })); };",
  'window.sticks = (roll, pitch, thr, yaw) => { __pad.axes = [roll, pitch, thr, yaw, 0, 0, 0, 0]; return 1; };',
  "window.radioBox = () => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Radio controls'))?.querySelector('input');",
  '1'
].join('\n'));
console.log('radio:', await js(`document.querySelector('.title-radio')?.innerText`));
await js(`click('Start flying')`); await sleep(1000);
// arm (Space: the profile has no arm switch), climb and fly forward for 12 s
await js(`sticks(0, 0, -1, 0); key('Space'); 1`); await sleep(500);
await js('sticks(0, 0.15, 0.1, 0)'); await sleep(4000);
await js('sticks(0.3, 0.2, 0, 0)'); await sleep(4000);
await js('sticks(0, 0, -0.2, 0)'); await sleep(4000);
await js(`sticks(0, 0, -1, 0); key('Space'); 1`); await sleep(500);
await js(`key('Escape'); 1`); await sleep(500);
console.log('flight replay:', await js(`click('Flight replay')`)); await sleep(1500);
console.log('watch:', await js(`click('Watch')`));
for (let i = 0; i < 60 && !(await js(`!!document.querySelector('.replay-time')?.offsetParent`)); i++) await sleep(500);
await sleep(1000);
const head = () => js(`document.querySelector('.replay-time').textContent + ' ' + (document.querySelector('.replay-wind')?.textContent ?? '') + ' [' + document.querySelector('.replay-play').textContent + ']'`);
console.log('opened:', await head());
// pause with the button, then turn the radio controls on
await js(`document.querySelector('.replay-play').click(); 1`); await sleep(300);
console.log('radio controls:', await js(`radioBox() ? (radioBox().click(), 'ticked') : 'no box'`), '| paused at', await head());
await shot('1-radio-on-paused');
const step = async (label, s, ms) => { await js(`sticks(${s.join(',')})`); await sleep(ms); console.log(label.padEnd(38), await head()); };
await step('jitter: roll 0.4, pitch 0.7, yaw 0.3', [0.4, 0.7, -1, 0.3], 1500);
await step('centre', [0, 0, -1, 0], 300);
await step('roll right 0.75 for 2 s (2.4x)', [0.75, 0, -1, 0], 2000);
await shot('2-winding-forward');
await step('roll left full for 1 s (8x back)', [-1, 0, -1, 0], 1000);
await shot('3-winding-back');
await step('centre', [0, 0, -1, 0], 500);
await step('pitch full forward: play', [0, 1, -1, 0], 300);
await step('held 1.5 s (no second toggle)', [0, 1, -1, 0], 1500);
await step('back to centre, 1 s', [0, 0, -1, 0], 1000);
await step('pitch full back: pause', [0, -1, -1, 0], 300);
await step('centre, 1 s', [0, 0, -1, 0], 1000);
await js('radioBox().click(); 1');
await step('box off, roll right 1.5 s', [1, 0, -1, 0], 1500);
await js('radioBox().click(); 1');
await step('box on again, roll still held 1 s', [1, 0, -1, 0], 1000);
await js('sticks(0, 0, -1, 0)');
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); proc.kill();
