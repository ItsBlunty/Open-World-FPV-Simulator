// Compile a preset JSON (every field has value + source) into the flat numbers the model uses.

import type { RatesConfig, RatesType, ThrottleCurve } from './rates';
import { invertThrottle } from './rates';
import type { LevelParams } from './contracts';
import { compileWind } from './wind';
import { WAKE_LOSS_MAX } from './wake';
import type { WindConfig } from './wind';

export type FieldSource = 'manufacturer' | 'estimate' | 'bf-default' | `measured:${string}`;

export interface PresetField<T = unknown> {
    value: T;
    source: FieldSource;
    ref?: string;
    note?: string;
    min?: number;
    max?: number;
}

export interface PresetJson {
    id: string;
    name: string;
    class: string;
    notes?: string;
    fields: Record<string, PresetField>;
}

export type GravityMode = 'honest' | 'same-twr' | 'auto-throttle';

export interface SimParams {
    presetId: string;
    mass: number; // kg
    inertia: [number, number, number]; // body x (pitch), y (yaw), z (roll), kg m^2
    twr: number;
    tmaxMotorNom: number; // N per motor at vNom
    vNom: number; // pack voltage under full load, fresh pack
    cells: number;
    capacityAs: number; // ampere-seconds
    rPack: number; // ohm
    eta: number;
    omegaMaxPerVolt: number; // rad/s per volt, loaded
    tau: number; // s
    kappa: number; // m
    idle: number;
    /** Betaflight's dynamic idle (dyn_idle_*), compiled for the 1 ms tick; null = off (the static idle above) */
    dynIdle: DynIdleParams | null;
    motorPos: Float64Array; // 4 x (x, y, z) body frame, m
    motorYaw: Float64Array; // +1 = CW prop (reaction yaw left, +y torque), -1 = CCW
    cda: [number, number, number]; // m^2 along body x, y, z
    spheres: Float64Array; // n x (x, y, z, r) body frame, m
    boundRadius: number; // body origin -> farthest sphere surface, m
    vBounce: number;
    vCrash: number;
    /**
     * Damage (this project, sim-core/0.3.0): a hit on the props, arms or top approaching at up to vHarm m/s does no
     * damage; from there the damage grows with the impact energy, to the whole health at vCrash. A hit on the
     * underside (the body landing) uses vLandSafe and vLandCrash instead.
     */
    vHarm: number;
    vLandSafe: number;
    vLandCrash: number;
    rates: RatesConfig;
    pid: { roll: number[]; pitch: number[]; yaw: number[] };
    throttle: ThrottleCurve;
    gravity: number; // m/s^2
    gravityMode: GravityMode;
    rho: number;
    cameraUptiltDeg: number;
    cameraFovDeg: number;
    /** self-level tuning of angle and horizon modes (B.1) */
    level: LevelParams;
    /** PT3 cutoff on the self-level rate output, Hz (Betaflight ATTITUDE_CUTOFF_HZ 50); 0 = unfiltered, a test control only */
    levelOutputHz: number;
    /** false: an impact above vCrash is a bounce, not a crash (C.7) */
    crashOn: boolean;
    /** false: the pack never drains (its state of charge stays where the life set it); its sag under load stays */
    batteryDrain: boolean;
    /**
     * arming needs the craft within this many degrees of level (Betaflight's small_angle, default 25); 180 arms at any
     * tilt, as Betaflight does with small_angle = 180 (src/main/flight/imu.c)
     */
    smallAngleDeg: number;
    /** rotor and duct momentum drag at hover rotor speed, 1/s (H.2 item 1) */
    ductDrag: number;
    /** rotor + prop inertia about the motor axis, kg m^2 (H.2 item 3) */
    rotorInertia: number;
    /** motor-mix range where the I-term starts to fade (Betaflight iterm_windup 85 %); 1 = v0.2 (freeze only when saturated) */
    itermWindup: number;
    /** lowest body point below the centre with the craft level, m: where the platform goes (C.2) */
    bodyBottom: number;
    /** the wind of the place (wind.ts); null: still air, exactly the model without wind */
    wind: WindConfig | null;
    /**
     * prop wash (wake.ts): the share of thrust lost at the worst point of a descent through the rotors'
     * own wake (preset wake_loss x the wake override); 0 = no prop-wash term, the model without it bit for bit
     */
    wakeLoss: number;
    /** prop wash: turbulent roll/pitch torque, share of one rotor's thrust times the arm (preset wake_shake) */
    wakeShake: number;
    /** total rotor disk area, m^2 (4 disks of preset prop_diameter_mm); 0 when the preset has no prop wash */
    wakeArea: number;
    /**
     * Rotor inflow (sim-core/0.6.0, this project; physics-review G1): each prop's thrust follows the air through it
     * (Gill and D'Andrea 2019, RotorInflow). null: the classic model, thrust from rotor speed alone (presets without
     * prop_pitch_in, and ParamOverrides.classicPhysics), bit for bit sim-core/0.5.0.
     */
    inflow: RotorInflow | null;
    /**
     * The motor and ESC (sim-core/0.8.0, this project): each rotor's speed from the torque balance of a DC motor driven at
     * the commanded duty against its prop's aerodynamic torque, so a prop that unloads speeds up and the air can drive it
     * while the ESC brakes (MotorModel). Present with the rotor inflow model only (its prop torque needs the inflow);
     * null: the first-order lag `tau` of earlier versions.
     */
    motor: MotorModel | null;
}

