// One open-loop chop (all motors held at 0.03 from 60 ms, seed spread 1), every 10 ms: rates, rpm, thrust, moments.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('opentrace', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks0: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; const t0 = 4187;
    const sticks = sticks0.map((r) => r[0] >= t0 ? [r[0], 0, 0, r[3], 0, ...r.slice(5)] : r);
    g.K_ASYM = [1.0, 1.0, 1.0, 1.0]; g.K_BAND = 1; g.K_SIMMONS = 0; g.K_LAG = 0; g.K_DAMP = 0;
    if (process.env.ASYM) g.K_ASYM = JSON.parse(process.env.ASYM);
    const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
    const p = sc.compileParams(preset, o);
    const sim: any = new sc.Sim(p, null); sim.reset(0, 0.105, -585, 0); g.K_CMD = null;
    const mp = p.motorPos;
    console.log('inertia', p.inertia, 'rotorInertia', p.rotorInertia);
    for (const row of sticks) {
        const t = row[0] - t0;
        if (t === 60) { g.K_CMD = [0.03, 0.03, 0.03, 0.03]; g.K_CMD_T = sim.tick + 1; }
        sim.setChannels(row.slice(1)); sim.step();
        if (t < 40 || t > 300 || t % 10) continue;
        const kw = p.omegaMaxPerVolt * sim.s[S.volt]; const T = sim.thrust;
        let tx = 0, tz = 0; for (let i = 0; i < 4; i++) { tx += -mp[i * 3 + 2] * T[i]; tz += mp[i * 3] * T[i]; }
        console.log(`${t} | roll ${(-sim.s[S.wz] * 57.3).toFixed(0)} pitch ${(-sim.s[S.wx] * 57.3).toFixed(0)} yaw ${(sim.s[S.wy] * 57.3).toFixed(0)} | rpm ${[0, 1, 2, 3].map((i) => (sim.s[S.m0 + i] * kw * 9.549).toFixed(0)).join(' ')} | T ${Array.from(T as Float64Array).map((v) => v.toFixed(2)).join(' ')} | tauRoll ${tz.toFixed(4)} tauPitch ${tx.toFixed(4)}`);
    }
    g.K_CMD = null;
});
