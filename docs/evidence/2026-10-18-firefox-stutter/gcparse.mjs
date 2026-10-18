// Firefox startup profile (gecko format): major/minor GC markers on the content process main threads
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const all = [];
const walk = (prof) => { for (const t of prof.threads ?? []) all.push(t); for (const sub of prof.processes ?? []) walk(sub); };
walk(p);
const rows = [];
for (const t of all) {
  if (t.name !== 'GeckoMain' || !t.markers) continue;
  const sch = t.markers.schema, S = t.stringTable ?? t.stringArray;
  const name = (r) => S[r[sch.name]];
  let minor = 0, minorMs = 0, msgs = 0; const major = [];
  for (const r of t.markers.data) {
    const n = name(r), d = r[sch.data];
    if (n === 'GCMinor') { minor++; const s = r[sch.startTime], e = r[sch.endTime]; if (e && s) minorMs += e - s; }
    else if (n === 'GCMajor') major.push({ at: +(r[sch.startTime] / 1000).toFixed(1), reason: d?.timings?.reason, maxPause: d?.timings?.max_pause, allocatedMB: d?.timings?.allocated_bytes ? +(d.timings.allocated_bytes / 1048576).toFixed(1) : undefined });
    else if (n === 'DOMEvent' && d?.eventType === 'message') msgs++;
  }
  if (minor > 200) rows.push({ process: t.processName, tid: t.tid, minorGCs: minor, minorMsTotal: +minorMs.toFixed(0), messageEvents: msgs, majorGCs: major.length, major });
}
console.log(JSON.stringify(rows, null, 1));
