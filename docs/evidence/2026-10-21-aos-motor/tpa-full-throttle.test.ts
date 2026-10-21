// New Nazgul, 4 kHz, inflow: full-throttle top-speed run (angle mode) and the 60 s step flight, per tune as real pilots run
// them: Betaflight 4.5 defaults with their TPA (D 65 % from 1350), SupaflyFPV, iFlight's published Nazgul tune (TPA 60 %
// from 1280 on D), and the preset's own gains without TPA.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
test('tpa', { timeout: 900000 }, async () => {
    const sc: any = await import('G:/openworldfpvsim/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const pr = JSON.parse(readFileSync('G:/openworldfpvsim/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const cases: [string, any][] = [
        ['own gains, no TPA', {}],
        ['Betaflight defaults + TPA', (() => { const o: any = {}; tunes.tuneOverrides('betaflight', o); return o; })()],
        ['SupaflyFPV', (() => { const o: any = { dynIdle: { minRpm: 30 } }; tunes.tuneOverrides('supafly5', o); return o; })()],
        ["iFlight's Nazgul tune", { pid: { roll: [62, 94, 45, 115], pitch: [64, 99, 48, 120], yaw: [52, 99, 0, 110] }, tpa: { mode: 'D', rate: 60, breakpoint: 1280, lowRate: 20, lowBreakpoint: 1050, lowAlways: false } }]
    ];
    for (const [name, oo] of cases) {
        const o = { ...oo, loopHz: 4000 };
        const p0 = sc.compileParams(pr, o);
        const tilt = Math.acos(1 / p0.twr) * 57.29578;
        const p = sc.compileParams(pr, { ...o, level: { limitDeg: tilt } });
        let sim = new sc.Sim(p, null); sim.reset(0, 500, 0, 0);
        let ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.angle, 0, 0]; sim.setChannels(ch);
        for (let i = 0; i < 200; i++) sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step();
        ch[2] = 0; sim.setChannels(ch); for (let i = 0; i < 2000; i++) sim.step();
        ch[1] = 1; ch[2] = 1; sim.setChannels(ch);
        let e2 = 0, n = 0;
        for (let i = 0; i < 20000; i++) { sim.step(); if (i > 5000) { e2 += sim.s[sc.S.wx] ** 2 + sim.s[sc.S.wz] ** 2; n++; } }
        const v = Math.sqrt(sim.s[sc.S.vx] ** 2 + sim.s[sc.S.vz] ** 2) * 3.6;
        // step flight
        sim = new sc.Sim(p0, null); sim.reset(0, 5000, 0, 0);
        ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch);
        for (let i = 0; i < 200; i++) sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step();
        let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const ax = [0, 1].map(() => ({ from: 0, to: 0, t0: 0, ramp: 1, hold: 0 }));
        const hover = 2 * Math.sqrt(1 / 4.5) - 1; let thrTrim = 0;
        const k1 = 0.001 / (1 / (2 * Math.PI * 250) + 0.001), k2 = 0.001 / (1 / (2 * Math.PI * 500) + 0.001);
        const f = [[0, 0], [0, 0]]; const errs: number[] = [];
        for (let ms = 0; ms < 60000; ms++) {
            for (let a = 0; a < 2; a++) {
                const x = ax[a];
                if (ms >= x.t0 + x.ramp + x.hold) { x.from = x.to; x.to = (rnd() * 2 - 1) * (rnd() < 0.3 ? 0.9 : 0.45); x.t0 = ms; x.ramp = 40 + Math.floor(rnd() * 110); x.hold = 150 + Math.floor(rnd() * 650); if (rnd() < 0.35) x.to = 0; }
                ch[a] = x.from + (x.to - x.from) * Math.min(1, (ms - x.t0) / x.ramp);
            }
            thrTrim += -sim.s[sc.S.vy] * 0.00002; thrTrim = Math.max(-0.4, Math.min(1.2, thrTrim));
            ch[2] = Math.max(-1, Math.min(1, hover + thrTrim));
            sim.setChannels(ch); sim.step();
            const gr = -sim.s[sc.S.wz] * 57.29578, gp = -sim.s[sc.S.wx] * 57.29578;
            f[0][0] += (gr - f[0][0]) * k1; f[0][1] += (f[0][0] - f[0][1]) * k2; f[1][0] += (gp - f[1][0]) * k1; f[1][1] += (f[1][0] - f[1][1]) * k2;
            const rc = p0.rates;
            errs.push(Math.hypot(sc.setpointRate(rc.type, ch[0], rc.roll, rc.rateLimit) - f[0][1], sc.setpointRate(rc.type, ch[1], rc.pitch, rc.rateLimit) - f[1][1]));
        }
        errs.sort((a, b) => a - b);
        const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
        console.log(`${name.padEnd(28)} top speed ${v.toFixed(0)} km/h, body rate rms at full throttle ${(Math.sqrt(e2 / n) * 57.3).toFixed(1)} deg/s | step flight error rms ${rms.toFixed(1)} p99 ${errs[Math.floor(errs.length * 0.99)].toFixed(0)} deg/s`);
    }
});
