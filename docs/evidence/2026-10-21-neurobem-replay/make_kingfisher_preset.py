# Writes packages/sim-core/presets/uzh-kingfisher-4s.json (run from the repo root).
import json
naz = json.load(open('packages/sim-core/presets/nazgulf5v3-6s.json', encoding='utf-8'))['fields']
AG = 'https://arxiv.org/abs/2307.06100'
NB = 'https://arxiv.org/abs/2106.08015'
KF = 'https://github.com/uzh-rpg/agile_flight/blob/main/envsim/parameters/quads/kingfisher.yaml'
LOG = 'NeuroBEM raw blackbox logs (https://rpg.ifi.uzh.ch/NeuroBEM.html), log header'
EV = 'docs/evidence/2026-10-21-neurobem-replay'
f = {}


def put(k, v, src, ref=None, note=None, **kw):
    d = {'value': v, 'source': src}
    if ref:
        d['ref'] = ref
    d.update(kw)
    if note:
        d['note'] = note
    f[k] = d


put('wheelbase_mm', 253, 'measured:UZH', KF, 'motor to motor across the diagonal, from the motor positions below (2 x sqrt(77.5^2 + 100^2))')
put('motor_forward_mm', 77.5, 'measured:UZH', KF, 'each motor ahead of / behind the centre (a stretched X on the Armattan Chameleon 6-inch frame)')
put('motor_lateral_mm', 100, 'measured:UZH', KF, 'each motor to the side of the centre')
put('motor', 'Hobbywing XRotor 2306 2400KV', 'manufacturer', AG, 'Agilicious Table 2: 23x6 mm stator, 2400 kV, 758 W, 27.5 g')
put('motor_kv', 2400, 'manufacturer', AG)
put('prop', 'Azure Power SFP 5148, 3-blade', 'manufacturer', AG, 'Agilicious Table 2: 5.1 inch, 4.8 inch pitch, 5 g')
put('prop_diameter_mm', 129.5, 'manufacturer', AG, '5.1 inch')
put('prop_solidity', 0.115, 'estimate', naz['prop_solidity']['ref'], "the Nazgul preset's estimate for 5-inch three-blade props; the 5148's chord is not published")
put('prop_pitch_in', 4.4, 'estimate', AG, "the prop is 4.8 inch pitch; the rotor inflow model's windmill curves (sim-core/0.8.0) take at most about 4.4 on a 5.1-inch prop, so 4.4; the thrust level is set by the hover fit (twr)")
put('dry_mass_g', 553, 'measured:UZH', NB, '752 g take-off weight minus the 199 g pack (the NeuroBEM website later gives 772 g; the logs were fitted with 752)')
put('battery', '4S 1800 mAh (Tattoo R-Line)', 'manufacturer', AG)
put('battery_cells', 4, 'manufacturer', AG)
put('battery_capacity_mah', 1800, 'manufacturer', AG)
put('battery_mass_g', 199, 'manufacturer', AG)
put('auw_g', 752, 'measured:UZH', NB, 'NeuroBEM paper section IV; includes the Jetson TX2 compute unit (154 g)')
put('twr', 4.6, 'measured:UZH', NB, "fitted so the model hovers at the logs' median 11 100-11 500 rpm (DShot rpm telemetry): 11 400 rpm; the model's static thrust is then 31.6 N, the paper's 'approximately 33 N' (4.5)", min=4.3, max=4.8)
put('inertia_roll_pitch_kgm2', 0.0023, 'measured:UZH', KF, 'mean of roll and pitch (the per-axis values below are the ones used)')
put('inertia_roll_kgm2', 0.0025, 'measured:UZH', KF, '"identified from the real platform" (NeuroBEM paper section V)')
put('inertia_pitch_kgm2', 0.0021, 'measured:UZH', KF)
put('inertia_yaw_kgm2', 0.0043, 'measured:UZH', KF)
put('motor_tau_ms', 17, 'estimate', None, 'classic physics only; with rotor inflow the motor model spools in 23-24 ms (63 %), as measured on this quad (24-32 ms rise, 20-26 fall after 4 ms dead time, ' + EV + ')', min=10, max=30)
put('motor_kappa_m', 0.022, 'measured:UZH', KF, "kappa 0.022 N m / N (torque / thrust) in UZH's model of this quad; higher than the Nazgul's 0.0136, with its 4.8-inch pitch")
put('motor_idle', 0.055, 'measured:UZH', LOG, 'dshot_idle_value 550')
put('rates', {'type': 'BETAFLIGHT', 'roll': [220, 0, 0], 'pitch': [220, 0, 0], 'yaw': [204, 0, 0], 'rate_limit': 1998}, 'measured:UZH', LOG, 'rc_rates 220/220/204, rates 0, rc_expo 0, rates_type BETAFLIGHT: linear, 440 deg/s on roll and pitch at full stick')
put('pid_roll', [40, 80, 20, 0], 'measured:UZH', LOG, 'Betaflight 4.2.0 P, I, D, F (feedforward_weight 0)')
put('pid_pitch', [40, 80, 20, 0], 'measured:UZH', LOG)
put('pid_yaw', [30, 60, 0, 0], 'measured:UZH', LOG)
for k in ['rpm_loaded_fraction', 'cda_horizontal_cm2', 'cda_vertical_cm2', 'cda_vertical_inflow_cm2', 'collider_duct_radius_mm',
          'collider_duct_offset_mm', 'collider_body_radius_mm', 'v_bounce_ms', 'v_crash_ms', 'pack_resistance_per_cell_ohm',
          'efficiency', 'camera_uptilt_deg', 'camera_fov_deg', 'throttle', 'rotor_drag_per_s', 'rotor_inertia_kgm2', 'wake_loss', 'wake_shake']:
    d = dict(naz[k])
    if d['source'] != 'bf-default':
        d['source'] = 'estimate'
    d['note'] = ('as the Nazgul preset (a 5-inch quad of the same class). ' + d.get('note', '')).strip()
    f[k] = d
f['rotor_inertia_kgm2']['note'] = 'as the Nazgul preset; with it the model spools in 23-24 ms (63 %), as measured on this quad (' + EV + ')'
p = {'id': 'uzh-kingfisher-4s', 'name': 'UZH Kingfisher research quad (NeuroBEM / Agilicious), 4S', 'class': '5-inch research quad',
     'notes': "The University of Zurich Robotics and Perception Group's 5-inch quad of the NeuroBEM and Agilicious papers: an Armattan "
              "Chameleon 6-inch frame with 5.1-inch props and a Jetson TX2 on board. Geometry, inertia, hover thrust and its Betaflight tune "
              "come from UZH's published model and logs; with them the simulator reproduces its logged flights (step response 26 / 22 ms "
              "against the real 28 / 22, " + EV + "). Aerodynamic drag and collision are the Nazgul preset's estimates. Nothing here is "
              "endorsed by UZH.",
     'fields': f}
json.dump(p, open('packages/sim-core/presets/uzh-kingfisher-4s.json', 'w', encoding='utf-8', newline='\n'), indent=2, ensure_ascii=False)
print(len(f), 'fields')
