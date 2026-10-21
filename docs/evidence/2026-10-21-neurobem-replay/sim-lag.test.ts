// The sim's command -> body acceleration lag, logged like NeuroBEM's blackbox (motor commands, rpm, Betaflight-filtered
// gyro) in the step-response flight, for telemlag.py's method. VARIANT: loopHz, dead (ms), propInertia; ROOT copy with
// K_DEAD (counts physics loops) when dead is set.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('lag', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const v = JSON.parse(process.env.VARIANT ?? '{}');
    const g = globalThis as any; g.K_ASYM = null; g.K_CMD = null; g.K_BAND = 1; g.K_SIMMONS = 0; g.K_LAG = 0; g.K_DAMP = 0;
    const loopHz = v.loopHz ?? 4000; g.K_DEAD = (v.dead ?? 0) * loopHz / 1000;
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const o: any = { loopHz }; if (v.pi) o.propInertia = v.pi;
    const p = sc.compileParams(preset, o);
    const sim = new sc.Sim(p, null); const S = sc.S;
    sim.reset(0, 5000, 0, 0);
    const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch);
    for (let i = 0; i < 200; i++) sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const ax = [0, 1].map(() => ({ from: 0, to: 0, t0: 0, ramp: 1, hold: 0 }));
    const hover = 2 * Math.sqrt(1 / 4.5) - 1; let thrTrim = 0;
    const kf1 = 0.001 / (1 / (2 * Math.PI * 250) + 0.001), kf2 = 0.001 / (1 / (2 * Math.PI * 500) + 0.001);
    const f = [[0, 0], [0, 0]];
    const rows = ['time,motor[0],motor[1],motor[2],motor[3],debug[0],debug[1],debug[2],debug[3],gyroADC[0],gyroADC[1],gyroADC[2]'];
    for (let ms = 0; ms < 90000; ms++) {
        for (let k = 0; k < 2; k++) {
            const a = ax[k];
            if (ms >= a.t0 + a.ramp + a.hold) { a.from = a.to; a.to = (rnd() * 2 - 1) * (rnd() < 0.3 ? 0.9 : 0.45); a.t0 = ms; a.ramp = 40 + Math.floor(rnd() * 110); a.hold = 150 + Math.floor(rnd() * 650); if (rnd() < 0.35) a.to = 0; }
            const u = Math.min(1, (ms - a.t0) / a.ramp); ch[k] = a.from + (a.to - a.from) * u;
        }
        thrTrim += -sim.s[S.vy] * 0.00002; thrTrim = Math.max(-0.4, Math.min(1.2, thrTrim));
        ch[2] = Math.max(-1, Math.min(1, hover + thrTrim));
        sim.setChannels(ch); sim.step();
        // Betaflight frame: gyro roll -wz, pitch -wx (deg/s, through its gyro PT1 250 + 500 Hz); motors as DShot 48-2047;
        // rpm as debug eRPM/100 (14 poles)
        const gr = -sim.s[S.wz] * 57.29578, gp = -sim.s[S.wx] * 57.29578;
        f[0][0] += (gr - f[0][0]) * kf1; f[0][1] += (f[0][0] - f[0][1]) * kf2;
        f[1][0] += (gp - f[1][0]) * kf1; f[1][1] += (f[1][0] - f[1][1]) * kf2;
        const kw = p.omegaMaxPerVolt * sim.s[S.volt];
        const c = sim.motorCmd;
        const rpm = [0, 1, 2, 3].map((i) => (sim.s[S.m0 + i] * kw * 60 / (2 * Math.PI)) * 7 / 100);
        rows.push(`${ms * 1000},${[0, 1, 2, 3].map((i) => 48 + c[i] * 1999).join(',')},${rpm.join(',')},${f[0][1]},${f[1][1]},0`);
    }
    writeFileSync(process.env.OUT!, rows.join('\n'));
});
