// Quadcopter flight model, fixed 1 ms step, no DOM, deterministic.
//
// Frames: world is PlayCanvas world space (Y up, right-handed). Body: x right, y up (thrust),
// z back (the nose points to -z). Angular velocity w is in body frame, right-hand rule.
// Pilot / PID axes (Betaflight convention): roll + = roll right, pitch + = nose down,
// yaw + = yaw right. In body terms: roll = -w.z, pitch = -w.x, yaw = -w.y.
//
// Channels ch[0..7] in [-1, 1] after calibration: 0 roll (right +), 1 pitch (stick forward +),
// 2 throttle (-1 = low, +1 = full), 3 yaw (right +), 4 arm switch (> 0.5 on), 5 flight mode
// (modeFromChannel: -1 acro, 0 horizon, +1 angle), 6 turtle-mode switch (> 0.5 on; sim-core/0.4.0), 7 spare.
//
// Air: with p.wind (wind.ts) the drag terms act on the airspeed, velocity minus the wind at the
// craft's height above the scan's ground; without it the airspeed is the velocity (still air).

import { dcos, dsin, datan2, RAD2DEG, DEG2RAD } from './dmath';
import type { RotorInflow, SimParams } from './params';
import { cellVoc, hoverSolve, INFLOW_DELTA, INFLOW_RATIO_MAX } from './params';
import { setpointRate, throttleCurve } from './rates';
import { modeFromChannel } from './contracts';
import type { LevelParams, RespawnOpts } from './contracts';
import { PlatformContact } from './platform';
import { compileWind } from './wind';
import type { WindField } from './wind';
import { inducedVelocity, wakeIntensity, wakeNoise } from './wake';
import { crashFlipMix } from './crashflip';

export const DT = 0.001;
export const DT_US = 1000;

export interface ContactOut {
    sphere: number;
    nx: number;
    ny: number;
    nz: number;
}

/** Collision provider. sim-core does not depend on any collision implementation. */
export interface ContactWorld {
    /**
     * n spheres move linearly from c0 to c1 (packed x,y,z world). r = radii, pad = extra
     * conservative inflation per sphere (rotation chord error). Returns the earliest fraction
     * t in [0, 1] at which any sphere of radius r touches solid, or -1 if the whole move is free.
     * On contact, out receives the sphere index and the outward surface normal.
     */
    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number;
    /** Push-out vector for a sphere overlapping solid; false when free. */
    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean;
    /**
     * The surfaces within distance r of the point (x, y, z), at most max of them (the closest when there are more):
     * 4 numbers each into out, the unit normal pointing from the surface towards the point and the distance
     * (negative when the point is inside a solid whose inside is known). Returns how many. A flat surface counts
     * once, however many triangles or voxels it is made of. The contact solver asks this for every body sphere
     * every tick (sim-core/0.3.0).
     *
     * Moving surfaces (sim-core/0.5.0): when `vel` is given, a world whose surfaces move writes each contact's surface
     * velocity at the contact, m/s world, 3 numbers per contact (the sim zeroes it first, so a still world may ignore
     * it). A moving surface may also be reported up to its own travel in one tick beyond r: the solver works on the
     * velocity relative to the surface, so it can stop an approach it sees coming that tick.
     */
    contacts(x: number, y: number, z: number, r: number, out: Float64Array, max: number, vel?: Float64Array): number;
    /**
     * A world whose surfaces move (sim-core/0.5.0) places them where they are at this tick. The sim calls it at the
     * start of every step (parked or not), before any query; the surfaces must be a function of the tick alone (replays).
     */
    at?(tick: number): void;
}

export type SimEvent =
    | { type: 'arm'; tick: number }
    | { type: 'disarm'; tick: number; reason: string }
    /** damage: the share of the health this hit took (0..1; 0 below the safe speed or with crashes off) */
    | { type: 'contact'; tick: number; speed: number; regime: 'slide' | 'bounce'; damage: number }
    | { type: 'crash'; tick: number; speed: number; nx: number; ny: number; nz: number; px: number; py: number; pz: number }
    | { type: 'rest'; tick: number }
    | { type: 'respawn'; tick: number };

// State layout in one Float64Array (hashed for determinism).
export const S = {
    px: 0, py: 1, pz: 2,
    vx: 3, vy: 4, vz: 5,
    qw: 6, qx: 7, qy: 8, qz: 9,
    wx: 10, wy: 11, wz: 12,
    m0: 13, m1: 14, m2: 15, m3: 16,
    iR: 17, iP: 18, iY: 19,
    dfR: 20, dfP: 21, dfY: 22,
    ffR: 23, ffP: 24, ffY: 25,
    spR: 26, spP: 27, spY: 28,
    splR: 29, splP: 30,
    soc: 31, volt: 32, amps: 33,
    // mixRange: motor-mix range of the last step (I-term windup attenuation; v0.2 kept a 0/1 "sat" flag here)
    armed: 34, crashed: 35, armSw: 36, mixRange: 37, restT: 38, crashT: 39,
    g1R: 40, g1P: 41, g1Y: 42, g2R: 43, g2P: 44, g2Y: 45,
    d2R: 46, d2P: 47, d2Y: 48,
    hold: 49,
    // self-level (B.1): PT3 stages of the level rate output and of the angle feed-forward (roll,
    // pitch), the horizon level-share PT1, and the previous angle targets
    lvR1: 50, lvR2: 51, lvR3: 52, lvP1: 53, lvP2: 54, lvP3: 55,
    afR1: 56, afR2: 57, afR3: 58, afP1: 59, afP2: 60, afP3: 61,
    hzS: 62, tgR: 63, tgP: 64,
    // invisible one-way platform (C.2): on flag, disc centre on its top surface, radius
    platOn: 65, platX: 66, platY: 67, platZ: 68, platR: 69,
    // health 1 at a (re)spawn, down by each hit's damage; 0 is a crash (sim-core/0.3.0)
    health: 70,
    // turtle mode (crash flip) active: the turtle switch was on when the craft armed (sim-core/0.4.0)
    flip: 71,
    size: 72
} as const;

const PT1 = (fc: number) => {
    const rc = 1 / (2 * Math.PI * fc);
    return DT / (rc + DT);
};
// D-term filtering, Betaflight 4.5.1 defaults (flight/pid.h): LPF1 PT1 dynamic 75..150 Hz with
// throttle, LPF2 PT1 150 Hz. (The spec's single PT1 100 Hz was an estimate; this is the default.)
const DTERM_DYN_MIN = 75;
const DTERM_DYN_MAX = 150;
const K_DTERM2 = PT1(150);
// Betaflight 4.5.1 default gyro filtering (sensors/gyro.h): LPF1 PT1 250 Hz (dynamic minimum), LPF2 PT1 500 Hz.
// The sensor itself is ideal; these are the controller's filters and their phase lag.
const K_GYRO1 = PT1(250);
const K_GYRO2 = PT1(500);
const K_FF = PT1(30);
const K_RELAX = PT1(15);
// Betaflight's PT3 moves the cutoff so the cascade, not each stage, is -3 dB at fc: 1 / sqrt(2^(1/3) - 1)
const PT3_CUTOFF_CORRECTION = 1.961459177;
const PT3 = (fc: number) => {
    const rc = 1 / (2 * Math.PI * fc * PT3_CUTOFF_CORRECTION);
    return DT / (rc + DT);
};

const P_SCALE = 0.032029;
const I_SCALE = 0.244381;
const D_SCALE = 0.000529;
// Betaflight 4.5.1 (pid_init.c line 278) scales the F gain by 0.01 on top of the FF scale
const F_SCALE = 0.013754 * 0.01;
const ITERM_LIMIT = 400;
const RELAX_THRESHOLD = 40;

// platform (C.2): gap below the lowest body point at the spawn, default radius, and where it retires
const PLAT_GAP = 0.002;
const PLAT_R = 0.4;
const PLAT_LEAVE_UP = 1.0;
const PLAT_LEAVE_SIDE = 0.5;

// quad X mixer, Betaflight order M1 RR, M2 FR, M3 RL, M4 FL; columns roll, pitch, yaw
const MIX_R = [-1, -1, 1, 1];
const MIX_P = [1, -1, 1, -1];
const MIX_Y = [-1, 1, 1, -1];

const MU = 0.4; // friction coefficient [estimate]

// ---- contact solver (sim-core/0.3.0, this project; see contactsAt) ----
/**
 * Surfaces within this gap of a body sphere are contacts of the tick: the solver lets the gap close
 * in this tick but not further (speculative contacts). 5 mm covers an approach of 5 m/s in one 1 ms
 * tick; faster impacts are found by the swept test (sweepImpact). A numerical choice, not physics:
 * larger catches more impacts in the solver but can stop a sphere that would have passed just by an
 * edge, up to this far from it.
 */
const SPEC_MARGIN = 0.005;
/** the swept test uses spheres this much smaller, so a sphere resting on a surface is not "overlapping" it, m [numerical choice] */
const SWEEP_SHRINK = 0.0005;
/** contacts kept per body sphere (a sphere in a corner of three walls needs 3) */
const MAX_PER_SPHERE = 4;
/** Gauss-Seidel passes over the tick's contacts; 24 hold a craft on five coplanar spheres still (tests) [numerical choice] */
const SOLVE_PASSES = 24;
/**
 * contact record: offset from the centre of mass (3), normal (3), tangents (6), masses n/t1/t2 (3), target, impulses
 * n/t1/t2 (3), vn0, gap, sphere, surface velocity (3, sim-core/0.5.0)
 */
const CN = 25;
/** pose push-out passes for what penetration is left after the solve */
const PUSH_PASSES = 3;
/** approach speeds under this do not bounce (a resting craft's 1 ms of fall is 0.01 m/s) [estimate] */
const BOUNCE_MIN = 0.25;
/** an impact faster than this is a 'contact' event (upstream's value) */
const CONTACT_EVENT_V = 0.05;
/**
 * A contact already touching at the start of the tick (gap under PRESS_GAP, m) that approaches slower than PRESS_V
 * (m/s) is being pressed, not hit: the tick's forces alone push it in (full thrust of a whoop: 0.06 m/s per tick).
 * It is solved like any contact, but it is no impact: no event, no damage. [numerical choice]
 */
