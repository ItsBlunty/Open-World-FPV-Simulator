import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = p.shared.stringArray, sh = p.shared, t = p.threads[27], m = t.markers, sm = t.samples;
console.log('sampleUnits', JSON.stringify(p.meta.sampleUnits));
const times = new Float64Array(sm.length); { let acc = 0; for (let i = 0; i < sm.length; i++) { acc += sm.timeDeltas[i]; times[i] = acc; } }
const cpuIn = (a, b) => { let cpu = 0, n = 0; for (let i = 1; i < sm.length; i++) if (times[i] > a && times[i] <= b) { cpu += sm.threadCPUDelta[i] ?? 0; n++; } return { cpu, n, wall: b - a }; };
const ticks = []; for (let j = 0; j < m.length; j++) if (S[m.name[j]] === 'RefreshDriverTick' && m.phase[j] === 1) ticks.push([m.startTime[j], m.endTime[j]]);
ticks.sort((a, b) => a[0] - b[0]);
// normal ticks: CPU per ms of tick
const norm = ticks.filter(([s, e]) => e - s > 2 && e - s < 5).slice(1000, 1400).map(([s, e]) => { const c = cpuIn(s, e); return c.cpu / c.wall; }).sort((a, b) => a - b);
console.log('normal ticks: thread CPU per wall ms, p10/p50/p90', norm[40]?.toFixed(3), norm[200]?.toFixed(3), norm[360]?.toFixed(3));
for (const [s, e] of ticks.filter(([s, e]) => e - s > 10)) { const c = cpuIn(s, e); console.log('long tick at', (s / 1000).toFixed(3), 's wall', (e - s).toFixed(1), 'ms; thread CPU', c.cpu, 'per wall ms', (c.cpu / c.wall).toFixed(3), 'samples', c.n); }
// message events: who
const tg = {}; let first = null;
for (let j = 0; j < m.length; j++) { if (S[m.name[j]] !== 'DOMEvent') continue; const d = m.data[j]; if (d?.eventType !== 'message') continue; const k = `${d.target ?? '?'}|phase${m.phase[j]}`; tg[k] = (tg[k] || 0) + 1; if (!first) first = d; }
console.log('message DOMEvent by target/phase', JSON.stringify(tg)); console.log('sample data', JSON.stringify(first));
