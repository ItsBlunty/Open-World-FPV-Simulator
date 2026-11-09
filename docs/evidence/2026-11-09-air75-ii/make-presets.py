# Writes the three Air75 II presets (packages/sim-core/presets/air75ii-*.json) from one table, so the shared
# frame, prop, battery and derivation notes stay identical and only the per-version numbers differ.
# Run from the repo root: python docs/evidence/2026-11-09-air75-ii/make-presets.py
import json
import math
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
OUT = os.path.join(ROOT, 'packages', 'sim-core', 'presets')

PRODUCT = 'https://betafpv.com/products/air75-ii-brushless-whoop-quadcopter'
MOTOR = 'https://betafpv.com/products/0802-brushless-motors-2026'
PROP = 'https://betafpv.com/products/gemfan-1614-3-blade-propellers-1-0mm-shaft'
FRAME = 'https://betafpv.com/products/air75-ii-brushless-whoop-frame'
BATT = 'https://betafpv.com/products/lava-ii-1s-battery'
CLI = 'https://support.betafpv.com/hc/en-us/articles/54653618858521-CLI-and-Firmware-for-Air75-II'
CAM = 'https://betafpv.com/products/c03-fpv-micro-camera'
CANOPY = 'https://www.getfpv.com/accessories-390/parts-hardware/betafpv-air-ii-canopy.html'
FAESSLER = 'https://arxiv.org/abs/1712.02402'

BATT_G = 12.6
KAPPA = 0.0075

