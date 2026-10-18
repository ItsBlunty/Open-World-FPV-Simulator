import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = p.shared.stringArray, sh = p.shared;
const t = p.threads[27], m = t.markers;
// interval markers only (phase 1)
const iv = (name) => { const out = []; for (let j = 0; j < m.length; j++) if (S[m.name[j]] === name && m.phase[j] === 1) out.push({ s: m.startTime[j], e: m.endTime[j], data: m.data[j] }); return out.sort((a, b) => a.s - b.s); };
const ticks = iv('RefreshDriverTick');
console.log('RefreshDriverTick', ticks.length, 'from', (ticks[0].s / 1000).toFixed(1), 'to', (ticks.at(-1).s / 1000).toFixed(1), 's');
const gaps = [];
for (let i = 1; i < ticks.length; i++) gaps.push({ at: ticks[i].s, gap: ticks[i].s - ticks[i - 1].s, prevDur: ticks[i - 1].e - ticks[i - 1].s });
const gs = gaps.map(g => g.gap).sort((a, b) => a - b);
const q = (a, f) => +a[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2);
console.log('tick interval p01', q(gs, 0.01), 'p50', q(gs, 0.5), 'p99', q(gs, 0.99), 'max', q(gs, 1));
const durs = ticks.map(x => x.e - x.s).sort((a, b) => a - b);
console.log('tick duration p50', q(durs, 0.5), 'p99', q(durs, 0.99), 'max', q(durs, 1));
// samples -> function names
const samp = t.samples; const times = samp.time ?? (() => { const out = new Float64Array(samp.length); let acc = 0; for (let i = 0; i < samp.length; i++) { acc += samp.timeDeltas[i]; out[i] = acc; } return out; })();
const fnName = (fr) => S[sh.funcTable.name[sh.frameTable.func[fr]]];
const stackFuncs = (st) => { const out = []; let g = 0; while (st >= 0 && g++ < 300) { out.push(fnName(sh.stackTable.frame[st])); const o = sh.stackTable.prefixOffset[st]; if (o === 0) break; st -= o; } return out; };
const window = (a, b) => { const self = {}, incl = {}; let n = 0; for (let i = 0; i < samp.length; i++) { if (times[i] < a || times[i] > b) continue; const st = samp.stack[i]; if (st == null) continue; n++; const fs2 = stackFuncs(st); self[fs2[0]] = (self[fs2[0]] || 0) + 1; for (const f of new Set(fs2)) incl[f] = (incl[f] || 0) + 1; } return { n, self, incl }; };
const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([f, c]) => `${c} ${f.slice(0, 70)}`);
// the long gaps (missed frames) and long ticks
const bad = gaps.filter(g => g.gap > 12.5).sort((a, b) => b.gap - a.gap);
console.log('missed-frame gaps (>12.5 ms):', bad.length);
for (const g of bad.slice(0, 8)) {
  const a = g.at - g.gap, b = g.at;
  const w = window(a, b);
  const gcs = []; for (const nm of ['GCMinor', 'GCSlice', 'CCSlice']) for (const x of iv(nm)) if (x.s < b && x.e > a) gcs.push(`${nm} ${(x.e - x.s).toFixed(2)}`);
  console.log(`\n== gap ${g.gap.toFixed(1)} ms ending at ${(b / 1000).toFixed(3)} s (prev tick took ${g.prevDur.toFixed(1)} ms); samples ${w.n}; GC: ${gcs.join(', ') || 'none'}`);
  console.log('  self:', top(w.self, 8).join(' | '));
  console.log('  incl:', top(w.incl, 14).join(' | '));
}
