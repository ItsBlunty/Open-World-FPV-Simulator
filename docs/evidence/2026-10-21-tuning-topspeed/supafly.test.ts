// The SupaflyFPV Freestyle 5 Inch preset (betaflight/firmware-presets 4.5, GPL-3.0) in the sim, vs the sim's stock tune
// and Betaflight 4.5's defaults. PIDs from Betaflight 4.5.1 simplified_tuning.c on the 4.5 defaults; TPA, thrust
// linear, I-term relax cutoff and anti-gravity gain via the scratch patch (knobs). Owner's chop (4.15-7 s) and clean
// chops (sticks centred, 2 % motor spread) at 30 / 37 m/s level and 27 m/s climbing.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
const PT1 = (fc: number) => { const rc = 1 / (2 * Math.PI * fc); return 0.001 / (rc + 0.001); };
type Case = { name: string; pid?: any; dyn?: number; ag?: number; relax?: number; tpa?: any; tl?: number };
const BF_TPA = { mode: 'D', rate: 65, bp: 1350, lowRate: 20, lowBp: 1050, lowAlways: false };
const SF_TPA = { mode: 'PD', rate: 50, bp: 1250, lowRate: 20, lowBp: 1100, lowAlways: true };
const SF_CAM = { roll: [56, 86, 36, 117], pitch: [71, 108, 49, 146], yaw: [56, 86, 0, 117] };
const SF_NOCAM = { roll: [51, 78, 33, 112], pitch: [59, 90, 41, 128], yaw: [51, 78, 0, 112] };
const cases: Case[] = [
    { name: 'sim stock tune (owner settings, dyn idle 3400)' },
    { name: 'Betaflight 4.5 defaults incl. TPA (D 30, dyn idle 3400)', pid: { roll: [45, 80, 30, 120], pitch: [47, 84, 34, 125] }, tpa: BF_TPA },
    { name: 'SupaFly 5" (action cam option, the default)', pid: SF_CAM, dyn: 30, ag: 120 / 80, relax: 10, tpa: SF_TPA, tl: 0.30 },
    { name: 'SupaFly 5" (no action cam option)', pid: SF_NOCAM, dyn: 30, ag: 110 / 80, relax: 10, tpa: SF_TPA, tl: 0.30 },
    { name: 'SupaFly cam, without thrust linear', pid: SF_CAM, dyn: 30, ag: 120 / 80, relax: 10, tpa: SF_TPA },
    { name: 'SupaFly cam, without TPA', pid: SF_CAM, dyn: 30, ag: 120 / 80, relax: 10, tl: 0.30 },
    { name: 'SupaFly cam, PIDs only', pid: SF_CAM },
];
test('supafly', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; g.K_LAG = 0; g.K_BAND = 1; g.K_DAMP = 0;
    for (const c of cases) {
        const setK = () => { g.K_AGGAIN = c.ag ?? 1; g.K_RELAXK = c.relax ? PT1(c.relax) : undefined; g.K_TPA = c.tpa ?? null; g.tpaLowFaded = false; g.K_TL = c.tl ?? 0; };
        setK(); g.K_ASYM = null;
        const base = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
        const o: any = { ...base }; if (c.pid) o.pid = c.pid; if (c.dyn) o.dynIdle = { ...base.dynIdle, minRpm: c.dyn };
        let sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
        let mr = 0, mp = 0, ms = 0, p0 = NaN, drift = 0, mi = 0, ss = 0, nn = 0, tilt = 0; let q0: number[] | null = null;
        for (const row of sticks) {
            sim.setChannels(row.slice(1)); sim.step();
            if (row[0] >= 4150 && row[0] < 7000) {
                const a = sc.attitude(sim.s); if (isNaN(p0)) p0 = a.pitch; drift = Math.max(drift, Math.abs(a.pitch - p0));
                mr = Math.max(mr, Math.abs(sim.s[S.wz]) * 57.3); mp = Math.max(mp, Math.abs(sim.s[S.wx]) * 57.3);
                if (Math.max(...sim.motorCmd) > 0.15) ms++; mi = Math.max(mi, Math.abs(sim.s[S.iP]), Math.abs(sim.s[S.iR]));
                ss += sim.s[S.wx] ** 2 + sim.s[S.wz] ** 2; nn++;
                // total change of the thrust axis direction since the chop (yaw-free tilt change)
                const qw = sim.s[S.qw], qx = sim.s[S.qx], qy = sim.s[S.qy], qz = sim.s[S.qz];
                const up = [2 * (qx * qy - qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qw * qx)];
                if (!q0) q0 = up; tilt = Math.max(tilt, Math.acos(Math.min(1, up[0] * q0[0] + up[1] * q0[1] + up[2] * q0[2])) * 57.3);
            }
        }
        let out = `${c.name.padEnd(56)} owner chop: ${mr.toFixed(0).padStart(3)}/${mp.toFixed(0).padStart(3)} deg/s, drift ${drift.toFixed(1).padStart(4)}, rms ${(Math.sqrt(ss / nn) * 57.3).toFixed(0).padStart(3)} deg/s, tilt change ${tilt.toFixed(1).padStart(4)}, >15% ${String(ms).padStart(4)} ms, I ${mi.toFixed(0).padStart(3)} |`;
        for (const [mode, tilt, V] of [['level', 60, 30], ['level', 72, 37], ['climb', 30, 27]] as const) {
            setK(); g.K_ASYM = [1.02, 0.99, 1, 0.99];
            const oo: any = {}; if (c.pid) oo.pid = c.pid; oo.dynIdle = { minRpm: c.dyn ?? 34 };
            sim = new sc.Sim(sc.compileParams(preset, oo), null); sim.reset(0, 500, 0, 0);
            const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const h = (tilt * Math.PI / 180) / 2; sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = -Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
            const qw = sim.s[S.qw], qx = sim.s[S.qx]; const upY = 1 - 2 * qx * qx, upZ = 2 * qw * qx, fwdZ = -(1 - 2 * qx * qx);
            if (mode === 'level') { sim.s[S.vy] = 0; sim.s[S.vz] = V * Math.sign(fwdZ); } else { sim.s[S.vy] = V * upY; sim.s[S.vz] = V * upZ; }
            const thr = mode === 'level' ? 0.9 : 0.7; ch[2] = thr * 2 - 1; sim.setChannels(ch);
            for (let i = 0; i < 300; i++) sim.step();
            let r = 0, p = 0, m = 0, ii = 0;
            for (let i = 0; i < 1000; i++) {
                ch[2] = thr * (i < 150 ? 1 - i / 150 : 0) * 2 - 1; sim.setChannels(ch); sim.step();
                if (i >= 150) { r = Math.max(r, Math.abs(sim.s[S.wz]) * 57.3); p = Math.max(p, Math.abs(sim.s[S.wx]) * 57.3); if (Math.max(...sim.motorCmd) > 0.15) m++; ii = Math.max(ii, Math.abs(sim.s[S.iP]), Math.abs(sim.s[S.iR])); }
            }
            out += ` ${mode} ${V}: ${r.toFixed(0)}/${p.toFixed(0)}, ${m} ms, I ${ii.toFixed(0)} |`;
        }
        console.log(out);
    }
});
