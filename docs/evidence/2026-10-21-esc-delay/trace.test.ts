// The owner's chop with the ESC dead time (env DELAY, default 4 ms), SupaFly, sticks centred, one motor spread (env SPREAD):
// every 5 ms, per motor delayed command, rpm, s = theta tip / uy (rotor speed over its zero-thrust speed; NACA x / 1.47,
// drag peak near s 0.58) and thrust; roll / pitch rate.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('trace', { timeout: 900000 }, async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const sticks0: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; const t0 = 4187;
    const sticks = sticks0.map((r) => r[0] >= t0 ? [r[0], 0, 0, r[3], 0, ...r.slice(5)] : r);
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const spreads = Array.from({ length: 16 }, () => [0, 1, 2, 3].map(() => 1 + (rnd() * 2 - 1) * 0.025));
    const delay = Number(process.env.DELAY ?? 4);
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    preset.fields.esc_delay_ms = { value: delay, source: 'test' };
    g.K_ASYM = spreads[Number(process.env.SPREAD ?? 0)];
    const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
    delete o.dynIdle; tunes.tuneOverrides('supafly5', o); o.loopHz = 4000; o.dynIdle = { minRpm: 30 };
    const p = sc.compileParams(preset, o);
    const sim = new sc.Sim(p, null); sim.reset(0, 0.105, -585, 0);
    const tr = { om: [0, 0, 0, 0], T: [0, 0, 0, 0], Q: [0, 0, 0, 0], duty: [0, 0, 0, 0], bvy: 0 }; g.K_TRACE = tr;
    const th = p.inflow.theta, R = p.inflow.radius;
    console.log(`delay ${delay} ms spread ${g.K_ASYM.map((x: number) => x.toFixed(3))} theta ${th.toFixed(3)} R ${R}`);
    for (const row of sticks) {
        sim.setChannels(row.slice(1)); sim.step();
        const t = row[0] - t0;
        if (t < -20 || t > Number(process.env.TEND ?? 300)) continue;
        if (t % 5 !== 0) continue;
        const f = (i: number) => `${tr.duty[i].toFixed(2)} ${(tr.om[i] * 9.5493 / 1000).toFixed(1)}k s${(th * tr.om[i] * R / tr.bvy).toFixed(2)} ${tr.T[i].toFixed(2)}N`;
        console.log(`${String(t).padStart(4)} uy ${tr.bvy.toFixed(1)} roll ${(sim.s[S.wz] * 57.3).toFixed(0).padStart(5)} pitch ${(sim.s[S.wx] * 57.3).toFixed(0).padStart(5)} | ${[0, 1, 2, 3].map(f).join(' | ')}`);
    }
});
