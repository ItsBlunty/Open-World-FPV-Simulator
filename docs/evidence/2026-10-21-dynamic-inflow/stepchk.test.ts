// Hover, then a roll stick step to 0.3: time for the gyro (true rate) to reach 50 % / 90 % of the setpoint, with and
// without the ESC dead time.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('stepchk', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const tunes: any = await import('G:/openworldfpvsim/apps/fly/src/tunes');
    for (const tune of ['original', 'supafly5']) for (const d of [0, 4]) for (const ff of [true, false]) {
        const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
        if (d) preset.fields.esc_delay_ms = { value: d, source: 'test' };
        const o: any = { loopHz: 4000 }; if (process.env.DIN) o.dynamicInflow = true; tunes.tuneOverrides(tune, o);
        if (!ff) { const pid = o.pid ?? { roll: [...preset.fields.pid_roll.value], pitch: [...preset.fields.pid_pitch.value], yaw: [...preset.fields.pid_yaw.value] }; pid.roll[3] = 0; pid.pitch[3] = 0; pid.yaw[3] = 0; o.pid = pid; }
        const p = sc.compileParams(preset, o);
        (globalThis as any).K_LAG = Number(process.env.LAG ?? 0) / 1000; (globalThis as any).lagT = null; const sim = new sc.Sim(p, null); const S = sc.S; sim.reset(0, 5000, 0, 0);
        const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0]; sim.setChannels(ch); for (let i = 0; i < 100; i++) sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step(); ch[2] = -0.2; sim.setChannels(ch);
        for (let i = 0; i < 1500; i++) { sim.setChannels(ch); sim.step(); }
        ch[0] = 0.3; let t50 = -1, t90 = -1, pk = 0; let sp = 0;
        for (let i = 0; i < 300; i++) { sim.setChannels(ch); sim.step(); sp = Math.max(sp, Math.abs(sim.s[S.spR])); const g = Math.abs(sim.s[S.wz]) * 57.3; pk = Math.max(pk, g); if (t50 < 0 && g >= 0.5 * sp && sp > 0) t50 = i + 1; if (t90 < 0 && g >= 0.9 * sp && sp > 0) t90 = i + 1; }
        console.log(`${tune.padEnd(9)} delay ${d} (${p.escDelayLoops} loops) FF ${ff ? 'on ' : 'off'}: setpoint ${sp.toFixed(0)} deg/s, 50 % at ${t50} ms, 90 % at ${t90} ms, peak ${(pk / sp).toFixed(2)}`);
    }
});