/**
 * A brushless motor on an ESC with complementary PWM (active braking, the default of BLHeli_32, AM32 and Bluejay), in
 * the averaged DC-motor form: the winding sees duty x pack voltage, current i = (d V - Ke w) / R, torque Kt i with
 * Kt = Ke = 1 / Kv (SI units). The current may reverse, so the ESC brakes a rotor the air drives faster than d V / Ke.
 * R is the effective resistance of the motor's speed-torque line, set so that the motor turns at the preset's loaded
 * speed (rpm_loaded_fraction of Kv x V) against its prop's static torque at full output and nominal voltage.
 */
export interface MotorModel {
    /** back-EMF and torque constant, V s / rad = N m / A (1 / Kv) */
    ke: number;
    /** effective resistance of the speed-torque line, ohm */
    r: number;
}

/**
 * The propeller of the rotor inflow model (Sim.propLoads): blade-element thrust and torque from Gill and D'Andrea,
 * "Computationally Efficient Force and Moment Models for Propellers in UAV Forward Flight Applications", Drones
 * 3(4):77, 2019 (thrust their eq. 27, torque eq. 37-38), with its parameters predicted from the static thrust and torque
 * (their Section 4: symmetric airfoil c_l0 = 0, delta = 0.2, c_d0 = 0.05, c_d,alpha from the static torque). With
 * c_l0 = 0 the thrust only needs the lift slope x solidity product `a`, fixed by the static thrust. The blade angle is
 * theta_tip = INFLOW_PITCH_FACTOR P / (2 pi R), fitted to measured 5-inch props (sim-core/0.8.0). The induced inflow is
 * Glauert's momentum theory, which fitted NeuroBEM's measured flights better than Gill and D'Andrea's closed form
 * (eq. 69) in forward flight (docs/physics-review.md G1).
 */
export interface RotorInflow {
    /** c_l,alpha x solidity, from the static thrust coefficient (Gill and D'Andrea eq. 87) */
    a: number;
    /** blade pitch angle at the tip, rad (their eq. 82 with INFLOW_PITCH_FACTOR) */
    theta: number;
    /** prop radius, m */
    radius: number;
    /** one prop's disk area, m^2 */
    area: number;
    /** solidity N_b c_tip / (pi R) of the c_tip / r chord (preset prop_solidity) */
    sigma: number;
    /** profile drag coefficient at zero angle of attack (INFLOW_CD0) */
    cd0: number;
    /** quadratic drag coefficient, from the static torque (their eq. 88) */
    cdAlpha: number;
}

/** Gill and D'Andrea's "not useful" root fraction of the blade, fixed at 0.20 for predicted parameters (their Section 4.1). */
export const INFLOW_DELTA = 0.2;
/**
 * theta_tip = INFLOW_PITCH_FACTOR x P / (2 pi R). Gill and D'Andrea's eq. 82 gives 1.25 (1 / (1 - delta)); against the
 * UIUC Propeller Database's axial-flow sweeps of five 5-inch props (two- and three-blade, 3000-9000 rpm), whose thrust
 * reaches zero at 0.93-1.09 x the pitch speed, 1.25 is 8-21 % of the static thrust off and the median best fit, 1.025,
 * 0.5-9 % [measured: docs/evidence/2026-10-20-motor-model/prop_fit.py; sim-core/0.8.0].
 */
export const INFLOW_PITCH_FACTOR = 1.025;
/** profile drag coefficient at zero angle of attack, Gill and D'Andrea's predicted value (their Section 4.1) */
export const INFLOW_CD0 = 0.05;
/**
 * The edge of the domain the model was checked on in the wind tunnel (Gill and D'Andrea: climb ratio and advance ratio
 * up to about 0.3; near 0.2 a prop already makes about no thrust). Beyond it, a slow prop in a fast airflow (idle props
 * in a dive, a fall or a throttle chop at speed), the blade-element assumptions fail and no measured data covers a
 * 5-inch prop (Goyal, Sinnige et al. 2024: even blade-element momentum tools miss props in negative thrust). Past this
 * ratio along the axis the prop's loads come from blade-element theory without the small-angle step and with a stalling
 * section (Sim.bladeLoads, sim-core/0.8.0, blended in up to 0.45) [estimate, this project]; the advance ratio is held
 * at this value. Until 0.7.0 both ratios were clamped here, which kept a slow prop's loads at the clamped coefficient
 * x the rotor speed squared: no drag from a nearly stopped prop, no aerodynamic damping in a fast airflow, and a band
 * where more rpm gave less thrust for the wrong reason (physics-review F9).
 */
