// Drive a real windowed Firefox (WebDriver BiDi) or Chrome (CDP) with a throwaway profile and evaluate JS in pages.
// usage: node drive.mjs firefox|chrome <base url>   -> prints one JSON line per check
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [, , which, base] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), `${which}-`));

let proc, evalIn, navigate, close;
if (which === 'firefox') {
    const port = 19333;
    proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['-no-remote', '-profile', prof, '--remote-debugging-port', String(port), '-width', '1280', '-height', '800', 'about:blank'], { stdio: 'ignore' });
    let ws;
    for (let i = 0; i < 40 && !ws; i++) {
        await sleep(500);
        try {
            const w = new WebSocket(`ws://127.0.0.1:${port}/session`);
            await new Promise((res, rej) => { w.onopen = res; w.onerror = rej; });
            ws = w;
        } catch {}
    }
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const cmd = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await cmd('session.new', { capabilities: {} });
    const tree = await cmd('browsingContext.getTree', {});
    const ctx = tree.result.contexts[0].context;
    navigate = (url) => cmd('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
    evalIn = async (expr) => {
        const r = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, serializationOptions: { maxObjectDepth: 4 } });
        if (r.type === 'error' || r.result?.type === 'exception') return { error: JSON.stringify(r.error ?? r.result.exceptionDetails?.text ?? r) };
        return JSON.parse(r.result.result.value);
    };
    close = async () => { try { await cmd('browser.close', {}); } catch {} };
} else {
    const port = 19334;
    proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
    let target;
    for (let i = 0; i < 40 && !target; i++) {
        await sleep(500);
        try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res) => { ws.onopen = res; });
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const cmd = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await cmd('Page.enable', {});
    navigate = async (url) => { await cmd('Page.navigate', { url }); await sleep(1500); };
    evalIn = async (expr) => {
        const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
        return JSON.parse(r.result.result.value);
    };
    close = async () => { try { await cmd('Browser.close', {}); } catch {} };
    globalThis.shot = async (file) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
}

// wait until the engine is ready, then let it run, then read the HUD footer and count how many 1 ms worker-clock
// ticks reach the page's main thread in 3 s (the chances the gamepad poll gets)
const measure = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(200);
  await sleep(3000);
  // each tick carries the worker's absolute time: lateness = when the page got it - when it was sent
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(performance.timeOrigin + performance.now()), 1)'], { type: 'text/javascript' })));
  let n = 0, late = [], gaps = [], last = 0;
  w.onmessage = (e) => { const now = performance.timeOrigin + performance.now(); n++; late.push(now - e.data); if (last) gaps.push(now - last); last = now; };
  await sleep(1000); n = 0; late = []; gaps = []; await sleep(3000); w.terminate();
  late.sort((a, b) => a - b);
  const q = (a, f) => +a[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2);
  // a tick less than 0.5 ms after the one before arrived in the same bunch: it can see no new gamepad value
  const apart = gaps.filter((g) => g >= 0.5).length;
  const footer = document.querySelector('#hud .bottom')?.textContent ?? '';
  const tick = await __fly.ask('return fly.session.sim.tick').catch((e) => String(e));
  return JSON.stringify({ engine: __fly.engine, footer, pageClockTicksPerS: n / 3, apartPerS: +(apart / 3).toFixed(1), lateP50: q(late, 0.5), lateP95: q(late, 0.95), lateMax: q(late, 0.999), simTick: tick, ua: navigator.userAgent.replace(/.*(Firefox|Chrome)\\/(\\d+).*/, '$1 $2') });
})()`;
const selftest = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 300 && !window.__selftest; i++) await sleep(200);
  const s = window.__selftest; return JSON.stringify(s ? { ok: s.ok, flightOk: s.flightOk, trafficOk: s.trafficOk, hash: s.hash, traffic: s.traffic, engine: __fly.engine } : { error: 'no selftest result' });
})()`;

