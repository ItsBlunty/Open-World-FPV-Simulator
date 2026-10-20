import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('sticks', async () => {
  const sc: any = await import(ROOT + '/packages/sim-core/src/index');
  const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
  const sticks: number[][] = JSON.parse(readFileSync(__dirname + '/sticks.json', 'utf8'));
  const o = JSON.parse(readFileSync(__dirname + '/overrides.json', 'utf8'));
  if (process.env.NODYN) delete o.dynIdle;
  const sim = new sc.Sim(sc.compileParams(preset, o), null);
  sim.reset(0, 0.105, -585, 0);
  const out: string[] = []; const S = sc.S;
  for (const row of sticks) {
    sim.setChannels(row.slice(1)); sim.step();
    const st = sim.s; const a = sc.attitude(st);
    const rpm = (i: number) => Math.abs(st[S.m0 + i]) * sim.p.omegaMaxPerVolt * st[S.volt] * 60 / (2 * Math.PI);
    const th = sim.thrust as Float64Array;
    const spd = Math.hypot(st[S.vx], st[S.vy], st[S.vz]);
    out.push([row[0], ...row.slice(1, 5), spd, a.pitch, -st[S.wz] * 57.3, -st[S.wx] * 57.3, ...Array.from(sim.motorCmd as Float64Array), rpm(0), rpm(1), rpm(2), rpm(3), ...Array.from(th), st[S.iP]].map((x: number) => +(+x).toFixed(4)).join(','));
  }
  writeFileSync(process.env.OUT!, 'tick,r,p,thr,y,spd,pitch,rr,pr,c0,c1,c2,c3,r0,r1,r2,r3,T0,T1,T2,T3,iP\n' + out.join('\n'));
});
