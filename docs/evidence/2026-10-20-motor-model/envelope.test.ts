// The Nazgul's flight envelope, measured from the model before and after the motor model (2026-10-20), both physics
// models (airflow and classic). Run: pnpm exec vitest run --root docs/evidence/2026-10-20-motor-model
// OUT=before|after picks the output file (envelope-<OUT>.txt).
import { test } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { compileParams, Sim, S, hoverSolve, attitude, MODE_CHANNEL, SIM_CORE_VERSION } from '../../../packages/sim-core/src/index';
import preset from '../../../packages/sim-core/presets/nazgulf5v3-6s.json';

const OUT = new URL(`envelope-${process.env.OUT ?? 'out'}.txt`, import.meta.url);
const log = (t: string) => appendFileSync(OUT, t + '\n');
const ACRO = MODE_CHANNEL.acro;
const rpm = (sim: Sim, i: number) => Math.abs(sim.s[S.m0 + i]) * sim.p.omegaMaxPerVolt * sim.s[S.volt] * 60 / (2 * Math.PI);
const speed = (sim: Sim) => Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]);

function armed(classic: boolean, y = 1000): { sim: Sim; ch: number[] } {
    const sim = new Sim(compileParams(preset as never, { classicPhysics: classic }), null);
    sim.reset(0, y, 0, 0);
    const ch = [0, 0, -1, 0, -1, ACRO, 0, 0];
    sim.setChannels(ch); sim.step(); ch[4] = 1; sim.setChannels(ch); sim.step();
    return { sim, ch };
}
function setPitch(sim: Sim, deg: number) { const h = -deg * Math.PI / 360; sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = Math.sin(h); sim.s[S.qy] = 0; sim.s[S.qz] = 0; }
/** hold an attitude by force (the controller still runs); speeds every `every` ms */
function held(classic: boolean, thr: number, secs: number, pitch: number, every = 500): string {
    const { sim } = armed(classic);
    sim.setChannels([0, 0, thr, 0, 1, ACRO, 0, 0]); const out: string[] = [];
    for (let i = 1; i <= secs * 1000; i++) {
        setPitch(sim, pitch); sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0;
        sim.step();
        if (i % every === 0) out.push((i / 1000).toFixed(1) + 's:' + speed(sim).toFixed(1));
    }
    return out.join(' ');
}
/** hovering in acro at the solved hover stick for `ms` */
function hovering(classic: boolean): { sim: Sim; ch: number[]; stick: number } {
    const { sim, ch } = armed(classic);
    const stick = hoverSolve(sim.p, 1).stick;
    ch[2] = stick * 2 - 1; sim.setChannels(ch);
    for (let i = 0; i < 3000; i++) sim.step();
    return { sim, ch, stick };
}