// imitation of Firefox's gamepad path: a worker posts numbered updates every 4 ms (Firefox's drain timer); the page
// keeps only the latest (as getGamepads); a poller on clock A (setInterval 1, clamped) or B (1 ms timeouts set from
// message tasks) counts distinct updates seen. caught/sent is the share of the radio's values the sim would get.
const catchRate = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(200);
  await sleep(2000);
  const mk = (src) => new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  const out = {};
  for (const [name, src] of [['clampedInterval', 'setInterval(() => postMessage(0), 1);'],
      ['bounce', 'const mc = new MessageChannel(); mc.port1.onmessage = () => setTimeout(tick, 1); function tick() { postMessage(0); mc.port2.postMessage(0); } tick();'], ['postTask', 'posttask']]) {
    let latest = 0, seen = 0, lastSeen = 0, polls = 0;
    const upd = mk('let n = 0; setInterval(() => postMessage(++n), 4);');
    upd.onmessage = (e) => { latest = e.data; };
    const poll = () => { polls++; if (latest !== lastSeen) { lastSeen = latest; seen++; } };
    let clk;
    if (src === 'posttask') { let on = true; const f = () => { if (!on) return; poll(); scheduler.postTask(f, { delay: 1 }); }; f(); clk = { terminate() { on = false; } }; }
    else { clk = mk(src); clk.onmessage = poll; }
    // a page timer next to the clock: does the clock slow it? (the simulated radio runs on one)
    let pt = 0; const pti = setInterval(() => pt++, 2);
    await sleep(500);
    const s0 = latest, seen0 = seen, p0 = polls;
    await sleep(4000);
    const sent = latest - s0;
    clearInterval(pti);
    out[name] = { pageTimerPerS: +(pt / 4.5).toFixed(0), sentPerS: +(sent / 4).toFixed(1), caughtPerS: +((seen - seen0) / 4).toFixed(1), share: +((seen - seen0) / sent).toFixed(3), pollsPerS: +((polls - p0) / 4).toFixed(1) };
    upd.terminate(); clk.terminate();
  }
  return JSON.stringify({ engine: __fly.engine, footer: document.querySelector('#hud .bottom')?.textContent ?? '', ...out });
})()`;
// the page's UI drives the worker: free-fly keys and mouse, spawn menu, a settings slider, resize
const uiCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(200);
  await sleep(${+(process.env.WAIT ?? 1000)});
  const ask = (c) => __fly.ask(c);
  const cam = () => ask('const p = fly.view.camera.position, q = fly.view.camera.quaternion; return [p.x, p.y, p.z, q.x, q.y, q.z, q.w].map((v) => +v.toFixed(3));');
  const r = {};
  // close the menu: "Look around"
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Look around').click();
  await sleep(500);
  r.freeCamActive = await ask('return fly.freeCam.active');
  const c0 = await cam();
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  await sleep(1000);
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  await sleep(200);
  const c1 = await cam();
  r.wMovedM = +Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]).toFixed(2);
  // drag to steer (mouse captured or a button held)
  const cv = document.querySelector('canvas');
  cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  for (let i = 0; i < 10; i++) { dispatchEvent(new MouseEvent('mousemove', { movementX: 20, movementY: 0 })); await sleep(20); }
  dispatchEvent(new MouseEvent('mouseup'));
  if (document.pointerLockElement) document.exitPointerLock();
  await sleep(200);
  const c2 = await cam();
  r.mouseTurned = c2.slice(3).some((v, i) => Math.abs(v - c1[3 + i]) > 0.01);
  r.hudMid = document.querySelector('#hud .mid')?.textContent;
  r.footer = document.querySelector('#hud .bottom')?.textContent;
  // menu again: paused, then pick another spawn
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  await sleep(300);
  r.pausedInMenu = await ask('return fly.session.paused');
  const sel = document.querySelector('select');
  const before = await ask('return fly.session.spawn.id');
  sel.value = [...sel.options].find((o) => o.value !== before).value;
  sel.dispatchEvent(new Event('change'));
  await sleep(500);
  r.spawn = { before, after: await ask('return fly.session.spawn.id'), menu: sel.value };
  // settings: field of view slider
  [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Settings')).click();
  await sleep(200);
  const fov = [...document.querySelectorAll('input[type=range]')][1];
  fov.value = '100'; fov.dispatchEvent(new Event('input'));
  await sleep(300);
  r.fovSetting = await ask('return fly.view.fovDeg');
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Done').click();
  // resize
  const size0 = await ask('const c = fly.renderer.domElement; return [c.width, c.height]');
  r.canvasPx = size0;
  r.css = [innerWidth, innerHeight, devicePixelRatio];
  r.engine = __fly.engine;
  return JSON.stringify(r);
})()`;
// a simulated radio through the page's real path (onRaw -> mapFrame -> message -> worker -> physics)
const radioCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cal = (index) => ({ index, min: -1, center: 0, max: 1, invert: false });
  localStorage.setItem('owfpv.radioProfiles', JSON.stringify({ 'test:simulated': { version: 1, deviceKey: 'test:simulated', deviceName: 'Simulated radio',
    stickMode: 2, axes: { roll: cal(0), pitch: cal(1), throttle: cal(2), yaw: cal(3) }, arm: null, mode: null, reset: null, turtle: null, deadband: 0, created: 'test' } }));
  for (let i = 0; i < 100 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(200);
  await sleep(${+(process.env.WAIT ?? 0)});
  const feed = __fly.fakeRadio();
  let thr = -1;
  const axes = new Float32Array(8);
  const id = setInterval(() => { axes[2] = thr; feed({ t: performance.now(), axes, buttons: 0 }); }, 2);
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Fly').click();
  await sleep(800);
  const st = () => __fly.ask('const s = fly.session.sim.s; return { armed: s[fly.S.armed] > 0, y: +s[fly.S.py].toFixed(2), tick: fly.session.sim.tick, pending: fly.session.clock.pending }');
  const r = { start: await st() };
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
  await sleep(500);
  r.armedLow = await st();
  thr = 0.4;
  await sleep(1500);
  r.climbing = await st();
  clearInterval(id);
  await sleep(400);
  r.afterSilence = await st();
  r.footer = document.querySelector('#hud .bottom')?.textContent;
  r.engine = __fly.engine;
  r.padClock = __fly.padClock;
  localStorage.removeItem('owfpv.radioProfiles');
  return JSON.stringify(r);
})()`;
// first-turn stutter: after load, close the menu, drag the free camera 360 deg round, then down and up; frame times from rAF
const spinCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(100);
  const tReady = performance.now();
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Look around').click();
  await sleep(1500);
  const frames = [];
  let last = performance.now(), on = true;
  const raf = (t) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(raf); };
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(raf); });
  const cv = document.querySelector('canvas');
  cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const step = (dx, dy, n) => new Promise((res) => { let i = 0; const f = () => { dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy })); if (++i < n) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  await step(30, 0, 84);   // 84 * 30 px * 0.0025 rad = 360 deg
  await step(0, 25, 24);   // down 86 deg
  await step(0, -25, 48);  // up to 86 deg above
  await step(30, 0, 84);   // round again: anything left?
  dispatchEvent(new MouseEvent('mouseup'));
  on = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const firstSpin = frames.slice(0, 84 + 24 + 48), secondSpin = frames.slice(84 + 24 + 48);
  const sum = (a) => ({ frames: a.length, over25ms: a.filter((x) => x > 25).length, over50ms: a.filter((x) => x > 50).length, maxMs: +Math.max(...a).toFixed(1), worst5: a.slice().sort((x, y) => y - x).slice(0, 5).map((x) => +x.toFixed(0)) });
  return JSON.stringify({ slowAt: frames.map((x, i) => [i, +x.toFixed(0)]).filter(([, x]) => x > 12), engine: __fly.engine, readyAfterMs: Math.round(tReady), first: sum(firstSpin), second: sum(secondSpin) });
})()`;
// flying across the map: free camera, Shift+W (40 m/s) for 15 s on two headings; rAF frame times
const flyCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(100);
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Look around').click();
  await sleep(1500);
  const frames = []; let last = 0, on = true;
  const raf = (t) => { if (last) frames.push([t, t - last]); last = t; if (on) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  const cv = document.querySelector('canvas');
  const turn = (dx, n) => new Promise((res) => { cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); let i = 0; const f = () => { dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0 })); if (++i < n) requestAnimationFrame(f); else { dispatchEvent(new MouseEvent('mouseup')); res(); } }; requestAnimationFrame(f); });
  // level out: the free camera starts with the FPV camera's 20 deg uptilt, and W flies where it looks
  await new Promise((res) => { cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); let i = 0; const f = () => { dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 14 })); if (++i < 10) requestAnimationFrame(f); else { dispatchEvent(new MouseEvent('mouseup')); res(); } }; requestAnimationFrame(f); });
  // up 40 m first (Space, Shift: 40 m/s for 1 s), so the flight crosses the city above the roads
  dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
  await sleep(1000);
  dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
  await __fly.ask('const n = fly.renderer._nodes; const c = n._createNodeBuilder.bind(n); globalThis.__builds = []; n._createNodeBuilder = (ro, m) => { globalThis.__builds.push([Math.round(performance.now()), ro.object.name || ro.object.type, m.type, ro.camera.type]); return c(ro, m); }; return 1');
  const startPos = await __fly.ask('const p = fly.view.camera.position; return [p.x, p.y, p.z].map((v) => Math.round(v))');
  dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  await sleep(10000);
  await turn(20, 30);   // ~86 deg
  await sleep(10000);
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
  on = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const pos = await __fly.ask('const p = fly.view.camera.position; return [p.x, p.y, p.z].map((v) => Math.round(v))');
  const builds = await __fly.ask('return globalThis.__builds');
  const d = frames.map((x) => x[1]); const t0 = frames[0][0];
  return JSON.stringify({ shaderBuildsInFlight: builds.length, buildsByCamera: builds.reduce((o, b) => (o[b[3]] = (o[b[3]] || 0) + 1, o), {}), buildSample: builds.slice(0, 6), engine: __fly.engine, startPos, endPos: pos, frames: d.length, over12_5: d.filter((x) => x > 12.5).length, over20: d.filter((x) => x > 20).length, maxMs: +Math.max(...d).toFixed(1), slow: frames.filter((x) => x[1] > 12.5).map((x) => [+((x[0] - t0) / 1000).toFixed(2), +x[1].toFixed(0)]) });
})()`;
// shader builds still to come after loading: slide the sun's shadow square over the whole level (120 m steps)
// and count Three.js node builds (each is a new pipeline: a mid-flight stutter)
const sweepCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(100);
  await sleep(500);
  return JSON.stringify(await __fly.ask(\`
    const r = fly.renderer, n = r._nodes, c = n._createNodeBuilder.bind(n), builds = [];
    n._createNodeBuilder = (ro, m) => { builds.push((ro.object.name || ro.object.type) + ' / ' + m.type + ' / ' + ro.camera.type); return c(ro, m); };
    const lvl = fly.scene.children.find((o) => (o.name || '').startsWith('level:'));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of lvl.children) { const b = m.geometry.boundingSphere; x0 = Math.min(x0, b.center.x - b.radius); x1 = Math.max(x1, b.center.x + b.radius); z0 = Math.min(z0, b.center.z - b.radius); z1 = Math.max(z1, b.center.z + b.radius); }
    const p = fly.view.camera.position.clone(); let spots = 0;
    for (let x = x0; x <= x1; x += 120) for (let z = z0; z <= z1; z += 120) { p.set(x, 20, z); fly.sun.follow(p); r.render(fly.scene, fly.view.camera); spots++; }
    fly.sun.follow(fly.view.camera.position);
    n._createNodeBuilder = c;
    const by = {}; for (const b of builds) by[b] = (by[b] || 0) + 1;
    return { engine: 'x', extent: [x0, x1, z0, z1].map(Math.round), spots, buildsAfterLoad: builds.length, by };
  \`));
})()`;
// garbage: 60 s of ?demo with a gamepad-like clock (worker ticks, getGamepads() each) while Firefox's profiler records
const gcCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(100);
  const w = new Worker(URL.createObjectURL(new Blob(['const mc = new MessageChannel(); mc.port1.onmessage = () => setTimeout(tick, 1); function tick() { postMessage(0); mc.port2.postMessage(0); } tick();'], { type: 'text/javascript' })));
  const variant = '${process.env.GPUVAR ?? ''}';
  if (variant.includes('freeze')) await __fly.ask('fly.sun.follow = () => {}; return 1');
  if (variant.includes('every')) await __fly.ask('const k = ' + variant.replace(/.*every/, '') + ', sh = fly.sun.light.shadow; sh.autoUpdate = false; let i = 0; const r = fly.renderer, r0 = r.render.bind(r); let last = 0; r.render = (sc, cam) => { const q = performance.now(); if (q - last > 2 && ++i % k === 0) sh.needsUpdate = true; last = q; return r0(sc, cam); }; return 1');
  let n = 0; w.onmessage = () => { n++; navigator.getGamepads(); }; if (${process.env.NOCLOCK ? 1 : 0}) w.terminate();
  const frames = []; let last = 0, on = true; const raf = (t) => { if (last) frames.push(t - last); last = t; if (on) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
  await sleep(60000); on = false; w.terminate();
  return JSON.stringify({ variant, engine: __fly.engine, clockTicksPerS: Math.round(n / 60), frames: frames.length, over12_5: frames.filter((x) => x > 12.5).length, maxMs: +Math.max(...frames).toFixed(1) });
})()`;
// which WebGPU objects Three.js creates per second while flying (each is a browser object with native memory)
const gpuCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(100);
  await sleep(2000);
  const variant = '${process.env.GPUVAR ?? ''}';
  if (variant === 'freeze') await __fly.ask('fly.sun.follow = () => {}; return 1');
  if (variant.startsWith('every')) await __fly.ask('const k = ' + variant.slice(5) + ', sh = fly.sun.light.shadow; sh.autoUpdate = false; let i = 0; const r = fly.renderer, r0 = r.render.bind(r); let last = 0; r.render = (sc, cam) => { const q = performance.now(); if (q - last > 2 && ++i % k === 0) sh.needsUpdate = true; last = q; return r0(sc, cam); }; return 1');
  const counts = {};
  const wrap = (proto, cls) => { if (!proto) return; for (const k of Object.getOwnPropertyNames(proto)) { if (!/^(create|begin|finish|writeBuffer|writeTexture|submit|setBindGroup|getCurrentTexture)/.test(k)) continue; const d = Object.getOwnPropertyDescriptor(proto, k); if (typeof d.value !== 'function') continue; const f = d.value; proto[k] = function (...a) { const key = cls + '.' + k; counts[key] = (counts[key] || 0) + 1; return f.apply(this, a); }; } };
  wrap(window.GPUDevice?.prototype, 'device'); wrap(window.GPUCommandEncoder?.prototype, 'encoder'); wrap(window.GPUQueue?.prototype, 'queue'); wrap(window.GPUTexture?.prototype, 'texture'); wrap(window.GPURenderPassEncoder?.prototype, 'pass'); wrap(window.GPUCanvasContext?.prototype, 'canvas');
  const t0 = performance.now(); let frames = 0, on = true; const raf = () => { frames++; if (on) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
  await sleep(5000); on = false;
  const secs = (performance.now() - t0) / 1000;
  const perFrame = {}; for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) perFrame[k] = +(v / frames).toFixed(2);
  return JSON.stringify({ variant, engine: __fly.engine, fps: Math.round(frames / secs), perFrame });
})()`;
const cpuCheck = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !(window.__fly && !__fly.engine.includes('starting')); i++) await sleep(100);
  await sleep(3000);
  await __fly.ask('const R = fly.renderer, r0 = R.render.bind(R); globalThis.__rt = 0; globalThis.__rn = 0; R.render = (s, c) => { const t = performance.now(); const x = r0(s, c); globalThis.__rt += performance.now() - t; globalThis.__rn++; return x; }; return 1');
  const fr = []; let last = 0, on = true, busy = 0; const raf = (t) => { if (last) fr.push(t - last); last = t; if (on) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
  // page main-thread busy share: a 0 ms timer chain's lateness
  await sleep(10000); on = false;
  const r = await __fly.ask('return { ms: globalThis.__rt, n: globalThis.__rn }');
  fr.sort((a, b) => a - b);
  return JSON.stringify({ engine: __fly.engine, fps: +(fr.length / 10).toFixed(1), renderCallsPerFrame: +(r.n / fr.length).toFixed(1), renderCpuMsPerFrame: +(r.ms / fr.length).toFixed(2), p50: +fr[fr.length >> 1].toFixed(1), p95: +fr[Math.floor(fr.length * 0.95)].toFixed(1), dpr: devicePixelRatio, w: innerWidth, h: innerHeight });
})()`;
const runs = (process.argv[4] ?? 'demo,demo-main,demo-webgl,selftest').split(',');
const urls = { 'demo-city': '?demo&spawn=city', demo: '?demo', 'demo-main': '?demo&render=main', 'demo-worker': '?demo&render=worker', 'demo-noshadows': '?demo&noshadows', 'demo-webgl': '?demo&webgl', 'demo-low': '?demo&lowspec', 'demo-webgl-main': '?demo&webgl&render=main', selftest: '?selftest', menu: '' };
for (const r of runs) {
    await navigate(`${base}/${urls[r]}`);
    if (process.env.SETTINGS) {
        await evalIn(`(() => { localStorage.setItem('owfpv.settings', JSON.stringify(${process.env.SETTINGS})); return '1'; })()`);
        await navigate(`${base}/${urls[r]}`);
    }
    const out = await evalIn(r === 'selftest' ? selftest : process.env.CATCH ? catchRate : process.env.UI ? uiCheck : process.env.RADIO ? radioCheck : process.env.SPIN ? spinCheck : process.env.FLY ? flyCheck : process.env.SWEEP ? sweepCheck : process.env.GC ? gcCheck : process.env.GPU ? gpuCheck : process.env.CPU ? cpuCheck : measure);
    console.log(JSON.stringify({ browser: which, run: r, ...out }));
    if (process.env.SHOT && globalThis.shot) { await globalThis.shot(process.env.SHOT); console.log('screenshot', process.env.SHOT); }
}
await close();
await sleep(1500);
try { proc.kill(); } catch {}