export const INFLOW_RATIO_MAX = 0.3;

export const EARTH_G = 9.81;
/** Air density, kg/m^3 (ISA sea level, 15 deg C). */
const RHO = 1.225;

/** Betaflight 4.5.1 self-level defaults (pid.c: angle_limit 60, PID_LEVEL 50/75/75/50, horizon 135 deg, 500 ms, FF smoothing 80 ms). */
export const LEVEL_DEFAULTS: Readonly<LevelParams> = {
    limitDeg: 60,
    gain: 50,
    ffGain: 0.5,
    ffSmoothMs: 80,
    horizonStrength: 75,
    horizonLimitSticks: 0.75,
    horizonLimitDeg: 135,
    horizonDelayMs: 500
};

export interface ParamOverrides {
    twr?: number;
    tauMs?: number;
    cdaScale?: number;
    gravity?: number;
    gravityMode?: GravityMode;
    rates?: RatesConfig;
    vCrash?: number;
    vBounce?: number;
    /** damage thresholds, m/s (SimParams.vHarm, vLandSafe, vLandCrash) */
    vHarm?: number;
    vLandSafe?: number;
    vLandCrash?: number;
    pid?: { roll?: number[]; pitch?: number[]; yaw?: number[] };
    throttle?: ThrottleCurve; // thr_mid / thr_expo, e.g. imported from a Betaflight diff
    uptiltDeg?: number;
    fovDeg?: number;
    /** self-level tuning; missing fields keep LEVEL_DEFAULTS */
    level?: Partial<LevelParams>;
    /** crashes on (default) or off (C.7); a flag, because JSON turns Infinity into null */
    crashOn?: boolean;
    /** rotor and duct momentum drag, 1/s at hover rotor speed (preset rotor_drag_per_s) */
    ductDrag?: number;
    /** multiplier on the preset rotor_inertia_kgm2 (1 = preset, 0 = no rotor-inertia yaw reaction) */
    propInertia?: number;
    /** motor idle as a fraction of full output (0.10 = Betaflight dshot_idle_value 1000) */
    idle?: number;
    /**
     * the wind of the place (v0.7, wind.ts): absent = still air. Speed and gust 0 compile to still
     * air too, so such a model flies exactly as one without the field (its configHash still differs).
     */
    wind?: WindConfig;
    /**
     * multiplier on the preset's prop wash (wake_loss and wake_shake; 1 = preset, 0 = off). Presets
     * without those fields have no prop wash whatever this says.
     */
    wake?: number;
    /**
     * true: the classic flight model of sim-core/0.5.0 even for a preset with rotor inflow (thrust from rotor speed
     * alone, the preset's cda_vertical_cm2), for comparing the two (owner, 2026-10-18). Absent or false: the preset's.
     */
    classicPhysics?: boolean;
    /**
     * false: the pack never drains, so every life flies on the charge it started with (a fresh pack after a respawn to
     * the start); the voltage still sags under load as a fresh pack's does. Absent or true: it drains (every version
     * before this flag). The game's "Battery simulation" switch (owner, 2026-10-19).
     */
    batteryDrain?: boolean;
    /**
     * Betaflight's small_angle, degrees, 0-180: arming needs the craft within it of level unless the turtle switch is on.
     * Absent: 25 (Betaflight's default, every version before this field). 180: arms at any tilt. The game's
     * "Arming angle" setting (owner, 2026-10-20).
     */
    smallAngleDeg?: number;
    /**
     * Betaflight's dynamic idle, in its CLI units. Absent, or minRpm 0: off, the static `idle` as before (bit for bit).
     * On: the static idle no longer applies (Betaflight 4.3+), the floor of the motor range follows a PID on the slowest
     * motor's rpm instead. The game's "Dynamic idle" setting (owner, 2026-10-20).
     */
    dynIdle?: DynIdleConfig;
}

/** Betaflight's dyn_idle_* settings (src/main/flight/pid.c, 4.5), CLI units; missing fields take Betaflight's defaults. */
export interface DynIdleConfig {
    /** dyn_idle_min_rpm: the slowest motor is held above this x 100 rpm; 0-200, 0 = off */
    minRpm: number;
    /** dyn_idle_p_gain, dyn_idle_i_gain (1-250), dyn_idle_d_gain (0-250), default 50 each (cli/settings.c) */
    p?: number;
    i?: number;
    d?: number;
    /** dyn_idle_max_increase: the most the floor rises once airmode is active, 0.1 % steps (150 = 15 %), 10-255 */
    maxIncrease?: number;
    /** dyn_idle_start_increase: the most it rises before airmode is active (on the ground), 0.1 % steps (50 = 5 %), 10-255 */
    startIncrease?: number;
}

