// Lock-step bridge between sim-core's physics and Betaflight SITL built with OWFPV_LOCKSTEP (lockstep_patch.py),
// or the built-in controller for comparison. Per 1 ms tick: rc_packet + fdm_packet to SITL, wait for its motor packet,
// fly one physics tick with those commands. Runs in WSL (node >= 18) next to the SITL binary.
//
// node bridge.js <out.csv> '<json options>'
//   fc: 'sitl' | 'builtin'      scenario: 'steps' | 'fast' | 'chop'      seconds: flight length after arming
//   dead: ms of motor dead time (both)   propInertia: motor slow-down factor (both)   tune: built-in tune id
//   asym: [4 thrust/torque multipliers] (chop only; needs the experiment copy of sim-core, see README)
//   loopHz: sim-core's gyro / PID loop (1000 default); with SITL one exchange per loop (build SITL to match)
// CSV: t_ms, setpoint roll/pitch (deg/s from the sticks and rates), gyro roll/pitch (BF convention, deg/s, through
// Betaflight's default gyro PT1 250 + 500 Hz), motor commands 0-3, speed m/s.
'use strict';
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
const opt = JSON.parse(process.argv[3] || '{}');
const SC = opt.simcore || path.join(__dirname, 'simcore-js', 'index.js');
const sc = require(SC);
const REPO = opt.repo || '/mnt/g/openworldfpvsim';
const preset = JSON.parse(fs.readFileSync(REPO + '/packages/sim-core/presets/nazgulf5v3-6s.json', 'utf8'));
if (opt.asym) globalThis.K_ASYM = opt.asym;

const S = sc.S;
const o = {};
if (opt.propInertia) o.propInertia = opt.propInertia;
if (opt.overrides) Object.assign(o, opt.overrides);
if (opt.loopHz) o.loopHz = opt.loopHz;
const p = sc.compileParams(preset, o);
const sim = new sc.Sim(p, null);
const DT = 0.001;
const NLOOP = p.loopHz / 1000;
const H = 1 / p.loopHz;

// ---- pilot ----
let seed = 777;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ax = [0, 1].map(() => ({ from: 0, to: 0, t0: 0, ramp: 1, hold: 0 }));
let thrTrim = 0;
const hover = 2 * Math.sqrt(1 / 4.5) - 1;
let chopSticks = null, chopT0 = 0;
if (opt.scenario === 'chop') {
    chopSticks = JSON.parse(fs.readFileSync(REPO + '/docs/evidence/2026-10-20-windmill/replay/sticks.json', 'utf8'));
}
/** sticks [roll, pitch, throttle, yaw] in -1..1 at flight time ms (after arming) */
function pilot(ms) {
    const ch = [0, 0, -1, 0];
    if (opt.scenario === 'chop') {
        // the owner's flight from its start, sticks centred from the chop (4187 ms) on
        const r = chopSticks[Math.min(chopSticks.length - 1, ms)];
        ch[0] = r[1]; ch[1] = r[2]; ch[2] = r[3]; ch[3] = r[4];
        if (r[0] >= 4187) { ch[0] = 0; ch[1] = 0; ch[3] = 0; }
        return ch;
    }
    for (let k = 0; k < 2; k++) {
        const a = ax[k];
        if (ms >= a.t0 + a.ramp + a.hold) { a.from = a.to; a.to = (rnd() * 2 - 1) * (rnd() < 0.3 ? 0.9 : 0.45); a.t0 = ms; a.ramp = 40 + Math.floor(rnd() * 110); a.hold = 150 + Math.floor(rnd() * 650); if (rnd() < 0.35) a.to = 0; }
        const u = Math.min(1, (ms - a.t0) / a.ramp); ch[k] = a.from + (a.to - a.from) * u;
    }
    if (opt.scenario === 'fast') {
        const at = sc.attitude(sim.s);
        ch[0] = ch[0] * 0.5 + Math.max(-0.5, Math.min(0.5, -at.roll * 0.01));
        ch[1] = ch[1] * 0.5 + Math.max(-0.5, Math.min(0.5, (70 - at.pitch) * 0.01));
        thrTrim = 0.5 - hover;
    } else {
        thrTrim += -sim.s[S.vy] * 0.00002; thrTrim = Math.max(-0.4, Math.min(1.2, thrTrim));
    }
    ch[2] = Math.max(-1, Math.min(1, hover + thrTrim));
    return ch;
}