# Per version. bench: BetaFPV's load-performance table of the 0802 (2026) on the GF 1614-3P (the motor page's image
# 0802_Brushless_Motors_2026_load_performance.jpg) at 100 %, 70 % and 50 % throttle: (V, A, g, W, rpm).
VERSIONS = {
    'freestyle': dict(
        name='Freestyle', kv=22000, motor_g=1.88, bearing='brass bushings', dry_g=21.3, flight='7:30',
        bench100=(3.86, 5.90, 47.7, 22.73, 43292), bench70=(3.89, 3.18, 29.9, 12.36, 34253), bench50=(3.91, 1.87, 18.0, 7.31, 26640),
        winding_r=0.24, kv_eff=17670, eta=0.67, rpm_frac=0.51, duct_drag=0.91,
        idle=0.055, idle_src='bf-default', idle_note="BetaFPV's CLI sets no motor_idle, so Betaflight 2026.6's default 550 (5.5 %, src/main/pg/motor.c)",
        rates=dict(roll=[7, 75, 10], pitch=[7, 75, 10], yaw=[7, 70, 5]),
        rates_note="BetaFPV's CLI (2026.6.0, 20260515): ACTUAL rates (Betaflight's default type), centre sensitivity 70 deg/s (rc_rate 7, the default), max 750 / 750 / 700 deg/s (roll_srate 75, pitch_srate 75, yaw_srate 70), expo 0.10 / 0.10 / 0.05",
        pid=dict(roll=[33, 60, 21, 35], pitch=[33, 59, 21, 35], yaw=[33, 60, 0, 35]),
        pid_note="BetaFPV's CLI (2026.6.0, 20260515), profile 'GF 1614': P, I, D, F. Betaflight 2026's d_roll is the D flown at rest (4.5's d_min); its d_max 23 / 24, anti_gravity_gain 60 and TPA 60 % from 1220 are not modelled",
        thr=dict(mid=50, expo=0), thr_src='bf-default', thr_note="BetaFPV's CLI leaves Betaflight's default curve: thr_mid 50, thr_expo 0, thr_hover 50 (a straight line)",
        use="BetaFPV's version for a first whoop and smooth indoor flying",
    ),
    'racing': dict(
        name='Racing', kv=25000, motor_g=1.88, bearing='brass bushings', dry_g=20.9, flight='7:00',
        bench100=(3.82, 8.15, 55.0, 31.15, 46481), bench70=(3.87, 4.56, 36.8, 17.65, 37678), bench50=(3.90, 2.70, 22.9, 10.53, 29812),
        winding_r=0.20, kv_eff=21070, eta=0.62, rpm_frac=0.49, duct_drag=0.92,
        idle=0.06, idle_src='manufacturer', idle_note="BetaFPV's CLI (2026.6.0, 20260515): motor_idle 600",
        rates=dict(roll=[7, 58, 0], pitch=[7, 58, 0], yaw=[7, 50, 0]),
        rates_note="BetaFPV's CLI (2026.6.0, 20260515): ACTUAL rates (Betaflight's default type), centre sensitivity 70 deg/s (rc_rate 7, the default), max 580 / 580 / 500 deg/s (roll_srate 58, pitch_srate 58, yaw_srate 50), no expo",
        pid=dict(roll=[35, 76, 21, 43], pitch=[31, 68, 25, 38], yaw=[35, 76, 0, 43]),
        pid_note="BetaFPV's CLI (2026.6.0, 20260515), profile 'GF 1614': P, I, D, F. Betaflight 2026's d_roll is the D flown at rest (4.5's d_min); its d_max 24 / 29, anti_gravity_gain 50, iterm_relax_cutoff 25 and TPA 60 % from 1180 are not modelled",
        thr=None, bf_thr=(28, 25, 17),
        use="BetaFPV's version for technical gate courses",
    ),
    'champion': dict(
        name='Champion', kv=28000, motor_g=1.95, bearing='dual ball bearings', dry_g=20.2, flight='6:50',
        bench100=(3.81, 9.00, 58.2, 34.30, 47888), bench70=(3.86, 5.16, 38.5, 19.94, 38552), bench50=(3.89, 3.06, 24.2, 11.91, 30500),
        winding_r=0.18, kv_eff=21870, eta=0.60, rpm_frac=0.45, duct_drag=0.93,
        idle=0.035, idle_src='manufacturer', idle_note="BetaFPV's CLI (2026.6.0, 20260515): motor_idle 350",
        rates=dict(roll=[7, 58, 0], pitch=[7, 58, 0], yaw=[7, 50, 0]),
        rates_note="BetaFPV's CLI (2026.6.0, 20260515): ACTUAL rates (Betaflight's default type), centre sensitivity 70 deg/s (rc_rate 7, the default), max 580 / 580 / 500 deg/s (roll_srate 58, pitch_srate 58, yaw_srate 50), no expo",
        pid=dict(roll=[33, 60, 22, 31], pitch=[33, 59, 22, 31], yaw=[33, 60, 0, 31]),
        pid_note="BetaFPV's CLI (2026.6.0, 20260515), profile 'GF 1614': P, I, D, F. Betaflight 2026's d_roll is the D flown at rest (4.5's d_min); its d_max 24 / 25, anti_gravity_gain 50, iterm_relax_cutoff 24 and TPA 60 % from 1160 are not modelled",
        thr=None, bf_thr=(25, 45, 16),
        use="BetaFPV's version for maximum acceleration in races",
    ),
}

# Numbers the derivation settles (derive.md): the thrust-to-weight fixed point at the model's own loaded voltage, the
# two-parameter fit of Betaflight 2026's throttle curve, and the drag areas that give the top speed. Filled in by hand
# from the probe's output (probe.test.ts).
DERIVED = {
    'freestyle': dict(twr=4.6, thr=dict(mid=50, expo=0), thr_fit_err=None),
    'racing': dict(twr=5.0, thr=dict(mid=1, expo=32), thr_fit_err=3.0),
    'champion': dict(twr=5.1, thr=dict(mid=2, expo=38), thr_fit_err=1.2),
}
CDA_V_CLASSIC = 70
CDA_V_INFLOW = 40
PACK_R = 0.035


def f(value, source, ref=None, note=None, lo=None, hi=None):
    d = {'value': value, 'source': source}
    if ref:
        d['ref'] = ref
    if note:
        d['note'] = note
    if lo is not None:
        d['min'] = lo
    if hi is not None:
        d['max'] = hi
    return d