/** Dynamic idle compiled as Betaflight's mixerInitProfile() does (src/main/flight/mixer_init.c, 4.5), for a 1 kHz loop. */
export interface DynIdleParams {
    /** dyn_idle_min_rpm x 100 / 60: target rotations per second of the slowest motor */
    minRps: number;
    pGain: number;
    iGain: number;
    dGain: number;
    maxIncrease: number;
    startIncrease: number;
    /** PT1 gain on the measured rps: 800 x dt / 20 */
    delayK: number;
}

/** Betaflight's defaults (pid.c resetPidProfile, 4.5) */
export const DYN_IDLE_DEFAULTS = { p: 50, i: 50, d: 50, maxIncrease: 150, startIncrease: 50 } as const;

function dynIdleOf(c: DynIdleConfig | undefined): DynIdleParams | null {
    if (c === undefined) return null;
    const whole = (v: number, lo: number, hi: number, name: string): number => {
        if (!Number.isFinite(v)) throw new RangeError(`dynIdle.${name} ${v}`);
        return Math.min(hi, Math.max(lo, Math.round(v)));
    };
    const minRpm = whole(c.minRpm, 0, 200, 'minRpm');
    if (minRpm === 0) return null;
    // the controller runs every 1 ms tick: Betaflight's pidGetDT() = 0.001, pidGetPidFrequency() = 1000
    const dt = 0.001;
    return {
        minRps: (minRpm * 100) / 60,
        pGain: whole(c.p ?? DYN_IDLE_DEFAULTS.p, 1, 250, 'p') * 0.00015,
        iGain: whole(c.i ?? DYN_IDLE_DEFAULTS.i, 1, 250, 'i') * 0.01 * dt,
        dGain: whole(c.d ?? DYN_IDLE_DEFAULTS.d, 0, 250, 'd') * 0.0000003 * (1 / dt),
        maxIncrease: whole(c.maxIncrease ?? DYN_IDLE_DEFAULTS.maxIncrease, 10, 255, 'maxIncrease') * 0.001,
        startIncrease: whole(c.startIncrease ?? DYN_IDLE_DEFAULTS.startIncrease, 10, 255, 'startIncrease') * 0.001,
        delayK: (800 * dt) / 20
    };
}

/**
 * The game's automatic dyn_idle_min_rpm (x 100 rpm) for a prop diameter: 175 / diameter in inches, so 35 (3500 rpm) on a
 * 5-inch. Betaflight's 4.3 tuning notes: 30-40 (3000-4000 rpm) for typical quads, and the minimum is otherwise found by
 * testing for desyncs, which the simulator does not have. Oscar Liang's ranges by size (7": 14-28, 5": 20-40, 3": 33-66)
 * scale as 1 / diameter; 175 / D falls inside each [estimate between the two sources].
 */
export function autoDynIdleMinRpm(propDiameterMm: number): number {
    const inches = propDiameterMm / 25.4;
    return Math.min(200, Math.max(1, Math.round(175 / inches)));
}

/** small_angle in Betaflight's range, 0-180 whole degrees (its CLI setting); absent: 25, its default */
function smallAngleOf(deg: number | undefined): number {
    if (deg === undefined) return 25;
    if (!Number.isFinite(deg)) throw new RangeError(`smallAngleDeg ${deg}`);
    return Math.min(180, Math.max(0, Math.round(deg)));
}

function num(p: PresetJson, key: string): number {
    const f = p.fields[key];
    if (!f || typeof f.value !== 'number') throw new Error(`preset ${p.id}: numeric field ${key} missing`);
    return f.value;
}

/** An optional numeric field: its value, or `fallback` when the preset does not have it. */
function optNum(p: PresetJson, key: string, fallback: number): number {
    const f = p.fields[key];
    if (f === undefined) return fallback;
    if (typeof f.value !== 'number' || !Number.isFinite(f.value)) throw new Error(`preset ${p.id}: field ${key} is not a number`);
    return f.value;
}

/**
 * The prop-wash terms of a preset (wake.ts): wake_loss and wake_shake (both optional, 0 when absent)
 * times the override, and the disk area from prop_diameter_mm, which a preset with prop wash must have.
 * A preset's own wake_loss outside 0..WAKE_LOSS_MAX is an authoring error (thrown); the override (the
 * pilot's prop wash setting, up to 2x) can push the product past it, and that is capped, never thrown:
 * a setting must not make a drone that cannot be flown (review R5, docs/wip/v08-d.md).
 */