// ---- logging ----
const rows = ['t_ms,sp_roll,sp_pitch,gyro_roll,gyro_pitch,m0,m1,m2,m3,speed'];
const kf1 = DT / (1 / (2 * Math.PI * 250) + DT), kf2 = DT / (1 / (2 * Math.PI * 500) + DT);
const fg = [[0, 0], [0, 0]];
function log(ms, ch, cmd) {
    const rc = p.rates;
    const spR = sc.setpointRate(rc.type, ch[0], rc.roll, rc.rateLimit), spP = sc.setpointRate(rc.type, ch[1], rc.pitch, rc.rateLimit);
    const gr = -sim.s[S.wz] * 57.29578, gp = -sim.s[S.wx] * 57.29578;
    fg[0][0] += (gr - fg[0][0]) * kf1; fg[0][1] += (fg[0][0] - fg[0][1]) * kf2;
    fg[1][0] += (gp - fg[1][0]) * kf1; fg[1][1] += (fg[1][0] - fg[1][1]) * kf2;
    const v = Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]);
    rows.push(`${ms},${spR.toFixed(3)},${spP.toFixed(3)},${fg[0][1].toFixed(3)},${fg[1][1].toFixed(3)},${Array.from(cmd).map((c) => c.toFixed(4)).join(',')},${v.toFixed(2)}`);
}

// ---- motor dead time (both controllers) ----
const deadBuf = [];
function delayed(cmd) {
    if (!(opt.dead > 0)) return cmd;
    deadBuf.push(Float64Array.from(cmd));
    return deadBuf.length > opt.dead * NLOOP ? deadBuf.shift() : deadBuf[0];
}

const startY = opt.scenario === 'chop' ? 0.105 : 5000;
const flightMs = Math.round((opt.seconds ?? 90) * 1000);

// ---- built-in controller ----
if (opt.fc === 'builtin') {
    if (opt.tune) { /* tunes are applied by the caller through overrides */ }
    if (opt.scenario === 'chop') sim.reset(0, startY, -585, 0); else sim.reset(0, startY, 0, 0);
    const ch8 = [0, 0, -1, 0, -1, sc.MODE_CHANNEL.acro, 0, 0];
    sim.setChannels(ch8);
    for (let i = 0; i < 200; i++) sim.step();
    ch8[4] = 1; sim.setChannels(ch8); sim.step();
    const orig = sim.physics.bind(sim);
    sim.physics = (c) => orig(delayed(c));
    for (let ms = 0; ms < flightMs; ms++) {
        const ch = pilot(ms);
        ch8[0] = ch[0]; ch8[1] = ch[1]; ch8[2] = ch[2]; ch8[3] = ch[3];
        sim.setChannels(ch8); sim.step();
        log(ms, ch, sim.motorCmd);
    }
    fs.writeFileSync(out, rows.join('\n'));
    console.log('builtin done', rows.length - 1, 'rows');
    process.exit(0);
}

// ---- Betaflight SITL ----
const sock = dgram.createSocket('udp4');
const motorSock = dgram.createSocket('udp4');
const rawSock = dgram.createSocket('udp4');
const SITL_IP = '127.0.0.1';
let tick = 0, armedAt = -1, lastRaw = [0, 0, 0, 0];
const cmd = new Float64Array(4);
let pv = [0, 0, 0];
if (opt.scenario === 'chop') sim.reset(0, startY, -585, 0); else sim.reset(0, startY, 0, 0);
const hold = { px: sim.s[S.px], py: sim.s[S.py], pz: sim.s[S.pz], q: [sim.s[S.qw], sim.s[S.qx], sim.s[S.qy], sim.s[S.qz]] };

