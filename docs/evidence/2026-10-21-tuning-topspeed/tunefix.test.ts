// Betaflight's documented fixes for throttle-chop wobble (PID Tuning Tab, 4.3 tuning notes, Dynamic Idle guide), tried
// in the sim: (a) the owner's chop flight replayed (4.15-7 s); (b) clean chops, sticks centred, 2 % motor spread, at
// about 30 and 37 m/s level and 27 m/s climbing. Metrics: max roll/pitch rate, pitch drift (a), motor > 15 % ms, max |I|.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
const R0 = [45, 80, 40, 120], P0 = [47, 84, 46, 125], Y0 = [45, 80, 0, 120];
const sc4 = (v: number[], k: number[]) => v.map((x, i) => x * k[i]);
type Case = { name: string; o?: any; ag?: number };
const cases: Case[] = [
    { name: 'owner settings (dynamic idle 3400 rpm)' },
    { name: 'dynamic idle 4000 rpm', o: { dynIdle: { minRpm: 40 } } },
    { name: 'no dynamic idle, static idle 7 %', o: { dynIdle: null, idle: 0.07 } },
    { name: 'Pitch Tracking +30 % (pitch P, I)', o: { pid: { pitch: sc4(P0, [1.3, 1.3, 1, 1.3]) } } },
    { name: 'Tracking +30 % (roll+pitch P, I)', o: { pid: { roll: sc4(R0, [1.3, 1.3, 1, 1.3]), pitch: sc4(P0, [1.3, 1.3, 1, 1.3]) } } },
    { name: 'all PIDs +30 %', o: { pid: { roll: sc4(R0, [1.3, 1.3, 1.3, 1]), pitch: sc4(P0, [1.3, 1.3, 1.3, 1]), yaw: sc4(Y0, [1.3, 1.3, 1, 1]) } } },
    { name: 'I -30 % (Drift-Wobble slider down)', o: { pid: { roll: sc4(R0, [1, 0.7, 1, 1]), pitch: sc4(P0, [1, 0.7, 1, 1]) } } },
    { name: 'anti-gravity gain x0.5', ag: 0.5 },
    { name: 'anti-gravity gain x2', ag: 2 },
    { name: 'throttle expo 30 (mid 50)', o: { throttle: { mid: 50, expo: 30 } } },
    { name: 'freestyle values P65 I95 D45 + dyn idle 4000', o: { dynIdle: { minRpm: 40 }, pid: { roll: [65, 95, 45, 120], pitch: [65, 95, 45, 125] } } },
];
test('tunefix', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; g.K_LAG = 0; g.K_BAND = 1; g.K_DAMP = 0;
    for (const c of cases) {
        g.K_AGGAIN = c.ag ?? 1;
        // (a) the owner's flight
        g.K_ASYM = null;
        const base = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
        const o = { ...base, ...(c.o ?? {}) }; if (o.dynIdle === null) delete o.dynIdle;
        if (c.o?.dynIdle) o.dynIdle = { ...base.dynIdle, ...c.o.dynIdle };
        let sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
        let mr = 0, mp = 0, ms = 0, p0 = NaN, drift = 0, mi = 0;
        for (const row of sticks) {
            sim.setChannels(row.slice(1)); sim.step();
            if (row[0] >= 4150 && row[0] < 7000) {
                const a = sc.attitude(sim.s); if (isNaN(p0)) p0 = a.pitch; drift = Math.max(drift, Math.abs(a.pitch - p0));
                mr = Math.max(mr, Math.abs(sim.s[S.wz]) * 57.3); mp = Math.max(mp, Math.abs(sim.s[S.wx]) * 57.3);
                if (Math.max(...sim.motorCmd) > 0.15) ms++; mi = Math.max(mi, Math.abs(sim.s[S.iP]), Math.abs(sim.s[S.iR]));
            }
        }
        let out = `${c.name.padEnd(46)} owner chop: ${mr.toFixed(0).padStart(3)}/${mp.toFixed(0).padStart(3)} deg/s, drift ${drift.toFixed(1).padStart(4)}, >15% ${String(ms).padStart(4)} ms, I ${mi.toFixed(0).padStart(3)} |`;
        // (b) clean chops
        g.K_ASYM = [1.02, 0.99, 1, 0.99];
        for (const [mode, tilt, V] of [['level', 60, 30], ['level', 72, 37], ['climb', 30, 27]] as const) {
            const oo = { ...(c.o ?? {}) }; if (oo.dynIdle === null) delete oo.dynIdle; if (oo.dynIdle) oo.dynIdle = { minRpm: 34, ...oo.dynIdle };
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