const PRESS_GAP = 1e-4;
const PRESS_V = 1;
/**
 * The underside: a contact whose normal is within acos(0.866) = 30 deg of the body's up axis is a landing on
 * the frame's bottom, one beyond acos(0.5) = 60 deg is a hit on the props, arms or top; damage thresholds
 * blend in between [estimates, this project].
 */
const BOTTOM_COS_HI = 0.866;
const BOTTOM_COS_LO = 0.5;
/**
 * Prop strikes (sim-core/0.3.1, this project): a prop (duct sphere) touching a surface on its intake side, the side
 * its thrust points to, cannot draw air through the disc and its blades hit the surface, so it makes no thrust. Full
 * strike when the surface is within acos(0.866) = 30 deg of straight over the prop, none past acos(0.5) = 60 deg (a
 * surface beside or under the prop leaves it free); it fades in over the last STRIKE_GAP of the gap, so the thrust
 * changes smoothly as the prop nears the surface [estimates, this project]. 0.5 mm, not the 5 mm contact margin: the
 * thrust share is a spring with no damping, and a thin one keeps a quad climbing into a ceiling to a 1-2 mm bob
 * (5 mm: 1 cm at about 8 Hz, a visible shake). Without it a quad that ends up with its
 * props against a wall or ceiling pushes itself into it at full thrust and friction holds it there (the owner's
 * "stuck on walls", physics-review F4).
 */
const STRIKE_COS_HI = 0.866;
const STRIKE_COS_LO = 0.5;
const STRIKE_GAP = 0.0005;
/**
 * Blade strikes (sim-core/0.7.0, this project): a prop whose disc meets a surface edge-on has its blades hitting
 * that surface every pass, which brakes the rotor: the motor stalls, and the ESC spins it back up (motor_tau) once
 * the prop is clear. Full braking when the surface's normal is more than acos(0.5) = 60 deg from the thrust axis on
 * either side (near the disc plane), none within acos(0.866) = 30 deg of it, where the duct sphere touches with the
 * motor's top or bottom and the blades stay clear: a floor under an upright quad (take-off is free), a ceiling over
 * it (the intake strike takes that thrust). Faded in over STRIKE_GAP like the intake strike. The rotor speed loses
 * DT / BRAKE_TAU of itself each tick while fully braked: 5 ms, a few blade passes at flight rpm [estimate, this
 * project; no measured stall time found]. Against a motor lag of 17 ms the stalled rotor settles near a fifth of its
 * command, so its thrust (rotor speed squared) is a few per cent. Without it a quad scraping a wall with a prop
 * edge-on kept full thrust and climbed the wall (the owner's "pushed into the wall", 2026-10-19).
 */
const BRAKE_COS_HI = 0.866;
const BRAKE_COS_LO = 0.5;
const BRAKE_TAU = 0.005;
/**
 * Restitution of a hit on the props, arms, sides or top (sim-core/0.7.0): 0.526 measured for a rigid carbon-fibre
 * quadrotor (0.84 kg, caged props) pushed into a rigid wall at 1.85 m/s, motors off (Liu and Karydis 2023,
 * arXiv:2307.11309, Table III; 0.603 on a mat). Faster hits deform the frame and props more and keep less: above
 * 1.85 m/s e falls as (1.85 / v)^(1/4), the shape of the elastic-plastic impact law (Johnson; the shape is an
 * estimate here, its constant not checked against a source): 0.38 at 7 m/s, 0.31 at 15, 0.26 at 30. Upstream's
 * curve (0.07 at 15 m/s) left a wall hit with nearly no bounce, so the quad slapped flat against the wall.
 * The underside (BOTTOM_COS_HI) keeps upstream's gentle landing curve, which the owner flies and accepted.
 */
const E_WALL = 0.526;
const V_WALL = 1.85;
/**
 * Arming needs the craft within Betaflight's small_angle (default 25 deg, src/main/flight/imu.c) of level, unless the
 * turtle switch is on (src/main/fc/core.c updateArmingStatus): cos(25 deg).
 */
const SMALL_ANGLE_COS = 0.9063077870366499;
/**
 * Thrust of a prop spun backwards (turtle mode) as a share of its forward thrust: 0.59 / 0.81 kgf, the peaks measured
 * on a thrust stand with a Gemfan 7x5E on 4S (Tyto Robotics, "How Much Thrust Does a UAV Prop Make Backwards?").
 * One 7-inch prop; for the presets' props an estimate. Used for the reaction torque too [estimate].
 */
const REVERSE_THRUST = 0.59 / 0.81;
/** bisection halvings of the rotor inflow (inflowThrust): 2^-32 of the bracket, far below what changes the thrust [numerical choice] */
const INFLOW_STEPS = 32;
const CRASH_ANG_DAMP = 3; // 1/s, tumbling craft (props stopped, ducts dragging) [estimate]
const CRASH_LIN_DAMP = 0.5; // 1/s horizontal, scraping and bouncing losses [estimate]

/**
 * I-term gain from the last motor-mix range (Betaflight 4.5 pid.c dynCi, from the formula): full
 * below `windup`, fading to 0 at a saturated mix. windup >= 1 is v0.2's rule: freeze only above 1.
 */
export function itermGain(mixRange: number, windup: number): number {
    if (windup >= 1) return mixRange > 1 ? 0 : 1;
    const g = (1 - mixRange) / (1 - windup);
    return g < 0 ? 0 : g > 1 ? 1 : g;
}

/** one step of a 3-stage cascade stored in s[k..k+2] */
function pt3(s: Float64Array, k: number, x: number, g: number): number {
    s[k] += (x - s[k]) * g;
    s[k + 1] += (s[k] - s[k + 1]) * g;
    s[k + 2] += (s[k + 1] - s[k + 2]) * g;
    return s[k + 2];
}

export class Sim {
    readonly p: SimParams;
    readonly s = new Float64Array(S.size);
    readonly ch = new Float64Array(8);
    tick = 0;
    world: ContactWorld | null;
    events: SimEvent[] = [];
    /** optional: counts fast-impact sweeps that started overlapping by more than SWEEP_SHRINK (should stay 0 in flight) */
    startOverlaps = 0;
    /**
     * Test seam for the determinism negative control ONLY: when set, its value is added to the
     * thrust every step (e.g. Math.random), which must change the trace hash. Never set in the app.
     */
    perturb: (() => number) | null = null;

    // scratch
    private c0: Float64Array;
    private c1: Float64Array;
    private rr: Float64Array;
    /** sphere radii minus SWEEP_SHRINK, for the fast-impact sweep */
    private rs: Float64Array;
    private pad: Float64Array;
    private nS: number;
    private cout: ContactOut = { sphere: -1, nx: 0, ny: 0, nz: 0 };
    private push = { x: 0, y: 0, z: 0 };
    /** contact solver scratch: CN slots per contact, one sphere's world.contacts answer and surface velocities, the rotation of the pose */
    private cn: Float64Array;
    private cq: Float64Array;
    private cv: Float64Array;
    private rot = new Float64Array(9);
    /** velocity (3) and world angular momentum (3) the solver works on; world inverse inertia (xx, xy, xz, yy, yz, zz) */
    private vl = new Float64Array(6);
    private iw = new Float64Array(6);
    /** the tick's strongest impact (applyHit): approach speed (-1 none), damage, normal, world point */
    private hitV = -1;
    private hitDmg = 0;
    private hit = new Float64Array(6);
    /** motor commands of the last step: after the mixer and idle, before the motor lag (0..1) */
    readonly motorCmd = new Float64Array(4);
    /**
     * Spin direction of each motor for the physics: 1 normal, -1 reversed (turtle mode). With motorCmd it is the whole
     * controller-to-physics seam: DShot sends the direction as its own command, so the commands stay in 0..1.
     */
    readonly motorDir = new Float64Array([1, 1, 1, 1]);
    private thrust = new Float64Array(4);
    /** per-motor thrust share left by prop strikes this tick (1: free; exactly 1 without contacts) */
    private strike = new Float64Array(4);
    /** per-motor share of the blade-strike brake this tick (0: free; exactly 0 without contacts) */
    private brake = new Float64Array(4);
    private plat = new PlatformContact();
    // per-model constants of the self-level and drag terms (params do not change after construction)
    private maxR: number;
    private maxP: number;
    private kAtt: number;
    private kAff: number;
    private kHz: number;
    private sqrtTwr: number;
    /** the wind of the place (wind.ts), compiled from p.wind; null: still air, exactly the model without wind */
    private readonly air: WindField | null;
    /** the scene transform's scale and y offset (setSceneFrame): where the scan's heights are in the flown world */
    private sceneS = 1;
    private sceneTy = 0;
    /**
     * The wind the last step flew in, world frame, m/s (the HUD's wind dial); zeros in still air. Not
     * part of the hashed state: the noise is a function of the tick, so nothing carries over a step.
     */
    readonly windNow = new Float64Array(3);
    /**
     * The prop-wash intensity of the last step, 0..1 (wake.ts); always 0 for a preset without prop wash.
     * Not part of the hashed state: it is recomputed from the state and the tick every step.
     */
    washNow = 0;

    constructor(p: SimParams, world: ContactWorld | null) {
        this.p = p;
        this.world = world;
        this.nS = p.spheres.length / 4;
        this.c0 = new Float64Array(this.nS * 3);
        this.c1 = new Float64Array(this.nS * 3);
        this.rr = new Float64Array(this.nS);
        this.pad = new Float64Array(this.nS);
        this.rs = new Float64Array(this.nS);
        this.cn = new Float64Array(this.nS * MAX_PER_SPHERE * CN);
        this.cq = new Float64Array(MAX_PER_SPHERE * 4);
        this.cv = new Float64Array(MAX_PER_SPHERE * 3);
        for (let i = 0; i < this.nS; i++) {
            this.rr[i] = p.spheres[i * 4 + 3];
            this.rs[i] = this.rr[i] - SWEEP_SHRINK;
        }
        const rc = p.rates;
        this.maxR = setpointRate(rc.type, 1, rc.roll, rc.rateLimit, rc.quickRcExpo === true);
        this.maxP = setpointRate(rc.type, 1, rc.pitch, rc.rateLimit, rc.quickRcExpo === true);
        const lv = p.level;
        this.kAtt = p.levelOutputHz > 0 ? PT3(p.levelOutputHz) : 0;
        // Betaflight: angle feed-forward cutoff = 1000 / (2 pi smoothing_ms)
        this.kAff = lv.ffSmoothMs > 0 ? PT3(1000 / (2 * Math.PI * lv.ffSmoothMs)) : 1;
        // PT1 with time constant horizon_delay_ms
        this.kHz = lv.horizonDelayMs > 0 ? DT / (lv.horizonDelayMs / 1000 + DT) : 1;
        this.sqrtTwr = Math.sqrt(p.twr);
        // auto-throttle hover from the params alone, so a replay needs nothing from the page (D-g);
        // v0.2 defaulted to 0.4 and relied on the page setting hoverSolve().motor
        this.hoverThr = hoverThrOf(p);
        this.air = compileWind(p.wind);
        this.s[S.soc] = 1; // a new model starts with a fresh pack; reset keeps the battery
        this.reset(0, 0, 0, 0);
        this.ch[2] = -1;
        this.ch[4] = -1;
    }

