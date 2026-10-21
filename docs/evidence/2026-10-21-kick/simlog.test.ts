// The owner's whole replayed flight written as a blackbox-like table (time us, rcCommand[3] as 1000-2000, motor[0-3] in
// 0-1 in Betaflight's order, gyroADC roll/pitch deg/s) for authority_fit.py. Sim motors: m0 (+x,+z), m1 (+x,-z),
// m2 (-x,+z), m3 (-x,-z); body x is the pitch axis (nose along -z? the fit takes the sign as it comes), roll = -wz.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('simlog', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any;
    g.K_ASYM = null; g.K_BAND = 1; g.K_SIMMONS = 0; g.K_LAG = 0; g.K_DAMP = 0; g.K_DEAD = 0; g.K_CMD = null;
    const tune = process.env.TUNE ?? 'original';
    const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8')); tunes.tuneOverrides(tune, o);
    const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
    const rows = ['time,rcCommand[3],m0,m1,m2,m3,gyroRoll,gyroPitch,wy'];
    for (const row of sticks) {
        sim.setChannels(row.slice(1)); sim.step();
        const c = sim.motorCmd;
        rows.push(`${row[0] * 1000},${1000 + (row[3] + 1) * 500},${c[0]},${c[1]},${c[2]},${c[3]},${-sim.s[S.wz] * 57.3},${-sim.s[S.wx] * 57.3},${sim.s[S.wy] * 57.3}`);
    }
    writeFileSync(process.env.OUT!, rows.join('\n'));
});
