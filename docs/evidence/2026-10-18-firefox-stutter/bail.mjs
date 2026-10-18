import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = p.shared.stringArray, t = p.threads[27], m = t.markers;
const ev = [];
for (let j = 0; j < m.length; j++) { const n = S[m.name[j]]; if (n !== 'Bailout' && n !== 'Invalidate') continue; ev.push({ s: m.startTime[j] ?? m.endTime[j], n, text: S[m.data[j]?.name] ?? '' }); }
ev.sort((a, b) => a.s - b.s);
console.log('total', ev.length, 'bailouts', ev.filter(e => e.n === 'Bailout').length, 'invalidations', ev.filter(e => e.n === 'Invalidate').length);
// bursts: group events within 50 ms
const bursts = []; for (const e of ev) { const b = bursts.at(-1); if (b && e.s - b.end < 50) { b.end = e.s; b.n++; b.inv += e.n === 'Invalidate'; b.texts.add(e.text); } else bursts.push({ start: e.s, end: e.s, n: 1, inv: +(e.n === 'Invalidate'), texts: new Set([e.text]) }); }
console.log('bursts', bursts.length);
for (const b of bursts.filter(b => b.n >= 5)) console.log((b.start / 1000).toFixed(3), '-', (b.end / 1000).toFixed(3), 's', b.n, 'events', b.inv, 'invalidations |', [...b.texts].slice(0, 4).map(x => x.slice(0, 110)).join(' || '));
const byText = {}; for (const e of ev) if (e.n === 'Invalidate') byText[e.text] = (byText[e.text] || 0) + 1;
console.log('\ninvalidated (top):'); for (const [k, c] of Object.entries(byText).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(c, k.slice(0, 160));
