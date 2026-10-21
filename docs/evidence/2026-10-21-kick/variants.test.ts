// The 16 seeded centred-stick chops (as sweep.test.ts) for each model variant and tune, scored like the real logs:
// peak roll/pitch rate (0-1.5 s), largest angular acceleration over 10 ms steps after a 100 Hz PT1 (45-445 ms), top
// motor command in that span. Real (11 centred chops, Betaflight 3.2-4.0): peak median ~60 max 77 deg/s, acceleration
// median 2200 max 3700 deg/s^2, top motor median 0.49.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('variants', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const sticks0: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; const t0 = 4187;
    const sticks = sticks0.map((r) => r[0] >= t0 ? [r[0], 0, 0, r[3], 0, ...r.slice(5)] : r);
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const spreads = Array.from({ length: 16 }, () => [0, 1, 2, 3].map(() => 1 + (rnd() * 2 - 1) * 0.025));
    type V = { name: string; pi?: number; dead?: number; lag?: number; simmons?: number; band?: number; kappa?: number };
    const variants: V[] = JSON.parse(process.env.VARIANTS!);
    for (const tune of (process.env.TUNES ?? 'original,supafly5').split(',')) for (const v of variants) {
        const peaks: number[] = [], accs: number[] = [], tops: number[] = [], highs: number[] = [];
        for (const sp of spreads) {
            g.K_ASYM = sp; g.K_BAND = v.band ?? 1; g.K_SIMMONS = v.simmons ?? 0; g.K_LAG = v.lag ?? 0; g.lagT = null; g.K_DAMP = 0; g.K_DEAD = v.dead ?? 0; g.K_CMD = null;
            const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
            tunes.tuneOverrides(tune, o);
            if (tune === 'supafly5') o.dynIdle = { ...o.dynIdle, minRpm: 30 };
            if (v.pi) o.propInertia = v.pi;
            const pr = JSON.parse(JSON.stringify(preset)); if (v.kappa) pr.fields.motor_kappa_m.value = v.kappa; if ((v as any).inertia) { pr.fields.inertia_roll_pitch_kgm2.value *= (v as any).inertia; pr.fields.inertia_yaw_kgm2.value *= (v as any).inertia; }
            const sim = new sc.Sim(sc.compileParams(pr, o), null); sim.reset(0, 0.105, -585, 0);
            let fa = 0, fb = 0; const hist: number[][] = []; let acc = 0, top = 0, pk = 0, last = 0;
            const kf = 0.001 / (1 / (2 * Math.PI * 100) + 0.001);
            for (const row of sticks) {
                sim.setChannels(row.slice(1)); sim.step();
                const t = row[0] - t0;
                if (t < 0 || t > 1500) continue;
                const a = sim.s[S.wx] * 57.3, b = sim.s[S.wz] * 57.3;
                pk = Math.max(pk, Math.abs(a), Math.abs(b));
                fa += (a - fa) * kf; fb += (b - fb) * kf; hist.push([fa, fb]);
                if (t >= 45 && t <= 445) { const h0 = hist[hist.length - 11]; acc = Math.max(acc, Math.abs(fa - h0[0]) / 0.01, Math.abs(fb - h0[1]) / 0.01); top = Math.max(top, ...sim.motorCmd); }
                if (Math.max(...sim.motorCmd) > 0.15) last = t;
            }
            peaks.push(pk); accs.push(acc); tops.push(top); highs.push(last);
        }
        const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
        console.log(`${tune.padEnd(9)} ${v.name.padEnd(34)} peak ${med(peaks).toFixed(0).padStart(4)} / ${Math.max(...peaks).toFixed(0).padStart(4)} deg/s | accel ${med(accs).toFixed(0).padStart(6)} / ${Math.max(...accs).toFixed(0).padStart(6)} deg/s^2 | top motor ${med(tops).toFixed(2)} | motor high until ${med(highs)} ms`);
    }
});