    /**
     * Place the craft level and still at (x, y, z) with heading yawDeg (0 = nose along -z, + = turned
     * right). Every hashed slot goes back to its start value except the battery, which opts.soc
     * replaces (C.8). opts.platform puts the invisible platform under it (C.2). opts.keepArmed
     * leaves it armed when the last applied arm channel is on (C.3); otherwise it is parked until
     * a fresh off -> on edge of the switch.
     */
    reset(x: number, y: number, z: number, yawDeg: number, opts: RespawnOpts = {}): void {
        const s = this.s;
        let soc = s[S.soc];
        // NaN keeps the pack (as a log record's -1 does): it would poison every hashed slot after it
        if (opts.soc !== undefined && opts.soc === opts.soc) soc = opts.soc < 0 ? 0 : opts.soc > 1 ? 1 : opts.soc;
        s.fill(0);
        s[S.health] = 1;
        this.motorCmd.fill(0);
        this.motorDir.fill(1);
        s[S.px] = x; s[S.py] = y; s[S.pz] = z;
        const h = -yawDeg * DEG2RAD * 0.5;
        // rotation about +y (which turns left), so a right heading is a negative angle
        s[S.qw] = dcos(h); s[S.qx] = 0; s[S.qy] = dsin(h); s[S.qz] = 0;
        s[S.soc] = soc;
        s[S.volt] = this.p.cells * cellVoc(soc);
        s[S.armSw] = 1; // an off -> on transition is needed to arm, unless kept armed below
        if (opts.platform === true) {
            s[S.platOn] = 1;
            s[S.platX] = x;
            s[S.platY] = y - this.p.bodyBottom - PLAT_GAP;
            s[S.platZ] = z;
            s[S.platR] = opts.platformR ?? PLAT_R;
        }
        if (opts.keepArmed === true && this.ch[4] > 0.5) {
            s[S.armed] = 1; // the pilot never released the switch: fly on at once
            this.events.push({ type: 'arm', tick: this.tick });
        } else {
            s[S.hold] = 1; // held in place until the first arm
        }
    }

    /**
     * The scene transform the craft flies under (E.7, T(w) = s*w + t), as far as the model needs it:
     * the scan's heights in the flown world (the wind's ground, WindConfig.groundM). The runner and the
     * replays set it from the life header and from every world record, so a rescale moves the ground
     * without a new life. Not hashed state; identity until set.
     */
    setSceneFrame(s: number, ty: number): void {
        this.sceneS = s;
        this.sceneTy = ty;
    }

    /** The wind's ground in the flown world, m (the scan's ground through the scene transform); null in still air. */
    get windGroundY(): number | null {
        return this.air ? this.sceneS * this.air.groundM + this.sceneTy : null;
    }

    /** The wind field this model flies in, null in still air. */
    get wind(): WindField | null {
        return this.air;
    }

    get armed(): boolean { return this.s[S.armed] > 0; }
    /**
     * How hard a surface brakes prop i this tick, 0 (free) to 1: the blade strike (sim-core/0.7.0). Read only, for the
     * game's sound of props hitting things; nothing in the sim reads it from here.
     */
    bladeBrake(i: number): number { return this.brake[i]; }
    get crashed(): boolean { return this.s[S.crashed] > 0; }

    /** What the craft collides with: the scene, plus the platform while it is on. */
    get contactWorld(): ContactWorld | null {
        const s = this.s;
        return s[S.platOn] > 0 ? this.plat.set(this.world, s[S.platX], s[S.platY], s[S.platZ], s[S.platR]) : this.world;
    }

    setChannels(ch: ArrayLike<number>): void {
        for (let i = 0; i < 8; i++) this.ch[i] = Math.fround(ch[i] ?? 0);
    }

    /** reset() between ticks plus a 'respawn' event; without opts it is v0.2's respawn (battery kept, parked). */
    respawn(x: number, y: number, z: number, yawDeg: number, opts: RespawnOpts = {}): void {
        this.events.push({ type: 'respawn', tick: this.tick });
        this.reset(x, y, z, yawDeg, opts);
    }

    /**
     * Prop-wash intensity 0..1 for this step (wake.ts) from the hashed state and the tick only: the
     * thrust the rotors make now (motor state before this step's lag, at the pack's voltage) sets the
     * induced velocity; the airspeed (velocity minus the wind at this tick, the same wind the drag uses
     * below) split along the body's up axis and its rotor plane sets where the craft is in its wake.
     * r01..r21 = body up in world, r00..r20 = body right, r02..r22 = body back.
     */
    private washIntensity(tmax: number, ux: number, uy: number, uz: number, rx: number, ry: number, rz: number, bx: number, by: number, bz: number): number {
        const s = this.s;
        const p = this.p;
        let tNow = 0;
        for (let i = 0; i < 4; i++) tNow += tmax * s[S.m0 + i] * s[S.m0 + i];
        const vi = inducedVelocity(tNow, p.rho, p.wakeArea);
        if (!(vi > 0)) return 0;
        let ax = s[S.vx], ay = s[S.vy], az = s[S.vz];
        const air = this.air;
        if (air) {
            const w = this.windNow;
            air.at(this.tick, s[S.py] - (this.sceneS * air.groundM + this.sceneTy), w);
            ax -= w[0];
            ay -= w[1];
            az -= w[2];
        }
        const up = ux * ax + uy * ay + uz * az;
        const right = rx * ax + ry * ay + rz * az;
        const back = bx * ax + by * ay + bz * az;
        return wakeIntensity(-up, Math.sqrt(right * right + back * back), vi);
    }

    /**
     * One 1 ms tick: the built-in flight controller turns the sticks into four motor commands, then
     * the physics flies them. The two meet only at those commands (this.motorCmd, 0..1 after idle:
     * the shape of Betaflight's mixer output, which SITL sends), so another controller can drive
     * the same physics (SPEC.md R1, R4).
     */
    step(): void {
        const s = this.s;
        this.tick++;
        // moving surfaces go where they are at this tick, for every query of the step, also while parked (sim-core/0.5.0)
        if (this.world && this.world.at) this.world.at(this.tick);
        this.arming();
        if (s[S.hold] > 0) {
            if (s[S.armed] > 0) s[S.hold] = 0;
            else return; // parked at the spawn: no forces until armed
        }
        this.controller();
        this.physics(this.motorCmd);
    }

