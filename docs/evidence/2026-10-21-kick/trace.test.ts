// Owner's chop, ms by ms from 50 ms before to 700 ms after: body rates, motor commands, rotor rpm, each rotor's thrust
// and axial inflow ratio, the moments the thrust differences make, I terms. TUNE=original|supafly5.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = 'G:/openworldfpvsim';
const REPLAY = ROOT + '/docs/evidence/2026-10-20-windmill/replay/';
test('trace', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import(ROOT + '/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const t0 = 4187; const id = process.env.TUNE ?? 'original';
    const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
    tunes.tuneOverrides(id, o);
    if (id === 'supafly5') o.dynIdle = { ...o.dynIdle, minRpm: 30 };
    const p = sc.compileParams(preset, o);
    const sim: any = new sc.Sim(p, null); sim.reset(0, 0.105, -585, 0);
    const mp = p.motorPos; const R = p.inflow.radius;
    const lines = [`# ${id}; motorPos (x, z) ${[0, 1, 2, 3].map((i) => `${mp[i * 3].toFixed(3)},${mp[i * 3 + 2].toFixed(3)}`).join(' ')}; radius ${R}`,
        't_ms thr | roll(-wz) pitch(-wx) deg/s | cmd0-3 | rpm0-3 | T0-3 N | uy/tip 0-3 | tauRollFromT tauPitchFromT Nm | Iroll Ipitch | axial in-plane m/s'];
    for (const row of sticks) {
        sim.setChannels(row.slice(1)); sim.step();
        const t = row[0] - t0;
        if (t < -50 || t > 700) continue;
        const s = sim.s;
        const w = s[S.qw], x = s[S.qx], y = s[S.qy], z = s[S.qz];
        const r01 = 2 * (x * y - w * z), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + w * x);
        const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + w * z), r20 = 2 * (x * z - w * y);
        const r02 = 2 * (x * z + w * y), r12 = 2 * (y * z - w * x), r22 = 1 - 2 * (x * x + y * y);
        const bvx = r00 * s[S.vx] + r10 * s[S.vy] + r20 * s[S.vz];
        const bvy = r01 * s[S.vx] + r11 * s[S.vy] + r21 * s[S.vz];
        const bvz = r02 * s[S.vx] + r12 * s[S.vy] + r22 * s[S.vz];
        const kw = p.omegaMaxPerVolt * s[S.volt];
        const T = sim.thrust; let tx = 0, tz = 0; const ratio: string[] = [], rpm: string[] = [];
        for (let i = 0; i < 4; i++) {
            tx += -mp[i * 3 + 2] * T[i]; tz += mp[i * 3] * T[i];
            const om = s[S.m0 + i] * kw; rpm.push((om * 60 / (2 * Math.PI)).toFixed(0));
            const uy = bvy + s[S.wz] * mp[i * 3] - s[S.wx] * mp[i * 3 + 2];
            ratio.push((uy / (om * R)).toFixed(2));
        }
        if (t % 5 === 0) lines.push(`${t} ${row[3].toFixed(2)} | ${(-s[S.wz] * 57.3).toFixed(0)} ${(-s[S.wx] * 57.3).toFixed(0)} | ${Array.from(sim.motorCmd as Float64Array).map((v) => v.toFixed(2)).join(' ')} | ${rpm.join(' ')} | ${Array.from(T as Float64Array).map((v) => v.toFixed(2)).join(' ')} | ${ratio.join(' ')} | ${tz.toFixed(3)} ${tx.toFixed(3)} | ${s[S.iR].toFixed(0)} ${s[S.iP].toFixed(0)} | ${bvy.toFixed(1)} ${Math.hypot(bvx, bvz).toFixed(1)}`);
    }
    writeFileSync(`${process.env.OUT}/trace-${id}.txt`, lines.join('\n') + '\n');
});
