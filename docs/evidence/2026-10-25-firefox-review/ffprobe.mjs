// Headless Firefox through WebDriver BiDi: open a URL, evaluate expression files, print JSON.
// usage: node ffprobe.mjs <url> <expr.js> [waitMs] [--windowed]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [, , url, exprFile, waitArg, mode] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ffprobe-'));
const port = 19335;
const args = ['-no-remote', '-profile', prof, '--remote-debugging-port', String(port), '-width', '1280', '-height', '800'];
if (mode !== '--windowed') args.unshift('--headless');
const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', [...args, 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 60 && !ws; i++) {
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
try {
    await cmd('session.new', { capabilities: {} });
    const tree = await cmd('browsingContext.getTree', {});
    const ctx = tree.result.contexts[0].context;
    await cmd('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
    await sleep(Number(waitArg ?? 1000));
    // exprFile: a .js expression, or a .json list of steps: {eval: code} | {shot: file} | {sleep: ms}
    const steps = exprFile.endsWith('.json') ? JSON.parse(fs.readFileSync(exprFile, 'utf8')) : [{ eval: fs.readFileSync(exprFile, 'utf8') }];
    for (const st of steps) {
        if (st.sleep) await sleep(st.sleep);
        if (st.eval) {
            const r = await cmd('script.evaluate', { expression: st.eval, target: { context: ctx }, awaitPromise: true });
            if (r.type === 'error' || r.result?.type === 'exception') console.log(JSON.stringify(r.error ?? r.result.exceptionDetails ?? r).slice(0, 500));
            else console.log(r.result.result.value);
        }
        if (st.shot) {
            const sh = await cmd('browsingContext.captureScreenshot', { context: ctx });
            if (sh.result?.data) fs.writeFileSync(st.shot, Buffer.from(sh.result.data, 'base64')); else console.log('shot failed', JSON.stringify(sh).slice(0, 300));
        }
    }
    await cmd('browser.close', {});
} finally {
    await sleep(500);
    try { proc.kill(); } catch {}
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