    /**
     * Arming: the edge of the arm switch, throttle low, not crashed, and level within small_angle unless the turtle
     * switch is on. Turtle mode (Betaflight 2026.6.2 src/main/fc/core.c, crashflip_auto_rearm off, its default): the
     * turtle switch's position when the craft arms decides it; turning the switch off while armed in turtle mode
     * disarms, and arming again needs the arm switch off and on (the edge rule below already asks for that).
     */
    private arming(): void {
        const s = this.s;
        const ch = this.ch;
        const sw = ch[4] > 0.5 ? 1 : 0;
        const flipSw = ch[6] > 0.5 ? 1 : 0;
        const thrStick = (ch[2] + 1) * 0.5;
        if (sw === 1 && s[S.armSw] === 0 && s[S.armed] === 0) {
            // body up along world up (r11)
            const upY = 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]);
            if (thrStick <= 0.05 && s[S.crashed] === 0 && (upY > SMALL_ANGLE_COS || flipSw === 1)) {
                s[S.armed] = 1;
                s[S.flip] = flipSw;
                s[S.iR] = s[S.iP] = s[S.iY] = 0;
                this.events.push({ type: 'arm', tick: this.tick });
            }
        }
        if (s[S.armed] === 1 && s[S.flip] === 1 && flipSw === 0) {
            s[S.armed] = 0;
            s[S.flip] = 0;
            this.events.push({ type: 'disarm', tick: this.tick, reason: 'crashflip' });
        }
        if (sw === 0 && s[S.armed] === 1) {
            s[S.armed] = 0;
            s[S.flip] = 0;
            this.events.push({ type: 'disarm', tick: this.tick, reason: 'switch' });
        }
        s[S.armSw] = sw;
    }

    /**
     * The built-in flight controller (Betaflight 4.5.1 behaviour, re-implemented from its formulas):
     * stick setpoints, self-level, the rate PID and the airmode mixer. Reads the sticks and the
     * craft's attitude and rotation rates (an ideal IMU), writes the four motor commands into
     * this.motorCmd. Its filter and PID states are part of the hashed state.
     */
    private controller(): void {
        const s = this.s;
        const p = this.p;
        const ch = this.ch;
        const thrStick = (ch[2] + 1) * 0.5;

        // ---- body rotation matrix from q ----
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r22 = 1 - 2 * (qx * qx + qy * qy);

        const wx = s[S.wx], wy = s[S.wy], wz = s[S.wz];
        const armed = s[S.armed] > 0 && s[S.crashed] === 0;

        // ---- setpoints ----
        const rc = p.rates;
        const acroR = setpointRate(rc.type, ch[0], rc.roll, rc.rateLimit, rc.quickRcExpo === true);
        const acroP = setpointRate(rc.type, ch[1], rc.pitch, rc.rateLimit, rc.quickRcExpo === true);
        const spY = setpointRate(rc.type, ch[3], rc.yaw, rc.rateLimit, rc.quickRcExpo === true);
        const mode = modeFromChannel(ch[5]);
        let spR = acroR, spP = acroP;
        if (mode === 'acro') {
            this.levelIdle(acroR, acroP);
        } else {
            // self-level on roll and pitch, Betaflight 4.5.1 pidLevel() from its formulas.
            // body axes in world: right = (r00, r10, r20), up = (r01, r11, r21), back = (r02, r12, r22)
            const lv = p.level;
            const rollDeg = datan2(-r10, r11) * RAD2DEG; // right side below the horizon = roll right
            const pitchDeg = datan2(r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD2DEG; // nose down +
            const lvR = this.levelRate(0, acroR, rollDeg, lv);
            const lvP = this.levelRate(1, acroP, pitchDeg, lv);
            if (mode === 'angle') {
                spR = lvR;
                spP = lvP;
                s[S.hzS] = 0;
            } else {
                const hs = this.horizonShare(rollDeg, pitchDeg, lv);
                spR = acroR * (1 - hs) + lvR * hs;
                spP = acroP * (1 - hs) + lvP * hs;
            }
        }

        let thr: number;
        if (p.gravityMode === 'auto-throttle') {
            thr = autoThrottle(thrStick, (this.hoverThr - p.idle) / (1 - p.idle));
        } else {
            thr = throttleCurve(thrStick, p.throttle);
        }

        // ---- rate PID in Betaflight units ----
        const gR = this.gyroFilter(0, -wz * RAD2DEG);
        const gP = this.gyroFilter(1, -wx * RAD2DEG);
        const gY = this.gyroFilter(2, -wy * RAD2DEG);
        const dynCi = itermGain(s[S.mixRange], p.itermWindup);
        const fcD = DTERM_DYN_MIN + (DTERM_DYN_MAX - DTERM_DYN_MIN) * (thr < 0 ? 0 : thr > 1 ? 1 : thr);
        const kD1 = PT1(fcD);
        // rate-loop feed-forward follows the stick setpoint; Betaflight 4.5 forces it to 0 on axes
        // under angle-mode control (horizon keeps it)
        const ffRP = mode !== 'angle';
        const pidR = this.axisPid(0, spR, acroR, ffRP, gR, p.pid.roll, dynCi, armed, 500, kD1);
        const pidP = this.axisPid(1, spP, acroP, ffRP, gP, p.pid.pitch, dynCi, armed, 500, kD1);
        const pidY = this.axisPid(2, spY, spY, true, gY, p.pid.yaw, dynCi, armed, 400, kD1);

        // ---- mixer with airmode ----
        const out = this.motorCmd;
        if (armed) {
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < 4; i++) {
                const m = pidR * MIX_R[i] + pidP * MIX_P[i] + pidY * MIX_Y[i];
                out[i] = m;
                if (m < mn) mn = m;
                if (m > mx) mx = m;
            }
            const range = mx - mn;
            let t = thr;
            if (range > 1) {
                const inv = 1 / range;
                for (let i = 0; i < 4; i++) out[i] *= inv;
                mn *= inv; mx *= inv;
            }
            t = t < -mn ? -mn : t > 1 - mx ? 1 - mx : t;
            s[S.mixRange] = range;
            for (let i = 0; i < 4; i++) {
                let v = out[i] + t;
                v = v < 0 ? 0 : v > 1 ? 1 : v;
                out[i] = p.idle + (1 - p.idle) * v;
            }
        } else {
            for (let i = 0; i < 4; i++) out[i] = 0;
            s[S.mixRange] = 0;
        }
        // turtle mode replaces the mix (Betaflight returns from mixTable before mixing): sticks only, motors reversed
        const dir = this.motorDir;
        if (armed && s[S.flip] > 0) {
            crashFlipMix(ch[0], ch[1], ch[3], MIX_R, MIX_P, MIX_Y, out);
            for (let i = 0; i < 4; i++) {
                if (out[i] > 0) out[i] = p.idle + (1 - p.idle) * out[i];
                dir[i] = -1;
            }
        } else {
            dir[0] = dir[1] = dir[2] = dir[3] = 1;
        }
    }

    /**
     * The physics of one tick from four motor commands in 0..1 (after idle): motor lag and rotor
     * inertia, prop wash, battery, forces, integration, contact and the crashed body settling.
     * Uses nothing from the controller but `out`.
     */
    private physics(out: Float64Array): void {
        const s = this.s;
        const p = this.p;

        // ---- body rotation matrix from q ----
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
        const wx = s[S.wx], wy = s[S.wy], wz = s[S.wz];

        // ---- motors ----
        const volt = s[S.volt];
        const vr = volt / p.vNom;
        const tmax = p.tmaxMotorNom * vr * vr;
        const th = this.thrust;
        let tSum = 0;
        let wSum = 0;
        let tauX = 0, tauY = 0, tauZ = 0;
        let power = 0;
        const mp = p.motorPos;
        const a = p.tau > 0 ? DT / p.tau : 1;
        const aa = a > 1 ? 1 : a;
        // spinning a rotor up takes torque, and the body takes the reaction about the motor axis:
        // J_r * d(omega)/dt with omega = w * omega_max(V) (H.2 item 3); CW props (+1) push +y like their drag
        const jr = (p.rotorInertia * p.omegaMaxPerVolt * volt) / DT;
        // prop wash (wake.ts): only a preset that has it; without it `keep` stays exactly 1 (x 1 is exact
        // in IEEE arithmetic) and no torque is added, so such a model flies bit for bit as before
        let keep = 1;
        let wash = 0;
        if (p.wakeLoss > 0 || p.wakeShake > 0) {
            wash = this.washIntensity(tmax, r01, r11, r21, r00, r10, r20, r02, r12, r22);
            keep = 1 - p.wakeLoss * wash;
        }
        this.washNow = wash;
        // the surfaces near the body at the start of the tick (contactsAt solves them below), and the props they block
        const world = this.contactWorld;
        let nNear = 0;
        if (world) {
            setRot(this.rot, qw, qx, qy, qz);
            nNear = this.gatherContacts(world, s[S.px], s[S.py], s[S.pz]);
        }
        this.propStrikes(nNear);
        const strike = this.strike;
        const brake = this.brake;
        const dir = this.motorDir;

        // ---- airspeed ----
        const vx = s[S.vx], vy = s[S.vy], vz = s[S.vz];
        // the air moves (wind.ts): every drag term below works on the airspeed, velocity minus wind.
        // In still air the airspeed is the velocity itself, so the model is the one without wind bit for bit.
        let airX = vx, airY = vy, airZ = vz;
        const air = this.air;
        if (air) {
            const w = this.windNow;
            air.at(this.tick, s[S.py] - (this.sceneS * air.groundM + this.sceneTy), w);
            airX = vx - w[0];
            airY = vy - w[1];
            airZ = vz - w[2];
        }
        // airspeed in body frame: R^T (v - wind)
        const bvx = r00 * airX + r10 * airY + r20 * airZ;
        const bvy = r01 * airX + r11 * airY + r21 * airZ;
        const bvz = r02 * airX + r12 * airY + r22 * airZ;

        const inflow = p.inflow;
        for (let i = 0; i < 4; i++) {
            const k = S.m0 + i;
            // the motor state is signed: below 0 the motor spins backwards (turtle mode), towards dir x command
            const dw = (dir[i] * out[i] - s[k]) * aa;
            s[k] += dw;
            // blade strike: the surface brakes the rotor (the wall takes that torque, not the body: no reaction)
            if (brake[i] > 0) s[k] -= s[k] * brake[i] * (DT / BRAKE_TAU);
            const w = s[k];
            const wa = w < 0 ? -w : w;
            // backwards: thrust and reaction torque the other way, at REVERSE_THRUST of the forward value
            const T0 = w < 0 ? -REVERSE_THRUST * tmax * wa * wa : tmax * w * w;
            const Tc = T0 * keep * strike[i];
            // rotor inflow (sim-core/0.6.0): a forward-spinning prop's thrust from the air through it; the reaction
            // torque stays with the thrust the rotor makes at this speed in still air (Tc), as the power does below
            const T = inflow && w > 0 ? this.inflowThrust(inflow, i, w * p.omegaMaxPerVolt * volt, bvx, bvy, bvz, wx, wy, wz) * keep * strike[i] : Tc;
            th[i] = T;
            tSum += T;
            wSum += wa;
            // r x (0, T, 0) = (-rz T, 0, rx T)
            tauX += -mp[i * 3 + 2] * T;
            tauZ += mp[i * 3] * T;
            tauY += p.motorYaw[i] * (p.kappa * Tc + jr * dw);
            // the rotors turn as fast in the wash: the power follows the thrust they would make in clean air
            power += p.kappa * (T0 < 0 ? -T0 : T0) * (wa * p.omegaMaxPerVolt * volt);
        }
        if (wash > 0 && p.wakeShake > 0) {
            // turbulent roll (about body z) and pitch (about body x) torque: the rotors' thrust fluctuates by a
            // share of what they make, unevenly from side to side; amplitude = share x one rotor's thrust x arm
            const amp = p.wakeShake * wash * (tSum * 0.25) * Math.sqrt(mp[0] * mp[0] + mp[2] * mp[2]);
            tauZ += amp * wakeNoise(0, this.tick);
            tauX += amp * wakeNoise(1, this.tick);
        }

        if (this.perturb) tSum += this.perturb() * 1e-9;

        // ---- battery ----
        const amps = volt > 0.1 ? power / (p.eta * volt) : 0;
        let soc = s[S.soc];
        if (p.batteryDrain) {
            soc -= (amps * DT) / p.capacityAs;
            if (soc < 0) soc = 0;
            s[S.soc] = soc;
        }
        s[S.amps] = amps;
        s[S.volt] = p.cells * cellVoc(soc) - amps * p.rPack;

        // ---- forces (world) ----
        const speed = Math.sqrt(airX * airX + airY * airY + airZ * airZ);
        const kd = -0.5 * p.rho * speed;
        // rotor and duct momentum drag (H.2 item 1): the rotors ingest the in-plane airflow and send
        // it down the duct axis, so the force opposes the in-rotor-plane velocity and scales with the
        // mass flow, i.e. rotor speed. ductDrag is the rate at Earth hover, where
        // sum(w) * V / V_nom = 4 / sqrt(TWR). Zero with the motors stopped (free fall is unchanged).
        const kLin = p.ductDrag * p.mass * wSum * vr * this.sqrtTwr * 0.25;
        const dbx = kd * p.cda[0] * bvx - kLin * bvx;
        const dby = kd * p.cda[1] * bvy + tSum;
        const dbz = kd * p.cda[2] * bvz - kLin * bvz;
        const fx = r00 * dbx + r01 * dby + r02 * dbz;
        const fy = r10 * dbx + r11 * dby + r12 * dbz - p.mass * p.gravity;
        const fz = r20 * dbx + r21 * dby + r22 * dbz;

        // ---- integrate (semi-implicit Euler) ----
        const px0 = s[S.px], py0 = s[S.py], pz0 = s[S.pz];
        const q0w = qw, q0x = qx, q0y = qy, q0z = qz;
        const invM = 1 / p.mass;
        let nvx = vx + fx * invM * DT;
        let nvy = vy + fy * invM * DT;
        let nvz = vz + fz * invM * DT;

        // Rotation: I w' = tau - w x I w, integrated through the world-frame angular momentum
        // (L_w += R tau dt), which keeps |L| exact when no torque acts; w follows from the new
        // attitude. Semi-implicit: the attitude update uses the predicted new w.
        const I0 = p.inertia[0], I1 = p.inertia[1], I2 = p.inertia[2];
        const lbx = I0 * wx, lby = I1 * wy, lbz = I2 * wz;
        let lwx = r00 * lbx + r01 * lby + r02 * lbz + (r00 * tauX + r01 * tauY + r02 * tauZ) * DT;
        let lwy = r10 * lbx + r11 * lby + r12 * lbz + (r10 * tauX + r11 * tauY + r12 * tauZ) * DT;
        let lwz = r20 * lbx + r21 * lby + r22 * lbz + (r20 * tauX + r21 * tauY + r22 * tauZ) * DT;

        // ---- contact, velocities: every surface near the body now, solved together (contactsAt) ----
        // With nothing within SPEC_MARGIN the velocities are untouched, so free flight is the model before 0.3.0.
        this.hitV = -1;
        if (nNear > 0) {
            // the same pose as the gather above (this.rot still holds it): nothing has moved yet
            const vl = this.vl;
            vl[0] = nvx; vl[1] = nvy; vl[2] = nvz; vl[3] = lwx; vl[4] = lwy; vl[5] = lwz;
            this.solveContacts(nNear, px0, py0, pz0);
            nvx = vl[0]; nvy = vl[1]; nvz = vl[2]; lwx = vl[3]; lwy = vl[4]; lwz = vl[5];
        }
        s[S.vx] = nvx; s[S.vy] = nvy; s[S.vz] = nvz;
        s[S.px] = px0 + nvx * DT; s[S.py] = py0 + nvy * DT; s[S.pz] = pz0 + nvz * DT;

        // predictor with the old attitude
        const pwx = (r00 * lwx + r10 * lwy + r20 * lwz) / I0;
        const pwy = (r01 * lwx + r11 * lwy + r21 * lwz) / I1;
        const pwz = (r02 * lwx + r12 * lwy + r22 * lwz) / I2;
        integrateQuat(s, pwx, pwy, pwz);
        const aw = s[S.qw], ax = s[S.qx], ay = s[S.qy], az = s[S.qz];
        const n00 = 1 - 2 * (ay * ay + az * az), n01 = 2 * (ax * ay - aw * az), n02 = 2 * (ax * az + aw * ay);
        const n10 = 2 * (ax * ay + aw * az), n11 = 1 - 2 * (ax * ax + az * az), n12 = 2 * (ay * az - aw * ax);
        const n20 = 2 * (ax * az - aw * ay), n21 = 2 * (ay * az + aw * ax), n22 = 1 - 2 * (ax * ax + ay * ay);
        s[S.wx] = (n00 * lwx + n10 * lwy + n20 * lwz) / I0;
        s[S.wy] = (n01 * lwx + n11 * lwy + n21 * lwz) / I1;
        s[S.wz] = (n02 * lwx + n12 * lwy + n22 * lwz) / I2;

        // ---- contact, poses: fast impacts, then what penetration is left ----
        if (world) {
            this.sweepImpact(world, px0, py0, pz0, q0w, q0x, q0y, q0z, lwx, lwy, lwz);
            this.pushClear(world);
            this.applyHit();
        }
        if (s[S.platOn] > 0) {
            // the platform retires once the craft has clearly left it (state only, so replays agree)
            const dx = s[S.px] - s[S.platX], dz = s[S.pz] - s[S.platZ];
            const side = s[S.platR] + PLAT_LEAVE_SIDE;
            if (s[S.py] - s[S.platY] > PLAT_LEAVE_UP || dx * dx + dz * dz > side * side) s[S.platOn] = 0;
        }

        // crashed body settling: air and scraping losses, rest detection and 4 s cap
        if (s[S.crashed] > 0) {
            s[S.crashT] += DT;
            const kw = 1 - CRASH_ANG_DAMP * DT, kv = 1 - CRASH_LIN_DAMP * DT;
            s[S.wx] *= kw; s[S.wy] *= kw; s[S.wz] *= kw;
            s[S.vx] *= kv; s[S.vz] *= kv;
            const v2 = s[S.vx] * s[S.vx] + s[S.vy] * s[S.vy] + s[S.vz] * s[S.vz];
            const w2 = s[S.wx] * s[S.wx] + s[S.wy] * s[S.wy] + s[S.wz] * s[S.wz];
            if (v2 < 0.0025 && w2 < 0.25) s[S.restT] += DT; else s[S.restT] = 0;
            if (s[S.restT] >= 0.5 || s[S.crashT] >= 4) {
                if (s[S.crashed] === 1) {
                    s[S.crashed] = 2; // settled
                    this.events.push({ type: 'rest', tick: this.tick });
                }
                s[S.vx] = s[S.vy] = s[S.vz] = 0;
                s[S.wx] = s[S.wy] = s[S.wz] = 0;
                s[S.px] = px0; s[S.py] = py0; s[S.pz] = pz0;
                s[S.qw] = q0w; s[S.qx] = q0x; s[S.qy] = q0y; s[S.qz] = q0z;
            }
        }
    }

    /**
     * Thrust of forward-spinning prop i at rotor speed omega (rad/s) from the air through it (sim-core/0.6.0,
     * physics-review G1), N. The air at the hub, body frame: the airspeed (bvx, bvy, bvz) plus the body rotation's
     * w x r at the motor, so a rolling craft's dropping side meets more air and pushes back (rotor damping). Its part
     * along the thrust axis is the climb velocity, the rest the in-plane velocity. Normalised by the tip speed
     * U = omega R: climb ratio lc, advance ratio mu (held within INFLOW_RATIO_MAX). Blade-element thrust (Gill and
     * D'Andrea 2019 eq. 27 with c_l0 = 0, params.ts RotorInflow):
     *   C_T = a (1 - d) (theta - lc - li) + a (1 - d) theta mu^2 / (2 d),
     * and Glauert's momentum theory for the induced inflow li (as in NeuroBEM, Bauersfeld et al. 2021, eq. 5):
     *   C_T = 4 li sqrt(mu^2 + (lc + li)^2),
     * solved together by bisection on the normal working state's branch (lc + li >= 0: the air goes down through
     * the disk), INFLOW_STEPS halvings. T = 1/2 rho A U^2 C_T; at rest it is the preset's static thrust. Checked on
     * NeuroBEM's 75 min of measured flight (docs/physics-review.md G1). Only + - * / and sqrt.
     */
    private inflowThrust(f: RotorInflow, i: number, omega: number, bvx: number, bvy: number, bvz: number, wx: number, wy: number, wz: number): number {
        const mp = this.p.motorPos;
        const mx = mp[i * 3], mz = mp[i * 3 + 2];
        // w x (mx, 0, mz) = (wy mz, wz mx - wx mz, -wy mx)
        const ux = bvx + wy * mz;
        const uy = bvy + wz * mx - wx * mz;
        const uz = bvz - wy * mx;
        const tip = omega * f.radius;
        let lc = uy / tip;
        lc = lc < -INFLOW_RATIO_MAX ? -INFLOW_RATIO_MAX : lc > INFLOW_RATIO_MAX ? INFLOW_RATIO_MAX : lc;
        let mu = Math.sqrt(ux * ux + uz * uz) / tip;
        if (mu > INFLOW_RATIO_MAX) mu = INFLOW_RATIO_MAX;
        const ad = f.a * (1 - INFLOW_DELTA);
        const ct0 = ad * (f.theta - lc) + (ad * f.theta * mu * mu) / (2 * INFLOW_DELTA); // C_T = ct0 - ad li
        const mu2 = mu * mu;
        // the branch starts where the total inflow lc + li is 0; past ct0 / ad the blades make no thrust (C_T 0) while
        // the momentum side is >= 0, so the root lies between (when even the start is past it, between 0 and the start)
        let lo = lc < 0 ? -lc : 0;
        let hi = ct0 / ad;
        if (4 * lo * Math.sqrt(mu2) - (ct0 - ad * lo) > 0) { hi = lo; lo = 0; }
        for (let n = 0; n < INFLOW_STEPS; n++) {
            const li = (lo + hi) * 0.5;
            const s = lc + li;
            if (4 * li * Math.sqrt(mu2 + s * s) > ct0 - ad * li) hi = li; else lo = li;
        }
        const ct = ct0 - ad * ((lo + hi) * 0.5);
        return 0.5 * this.p.rho * f.area * tip * tip * ct;
    }

    /**
     * Motor output at which the craft hovers (fresh pack; session.ts sets hoverSolve().motor).
     * Auto-throttle maps stick 0.5 to the mixer throttle that gives this output after idle (v0.2
     * fed the output in as the throttle, so centre stick climbed: +18 % thrust on Earth at 5.5 %
     * idle, +56 % on the Moon).
     */
    hoverThr = 0.4;

    /**
     * Self-level rate demand for roll (ax 0) or pitch (ax 1): the target angle follows the acro
     * rate curve, target = limit * setpoint(stick) / setpoint(1), so centre stick is gentle; rate =
     * (target - current) * strength / 10 + PT3-smoothed angle feed-forward, then a PT3 at 50 Hz.
     */
    private levelRate(ax: number, acro: number, curDeg: number, lv: LevelParams): number {
        const s = this.s;
        const max = ax === 0 ? this.maxR : this.maxP;
        const target = max > 0 ? (lv.limitDeg * acro) / max : 0;
        const tK = S.tgR + ax;
        const ffRaw = (lv.ffGain * (target - s[tK])) / DT;
        s[tK] = target;
        const ff = pt3(s, S.afR1 + ax * 3, ffRaw, this.kAff);
        const rate = ((target - curDeg) * lv.gain) / 10 + ff;
        const k = S.lvR1 + ax * 3;
        if (this.kAtt > 0) return pt3(s, k, rate, this.kAtt);
        s[k] = s[k + 1] = s[k + 2] = rate;
        return rate;
    }

    /**
     * In acro the level filters follow the stick, so switching to a levelled mode continues from
     * the current setpoint (no step), and the angle feed-forward starts from rest.
     */
    private levelIdle(acroR: number, acroP: number): void {
        const s = this.s;
        s[S.lvR1] = s[S.lvR2] = s[S.lvR3] = acroR;
        s[S.lvP1] = s[S.lvP2] = s[S.lvP3] = acroP;
        s[S.afR1] = s[S.afR2] = s[S.afR3] = 0;
        s[S.afP1] = s[S.afP2] = s[S.afP3] = 0;
        const lim = this.p.level.limitDeg;
        s[S.tgR] = this.maxR > 0 ? (lim * acroR) / this.maxR : 0;
        s[S.tgP] = this.maxP > 0 ? (lim * acroP) / this.maxP : 0;
        s[S.hzS] = 0;
    }

    /**
     * Horizon level share (Betaflight 4.5 calcHorizonLevelStrength): 1 when level with centred
     * sticks, 0 past horizonLimitDeg of inclination or horizonLimitSticks of deflection, times
     * strength / 100; rises are delayed by a PT1 of horizonDelayMs, falls are immediate.
     */
    private horizonShare(rollDeg: number, pitchDeg: number, lv: LevelParams): number {
        const s = this.s;
        const incl = Math.max(rollDeg < 0 ? -rollDeg : rollDeg, pitchDeg < 0 ? -pitchDeg : pitchDeg);
        const a0 = this.ch[0] < 0 ? -this.ch[0] : this.ch[0], a1 = this.ch[1] < 0 ? -this.ch[1] : this.ch[1];
        const stick = Math.min(1, Math.max(a0, a1));
        const fa = lv.horizonLimitDeg > 0 ? Math.max((lv.horizonLimitDeg - incl) / lv.horizonLimitDeg, 0) : 0;
        const fs = lv.horizonLimitSticks > 0 ? Math.max((lv.horizonLimitSticks - stick) / lv.horizonLimitSticks, 0) : 0;
        let h = fa * fs * Math.min(lv.horizonStrength / 100, 1);
        s[S.hzS] += (h - s[S.hzS]) * this.kHz;
        if (s[S.hzS] < h) h = s[S.hzS];
        return h;
    }

    private gyroFilter(ax: number, raw: number): number {
        const s = this.s;
        const a = S.g1R + ax, b = S.g2R + ax;
        s[a] += (raw - s[a]) * K_GYRO1;
        s[b] += (s[a] - s[b]) * K_GYRO2;
        return s[b];
    }

    /**
     * sp = the setpoint the loop tracks (after self-level); ffIn = the stick setpoint whose
     * derivative drives the feed-forward (0 output when ffOn is false); dynCi = I-term windup gain.
     */
    private axisPid(ax: number, sp: number, ffIn: number, ffOn: boolean, gyro: number, g: number[], dynCi: number, armed: boolean, limit: number, kD1: number): number {
        const s = this.s;
        const iK = S.iR + ax, dK = S.dfR + ax, fK = S.ffR + ax, spK = S.spR + ax;
        const e = sp - gyro;
        // D on the gyro through the D-term filter chain
        const d1 = s[dK] + (gyro - s[dK]) * kD1;
        s[dK] = d1;
        const d2K = S.d2R + ax;
        const prevD = s[d2K];
        const dNow = prevD + (d1 - prevD) * K_DTERM2;
        s[d2K] = dNow;
        const dTerm = -g[2] * D_SCALE * ((dNow - prevD) / DT);
        // feed-forward on the stick setpoint derivative, PT1 filtered; the previous setpoint is
        // tracked even while it is off, so switching back to acro gives no spike
        const spDelta = (ffIn - s[spK]) / DT;
        s[spK] = ffIn;
        let ff = 0;
        if (ffOn) {
            const ffPrev = s[fK];
            ff = ffPrev + (g[3] * F_SCALE * spDelta - ffPrev) * K_FF;
        }
        s[fK] = ff;
        // I with iterm relax (roll, pitch), windup attenuation and no I while disarmed
        let iErr = e;
        if (ax < 2) {
            const lK = S.splR + ax;
            const lpf = s[lK] + (sp - s[lK]) * K_RELAX;
            s[lK] = lpf;
            const hp = sp - lpf;
            const relax = 1 - (hp < 0 ? -hp : hp) / RELAX_THRESHOLD;
            iErr = e * (relax > 0 ? relax : 0);
        }
        if (armed && dynCi > 0) {
            let I = s[iK] + g[1] * I_SCALE * dynCi * iErr * DT;
            I = I < -ITERM_LIMIT ? -ITERM_LIMIT : I > ITERM_LIMIT ? ITERM_LIMIT : I;
            s[iK] = I;
        }
        if (!armed) s[iK] = 0;
        let sum = g[0] * P_SCALE * e + s[iK] + dTerm + ff;
        sum = sum < -limit ? -limit : sum > limit ? limit : sum;
        return sum / 1000;
    }

    /**
     * The contact solver (sim-core/0.3.0, this project; replaces upstream's one impulse at the first sphere a sweep
     * touched, docs/physics-review.md F1 and F2). Every body sphere asks the world for the surfaces within its
     * radius + SPEC_MARGIN at the pose (px, py, pz, this.rot), and all those contacts are solved together on the
     * velocity and world angular momentum in this.vl: projected Gauss-Seidel with accumulated impulses, as the
     * platform's resting solver did (upstream restOnDisc), extended to any surface and to friction in any direction.
     * A contact with a gap may close it in this tick and no further (a speculative contact), so the body arrives on
     * the surface instead of bouncing off a skin; one approaching faster than its gap is an impact, which bounces with
     * the speed-dependent restitution and counts for damage (applyHit). Normal impulses only push, friction stays
     * within MU times the normal impulse (Coulomb cone). False when nothing is near: this.vl is untouched.
     */
    private contactsAt(world: ContactWorld, px: number, py: number, pz: number): boolean {
        const m = this.gatherContacts(world, px, py, pz);
        if (m === 0) return false;
        this.solveContacts(m, px, py, pz);
        return true;
    }

    /** contactsAt's first half: every sphere's surfaces within SPEC_MARGIN at the pose into this.cn; their number. */
    private gatherContacts(world: ContactWorld, px: number, py: number, pz: number): number {
        const sp = this.p.spheres;
        const c = this.cn;
        const q = this.cq;
        const v = this.cv;
        const R = this.rot;
        let m = 0;
        for (let i = 0; i < this.nS; i++) {
            const lx = sp[i * 4], ly = sp[i * 4 + 1], lz = sp[i * 4 + 2], ri = this.rr[i];
            const ox = R[0] * lx + R[1] * ly + R[2] * lz, oy = R[3] * lx + R[4] * ly + R[5] * lz, oz = R[6] * lx + R[7] * ly + R[8] * lz;
            v.fill(0);
            const k = world.contacts(px + ox, py + oy, pz + oz, ri + SPEC_MARGIN, q, MAX_PER_SPHERE, v);
            for (let j = 0; j < k; j++) {
                const nx = q[j * 4], ny = q[j * 4 + 1], nz = q[j * 4 + 2];
                const o = m * CN;
                // the contact point: the sphere's surface point facing the surface
                c[o] = ox - nx * ri; c[o + 1] = oy - ny * ri; c[o + 2] = oz - nz * ri;
                c[o + 3] = nx; c[o + 4] = ny; c[o + 5] = nz;
                c[o + 20] = q[j * 4 + 3] - ri;
                c[o + 21] = i;
                c[o + 22] = v[j * 3]; c[o + 23] = v[j * 3 + 1]; c[o + 24] = v[j * 3 + 2];
                m++;
            }
        }
        return m;
    }

    /** contactsAt's second half: solve the m gathered contacts on this.vl and record the tick's impacts. */
    private solveContacts(m: number, px: number, py: number, pz: number): void {
        const p = this.p;
        const c = this.cn;
        const R = this.rot;
        this.inertiaWorld();
        const w = this.push;
        const im = 1 / p.mass;
        for (let j = 0; j < m; j++) {
            const o = j * CN;
            const ox = c[o], oy = c[o + 1], oz = c[o + 2], nx = c[o + 3], ny = c[o + 4], nz = c[o + 5];
            // tangents: a unit vector across n (from the axis least along it), and n x t1
            let ax = 1, ay = 0;
            if (nx > 0.57735 || nx < -0.57735) { ax = 0; ay = 1; }
            const an = ax * nx + ay * ny;
            let t1x = ax - an * nx, t1y = ay - an * ny, t1z = -an * nz;
            const tl = 1 / Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
            t1x *= tl; t1y *= tl; t1z *= tl;
            c[o + 6] = t1x; c[o + 7] = t1y; c[o + 8] = t1z;
            c[o + 9] = ny * t1z - nz * t1y; c[o + 10] = nz * t1x - nx * t1z; c[o + 11] = nx * t1y - ny * t1x;
            c[o + 12] = 1 / (im + this.angEff(ox, oy, oz, nx, ny, nz));
            c[o + 13] = 1 / (im + this.angEff(ox, oy, oz, t1x, t1y, t1z));
            c[o + 14] = 1 / (im + this.angEff(ox, oy, oz, c[o + 9], c[o + 10], c[o + 11]));
            c[o + 16] = 0; c[o + 17] = 0; c[o + 18] = 0;
            // the normal velocity the contact may have at the end of the tick: closing exactly its gap (0 when it is
            // already in: pushClear undoes penetration without adding speed), or the bounce of an impact. Velocities
            // here and below are relative to the surface (sim-core/0.5.0); a still surface's 0 leaves them exact.
            this.pointVel(ox, oy, oz, w);
            const vn0 = (w.x - c[o + 22]) * nx + (w.y - c[o + 23]) * ny + (w.z - c[o + 24]) * nz;
            const gap = c[o + 20];
            const allowed = gap > 0 ? -gap / DT : 0;
            let target = allowed;
            if (vn0 < allowed) {
                const e = this.restitution(-vn0, nx * R[1] + ny * R[4] + nz * R[7]);
                if (e > 0) target = -vn0 * e;
            }
            c[o + 15] = target;
            c[o + 19] = vn0;
        }
        for (let pass = 0; pass < SOLVE_PASSES; pass++) {
            // alternate the order, so no contact takes the load first every time
            for (let jj = 0; jj < m; jj++) {
                const o = (pass & 1 ? m - 1 - jj : jj) * CN;
                const ox = c[o], oy = c[o + 1], oz = c[o + 2], nx = c[o + 3], ny = c[o + 4], nz = c[o + 5];
                // normal: the accumulated impulse only pushes
                const svx = c[o + 22], svy = c[o + 23], svz = c[o + 24];
                this.pointVel(ox, oy, oz, w);
                const lamN = Math.max(0, c[o + 16] + (c[o + 15] - ((w.x - svx) * nx + (w.y - svy) * ny + (w.z - svz) * nz)) * c[o + 12]);
                const jn = lamN - c[o + 16];
                c[o + 16] = lamN;
                if (jn !== 0) this.applyJ(nx * jn, ny * jn, nz * jn, ox, oy, oz);
                // friction: stop the sliding, the accumulated impulse within MU times the normal one
                const t1x = c[o + 6], t1y = c[o + 7], t1z = c[o + 8], t2x = c[o + 9], t2y = c[o + 10], t2z = c[o + 11];
                this.pointVel(ox, oy, oz, w);
                const rx = w.x - svx, ry = w.y - svy, rz = w.z - svz;
                let l1 = c[o + 17] - (rx * t1x + ry * t1y + rz * t1z) * c[o + 13];
                let l2 = c[o + 18] - (rx * t2x + ry * t2y + rz * t2z) * c[o + 14];
                const lim = MU * lamN;
                const ll = l1 * l1 + l2 * l2;
                if (ll > lim * lim) {
                    const k = lim > 0 ? lim / Math.sqrt(ll) : 0;
                    l1 *= k; l2 *= k;
                }
                const j1 = l1 - c[o + 17], j2 = l2 - c[o + 18];
                c[o + 17] = l1; c[o + 18] = l2;
                if (j1 !== 0 || j2 !== 0) this.applyJ(t1x * j1 + t2x * j2, t1y * j1 + t2y * j2, t1z * j1 + t2z * j2, ox, oy, oz);
            }
        }
        // the impacts: contacts that approached faster than their gap allowed and pushed. The tick keeps the most
        // damaging one (then the fastest) for applyHit.
        const ux = R[1], uy = R[4], uz = R[7];
        for (let j = 0; j < m; j++) {
            const o = j * CN;
            const vn0 = c[o + 19];
            const gap = c[o + 20];
            if (!(c[o + 16] > 0) || !(vn0 < (gap > 0 ? -gap / DT : 0))) continue;
            const a = -vn0;
            if (gap < PRESS_GAP && a < PRESS_V) continue;
            const dmg = this.damageOf(a, c[o + 3] * ux + c[o + 4] * uy + c[o + 5] * uz);
            if (dmg > this.hitDmg || (dmg === this.hitDmg && a > this.hitV)) {
                const h = this.hit;
                h[0] = c[o + 3]; h[1] = c[o + 4]; h[2] = c[o + 5];
                h[3] = px + c[o]; h[4] = py + c[o + 1]; h[5] = pz + c[o + 2];
                this.hitDmg = dmg;
            }
            if (a > this.hitV) this.hitV = a;
        }
    }

    /**
     * this.strike from the m contacts gathered at the start of the tick: each prop's thrust share after prop strikes
     * (STRIKE_COS_HI). Only the duct spheres (0-3, the motors' order) are props; a preset without them has no strikes.
     * Exactly 1 for a prop with nothing near, so free flight is unchanged bit for bit. A reversed prop (turtle mode)
     * draws its air from below, so for it the surfaces under the body block the intake.
     */
    private propStrikes(m: number): void {
        const st = this.strike;
        st[0] = st[1] = st[2] = st[3] = 1;
        const br = this.brake;
        br[0] = br[1] = br[2] = br[3] = 0;
        if (this.nS < 5) return;
        const c = this.cn;
        const R = this.rot;
        const ux = R[1], uy = R[4], uz = R[7];
        for (let j = 0; j < m; j++) {
            const o = j * CN;
            const i = c[o + 21];
            if (i > 3) continue;
            // how far the surface is over the intake: the normal points from the surface to the prop, so against the
            // side the thrust points to (up, or down for a reversed prop)
            const along = (c[o + 3] * ux + c[o + 4] * uy + c[o + 5] * uz) * this.motorDir[i];
            let g = c[o + 20] / STRIKE_GAP;
            g = g < 0 ? 0 : g > 1 ? 1 : g;
            // blade strike: a surface near the disc plane, on either side of it (BRAKE_COS_HI)
            let b = (BRAKE_COS_HI - (along < 0 ? -along : along)) / (BRAKE_COS_HI - BRAKE_COS_LO);
            if (b > 0) {
                if (b > 1) b = 1;
                b *= 1 - g;
                if (b > br[i]) br[i] = b;
            }
            let a = (-along - STRIKE_COS_LO) / (STRIKE_COS_HI - STRIKE_COS_LO);
            if (!(a > 0)) continue;
            if (a > 1) a = 1;
            const f = 1 - a * (1 - g);
            if (f < st[i]) st[i] = f;
        }
    }

    /**
     * Fast impacts: a surface the tick's start could not see (approaching faster than SPEC_MARGIN per tick) is found
     * by the swept test of the tick's motion with spheres SWEEP_SHRINK smaller (so resting on a surface is not a hit).
     * The body stops at the pose of the first touch and the contacts there are solved like any others, so a level
     * impact on a flat surface is shared by every sphere that meets it (F1). Upstream kept a 1 mm skin here and
     * threw the tick's motion away when a sphere started inside something; neither is needed now.
     */
    private sweepImpact(world: ContactWorld, px0: number, py0: number, pz0: number, q0w: number, q0x: number, q0y: number, q0z: number, lwx: number, lwy: number, lwz: number): void {
        const s = this.s;
        const p = this.p;
        const n = this.nS;
        const sp = p.spheres;
        // sphere centres at the start and end of the tick
        spherePoses(sp, n, px0, py0, pz0, q0w, q0x, q0y, q0z, this.c0);
        spherePoses(sp, n, s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], this.c1);
        // rotation chord error bound: d * dtheta^2 / 8
        const wmag = Math.sqrt(s[S.wx] * s[S.wx] + s[S.wy] * s[S.wy] + s[S.wz] * s[S.wz]);
        const dth = wmag * DT;
        for (let i = 0; i < n; i++) {
            const lx = sp[i * 4], ly = sp[i * 4 + 1], lz = sp[i * 4 + 2];
            const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
            this.pad[i] = (d * dth * dth) / 8 + 1e-9;
        }
        const t = world.sweep(this.c0, this.c1, this.rs, this.pad, n, this.cout);
        if (t < 0) return;
        if (t === 0) {
            // already more than SWEEP_SHRINK inside at the start (a respawn into something, a squeeze): pushClear moves it out
            this.startOverlaps++;
            return;
        }
        // move to the contact pose: translation and rotation interpolated like the sweep did
        s[S.px] = px0 + (s[S.px] - px0) * t;
        s[S.py] = py0 + (s[S.py] - py0) * t;
        s[S.pz] = pz0 + (s[S.pz] - pz0) * t;
        let bw = s[S.qw], bx = s[S.qx], by = s[S.qy], bz = s[S.qz];
        if (q0w * bw + q0x * bx + q0y * by + q0z * bz < 0) { bw = -bw; bx = -bx; by = -by; bz = -bz; }
        let iw = q0w + (bw - q0w) * t, ix = q0x + (bx - q0x) * t, iy = q0y + (by - q0y) * t, iz = q0z + (bz - q0z) * t;
        const il = 1 / Math.sqrt(iw * iw + ix * ix + iy * iy + iz * iz);
        iw *= il; ix *= il; iy *= il; iz *= il;
        s[S.qw] = iw; s[S.qx] = ix; s[S.qy] = iy; s[S.qz] = iz;
        const vl = this.vl;
        vl[0] = s[S.vx]; vl[1] = s[S.vy]; vl[2] = s[S.vz]; vl[3] = lwx; vl[4] = lwy; vl[5] = lwz;
        const R = this.rot;
        setRot(R, iw, ix, iy, iz);
        this.contactsAt(world, s[S.px], s[S.py], s[S.pz]);
        s[S.vx] = vl[0]; s[S.vy] = vl[1]; s[S.vz] = vl[2];
        // body rates from the angular momentum, at this pose
        const I = p.inertia;
        s[S.wx] = (R[0] * vl[3] + R[3] * vl[4] + R[6] * vl[5]) / I[0];
        s[S.wy] = (R[1] * vl[3] + R[4] * vl[4] + R[7] * vl[5]) / I[1];
        s[S.wz] = (R[2] * vl[3] + R[5] * vl[4] + R[8] * vl[5]) / I[2];
    }

    /**
     * What penetration is left (rotation within the tick, the last fraction of a millimetre of a fast impact, a respawn
     * into something) is undone by moving the body out along each sphere's push-out, without touching its velocity:
     * the solver already stopped the approach, and a push through the velocity would add a bounce.
     */
    private pushClear(world: ContactWorld): void {
        const s = this.s;
        const sp = this.p.spheres;
        const R = this.rot;
        setRot(R, s[S.qw], s[S.qx], s[S.qy], s[S.qz]);
        const u = this.push;
        for (let it = 0; it < PUSH_PASSES; it++) {
            let moved = false;
            for (let i = 0; i < this.nS; i++) {
                const lx = sp[i * 4], ly = sp[i * 4 + 1], lz = sp[i * 4 + 2];
                const cx = s[S.px] + R[0] * lx + R[1] * ly + R[2] * lz;
                const cy = s[S.py] + R[3] * lx + R[4] * ly + R[5] * lz;
                const cz = s[S.pz] + R[6] * lx + R[7] * ly + R[8] * lz;
                if (!world.pushOut(cx, cy, cz, this.rr[i], u)) continue;
                s[S.px] += u.x; s[S.py] += u.y; s[S.pz] += u.z;
                moved = true;
            }
            if (!moved) break;
        }
    }

    /**
     * The tick's strongest impact (contactsAt): its damage comes off the health, and at 0 the craft crashes (motors
     * stopped, disarmed: upstream's crash). With crashes off (C.7) nothing is damaged and every impact is a bounce.
     */
    private applyHit(): void {
        const s = this.s;
        const p = this.p;
        const a = this.hitV;
        const dmg = p.crashOn ? this.hitDmg : 0;
        this.hitV = -1;
        this.hitDmg = 0;
        if (a < 0 || s[S.crashed] > 0) return;
        if (dmg > 0) {
            const hp = s[S.health] - dmg;
            s[S.health] = hp > 0 ? hp : 0;
        }
        if (s[S.health] <= 0) {
            const h = this.hit;
            s[S.crashed] = 1;
            s[S.crashT] = 0;
            s[S.restT] = 0;
            s[S.flip] = 0;
            if (s[S.armed] > 0) {
                s[S.armed] = 0;
                this.events.push({ type: 'disarm', tick: this.tick, reason: 'crash' });
            }
            for (let i = 0; i < 4; i++) s[S.m0 + i] = 0;
            this.events.push({ type: 'crash', tick: this.tick, speed: a, nx: h[0], ny: h[1], nz: h[2], px: h[3], py: h[4], pz: h[5] });
        } else if (a > CONTACT_EVENT_V) {
            this.events.push({ type: 'contact', tick: this.tick, speed: a, regime: a >= p.vBounce ? 'bounce' : 'slide', damage: dmg });
        }
    }

    /**
     * The share of the health a hit approaching at `a` m/s takes: none up to the safe speed, then growing with the
     * impact energy (a^2) to all of it at the crash speed. up = the contact normal along the body's up axis: above
     * BOTTOM_COS_HI a landing on the frame's underside (vLandSafe, vLandCrash), under BOTTOM_COS_LO the props, arms
     * or top (vHarm, vCrash).
     */
    private damageOf(a: number, up: number): number {
        const p = this.p;
        let f = (up - BOTTOM_COS_LO) / (BOTTOM_COS_HI - BOTTOM_COS_LO);
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const crash = p.vCrash + (p.vLandCrash - p.vCrash) * f;
        let safe = p.vHarm + (p.vLandSafe - p.vHarm) * f;
        if (safe > crash) safe = crash;
        if (a >= crash) return 1;
        if (a <= safe) return 0;
        return (a * a - safe * safe) / (crash * crash - safe * safe);
    }

    /**
     * Restitution of an impact approaching at `a` m/s; none under BOUNCE_MIN. up = the contact normal along the body's
     * up axis, as in damageOf: the underside keeps upstream's landing values, the props, arms, sides and top bounce
     * as measured (E_WALL), blended between BOTTOM_COS_LO and BOTTOM_COS_HI.
     */
    private restitution(a: number, up: number): number {
        const p = this.p;
        if (a < BOUNCE_MIN) return 0;
        if (this.s[S.crashed] > 0) return 0.3 / (1 + a * 0.5);
        const land = a < p.vBounce ? 0.1 : 0.35 / (1 + (a - p.vBounce) * 0.5);
        let f = (up - BOTTOM_COS_LO) / (BOTTOM_COS_HI - BOTTOM_COS_LO);
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        if (f >= 1) return land;
        const hit = a <= V_WALL ? E_WALL : E_WALL * Math.sqrt(Math.sqrt(V_WALL / a));
        return hit + (land - hit) * f;
    }

    /** this.iw = R diag(1/I) R^T for the pose in this.rot: the world angular velocity is iw L. */
    private inertiaWorld(): void {
        const R = this.rot;
        const I = this.p.inertia;
        const a = 1 / I[0], b = 1 / I[1], c = 1 / I[2];
        const iw = this.iw;
        iw[0] = R[0] * R[0] * a + R[1] * R[1] * b + R[2] * R[2] * c;
        iw[1] = R[0] * R[3] * a + R[1] * R[4] * b + R[2] * R[5] * c;
        iw[2] = R[0] * R[6] * a + R[1] * R[7] * b + R[2] * R[8] * c;
        iw[3] = R[3] * R[3] * a + R[4] * R[4] * b + R[5] * R[5] * c;
        iw[4] = R[3] * R[6] * a + R[4] * R[7] * b + R[5] * R[8] * c;
        iw[5] = R[6] * R[6] * a + R[7] * R[7] * b + R[8] * R[8] * c;
    }

    /** (o x u) . iw (o x u): the rotational part of the inverse effective mass along u at offset o. */
    private angEff(ox: number, oy: number, oz: number, ux: number, uy: number, uz: number): number {
        const iw = this.iw;
        const cx = oy * uz - oz * uy, cy = oz * ux - ox * uz, cz = ox * uy - oy * ux;
        return cx * (iw[0] * cx + iw[1] * cy + iw[2] * cz) + cy * (iw[1] * cx + iw[3] * cy + iw[4] * cz) + cz * (iw[2] * cx + iw[4] * cy + iw[5] * cz);
    }

    /** Velocity of the point at world offset o from the centre of mass, v + w x o, from this.vl, into out. */
    private pointVel(ox: number, oy: number, oz: number, out: { x: number; y: number; z: number }): void {
        const vl = this.vl;
        const iw = this.iw;
        const Lx = vl[3], Ly = vl[4], Lz = vl[5];
        const wx = iw[0] * Lx + iw[1] * Ly + iw[2] * Lz;
        const wy = iw[1] * Lx + iw[3] * Ly + iw[4] * Lz;
        const wz = iw[2] * Lx + iw[4] * Ly + iw[5] * Lz;
        out.x = vl[0] + (wy * oz - wz * oy);
        out.y = vl[1] + (wz * ox - wx * oz);
        out.z = vl[2] + (wx * oy - wy * ox);
    }

    /** Impulse J at world offset o into this.vl: v += J / m, L += o x J. */
    private applyJ(jx: number, jy: number, jz: number, ox: number, oy: number, oz: number): void {
        const vl = this.vl;
        const im = 1 / this.p.mass;
        vl[0] += jx * im; vl[1] += jy * im; vl[2] += jz * im;
        vl[3] += oy * jz - oz * jy; vl[4] += oz * jx - ox * jz; vl[5] += ox * jy - oy * jx;
    }
}

