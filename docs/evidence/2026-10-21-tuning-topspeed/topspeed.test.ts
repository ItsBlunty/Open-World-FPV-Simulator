// Level-flight top speed of the Nazgul (airflow physics) at full throttle: for each tilt of the thrust axis, start at
// 25 m/s horizontal, fly 10 s in acro with sticks centred, and read the horizontal and vertical speed at the end.
// Level top speed = horizontal speed where the vertical speed crosses zero. Swept over the drag-area scale.
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
const ROOT = process.env.ROOT!;
test('topspeed', async () => {
    const sc: any = await import(ROOT + '/packages/sim-core/src/index');
    const preset = JSON.parse(readFileSync(ROOT + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
    const S = sc.S;
    for (const cdaScale of [0.75, 1, 1.5]) {
        const rows: [number, number, number][] = [];
        for (let tilt = 50; tilt <= 86; tilt += 3) {
            const sim = new sc.Sim(sc.compileParams(preset, { cdaScale, batteryDrain: false }), null);
            sim.reset(0, 2000, 0, 0);
            const ch = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0];
            sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
            const h = (tilt * Math.PI / 180) / 2; sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = -Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
            const qw = sim.s[S.qw], qx = sim.s[S.qx]; const fwdZ = -(1 - 2 * qx * qx);
            sim.s[S.vx] = 0; sim.s[S.vy] = 0; sim.s[S.vz] = 25 * Math.sign(fwdZ);
            ch[2] = 1; sim.setChannels(ch);
            for (let i = 0; i < 10000; i++) sim.step();
            rows.push([tilt, Math.hypot(sim.s[S.vx], sim.s[S.vz]), sim.s[S.vy]]);
        }
        let level = NaN;
        for (let i = 1; i < rows.length; i++) if (rows[i - 1][2] >= 0 && rows[i][2] < 0) { const f = rows[i - 1][2] / (rows[i - 1][2] - rows[i][2]); level = rows[i - 1][1] + f * (rows[i][1] - rows[i - 1][1]); }
        console.log(`cdaScale ${cdaScale}: level top speed ${level.toFixed(1)} m/s (${(level * 3.6).toFixed(0)} km/h) | ` + rows.map(([t, vh, vv]) => `${t}deg ${vh.toFixed(0)}/${vv >= 0 ? '+' : ''}${vv.toFixed(0)}`).join(' '));
    }
});
