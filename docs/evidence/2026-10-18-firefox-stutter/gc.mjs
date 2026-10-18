import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = p.shared.stringArray;
const t = p.threads[27], m = t.markers;
const q = (a, f) => a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : null;
const by = {};
for (let j = 0; j < m.length; j++) {
  const n = S[m.name[j]];
  if (!/^(GC|CC|requestAnimationFrame|Jank|Paint|Refresh|WebGPU: QueueSubmit|DOMEvent)/.test(n)) continue;
  const s = m.startTime[j], e = m.endTime[j];
  const d = e != null && s != null ? e - s : null;
  (by[n] ||= []).push({ s, d, data: m.data[j] });
}
const t0 = p.meta.startTime;
for (const [n, arr] of Object.entries(by)) {
  const ds = arr.map(x => x.d).filter(x => x != null).sort((a, b) => a - b);
  console.log(n.padEnd(34), 'count', String(arr.length).padStart(6), 'dur p50', q(ds, 0.5), 'p99', q(ds, 0.99), 'max', ds.length ? +ds[ds.length - 1].toFixed(2) : null, 'total', +ds.reduce((a, b) => a + b, 0).toFixed(0));
}
// GCMinor reasons and nursery
const reasons = {};
for (const x of by.GCMinor || []) { const r = x.data?.nursery?.reason ?? x.data?.reason ?? '?'; reasons[r] = (reasons[r] || 0) + 1; }
console.log('GCMinor reasons', JSON.stringify(reasons));
const g0 = (by.GCMinor || [])[100]?.data; console.log('GCMinor sample data', JSON.stringify(g0)?.slice(0, 700));
for (const k of ['GCMajor', 'GCSlice']) for (const x of (by[k] || []).filter(x => x.d > 3).slice(0, 12)) console.log(k, 'at', +(x.s / 1000).toFixed(2), 's dur', +x.d.toFixed(2), JSON.stringify(x.data).slice(0, 400));
// DOMEvent types
const ev = {}; for (const x of by.DOMEvent || []) { const ty = x.data?.eventType ?? '?'; ev[ty] = (ev[ty] || 0) + 1; } console.log('DOMEvent types', JSON.stringify(ev));
// long rAF callbacks
const raf = (by['requestAnimationFrame callbacks'] || []).filter(x => x.d > 9).sort((a, b) => b.d - a.d).slice(0, 15);
console.log('profile range s', +(Math.min(...m.startTime.filter(x => x != null)) / 1000).toFixed(1), +(Math.max(...m.startTime.filter(x => x != null)) / 1000).toFixed(1));
for (const x of raf) {
  const ov = [];
  for (const [n, arr] of Object.entries(by)) if (/^(GC|CC)/.test(n)) for (const y of arr) if (y.s < x.s + x.d && y.s + (y.d || 0) > x.s) ov.push(`${n} ${(y.d || 0).toFixed(1)}ms`);
  console.log('long rAF at', +(x.s / 1000).toFixed(3), 's', +x.d.toFixed(1), 'ms; overlapping:', ov.join(', ') || 'none');
}
