// The new Nazgul (measured motor, ESC dead time, inertia, preset TPA) as the game flies it (4 kHz, SupaFly tune with
// dynamic idle 3000 rpm; and Betaflight defaults), the owner's chop with sticks centred and 16 motor spreads: peak rate,
// largest angular acceleration over 10 ms (100 Hz PT1) in 45-445 ms after the chop, top motor then, motor > 15 % until,
// tilt change. Real issue logs: peak ~60/77, accel 2200 (max 3700), top motor 0.49, 1.5-2.5 s, tilt 6.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
const REPLAY = 'G:/openworldfpvsim/docs/evidence/2026-10-20-windmill/replay/';
test('chop', { timeout: 900000 }, async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8')); if (process.env.DELAY) preset.fields.esc_delay_ms = { value: Number(process.env.DELAY), source: 'test' };
    const sticks0: number[][] = JSON.parse(readFileSync(REPLAY + 'sticks.json', 'utf8'));
    const S = sc.S; const g = globalThis as any; const t0 = 4187;
    const sticks = sticks0.map((r) => r[0] >= t0 ? [r[0], 0, 0, r[3], 0, ...r.slice(5)] : r);
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const spreads = Array.from({ length: 16 }, () => [0, 1, 2, 3].map(() => 1 + (rnd() * 2 - 1) * 0.025));
    for (const tune of ['supafly5', 'betaflight']) {
        const peaks: number[] = [], accs: number[] = [], tops: number[] = [], highs: number[] = [], tilts: number[] = [];
        for (const sp of spreads) {
            g.K_ASYM = sp;
            const o: any = JSON.parse(readFileSync(REPLAY + 'overrides.json', 'utf8'));
            delete o.dynIdle; tunes.tuneOverrides(tune, o); o.loopHz = 4000; if (process.env.DIN) o.dynamicInflow = true;
            if (tune === 'supafly5') o.dynIdle = { minRpm: 30 };
            (globalThis as any).K_LEAD = Number(process.env.LEAD ?? 0) / 1000; (globalThis as any).leadT = null; const sim = new sc.Sim(sc.compileParams(preset, o), null); sim.reset(0, 0.105, -585, 0);
            let fa = 0, fb = 0; const hist: number[][] = []; let acc = 0, top = 0, pk = 0, last = 0, ia = 0, ib = 0, tilt = 0;
            const kf = 0.001 / (1 / (2 * Math.PI * 100) + 0.001);
            for (const row of sticks) {
                sim.setChannels(row.slice(1)); sim.step();
                const t = row[0] - t0;
                if (t < 0 || t > 1500) continue;
                const a = sim.s[S.wx] * 57.3, b = sim.s[S.wz] * 57.3;
                pk = Math.max(pk, Math.abs(a), Math.abs(b)); ia += a * 0.001; ib += b * 0.001; tilt = Math.max(tilt, Math.hypot(ia, ib));
                fa += (a - fa) * kf; fb += (b - fb) * kf; hist.push([fa, fb]);
                if (t >= 45 && t <= 445) { const h0 = hist[hist.length - 11]; acc = Math.max(acc, Math.abs(fa - h0[0]) / 0.01, Math.abs(fb - h0[1]) / 0.01); top = Math.max(top, ...sim.motorCmd); }
                if (Math.max(...sim.motorCmd) > 0.15) last = t;
            }
            peaks.push(pk); accs.push(acc); tops.push(top); highs.push(last); tilts.push(tilt);
        }
        g.K_ASYM = null;
        const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
        console.log(`${tune.padEnd(10)} peak ${med(peaks).toFixed(0)} / ${Math.max(...peaks).toFixed(0)} deg/s | accel ${med(accs).toFixed(0)} / ${Math.max(...accs).toFixed(0)} deg/s^2 | top motor ${med(tops).toFixed(2)} | motor high until ${med(highs)} ms | tilt ${med(tilts).toFixed(1)} deg`);
    }
});
