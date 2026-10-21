// The Nazgul preset with rpm_loaded_fraction f: the motor model's R, the static rpm and thrust at commands 0.1-1.0 (held
// still at 24 V like the stand, soc set so the pack is near 24 V), and the 63 % spool time for 0.25 -> 0.40.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
test('frac', async () => {
    const sc: any = await import('G:/openworldfpvsim/packages/sim-core/src/index');
    for (const f of [0.8, 0.72, 0.7, 0.68]) {
        const preset = JSON.parse(readFileSync('G:/openworldfpvsim/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
        preset.fields.rpm_loaded_fraction.value = f;
        const p = sc.compileParams(preset, { loopHz: 4000 });
        const run = (c0: number, c1: number | null) => {
            const sim: any = new sc.Sim(p, null); sim.reset(0, 100, 0, 0);
            const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const hold = () => { const s = sim.s; s[sc.S.qw] = 1; s[sc.S.qx] = s[sc.S.qy] = s[sc.S.qz] = 0; s[sc.S.wx] = s[sc.S.wy] = s[sc.S.wz] = 0; s[sc.S.vx] = s[sc.S.vy] = s[sc.S.vz] = 0; s[sc.S.py] = 100; s[sc.S.soc] = 0.85; };
            const rpm = () => sim.s[sc.S.m0] * p.omegaMaxPerVolt * sim.s[sc.S.volt] * 9.5493;
            const c = new Float64Array(4).fill(c0);
            for (let i = 0; i < 6000; i++) { hold(); sim.physics(c); }
            if (c1 === null) return { rpm: rpm(), T: sim.thrust[0], V: sim.s[sc.S.volt], ms: 0 };
            const r0 = rpm(); const tr: number[] = []; c.fill(c1);
            for (let i = 0; i < 2000; i++) { hold(); sim.physics(c); tr.push(rpm()); }
            const r1 = tr[tr.length - 1];
            return { rpm: r1, T: 0, V: 0, ms: (tr.findIndex((r) => (r - r0) / (r1 - r0) >= 0.632) + 1) / 4 };
        };
        const pts = [0.1, 0.2, 0.3, 0.5, 0.7, 1.0].map((c) => { const r = run(c, null); return `${c}: ${r.rpm.toFixed(0)} rpm ${(r.T / 9.80665e-3).toFixed(0)} g`; });
        const sp = run(0.25, 0.4);
        console.log(`f ${f}: R ${p.motor.r.toFixed(3)} ohm, Ke ${p.motor.ke.toFixed(5)}, volt ${run(0.3, null).V.toFixed(2)} | ${pts.join(' | ')} | spool 0.25->0.40 63 % in ${sp.ms} ms`);
    }
});