test('envelope', () => {
    writeFileSync(OUT, `${SIM_CORE_VERSION}\n`);
    for (const classic of [false, true]) {
        const p = compileParams(preset as never, { classicPhysics: classic });
        const hs = hoverSolve(p, 1);
        log(`\n=== ${classic ? 'CLASSIC' : 'AIRFLOW'}`);
        {
            const { sim } = hovering(classic);
            log(`hover: solved motor command ${hs.motor.toFixed(4)}, stick ${hs.stick.toFixed(4)}; after 3 s: vy ${sim.s[S.vy].toFixed(3)} m/s, rpm ${rpm(sim, 0).toFixed(0)}, ${sim.s[S.amps].toFixed(2)} A, ${sim.s[S.volt].toFixed(2)} V`);
        }
        {
            const { sim, ch } = armed(classic);
            for (let i = 0; i < 1000; i++) sim.step();
            log(`idle, armed, throttle down 1 s: rpm ${[0, 1, 2, 3].map((i) => rpm(sim, i).toFixed(0)).join(' ')}`);
            void ch;
        }
        {
            // motor step: the commanded output steps from hover to hover + 0.3 and back (motors read directly)
            const { sim } = hovering(classic);
            const r0 = rpm(sim, 0);
            const stepTo = (thrStick: number, label: string) => {
                sim.setChannels([0, 0, thrStick * 2 - 1, 0, 1, ACRO, 0, 0]);
                const start = rpm(sim, 0); const trace: number[] = [];
                for (let i = 0; i < 300; i++) { sim.step(); trace.push(rpm(sim, 0)); }
                const end = trace[trace.length - 1];
                const t63 = trace.findIndex((r) => Math.abs(r - start) >= 0.632 * Math.abs(end - start)) + 1;
                log(`motor step ${label}: ${start.toFixed(0)} -> ${end.toFixed(0)} rpm, 63 % in ${t63} ms`);
            };
            stepTo(Math.min(1, hs.stick + 0.3), 'up  ');
            stepTo(hs.stick, 'down');
            void r0;
        }
        log('full-throttle climb        ' + held(classic, 1, 4, 0));
        log('full throttle, 60 deg      ' + held(classic, 1, 4, 60));
        log('full throttle, 75 deg      ' + held(classic, 1, 4, 75));
        log('flat fall, throttle down   ' + held(classic, -1, 6, 0, 1000));
        log('nose-down dive, thr down   ' + held(classic, -1, 6, 90, 1000));
        {
            const { sim } = armed(classic);
            sim.setChannels([0, 0, 1, 0, 1, ACRO, 0, 0]);
            for (let i = 0; i < 500; i++) { setPitch(sim, 0); sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0; sim.step(); }
            log(`full throttle 0.5 s: ${sim.s[S.amps].toFixed(1)} A, ${sim.s[S.volt].toFixed(2)} V, rpm ${rpm(sim, 0).toFixed(0)}`);
        }
        {
            // roll step at hover: full stick for 300 ms, rate and 63 % time
            const { sim, ch } = hovering(classic);
            ch[0] = 1; sim.setChannels(ch);
            let t63 = -1, peak = 0; const target = sim.s[S.spR];
            for (let i = 1; i <= 300; i++) {
                sim.step();
                const r = -sim.s[S.wz] * 180 / Math.PI;
                if (r > peak) peak = r;
                if (t63 < 0 && r >= 0.632 * sim.s[S.spR]) t63 = i;
            }
            void target;
            log(`roll step at hover: setpoint ${sim.s[S.spR].toFixed(0)} deg/s, 63 % in ${t63} ms, peak ${peak.toFixed(0)}`);
        }
        // throttle chops: climb by stick in angle mode, settle in acro, then the throttle cut alone
        for (const [label, pitchStick, thr] of [['chop from a 23 m/s climb, 23 deg', 0.6, 0.3], ['chop from a 33 m/s climb, 39 deg', 0.8, 0.6], ['chop from a slow climb, 11 deg', 0.4, 0.1]] as const) {
            const { sim, ch } = armed(classic, 2000);
            ch[5] = MODE_CHANNEL.angle; ch[2] = thr; ch[1] = pitchStick; sim.setChannels(ch);
            for (let i = 0; i < 6000; i++) sim.step();
            // acro, sticks centred, the same throttle for 0.5 s (no stick move at the chop), then only the throttle cut
            ch[5] = ACRO; ch[1] = 0; sim.setChannels(ch);
            for (let i = 0; i < 500; i++) sim.step();
            const t0 = attitude(sim.s).pitch, v0 = speed(sim);
            ch[2] = -1; sim.setChannels(ch);
            let peakCmd = 0, msHigh = 0, dev = 0, maxRate = 0;
            for (let i = 0; i < 2000; i++) {
                sim.step();
                const m = Math.max(...sim.motorCmd); if (m > peakCmd) peakCmd = m; if (m > 0.15) msHigh++;
                dev = Math.max(dev, Math.abs(attitude(sim.s).pitch - t0));
                maxRate = Math.max(maxRate, Math.abs(sim.s[S.wx]) * 180 / Math.PI);
            }
            log(`${label} (${v0.toFixed(1)} m/s): peak motor cmd ${peakCmd.toFixed(2)}, ms a motor > 15 %: ${msHigh}, pitch moved ${dev.toFixed(1)} deg, max pitch rate ${maxRate.toFixed(0)} deg/s`);
        }
        {
            // steering in the chop: 0.3 s after cutting the throttle from the 23 m/s climb, a roll stick of 0.3 for 150 ms
            const { sim, ch } = armed(classic, 2000);
            ch[5] = MODE_CHANNEL.angle; ch[2] = 0.3; ch[1] = 0.6; sim.setChannels(ch);
            for (let i = 0; i < 6000; i++) sim.step();
            ch[5] = ACRO; ch[1] = 0; sim.setChannels(ch);
            for (let i = 0; i < 500; i++) sim.step();
            ch[2] = -1; sim.setChannels(ch);
            for (let i = 0; i < 300; i++) sim.step();
            let e2 = 0, maxE = 0, swings = 0, last = 0, n = 0;
            for (let i = 0; i < 1000; i++) {
                ch[0] = i < 150 ? 0.3 : 0; sim.setChannels(ch); sim.step();
                const r = -sim.s[S.wz] * 180 / Math.PI, e = sim.s[S.spR] - r;
                e2 += e * e; n++; if (Math.abs(e) > maxE) maxE = Math.abs(e);
                const sg = Math.abs(r) < 15 ? 0 : Math.sign(r); if (sg !== 0 && sg !== last) { if (last !== 0) swings++; last = sg; }
            }
            log(`roll input in the chop (0.3 stick, 150 ms): rate error rms ${Math.sqrt(e2 / n).toFixed(0)} deg/s, max ${maxE.toFixed(0)}, overshoot swings ${swings}, roll left ${attitude(sim.s).roll.toFixed(1)} deg`);
        }
    }
});