function wakeOf(p: PresetJson, scale: number): { wakeLoss: number; wakeShake: number; wakeArea: number } {
    if (!(scale >= 0) || !Number.isFinite(scale)) throw new RangeError(`wake must be a number >= 0, got ${String(scale)}`);
    const own = optNum(p, 'wake_loss', 0), ownShake = optNum(p, 'wake_shake', 0);
    if (own < 0 || own > WAKE_LOSS_MAX || ownShake < 0) throw new RangeError(`preset ${p.id}: wake_loss must be 0..${WAKE_LOSS_MAX} and wake_shake >= 0`);
    const loss = Math.min(WAKE_LOSS_MAX, own * scale);
    const shake = ownShake * scale;
    if (loss === 0 && shake === 0) return { wakeLoss: 0, wakeShake: 0, wakeArea: 0 };
    const r = num(p, 'prop_diameter_mm') / 2000;
    return { wakeLoss: loss, wakeShake: shake, wakeArea: 4 * Math.PI * r * r };
}

/**
 * The level-mode numbers a preset may set (optional field `level`, its value an object of Betaflight CLI
 * names): the angle feed-forward and its smoothing, which a drone's tune sets as it sets its PID (a heavy,
 * slow craft needs less feed-forward or angle mode overshoots its limit and swings past level on release:
 * review R4, docs/wip/v08-d.md). Absent = Betaflight's defaults (LEVEL_DEFAULTS), so the presets without
 * the field fly as before. The level numbers the pilot sets (angle_limit, angle_p_gain,
 * horizon_level_strength: the settings level.*) are refused here: their settings show Betaflight's
 * defaults, and a preset value under them would make the settings screen show a number the drone does
 * not fly. ParamOverrides.level still wins over the preset.
 */
const PRESET_LEVEL_KEYS: Readonly<Record<string, (v: number) => Partial<LevelParams>>> = {
    /** Betaflight angle_feedforward, 0-200 (default 50): the feed-forward gain is it / 100 */
    angle_feedforward: (v) => ({ ffGain: v / 100 }),
    /** Betaflight angle_feedforward_smoothing_ms (default 80) */
    angle_feedforward_smoothing_ms: (v) => ({ ffSmoothMs: v })
};

function presetLevel(p: PresetJson): Partial<LevelParams> {
    const f = p.fields.level;
    if (f === undefined) return {};
    const v = f.value;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`preset ${p.id}: field level must be an object of Betaflight names`);
    let out: Partial<LevelParams> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        const put = Object.hasOwn(PRESET_LEVEL_KEYS, k) ? PRESET_LEVEL_KEYS[k] : undefined;
        if (!put) throw new Error(`preset ${p.id}: level.${k} is not a level number a preset sets (${Object.keys(PRESET_LEVEL_KEYS).join(', ')})`);
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error(`preset ${p.id}: level.${k} must be a number >= 0`);
        out = { ...out, ...put(n) };
    }
    return out;
}

function voc(soc: number): number {
    // per cell, piecewise linear 4.2 / 3.7 / 3.3 V at SoC 1 / 0.5 / 0
    return soc >= 0.5 ? 3.7 + (soc - 0.5) * 1.0 : 3.3 + soc * 0.8;
}
export { voc as cellVoc };