function rcPacket(ts, ch, arm) {
    const b = Buffer.alloc(40);
    b.writeDoubleLE(ts, 0);
    const us = (v) => Math.round(1500 + 500 * Math.max(-1, Math.min(1, v)));
    const chans = [us(ch[0]), us(ch[1]), us(ch[2]), us(ch[3]), arm ? 2000 : 1000, 1500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
    chans.forEach((c, i) => b.writeUInt16LE(c, 8 + 2 * i));
    return b;
}
function fdmPacket(ts) {
    const s = sim.s;
    // specific force (world, y up) from the velocity change over the last tick, then body (x right, y up, z back)
    const v = [s[S.vx], s[S.vy], s[S.vz]];
    const f = [(v[0] - pv[0]) / H, (v[1] - pv[1]) / H + 9.81, (v[2] - pv[2]) / H];
    pv = v;
    const w = s[S.qw], x = s[S.qx], y = s[S.qy], z = s[S.qz];
    const xb = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    const yb = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
    const zb = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    const fr = dot(f, xb), fu = dot(f, yb), fbk = dot(f, zb);
    const d = [ts,
        // gyro so that after sitlGyroBodyFromSim (Gazebo bridge: roll, -pitch, yaw) Betaflight sees the sim's own
        // controller inputs (roll -wz, pitch -wx); yaw found reversed in the first flight (spun up), so +wy
        -s[S.wz], s[S.wx], s[S.wy],
        // specific force FRD (forward, right, down)
        -fbk, fr, -fu,
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 101325];
    const b = Buffer.alloc(8 * d.length);
    d.forEach((val, i) => b.writeDoubleLE(val, 8 * i));
    return b;
}
function send(ts, ch, arm) {
    sock.send(rcPacket(ts, ch, arm), 9004, SITL_IP);
    sock.send(fdmPacket(ts), 9003, SITL_IP);
}

let curCh = [0, 0, -1, 0], curArm = false, resendTimer = null, flightMsNow = -1;
function sendTick() {
    const ts = (tick + 1) * H;
    send(ts, curCh, curArm);
    clearTimeout(resendTimer);
    // only before the first reply (SITL not yet listening); afterwards one packet set per motor reply
    resendTimer = setTimeout(() => { if (tick === 0) { pv = [sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]]; sendTick(); } }, 300);
}
rawSock.on('message', (m) => {
    // servo_packet_raw: uint16 motorCount, (2 pad), float pwm_output_raw[16] (microseconds)
    if (m.length >= 20) for (let i = 0; i < 4; i++) lastRaw[i] = m.readFloatLE(4 + 4 * i);
});
motorSock.on('message', (m) => {
    // servo_packet: float motor_speed[4]; use the raw microseconds (1000-2000) for the duty
    for (let i = 0; i < 4; i++) cmd[i] = Math.max(0, Math.min(1, (lastRaw[i] - 1000) / 1000));
    tick++;
    if (opt.debug && tick % 500 === 0) console.log('tick', tick, 'real ms', Date.now() - (globalThis.T0 ??= Date.now()));
    const preArm = armedAt < 0;
    if (preArm) {
        // on the ground: held still and level until Betaflight arms and spins the motors up to idle
        sim.s[S.px] = hold.px; sim.s[S.py] = hold.py; sim.s[S.pz] = hold.pz;
        [sim.s[S.qw], sim.s[S.qx], sim.s[S.qy], sim.s[S.qz]] = hold.q;
        sim.s[S.vx] = sim.s[S.vy] = sim.s[S.vz] = 0; sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0;
        // arm switch toggled (off a second, on a second) after the boot grace, until Betaflight arms
        const msNow = Math.floor(tick / NLOOP);
        curArm = msNow > 6000 && Math.floor(msNow / 1000) % 2 === 1; curCh = [0, 0, -1, 0];
        if (curArm && cmd.some((c) => c > 0.02)) { armedAt = tick; console.log('armed at tick', tick, 'idle cmd', Array.from(cmd).map((c) => c.toFixed(3)).join(' '), 'raw', lastRaw.map((r) => r.toFixed(0)).join(' ')); }
        if (msNow > 30000) { console.log('did not arm; raw', lastRaw); process.exit(2); }
        if (tick % NLOOP === 0) sim.tick++;
        pv = [0, 0, 0];
        sendTick();
        return;
    }
    const loop = tick - armedAt - 1;
    flightMsNow = Math.floor(loop / NLOOP);
    if (loop % NLOOP === 0) sim.tick++;
    sim.physics(delayed(cmd));
    if (loop % NLOOP === NLOOP - 1) log(flightMsNow, curCh, cmd);
    if ((loop + 1) % NLOOP === 0 && flightMsNow + 1 >= flightMs) {
        fs.writeFileSync(out, rows.join('\n'));
        console.log('sitl done', rows.length - 1, 'rows; final speed', Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]).toFixed(1));
        process.exit(0);
    }
    if ((loop + 1) % NLOOP === 0) curCh = pilot(flightMsNow + 1);
    sendTick();
});
motorSock.bind(9002, '127.0.0.1', () => rawSock.bind(9001, '127.0.0.1', () => { console.log('bridge listening; sending tick 0'); sendTick(); }));
