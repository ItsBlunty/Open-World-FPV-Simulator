// The Nazgul as the game flies it (SupaFly, dynamic idle 3000 rpm, 4 kHz) chopped at set airspeeds, sticks centred, 16
// motor spreads (+-2.5 %), ESC dead time 0 and 4 ms. Level: thrust axis leaned forward; climb: thrust axis 30 deg off the
// velocity. Throttle held 0.3 s, ramped to zero over 150 ms; measured 0-1 s after the ramp ends: peak |gyro| r/p
// (median / max over spreads), top motor median.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('speeds', { timeout: 900000 }, async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const S = sc.S; const g = globalThis as any;
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const spreads = Array.from({ length: 16 }, () => [0, 1, 2, 3].map(() => 1 + (rnd() * 2 - 1) * 0.025));
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const delays = (process.env.DELAYS ?? '0,4').split(',').map(Number);
    const speeds = (process.env.SPEEDS ?? '15,20,25,30,40').split(',').map(Number);
    for (const delay of delays) for (const mode of ['level', 'climb'] as const) for (const V of speeds) {
        const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
        if (delay) preset.fields.esc_delay_ms = { value: delay, source: 'test' };
        g.K_FLAT = !!process.env.FLAT; const o: any = { batteryDrain: false, crashOn: false, smallAngleDeg: 180 }; const tn = process.env.TUNE ?? 'supafly5'; tunes.tuneOverrides(tn, o); o.loopHz = 4000; if (tn === 'supafly5') o.dynIdle = { minRpm: 30 }; if (process.env.OX) Object.assign(o, JSON.parse(process.env.OX)); if (process.env.NODYN) delete o.dynIdle;
        const p = sc.compileParams(preset, o);
        const pk: number[] = [], top: number[] = [];
        for (const sp of (process.env.ONE ? [spreads[0]] : spreads)) {
            if (process.env.ONE) g.K_TRACE = { om: [0, 0, 0, 0], T: [0, 0, 0, 0], Q: [0, 0, 0, 0], duty: [0, 0, 0, 0], bvy: 0 };
            g.K_ASYM = sp;
            (globalThis as any).K_LAG = Number(process.env.LAG ?? 0) / 1000; (globalThis as any).lagT = null; (globalThis as any).K_LEAD = Number(process.env.LEAD ?? 0) / 1000; (globalThis as any).leadT = null; const sim = new sc.Sim(p, null); sim.reset(0, 500, 0, 0);
            const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0];
            sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const th = (mode === 'level' ? Math.min(75, 20 + V * 1.3) : 30) * Math.PI / 180;
            const h = th / 2; sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = -Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
            const qw = sim.s[S.qw], qx = sim.s[S.qx];
            const upY = 1 - 2 * qx * qx, upZ = 2 * qw * qx, fwdZ = -(1 - 2 * qx * qx);
            if (mode === 'level') { sim.s[S.vz] = V * Math.sign(fwdZ); } else { sim.s[S.vy] = V * upY; sim.s[S.vz] = V * upZ; }
            const thr = mode === 'level' ? 0.25 + V / 40 * 0.5 : 0.7;
            ch[2] = thr * 2 - 1; sim.setChannels(ch);
            for (let i = 0; i < 300; i++) { if (p.dynIdle) sim.s[sc.S_DYN.dynI] = 0; sim.step(); }
            let m = 0, tp = 0;
            for (let i = 0; i < 1150; i++) {
                const k = i < 150 ? 1 - i / 150 : 0; ch[2] = thr * k * 2 - 1; sim.setChannels(ch); sim.step();
                const tr = g.K_TRACE; if (tr && (process.env.FINE ? (i >= 240 && i < 320) : (i % 10 === 0 && i < 600))) { const th = p.inflow.theta, R = p.inflow.radius; console.log(`${String(i - 150).padStart(4)} dyn ${(tr.dyn ?? []).map((x: number) => x.toFixed(3)).join(",")} lo ${(tr.lo ?? 0).toFixed(3)} uy ${tr.bvy.toFixed(1)} roll ${(sim.s[S.wz] * 57.3).toFixed(0).padStart(5)} pitch ${(sim.s[S.wx] * 57.3).toFixed(0).padStart(5)} | ` + [0, 1, 2, 3].map((j) => `${tr.duty[j].toFixed(2)} ${(tr.om[j] * 9.5493 / 1000).toFixed(1)}k s${(th * tr.om[j] * R / tr.bvy).toFixed(2)} ${tr.T[j].toFixed(2)}N`).join(' | ')); }
                if (i >= 150) { m = Math.max(m, Math.abs(sim.s[S.wz]) * 57.3, Math.abs(sim.s[S.wx]) * 57.3); tp = Math.max(tp, ...sim.motorCmd); }
            }
            pk.push(m); top.push(tp);
        }
        console.log(`delay ${delay} ${mode.padEnd(5)} V ${String(V).padStart(2)}: peak ${med(pk).toFixed(0).padStart(4)} / ${Math.max(...pk).toFixed(0).padStart(4)} deg/s | top motor ${med(top).toFixed(2)}`);
    }
});
