// The owner's chop with its sticks centred from the chop on, repeated with 16 different small motor-to-motor spreads
// (each rotor's thrust and torque x 1 +- up to 2.5 %, K_ASYM, fixed pseudo-random list), for each prop model and tune:
// the distribution of the peak roll/pitch rate, tilt change and motor-high time over 0-1.5 s, to compare with the 11
// real centred chops (peak median 32/60, max 77 deg/s; tilt median 6 deg). ROOT = scratch copy with the switches.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('sweep', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks0: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; const t0 = 4187;
    // sticks centred (roll, pitch, yaw) from the chop on
    const sticks = sticks0.map((r) => r[0] >= t0 ? [r[0], 0, 0, r[3], 0, ...r.slice(5)] : r);
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const spreads = Array.from({ length: 16 }, () => [0, 1, 2, 3].map(() => 1 + (rnd() * 2 - 1) * 0.025));
    const models = [{ name: "as built", band: 1, simmons: 0 }];
    for (const tune of ['original', 'supafly5']) for (const m of models) {
        const accs: number[] = [], tops: number[] = []; const peaks: number[] = [], tilts: number[] = [], highs: number[] = [], cmds: number[] = [];
        for (const sp of spreads) {
            g.K_ASYM = sp; g.K_BAND = m.band; g.K_SIMMONS = m.simmons; g.K_LAG = 0; g.K_DAMP = 0;
            const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
            tunes.tuneOverrides(tune, o);
            if (tune === 'supafly5') o.dynIdle = { ...o.dynIdle, minRpm: 30 };
            const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
            let fa = 0, fb = 0; const hist: number[][] = []; let acc = 0, top = 0; let pk = 0, ia = 0, ib = 0, tilt = 0, last = 0, cmdAtPk = 0;
            for (const row of sticks) {
                sim.setChannels(row.slice(1)); sim.step();
                const t = row[0] - t0;
                if (t < 0 || t > 1500) continue;
                const kf = 0.001 / (1 / (2 * Math.PI * 100) + 0.001); fa += (sim.s[S.wx] * 57.3 - fa) * kf; fb += (sim.s[S.wz] * 57.3 - fb) * kf; hist.push([fa, fb]);
                if (t >= 45 && t <= 445) { const h0 = hist[hist.length - 11]; acc = Math.max(acc, Math.abs(fa - h0[0]) / 0.01, Math.abs(fb - h0[1]) / 0.01); top = Math.max(top, ...sim.motorCmd); }
                const a = sim.s[S.wx] * 57.3, b = sim.s[S.wz] * 57.3;
                const r = Math.max(Math.abs(a), Math.abs(b));
                if (r > pk) { pk = r; cmdAtPk = Math.max(...sim.motorCmd); }
                ia += a * 0.001; ib += b * 0.001; tilt = Math.max(tilt, Math.hypot(ia, ib));
                if (Math.max(...sim.motorCmd) > 0.15) last = t;
            }
            peaks.push(pk); accs.push(acc); tops.push(top); tilts.push(tilt); highs.push(last); cmds.push(cmdAtPk);
        }
        const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
        console.log(`${tune.padEnd(9)} ${m.name.padEnd(15)} peak median ${med(peaks).toFixed(0)} max ${Math.max(...peaks).toFixed(0)} deg/s (all: ${peaks.map((v) => v.toFixed(0)).join(' ')}) | tilt median ${med(tilts).toFixed(1)} deg | motor high until median ${med(highs)} ms | max accel median ${med(accs).toFixed(0)} max ${Math.max(...accs).toFixed(0)} deg/s^2 | top motor median ${med(tops).toFixed(2)}`);
    }
});
