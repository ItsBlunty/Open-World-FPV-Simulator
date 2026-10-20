import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFirstMap, levelSha256 } from '@owfpv/maps';
import { MeshContactWorld } from '@owfpv/world-mesh';
import { replayLives, S, attitude } from '@owfpv/sim-core';
import { asLife, checkFlight, flightFromJson, lifeDeps } from '../src/flights';
test('owner flight', () => {
  const flight = flightFromJson(readFileSync(process.env.F!, 'utf8'));
  const level = buildFirstMap(); const mesh = new MeshContactWorld(level.collision);
  console.log('check', JSON.stringify(checkFlight(flight, level, mesh)));
  const sha = levelSha256(level);
  const rows: string[] = []; const ev: string[] = [];
  flight.lives.forEach((s, li) => {
    replayLives([asLife(s)], lifeDeps(flight, s, level, sha, mesh), {
      onEvent: (e: any) => ev.push(JSON.stringify(e)),
      onStep: (sim) => {
        const a = attitude(sim.s); const st = sim.s;
        const qw = st[S.qw], qx = st[S.qx], qy = st[S.qy], qz = st[S.qz];
        // body up (thrust axis) in world, and the airspeed along it and across it
        const ux = 2 * (qx * qy - qw * qz), uy = 1 - 2 * (qx * qx + qz * qz), uz = 2 * (qy * qz + qw * qx);
        const ax = st[S.vx] * ux + st[S.vy] * uy + st[S.vz] * uz;
        const spd = Math.hypot(st[S.vx], st[S.vy], st[S.vz]);
        const side = Math.sqrt(Math.max(0, spd * spd - ax * ax));
        const rpm = (i: number) => Math.abs(st[S.m0 + i]) * sim.p.omegaMaxPerVolt * st[S.volt] * 60 / (2 * Math.PI);
        const th = (sim as any).thrust as Float64Array;
        rows.push([li, sim.tick, sim.ch[0], sim.ch[1], sim.ch[2], sim.ch[3], sim.ch[4], sim.ch[5], sim.ch[6], sim.ch[7], spd, ax, side, a.roll, a.pitch, -st[S.wz]*57.3, -st[S.wx]*57.3, -st[S.wy]*57.3,
          ...Array.from(sim.motorCmd), rpm(0), rpm(1), rpm(2), rpm(3), ...Array.from(th), st[S.iR], st[S.iP], (sim as any).washNow, st[S.py]].map((x) => +(+x).toFixed(4)).join(','));
      } });
  });
  writeFileSync(process.env.OUT!, 'life,tick,roll_st,pitch_st,thr_st,yaw_st,c4,c5,c6,c7,spd,axial,side,roll,pitch,rr,pr,yr,c0,c1,c2,c3,r0,r1,r2,r3,T0,T1,T2,T3,iR,iP,wash,y\n' + rows.join('\n'));
  writeFileSync(process.env.OUT! + '.events', ev.join('\n'));
}, 900000);
