// Sensitivity of the owner's chop (sticks replayed, 4.15-7 s) to each remaining gap, on a scratch copy of sim-core with
// switches: K_LAG (prop-load lag, gap 3), K_BAND (windmill curve depth, gap 1), K_DAMP (frame damping, gap 7), plus
// preset edits (inertia, gap 9; torque/thrust ratio, gap 10) and stick edits (gap 11), dynamic idle off.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('knobs', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const base = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any;
    type Case = { name: string; lag?: number; band?: number; damp?: number; inertia?: number; kappa?: number; sticks?: 'centre' | 'noyaw'; nodyn?: boolean; classic?: boolean };
    const cases: Case[] = [
        { name: 'as built (0.8.0 + NACA refit)' },
        { name: 'gap 3: prop loads lag 1 ms (dynamic inflow, Peters)', lag: 0.001 },
        { name: 'gap 3: lag 5 ms', lag: 0.005 },
        { name: 'gap 3: lag 20 ms (far beyond physics)', lag: 0.02 },
        { name: 'gap 1: windmill curves x0.65 (measured small-prop depth)', band: 0.65 },
        { name: 'gap 1: windmill curves x0.3', band: 0.3 },
        { name: 'gap 7: frame damping 2e-3 N m s at 40 m/s', damp: 0.002 },
        { name: 'gap 7: frame damping 1e-2 (5x the estimate)', damp: 0.01 },
        { name: 'gap 9: inertia x0.7', inertia: 0.7 },
        { name: 'gap 9: inertia x0.5', inertia: 0.5 },
        { name: 'gap 10: kappa 0.0125 (AOS-RC Nazgul F5 prop)', kappa: 0.0125 },
        { name: 'gap 11: yaw stick 0 from the chop', sticks: 'noyaw' },
        { name: 'gap 11: all sticks centred from the chop', sticks: 'centre' },
        { name: 'dynamic idle off (owner had it on)', nodyn: true },
        { name: 'classic physics (no airflow on the props)', classic: true },
    ];
    for (const c of cases) {
        g.K_LAG = c.lag ?? 0; g.lagT = null; g.K_BAND = c.band ?? 1; g.K_DAMP = c.damp ?? 0;
        const preset = JSON.parse(JSON.stringify(base));
        if (c.inertia) { preset.fields.inertia_roll_pitch_kgm2.value *= c.inertia; preset.fields.inertia_yaw_kgm2.value *= c.inertia; }
        if (c.kappa) preset.fields.motor_kappa_m.value = c.kappa;
        const o = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
        if (c.nodyn) delete o.dynIdle;
        if (c.classic) o.classicPhysics = true;
        const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
        let maxRoll = 0, maxPitch = 0, msHigh = 0, p0 = NaN, drift = 0, maxI = 0;
        for (const row of sticks) {
            const ch = row.slice(1); const t = row[0];
            if (t >= 4150 && c.sticks === 'noyaw') ch[3] = 0;
            if (t >= 4150 && c.sticks === 'centre') { ch[0] = 0; ch[1] = 0; ch[3] = 0; }
            sim.setChannels(ch); sim.step();
            if (t >= 4150 && t < 7000) {
                const a = sc.attitude(sim.s); if (isNaN(p0)) p0 = a.pitch;
                drift = Math.max(drift, Math.abs(a.pitch - p0));
                maxRoll = Math.max(maxRoll, Math.abs(sim.s[S.wz]) * 57.3); maxPitch = Math.max(maxPitch, Math.abs(sim.s[S.wx]) * 57.3);
                if (Math.max(...sim.motorCmd) > 0.15) msHigh++;
                maxI = Math.max(maxI, Math.abs(sim.s[S.iP]), Math.abs(sim.s[S.iR]));
            }
        }
        console.log(`${c.name.padEnd(58)} roll ${maxRoll.toFixed(0).padStart(4)} pitch ${maxPitch.toFixed(0).padStart(4)} deg/s, drift ${drift.toFixed(1).padStart(4)} deg, motor>15% ${String(msHigh).padStart(4)} ms, max|I| ${maxI.toFixed(0)}`);
    }
});
