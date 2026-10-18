import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('G:/openworldfpvsim/package.json');
const { TraceMap, originalPositionFor } = require('G:/openworldfpvsim/node_modules/.pnpm/@jridgewell+trace-mapping@0.3.31/node_modules/@jridgewell/trace-mapping');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mapDir = process.argv[3];
const sh = p.shared, S = sh.stringArray, t = p.threads[27], sm = t.samples;
const maps = {}; const tm = (f) => maps[f] ??= (fs.existsSync(`${mapDir}/${f}.map`) ? new TraceMap(JSON.parse(fs.readFileSync(`${mapDir}/${f}.map`, 'utf8'))) : null);
const srcUrl = (fi) => { const s = sh.funcTable.source?.[fi]; if (s == null || s < 0) return null; const u = sh.sources.filename[s]; return u != null ? S[u] : null; };
const label = (fi) => {
  const name = S[sh.funcTable.name[fi]]; const url = srcUrl(fi); const ln = sh.funcTable.lineNumber[fi], col = sh.funcTable.columnNumber[fi];
  const mm = url?.match(/assets\/([\w-]+\.js)$/); if (!mm || ln == null) return name.slice(0, 60);
  const map = tm(mm[1]); if (!map) return `${name} ${mm[1]}:${ln}:${col}`;
  const o = originalPositionFor(map, { line: ln, column: Math.max(0, (col ?? 1) - 1) });
  return `${name.split(' ')[0].slice(0, 30)} = ${(o.source ?? '?').replace(/.*node_modules\/\.pnpm\/[^/]+\/node_modules\//, 'npm:').replace(/.*openworldfpvsim\//, '')}:${o.line} ${o.name ?? ''}`;
};
const times = new Float64Array(sm.length); { let acc = 0; for (let i = 0; i < sm.length; i++) { acc += sm.timeDeltas[i]; times[i] = acc; } }
const chain = (st) => { const out = []; let g = 0; while (st >= 0 && g++ < 400) { out.push(sh.frameTable.func[sh.stackTable.frame[st]]); const o = sh.stackTable.prefixOffset[st]; if (o === 0) break; st -= o; } return out; };
for (const [g, a, b] of [['slow 477.680', 477680, 477697], ['slow 507.947', 507947, 507963], ['normal 490.000', 490000, 490016]]) {
  const self = {}, incl = {}; let n = 0;
  for (let i = 0; i < sm.length; i++) { if (times[i] < a || times[i] > b || sm.stack[i] == null) continue; n++; const c = chain(sm.stack[i]); const js = c.filter((fi) => srcUrl(fi)?.includes('assets/')); if (js[0] != null) { const l = label(js[0]); self[l] = (self[l] || 0) + 1; } for (const fi of new Set(js)) { const l = label(fi); incl[l] = (incl[l] || 0) + 1; } }
  console.log(`\n=== ${g} (${n} samples, 1 ms each)\n innermost JS:`); for (const [k, c] of Object.entries(self).sort((x, y) => y[1] - x[1]).slice(0, 10)) console.log('  ', c, k);
  console.log(' on stack:'); for (const [k, c] of Object.entries(incl).sort((x, y) => y[1] - x[1]).slice(0, 16)) console.log('  ', c, k);
}