export function compileParams(p: PresetJson, o: ParamOverrides = {}): SimParams {
    const mass = num(p, 'auw_g') / 1000;
    const twr = o.twr ?? num(p, 'twr');
    const gravity = o.gravity ?? EARTH_G;
    const gravityMode = o.gravityMode ?? 'honest';
    // thrust is defined on Earth: T_max = TWR * m * 9.81; "same TWR" rescales it with g
    let tmaxTotal = twr * mass * EARTH_G;
    if (gravityMode === 'same-twr') tmaxTotal *= gravity / EARTH_G;
    const tmaxMotorNom = tmaxTotal / 4;

    const cells = num(p, 'battery_cells');
    const capacityAs = (num(p, 'battery_capacity_mah') / 1000) * 3600;
    const rPack = num(p, 'pack_resistance_per_cell_ohm') * cells;
    const eta = num(p, 'efficiency');
    const kv = num(p, 'motor_kv');
    const rpmFrac = num(p, 'rpm_loaded_fraction');
    const omegaMaxPerVolt = kv * rpmFrac * 0.10471975511965977; // rpm -> rad/s
    const kappa = num(p, 'motor_kappa_m');

    // V_nom: loaded pack voltage at full throttle with a fresh pack (fixed point, deterministic).
    const vOc = cells * voc(1);
    let v = vOc;
    for (let i = 0; i < 60; i++) {
        const tNow = tmaxMotorNom; // at V = V_nom thrust is nominal by definition
        const omega = omegaMaxPerVolt * v;
        const current = (4 * kappa * tNow * omega) / (eta * v);
        v = vOc - current * rPack;
    }
    const vNom = v;

    const wb = num(p, 'wheelbase_mm');
    void wb;
    const off = num(p, 'collider_duct_offset_mm') / 1000;
    const ductR = num(p, 'collider_duct_radius_mm') / 1000;
    const bodyR = num(p, 'collider_body_radius_mm') / 1000;
    // motor positions follow the wheelbase diagonal
    const arm = num(p, 'wheelbase_mm') / 2000 / Math.SQRT2;
    // Betaflight quad X order: M1 rear-right, M2 front-right, M3 rear-left, M4 front-left.
    // Body frame: x right, y up, z back (forward is -z).
    const motorPos = new Float64Array([arm, 0, arm, arm, 0, -arm, -arm, 0, arm, -arm, 0, -arm]);
    // props-in default: M1 CW, M2 CCW, M3 CCW, M4 CW (seen from above)
    const motorYaw = new Float64Array([1, -1, -1, 1]);

    let spheres: Float64Array;
    if (ductR > 0) {
        spheres = new Float64Array([
            off, 0, off, ductR,
            off, 0, -off, ductR,
            -off, 0, off, ductR,
            -off, 0, -off, ductR,
            0, 0, 0, bodyR
        ]);
    } else {
        spheres = new Float64Array([0, 0, 0, bodyR]);
    }
    let boundRadius = 0;
    let bodyBottom = 0;
    for (let i = 0; i < spheres.length; i += 4) {
        const d = Math.sqrt(spheres[i] * spheres[i] + spheres[i + 1] * spheres[i + 1] + spheres[i + 2] * spheres[i + 2]) + spheres[i + 3];
        if (d > boundRadius) boundRadius = d;
        const below = spheres[i + 3] - spheres[i + 1];
        if (below > bodyBottom) bodyBottom = below;
    }
    const lv = o.level ?? {};
    const pl = presetLevel(p);
    const vBounce = o.vBounce ?? num(p, 'v_bounce_ms');
    const vCrash = o.vCrash ?? num(p, 'v_crash_ms');

    const rj = p.fields.rates.value as { type: RatesType; roll: number[]; pitch: number[]; yaw: number[]; rate_limit: number };
    const rates: RatesConfig = o.rates ?? {
        type: rj.type,
        roll: { rcRate: rj.roll[0], rate: rj.roll[1], expo: rj.roll[2] },
        pitch: { rcRate: rj.pitch[0], rate: rj.pitch[1], expo: rj.pitch[2] },
        yaw: { rcRate: rj.yaw[0], rate: rj.yaw[1], expo: rj.yaw[2] },
        rateLimit: rj.rate_limit
    };
    const thr = p.fields.throttle.value as { mid: number; expo: number };
    const cdaScale = o.cdaScale ?? 1;
    const cdaH = (num(p, 'cda_horizontal_cm2') / 10000) * cdaScale;
    const inflow = o.classicPhysics === true ? null : inflowOf(p, tmaxMotorNom, omegaMaxPerVolt * vNom, kappa);
    const motor = inflow ? motorOf(kv, rpmFrac, vNom, kappa, tmaxMotorNom) : null;
    // with rotor inflow the props unload at speed themselves, so the vertical drag area is the frame's own; the
    // classic model's larger cda_vertical_cm2 stands in for that unloading
    const cdaV = (num(p, inflow ? 'cda_vertical_inflow_cm2' : 'cda_vertical_cm2') / 10000) * cdaScale;

    const ipr = num(p, 'inertia_roll_pitch_kgm2');
    const iy = num(p, 'inertia_yaw_kgm2');

    return {
        presetId: p.id,
        mass,
        inertia: [ipr, iy, ipr],
        twr,
        tmaxMotorNom,
        vNom,
        cells,
        capacityAs,
        rPack,
        eta,
        omegaMaxPerVolt,
        tau: (o.tauMs ?? num(p, 'motor_tau_ms')) / 1000,
        kappa,
        idle: o.idle ?? num(p, 'motor_idle'),
        dynIdle: dynIdleOf(o.dynIdle),
        motorPos,
        motorYaw,
        cda: [cdaH, cdaV, cdaH],
        spheres,
        boundRadius,
        vBounce,
        vCrash,
        // [estimates, this project]: below the bounce speed a touch is a slide and does no harm; a 5-inch quad lands on
        // its frame's underside at a few m/s without damage and survives drops of a couple of metres (10 m/s is a
        // 5 m drop), so the underside takes 0.8 and 2 times the crash speed. To be tuned by flying.
        vHarm: o.vHarm ?? vBounce,
        vLandSafe: o.vLandSafe ?? 0.8 * vCrash,
        vLandCrash: o.vLandCrash ?? 2 * vCrash,
        rates,
        pid: {
            roll: o.pid?.roll ?? (p.fields.pid_roll.value as number[]),
            pitch: o.pid?.pitch ?? (p.fields.pid_pitch.value as number[]),
            yaw: o.pid?.yaw ?? (p.fields.pid_yaw.value as number[])
        },
        throttle: o.throttle ? { mid: o.throttle.mid, expo: o.throttle.expo } : { mid: thr.mid, expo: thr.expo },
        gravity,
        gravityMode,
        rho: RHO,
        cameraUptiltDeg: o.uptiltDeg ?? num(p, 'camera_uptilt_deg'),
        cameraFovDeg: o.fovDeg ?? num(p, 'camera_fov_deg'),
        level: {
            limitDeg: lv.limitDeg ?? LEVEL_DEFAULTS.limitDeg,
            gain: lv.gain ?? LEVEL_DEFAULTS.gain,
            ffGain: lv.ffGain ?? pl.ffGain ?? LEVEL_DEFAULTS.ffGain,
            ffSmoothMs: lv.ffSmoothMs ?? pl.ffSmoothMs ?? LEVEL_DEFAULTS.ffSmoothMs,
            horizonStrength: lv.horizonStrength ?? LEVEL_DEFAULTS.horizonStrength,
            horizonLimitSticks: lv.horizonLimitSticks ?? LEVEL_DEFAULTS.horizonLimitSticks,
            horizonLimitDeg: lv.horizonLimitDeg ?? LEVEL_DEFAULTS.horizonLimitDeg,
            horizonDelayMs: lv.horizonDelayMs ?? LEVEL_DEFAULTS.horizonDelayMs
        },
        levelOutputHz: 50,
        crashOn: o.crashOn ?? true,
        batteryDrain: o.batteryDrain ?? true,
        smallAngleDeg: smallAngleOf(o.smallAngleDeg),
        ductDrag: o.ductDrag ?? num(p, 'rotor_drag_per_s'),
        rotorInertia: num(p, 'rotor_inertia_kgm2') * (o.propInertia ?? 1),
        itermWindup: 0.85,
        bodyBottom,
        // validated here (a bad wind throws RangeError: a log carrying one refuses to replay)
        wind: compileWind(o.wind) ? { ...o.wind! } : null,
        ...wakeOf(p, o.wake ?? 1),
        inflow,
        motor
    };
}

