// The sim Nazgul flown with real tunes and the measured 4 ms ESC dead time, at 4 kHz, with its roll/pitch/yaw inertia
// scaled: the 60 s step-response flight (pilot-like stick ramps, as docs/evidence/2026-10-21-step-response), tracking
// error (setpoint - gyro through Betaflight's PT1 250 + 500 Hz) rms / p99 and how often a motor is at full.
// ROOT: experiment copy with K_DEAD; TUNE: 'iflight' (iFlight's published Nazgul Evoque F5 tune, Betaflight 4.2.11:
// P62/64 I94/99 D45/48 F115/120, TPA 60 % from 1280 on D) or 'bfdefault' (Betaflight 4.5 defaults, as the preset).
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('inertia', { timeout: 600000 }, async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const g = globalThis as any; g.K_ASYM = null; g.K_CMD = null; g.K_BAND = 1; g.K_SIMMONS = 0; g.K_LAG = 0; g.K_DAMP = 0;
    const tune = process.env.TUNE ?? 'iflight';
    for (const frac of [0.8, 0.7]) for (const dead of [4]) for (const k of [1, 1.2, 1.4]) {
        g.K_DEAD = dead * 4;
        const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
        preset.fields.rpm_loaded_fraction.value = frac; preset.fields.inertia_roll_pitch_kgm2.value *= k; preset.fields.inertia_yaw_kgm2.value *= k;
        const o: any = { loopHz: 4000 };
        if (tune === 'iflight') {
            o.pid = { roll: [62, 94, 45, 115], pitch: [64, 99, 48, 120], yaw: [52, 99, 0, 110] };
            o.tpa = { mode: 'D', rate: 60, breakpoint: 1280, lowRate: 20, lowBreakpoint: 1050, lowAlways: false };
            o.idle = 0.06;
        }
        const p = sc.compileParams(preset, o);
        const sim = new sc.Sim(p, null); const S = sc.S;
        sim.reset(0, 5000, 0, 0);
        const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch);
        for (let i = 0; i < 200; i++) sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step();
        let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const ax = [0, 1].map(() => ({ from: 0, to: 0, t0: 0, ramp: 1, hold: 0 }));
        const hover = 2 * Math.sqrt(1 / 4.5) - 1; let thrTrim = 0;
        const k1 = 0.001 / (1 / (2 * Math.PI * 250) + 0.001), k2 = 0.001 / (1 / (2 * Math.PI * 500) + 0.001);
        const f = [[0, 0], [0, 0]]; const errs: number[] = []; let full = 0;
        for (let ms = 0; ms < 60000; ms++) {
            for (let a = 0; a < 2; a++) {
                const x = ax[a];
                if (ms >= x.t0 + x.ramp + x.hold) { x.from = x.to; x.to = (rnd() * 2 - 1) * (rnd() < 0.3 ? 0.9 : 0.45); x.t0 = ms; x.ramp = 40 + Math.floor(rnd() * 110); x.hold = 150 + Math.floor(rnd() * 650); if (rnd() < 0.35) x.to = 0; }
                ch[a] = x.from + (x.to - x.from) * Math.min(1, (ms - x.t0) / x.ramp);
            }
            thrTrim += -sim.s[S.vy] * 0.00002; thrTrim = Math.max(-0.4, Math.min(1.2, thrTrim));
            ch[2] = Math.max(-1, Math.min(1, hover + thrTrim));
            sim.setChannels(ch); sim.step();
            const gr = -sim.s[S.wz] * 57.29578, gp = -sim.s[S.wx] * 57.29578;
            f[0][0] += (gr - f[0][0]) * k1; f[0][1] += (f[0][0] - f[0][1]) * k2; f[1][0] += (gp - f[1][0]) * k1; f[1][1] += (f[1][0] - f[1][1]) * k2;
            const rc = p.rates;
            const spR = sc.setpointRate(rc.type, ch[0], rc.roll, rc.rateLimit), spP = sc.setpointRate(rc.type, ch[1], rc.pitch, rc.rateLimit);
            errs.push(Math.hypot(spR - f[0][1], spP - f[1][1]));
            if (Math.max(...sim.motorCmd) > 0.99) full++;
        }
        errs.sort((a, b) => a - b);
        const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
        console.log(`${tune.padEnd(9)} f ${frac} dead ${dead} ms, inertia x${k.toFixed(2)} (${(0.0016 * k).toFixed(4)}): error rms ${rms.toFixed(1)} p99 ${errs[Math.floor(errs.length * 0.99)].toFixed(0)} deg/s, motor at full ${(full / 600).toFixed(1)} %`);
    }
});
