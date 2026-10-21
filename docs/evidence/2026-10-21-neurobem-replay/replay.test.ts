// The NeuroBEM quad in the sim (neurobem.json, motors at its measured arm positions and its inertia per axis) flown with
// its own logged sticks through the built-in controller set as its Betaflight 4.2.0 log header (P40 I80 D20 F0 roll and
// pitch, P30 I60 yaw, rc_rate 2.2 / 2.04, no super rate, no expo, no TPA), loop 4 kHz (real 3.2 kHz). Writes sim setpoint,
// gyro (through PT1 200 + 250 Hz, the header's gyro_lowpass dyn minimum and lowpass2) and motor commands per ms.
// ROOT: experiment copy with K_DEAD; VARIANT: { dead (ms), log: 'l1' | 'l2' }.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('replay', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const v = JSON.parse(process.env.VARIANT ?? '{}');
    const g = globalThis as any; g.K_ASYM = null; g.K_CMD = null; g.K_BAND = 1; g.K_SIMMONS = 0; g.K_LAG = 0; g.K_DAMP = 0;
    g.K_DEAD = (v.dead ?? 0) * 4;
    const preset = JSON.parse(readFileSync(__dirname + '/neurobem.json', 'utf8'));
    const ax = (r: number) => ({ rcRate: r, rate: 0, expo: 0 });
    const p = sc.compileParams(preset, {
        loopHz: 4000, antiGravityGain: 10,
        pid: { roll: [40, 80, 20, 0], pitch: [40, 80, 20, 0], yaw: [30, 60, 0, 0] },
        rates: { type: 'BETAFLIGHT', roll: ax(220), pitch: ax(220), yaw: ax(204), rateLimit: 1998 }
    });
    // kingfisher.yaml: rotors at +-0.0775 m forward, +-0.1 m lateral; inertia x 0.0025 (roll), y 0.0021 (pitch), z 0.0043
    const mp = p.motorPos; const fwd = 0.0775, lat = 0.1;
    const pos = [[lat, fwd], [lat, -fwd], [-lat, fwd], [-lat, -fwd]];
    for (let i = 0; i < 4; i++) { mp[i * 3] = pos[i][0]; mp[i * 3 + 2] = pos[i][1]; }
    p.inertia[0] = 0.0021; p.inertia[1] = 0.0043; p.inertia[2] = 0.0025;
    const lines = readFileSync(__dirname + `/${v.log ?? 'l2'}.csv`, 'utf8').trim().split('\n');
    const hdr = lines[0].split(','); const col = (k: string) => hdr.indexOf(k);
    const rows = lines.slice(1).map((l) => l.split(',').map(Number));
    const sim = new sc.Sim(p, null); const S = sc.S;
    sim.reset(0, 2000, 0, 0);
    const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch);
    for (let i = 0; i < 200; i++) sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    const k1 = 0.001 / (1 / (2 * Math.PI * 200) + 0.001), k2 = 0.001 / (1 / (2 * Math.PI * 250) + 0.001);
    const f = [[0, 0], [0, 0]];
    const out = ['t_ms,sp_roll,sp_pitch,gyro_roll,gyro_pitch,m0,m1,m2,m3,speed'];
    for (const r of rows) {
        ch[0] = r[col('rcCommand0')] / 500; ch[1] = r[col('rcCommand1')] / 500; ch[3] = r[col('rcCommand2')] / 500;
        ch[2] = r[col('setpoint3')] / 500 - 1;
        sim.setChannels(ch); sim.step();
        const gr = -sim.s[S.wz] * 57.29578, gp = -sim.s[S.wx] * 57.29578;
        f[0][0] += (gr - f[0][0]) * k1; f[0][1] += (f[0][0] - f[0][1]) * k2;
        f[1][0] += (gp - f[1][0]) * k1; f[1][1] += (f[1][0] - f[1][1]) * k2;
        const rc = p.rates;
        const spR = sc.setpointRate(rc.type, ch[0], rc.roll, rc.rateLimit), spP = sc.setpointRate(rc.type, ch[1], rc.pitch, rc.rateLimit);
        out.push(`${r[0]},${spR.toFixed(2)},${spP.toFixed(2)},${f[0][1].toFixed(2)},${f[1][1].toFixed(2)},${Array.from(sim.motorCmd as Float64Array).map((x) => x.toFixed(4)).join(',')},${Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]).toFixed(2)}`);
    }
    writeFileSync(process.env.OUT!, out.join('\n'));
});