/**
 * The rotor inflow model of a preset that has prop_pitch_in (with prop_diameter_mm, prop_solidity and
 * cda_vertical_inflow_cm2), or null. Gill and D'Andrea's Section 4 parameter prediction: theta_tip from the pitch
 * (their eq. 82, with INFLOW_PITCH_FACTOR), then the lift-slope x solidity product `a` such that the model's static
 * thrust coefficient is the preset's (their eq. 87): hover with c_l0 = 0 gives C_T = (1 - delta) a (theta_tip -
 * lambda_i) and momentum theory C_T = 4 lambda_i^2. So at rest the model makes exactly the preset's thrust, and the
 * hover and thrust-to-weight stay. Then c_d,alpha such that the static torque is kappa x the thrust (their eq. 88).
 * tmaxMotor = one motor's full thrust at the nominal pack voltage, N; omegaMax = its rotor speed there, rad/s.
 */
function inflowOf(p: PresetJson, tmaxMotor: number, omegaMax: number, kappa: number): RotorInflow | null {
    if (p.fields.prop_pitch_in === undefined) return null;
    const radius = num(p, 'prop_diameter_mm') / 2000;
    const pitch = num(p, 'prop_pitch_in') * 0.0254;
    num(p, 'cda_vertical_inflow_cm2');
    const sigma = num(p, 'prop_solidity');
    const area = Math.PI * radius * radius;
    const theta = (INFLOW_PITCH_FACTOR * pitch) / (2 * Math.PI * radius);
    const tip = omegaMax * radius;
    // Gill and D'Andrea's normalisation: C_T = T / (1/2 rho A (Omega R)^2), C_Q = Q / (1/2 rho A (Omega R)^2 R)
    const ct = tmaxMotor / (0.5 * RHO * area * tip * tip);
    const lambdaI = Math.sqrt(ct / 4);
    if (!(theta > lambdaI)) throw new Error(`preset ${p.id}: prop_pitch_in too small for its static thrust (rotor inflow)`);
    const d = INFLOW_DELTA;
    // eq. 37-38 at rest (lambda = lambda_i, mu = 0): C_Q = C_T lambda_i + profile, with the profile's c_d,alpha unknown
    const cq = (kappa / radius) * ct;
    const prof0 = ((1 - d) * sigma * INFLOW_CD0 * (1 + d + d * d)) / 3;
    const cdAlpha = (cq - ct * lambdaI - prof0) / ((1 - d) * sigma * (lambdaI - theta) * (lambdaI - theta));
    if (!(cdAlpha >= 0)) throw new Error(`preset ${p.id}: motor_kappa_m too small for its prop's induced and profile torque (rotor inflow)`);
    return { a: ct / ((1 - d) * (theta - lambdaI)), theta, radius, area, sigma, cd0: INFLOW_CD0, cdAlpha };
}