/** Row-major rotation matrix of the unit quaternion q (body to world) into R. */
function setRot(R: Float64Array, qw: number, qx: number, qy: number, qz: number): void {
    R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qw * qz); R[2] = 2 * (qx * qz + qw * qy);
    R[3] = 2 * (qx * qy + qw * qz); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qw * qx);
    R[6] = 2 * (qx * qz - qw * qy); R[7] = 2 * (qy * qz + qw * qx); R[8] = 1 - 2 * (qx * qx + qy * qy);
}

/**
 * The motor output a fresh pack hovers at, the one value of Sim.hoverThr (review finding C6): the
 * Sim constructor sets it, and every Sim (the page's, a replay's, lifeSim's) gets the same. Zero
 * gravity hovers at 0 (v0.2's guard turned that into 0.4 in a `new Sim` while the page set 0, so
 * a zero-g auto-throttle flight replayed 13 m higher); a craft that cannot hover gets full output
 * (hoverSolve says NaN, which would poison the auto-throttle map).
 */
export function hoverThrOf(p: SimParams): number {
    const m = hoverSolve(p, 1).motor;
    return m >= 0 && m <= 1 ? m : 1;
}

/** throttle mapping for auto-throttle gravity mode: stick 0.5 -> hover. */
function autoThrottle(u: number, hover: number): number {
    const h = hover < 0.02 ? 0.02 : hover > 0.98 ? 0.98 : hover;
    return u <= 0.5 ? (u / 0.5) * h : h + ((u - 0.5) / 0.5) * (1 - h);
}