def preset(key):
    v = VERSIONS[key]
    dv = DERIVED[key]
    V, A, G, W, RPM = v['bench100']
    auw = round(v['dry_g'] + BATT_G, 1)
    ideal_drag = round(math.sqrt(9.81 * 1.225 * 4 * math.pi * 0.02 ** 2 / (auw / 1000)), 2)
    if v['thr']:
        thr, thr_src, thr_note = v['thr'], v['thr_src'], v['thr_note']
    else:
        m, e, h = v['bf_thr']
        thr, thr_src = dv['thr'], 'estimate'
        err = f", largest difference {dv['thr_fit_err']} % of throttle" if dv['thr_fit_err'] is not None else ''
        thr_note = (f"BetaFPV's CLI (2026.6.0, 20260515) sets Betaflight 2026's three-point curve: thr_mid {m}, thr_expo {e}, thr_hover {h} "
                    f"(the stick at {m} % gives {h} % throttle, then a steeper rise to full; src/main/fc/rc.c generateThrottleCurve). The simulator has "
                    f"Betaflight 4.5's two-parameter curve, which cannot pass under the diagonal: this mid / expo is its least-squares fit{err} "
                    f"(docs/evidence/2026-11-09-air75-ii/derive.md)")
    fields = {
        'wheelbase_mm': f(75, 'manufacturer', FRAME, 'motor to motor, corner to corner (a true X: the motors sit on a 53 mm square)'),
        'motor': f(f"BetaFPV 0802 (2026) {v['name']} {v['kv']}KV, {v['bearing']}, {v['motor_g']} g", 'manufacturer', MOTOR),
        'motor_kv': f(v['kv'], 'manufacturer', MOTOR),
        'prop': f('Gemfan 1614 3-blade (GF 1614-3P), 40 mm x 1.4 in, polycarbonate, 0.24 g', 'manufacturer', PROP),
        'prop_diameter_mm': f(40, 'manufacturer', PROP, '1.6 inch (the duct is 42.0 mm inside)'),
        'prop_pitch_in': f(1.4, 'manufacturer', PROP, '1614: 1.6 x 1.4; the rotor inflow model takes its blade angle from the pitch'),
        'dry_mass_g': f(v['dry_g'], 'manufacturer', PRODUCT, 'without the battery (BetaFPV: Champion 20.2 g, Racing 20.9 g, Freestyle 21.3 g)'),
        'battery': f('BetaFPV LAVA II 1S 480 mAh LiHV, 95C, BT2.0', 'manufacturer', BATT, "the pack of BetaFPV's flight-time figure; the 580 mAh LAVA II (about 15 g) is the other recommended pack"),
        'battery_cells': f(1, 'manufacturer', BATT, 'LiHV: 4.35 V full. The model charges its cell to 4.20 V (sim-core params.ts voc), so a fresh pack here starts 0.15 V down on the real one'),
        'battery_capacity_mah': f(480, 'manufacturer', BATT),
        'battery_mass_g': f(BATT_G, 'manufacturer', BATT, '61 x 15.5 x 6 mm'),
        'auw_g': f(auw, 'manufacturer', PRODUCT, f"{v['dry_g']} g dry + {BATT_G} g pack; Oscar Liang weighed the original Air75 at 33.5 g with a 450 mAh pack"),
        'twr': f(dv['twr'], 'manufacturer', MOTOR, lo=round(dv['twr'] * 0.85, 1), hi=round(dv['twr'] * 1.15, 1),
                 note=(f"BetaFPV's bench of this motor on the GF 1614-3P: {G} g at 100 % throttle, {A} A, {W} W, {RPM} rpm at {V} V (a supply, not a sagging pack). "
                       f"In flight the pack sags under four such motors: the thrust is scaled by (V_loaded / {V})^2 to the model's own full-throttle voltage "
                       f"(a fixed point with the pack resistance below), then x4 / {auw} g. The duct's share (BetaFPV: 11 % more thrust than the Air75's duct) is not known and not added")),
        'inertia_roll_pitch_kgm2': f(1.45e-5, 'estimate', note=(
            'sum of parts about the centre of mass: 4 motors + props (2.12 g each) at 26.5 mm on each axis (6.0e-6), the 4.0 g frame as four duct rings of 23 mm round them (3.7e-6), '
            'the 12.6 g pack lying 61 mm long on top (pitch 5.2e-6, roll 1.6e-6), FC, camera and canopy (pitch 2.1e-6, roll 0.6e-6): roll 1.2e-5, pitch 1.7e-5; one value for both, their mean')),
        'inertia_yaw_kgm2': f(2.6e-5, 'estimate', note='sum of parts: motors and props 1.2e-5, duct rings 7.4e-6, pack 4.2e-6, FC, camera and canopy 2.2e-6'),
        'motor_tau_ms': f(25, 'estimate', lo=15, hi=35, note=(
            f"J / (Kt^2 / R + 2 Q0 / w0) with J 3.5e-8 (prop and bell), Kt 60 / (2 pi {v['kv']}), R {v['winding_r']} ohm fitted to the bench's speed against current at 50 and 100 % throttle "
            f"(the motor turns {v['kv_eff']} rpm per volt left after the resistive drop), and the hover torque and speed: 25-27 ms. The same formula gave 9 ms for a 2207 whose log showed 17-18 ms, so this may be short; no Air75 II log yet")),
        'motor_kappa_m': f(KAPPA, 'estimate', MOTOR, lo=0.006, hi=0.013, note=(
            "reaction torque / thrust. From the bench's input power less copper (I^2 R) and iron losses: 0.0064 m at full throttle, 0.0078 at 80 %, 0.012 at 50 % (a 40 mm prop at Reynolds numbers of 10-20 k loses more torque the slower it turns); "
            "one value from the 70-100 % band, where the current sets the sag. With efficiency below, kappa / efficiency reproduces the bench's input power at 70-100 % throttle")),
        'motor_idle': f(v['idle'], v['idle_src'], CLI, v['idle_note']),
        'rpm_loaded_fraction': f(v['rpm_frac'], 'manufacturer', MOTOR, (
            f"BetaFPV's bench: {RPM} rpm at 100 % throttle and {V} V = {round(RPM / (v['kv'] * V), 2)} of KV x V (the 3-blade 40 mm prop loads the motor hard); "
            f"the model holds this fraction at every throttle, the real motor turns faster per volt at low throttle (bench: {v['bench50'][4]} rpm at 50 %, {round(v['bench50'][4] / RPM, 2)} of full)")),
        'cda_horizontal_cm2': f(22, 'estimate', note='side-on: the 99 x 16 mm frame, the pack end-on, canopy and camera, four motors, about 20 cm^2 at Cd 1.1'),
        'cda_vertical_cm2': f(CDA_V_CLASSIC, 'estimate', note='classic physics only: stands in for the props unloading at speed; set so the level top speed is about 60 km/h (no published figure; Oscar Liang estimates about 85 km/h for the more powerful Meteor75 Pro II)'),
        'cda_vertical_inflow_cm2': f(CDA_V_INFLOW, 'estimate', note='the frame seen from above outside the four prop discs: duct walls and braces, FC, pack and canopy, about 35 cm^2 at Cd 1.1; with rotor inflow the props unload at speed themselves'),
        'collider_duct_radius_mm': f(23, 'manufacturer', FRAME, 'the duct: 42.0 mm inside, 2 mm wall, so the frame is 99.1 mm over the ducts (26.5 + 23 = 49.5 mm from the centre on each axis)'),
        'collider_duct_offset_mm': f(26.5, 'manufacturer', FRAME, 'wheelbase / 2 / sqrt 2: each duct sphere on its motor'),
        'collider_body_radius_mm': f(25, 'estimate', note='FC, pack and canopy in the middle; the quad rests 25 mm above the ground on it (the real frame is 16.2 mm tall)'),
        'v_bounce_ms': f(1.5, 'estimate'),
        'v_crash_ms': f(4.0, 'estimate', note='as the 65 mm whoop presets'),
        'pack_resistance_per_cell_ohm': f(PACK_R, 'estimate', lo=0.025, hi=0.05, note=(
            "the 480 mAh 1S LiHV pack with its BT2.0 connector and the board's wiring: no measured figure found. Whoop pilots see a fresh pack fall from 4.35 V to about 3.3-3.5 V on a full punch of 25-35 A, "
            "which is 25-40 mOhm; BetaFPV rates the pack 95C (45 A). The sag is what sets this preset's thrust-to-weight (see twr)")),
        'efficiency': f(v['eta'], 'estimate', MOTOR, note=(
            f"the model's electrical efficiency, set so kappa / efficiency = {round(KAPPA / v['eta'], 4)} reproduces the bench's input power at 70-100 % throttle ({v['bench70'][3]} W at 70 %, {W} W at 100 %). "
            f"At hover the real motors draw about twice what the model does (the 40 mm prop's torque per thrust rises as it slows), so with Battery simulation on the model's hover lasts too long")),
        'flight_time': f(f"{v['flight']} on the LAVA II 1S 480 mAh (BetaFPV)", 'manufacturer', PRODUCT, 'Oscar Liang flew the original Air75 5:30-6:00 on a 450 mAh pack'),
        'camera_uptilt_deg': f(25, 'estimate', CANOPY, "the Air II canopy holds the C03 at 15-45 deg in 10 deg steps; the game's Settings > Camera sets the angle, this is only the preset's default"),
        'camera_fov_deg': f(125, 'manufacturer', CAM, 'C03: 160 deg field of view on a 4:3 sensor (2.1 mm lens), so about 125-130 deg across; the game draws its own lens'),
        'rates': f(dict(type='ACTUAL', rate_limit=1998, **v['rates']), 'manufacturer', CLI, v['rates_note']),
        'pid_roll': f(v['pid']['roll'], 'manufacturer', CLI, v['pid_note']),
        'pid_pitch': f(v['pid']['pitch'], 'manufacturer', CLI),
        'pid_yaw': f(v['pid']['yaw'], 'manufacturer', CLI),
        'throttle': f(thr, thr_src, CLI, thr_note),
        'rotor_drag_per_s': f(v['duct_drag'], 'estimate', FAESSLER, lo=0.6, hi=1.36, note=(
            f"rotor and duct momentum drag at hover rotor speed: momentum theory sqrt(g rho A_rotors / m) = {ideal_drag} 1/s, "
            "x 0.68 as the Air65 preset (the share the Pavo20 Pro's blackbox coast-down gave of its ideal)")),
        'rotor_inertia_kgm2': f(3.5e-8, 'estimate', lo=2.5e-8, hi=5e-8, note='the 0.24 g prop (blades 0.15 g from 2.5 to 20 mm: 1.9e-8) + the 0802 bell, magnets and shaft (about 0.85 g at 4.3 mm: 1.6e-8); drives the yaw reaction to motor speed changes'),
        'wake_loss': f(0.25, 'estimate', lo=0, hi=0.5, note="share of thrust lost at the worst point of a descent through the rotors' own wake (vortex-ring band of momentum theory); the Nazgul's estimate, whoops are known for it"),
        'wake_shake': f(0.3, 'estimate', lo=0, hi=0.6, note="turbulent roll/pitch torque in the wake, as a share of one rotor's thrust times the arm; the Nazgul's estimate"),
    }
    return {
        'id': f'air75ii-{key}-1s',
        'name': f"BetaFPV Air75 II {v['name']}, 1S",
        'class': '75 mm brushless tiny whoop',
        'notes': (f"BetaFPV's Air75 II in its {v['name']} version ({v['kv']}KV 0802 motors): {v['use']}. Frame, motors, prop, battery, weights and camera from BetaFPV's pages (read 2026-11-09); "
                  f"thrust, current, power and speed at every throttle step from BetaFPV's own bench of this motor on this prop (the 0802 (2026) page); rates, PIDs, idle and throttle curve from "
                  f"BetaFPV's CLI file for this version (Betaflight 2026.6.0, 20260515). Inertia, motor lag, kappa, drag and pack resistance are estimates from those parts "
                  f"(docs/notes/physics.md section 2w, docs/evidence/2026-11-09-air75-ii). Nothing here is endorsed by BetaFPV."),
        'fields': fields,
    }


if __name__ == '__main__':
    for key in VERSIONS:
        p = preset(key)
        path = os.path.join(OUT, p['id'] + '.json')
        with open(path, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(p, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        print('wrote', os.path.relpath(path, ROOT))