/**
 * The motor model (MotorModel) of a preset with rotor inflow: Ke = 1 / Kv, and R such that at full output, nominal
 * voltage and rest the motor holds its prop's static torque (kappa x the full thrust) at the loaded speed:
 * Ke w_L = rpm_loaded_fraction V_nom, so R = Ke V_nom (1 - rpm_loaded_fraction) / Q_L.
 */
function motorOf(kv: number, rpmFrac: number, vNom: number, kappa: number, tmaxMotor: number): MotorModel {
    const ke = 1 / (kv * 0.10471975511965977);
    return { ke, r: (ke * vNom * (1 - rpmFrac)) / (kappa * tmaxMotor) };
}

/** Throttle-curve output (0..1) that hovers at nominal voltage: u = (1/sqrt(TWR_local) - idle) / (1 - idle). */
export function hoverThrottle(sp: SimParams): number {
    const twrLocal = (4 * sp.tmaxMotorNom) / (sp.mass * sp.gravity);
    if (twrLocal <= 0) return 0;
    return (1 / Math.sqrt(twrLocal) - sp.idle) / (1 - sp.idle);
}

/**
 * Hover motor output and stick including battery sag at the given state of charge
 * (fixed point of thrust -> current -> voltage). Returns NaN outputs if it cannot hover.
 * throttle = the mixer throttle; stick = the stick position giving it (v0.2 returned the curve
 * output as `stick`, which only matched while the curve was linear). In auto-throttle mode the
 * stick goes through the Sim's auto-throttle map instead of the curve: stick 0.5 is the hover of a
 * fresh pack (the Sim's default hoverThr), so a drained pack needs a little more.
 */
export function hoverSolve(sp: SimParams, soc = 1): { motor: number; share: number; throttle: number; stick: number; volts: number } {
    const h = solveHover(sp, soc);
    if (!(h.motor <= 1)) return { motor: NaN, share: NaN, throttle: NaN, stick: NaN, volts: h.volts };
    const throttle = (h.motor - sp.idle) / (1 - sp.idle);
    let stick: number;
    if (sp.gravityMode === 'auto-throttle') {
        const fresh = soc === 1 ? h : solveHover(sp, 1);
        stick = autoThrottleStick(throttle, (fresh.motor - sp.idle) / (1 - sp.idle));
    } else stick = invertThrottle(throttle, sp.throttle);
    return { motor: h.motor, share: h.share, throttle, stick, volts: h.volts };
}

/**
 * motor = the motor command (mixer output after idle) that hovers; share = the rotor speed then, as the Sim's motor state
 * holds it (a share of omegaMaxPerVolt x the pack voltage). Without a motor model the two are the same; with one
 * (MotorModel) the command is the duty that holds that speed against the prop's static torque.
 */
function solveHover(sp: SimParams, soc: number): { motor: number; share: number; volts: number } {
    const need = (sp.mass * sp.gravity) / 4; // N per motor
    const vOc = sp.cells * voc(soc);
    let v = vOc;
    let w = 0;
    for (let i = 0; i < 80; i++) {
        const tmax = sp.tmaxMotorNom * (v / sp.vNom) * (v / sp.vNom);
        w = Math.sqrt(need / tmax);
        const omega = w * sp.omegaMaxPerVolt * v;
        const current = (4 * sp.kappa * need * omega) / (sp.eta * v);
        v = vOc - current * sp.rPack;
    }
    const m = sp.motor;
    if (!m) return { motor: w, share: w, volts: v };
    // duty d with d V = Ke w + R Q / Ke, Q = kappa x the hover thrust (the prop's static torque)
    const omega = w * sp.omegaMaxPerVolt * v;
    return { motor: (m.ke * omega + (m.r * sp.kappa * need) / m.ke) / v, share: w, volts: v };
}

/**
 * Inverse of the Sim's auto-throttle map (stick 0..0.5 -> 0..hover, 0.5..1 -> hover..1, with the
 * hover throttle clamped to 0.02..0.98 as the Sim clamps it): the stick that gives mixer throttle t.
 */
export function autoThrottleStick(t: number, hover: number): number {
    const h = hover < 0.02 ? 0.02 : hover > 0.98 ? 0.98 : hover;
    const u = t <= h ? (0.5 * t) / h : 0.5 + (0.5 * (t - h)) / (1 - h);
    return u < 0 ? 0 : u > 1 ? 1 : u;
}