/** q <- q * exp(w dt / 2), renormalised. */
function integrateQuat(s: Float64Array, wx: number, wy: number, wz: number): void {
    const wm = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const half = wm * DT * 0.5;
    let dw = 1, dx = 0, dy = 0, dz = 0;
    if (wm > 1e-12) {
        const sn = dsin(half) / wm;
        dw = dcos(half);
        dx = wx * sn; dy = wy * sn; dz = wz * sn;
    }
    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
    let nw = qw * dw - qx * dx - qy * dy - qz * dz;
    let nx = qw * dx + qx * dw + qy * dz - qz * dy;
    let ny = qw * dy - qx * dz + qy * dw + qz * dx;
    let nz = qw * dz + qx * dy - qy * dx + qz * dw;
    const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
    nw *= inv; nx *= inv; ny *= inv; nz *= inv;
    s[S.qw] = nw; s[S.qx] = nx; s[S.qy] = ny; s[S.qz] = nz;
}

/** World centres of the body spheres for pose (p, q). */
export function spherePoses(
    sp: Float64Array, n: number, px: number, py: number, pz: number,
    qw: number, qx: number, qy: number, qz: number, out: Float64Array
): void {
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    for (let i = 0; i < n; i++) {
        const lx = sp[i * 4], ly = sp[i * 4 + 1], lz = sp[i * 4 + 2];
        out[i * 3] = px + r00 * lx + r01 * ly + r02 * lz;
        out[i * 3 + 1] = py + r10 * lx + r11 * ly + r12 * lz;
        out[i * 3 + 2] = pz + r20 * lx + r21 * ly + r22 * lz;
    }
}

/** Attitude helpers for HUD / bot (deterministic). Degrees. */
export function attitude(s: Float64Array): { roll: number; pitch: number; yaw: number } {
    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
    // body axes in world: right (r00,r10,r20), up (r01,r11,r21), back (r02,r12,r22)
    const r10 = 2 * (qx * qy + qw * qz);
    const r11 = 1 - 2 * (qx * qx + qz * qz);
    const r02 = 2 * (qx * qz + qw * qy), r12 = 2 * (qy * qz - qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    // heading of the nose (-back) on the ground, right turn positive, 0 = -z
    const yaw = datan2(-r02, r22) * RAD2DEG;
    // nose below the horizon = positive pitch
    const pitch = datan2(r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD2DEG;
    // right side below the horizon = positive roll
    const roll = datan2(-r10, r11) * RAD2DEG;
    return { roll, pitch, yaw };
}
