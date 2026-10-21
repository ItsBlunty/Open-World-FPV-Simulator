# Physics review

Milestone M2 (`SPEC.md` R2), reviewed 2026-10-18 at sim-core/0.5.0 with the default drone `nazgulf5v3-6s`.
Part 1 is the review; part 2 keeps the findings recorded earlier (F1-F5), most of them fixed since.

Scope: `packages/sim-core/src/sim.ts`, `params.ts`, `wake.ts`, `wind.ts`. Every number below was read from the
code or measured with a Node probe of the model (fresh pack, still air, no world):
`docs/evidence/2026-10-18-physics-review/probe.test.ts`, output in `probe-output.txt` next to it.
Ratings: **A** = the textbook result, **B** = right shape, values estimated, **C** = a stand-in for a different
effect, **-** = not modelled. Claims marked "(to read)" are textbook knowledge not yet re-read from the primary
source; each is read in full before anything is built on it (CLAUDE.md).

**Owner's decisions (2026-10-18):** no blackbox logs for now (fitting the preset to real logs, G3, waits until
logs are available); the first improvement is the airflow fix, G1.

## 1. What the model does, effect by effect

| # | Effect | Equation in the code | Source of values | Rating | Impact on feel |
|---|---|---|---|---|---|
| 1 | Rotor thrust | T = Tmax(V) w^2, w = motor speed 0..1, Tmax proportional to V^2 | TWR 8 (estimate from bench tables) | B | High |
| 2 | Motor response | first-order lag on w, tau 17 ms, the same up and down | estimate from motor constants | B | High |
| 3 | Yaw torque | kappa T per motor + rotor spin-up reaction J_r dOmega/dt | kappa, J_r estimates | B | Medium |
| 4 | Battery | Voc(SoC) in straight pieces 4.2/3.7/3.3 V, sag = I R, I from shaft power / eta | R, eta estimates; hover current checked against iFlight's hover time | B | Low-medium |
| 5 | Body drag | 1/2 rho CdA abs(v) v per body axis, CdA 200 / 430 / 200 cm^2 | estimates; **the vertical 430 is set to cap the top speed** | C (vertical) | High |
| 6 | Rotor drag (in the rotor plane) | -k (rotor speed) v_inplane (Faessler et al. 2018) | 0.51 1/s from momentum theory x the measured share | A-B | Medium |
| 7 | Prop wash | thrust x (1 - loss k), random roll/pitch torque, k a bump over v_descent / v_induced | momentum theory's band; loss and shake estimates | B | Medium |
| 8 | Rigid body | Newton + Euler through the world angular momentum, semi-implicit, 1 ms | textbook | A | - |
| 9 | Inertia | diagonal 1.6e-3 / 2.8e-3 / 1.6e-3 kg m^2 | estimate, sum of parts | B | High |
| 10 | Flight controller | Betaflight 4.5.1 rate PID, FF, I-relax, dynamic I, airmode, filters, angle/horizon | re-implemented from Betaflight's formulas; rates checked to 0 error | A-B | High |
| 11 | Gyro | a perfect sensor, then Betaflight's 250/500 Hz lowpass | - | B | Low |
| 12 | Contacts | sphere colliders, all contacts solved together, Coulomb friction mu 0.4; restitution 0.53 falling with speed (sides, props, top; measured at 1.85 m/s), 0.1-0.35 (underside) | this project; one measured rigid-quad wall test; F1-F6 below | B | Medium |
| 13 | Prop strikes, turtle | no thrust when a surface covers the intake; a prop edge-on to a surface stalls (5 ms brake); reverse thrust 0.73 | estimate; one 7" thrust-stand test | B-C | Low |
| 14 | Wind | mean + seeded gusts + height gradient, acting through the drag | estimate | B | (off in the game) |

Measured from the model (Nazgul, `probe-output.txt`):

| Test | Result |
|---|---|
| Hover throttle, full pack | 24.8 % motor output (research notes) |
| Full-throttle climb from a hover | 39.7 m/s after 1 s, peak 43.1 m/s, then slowly less as the pack sags |
| Flat fall, throttle down (airmode idle) | terminal 16.2 m/s, reached in about 4 s |
| Nose-down vertical dive, throttle down | terminal 21.5 m/s |
| Full throttle held 60 deg from vertical | 44.8 m/s (161 km/h) |
| Roll step response | t63 15 ms, 670 deg/s (research notes) |

## 2. Findings of the review

### G1. Thrust does not depend on the air coming through the props (the biggest gap)
**Now:** a prop makes the same thrust whether the quad hovers, climbs at 40 m/s or flies forward at 150 km/h. To
keep the top speed sane, the preset gives the vertical axis a large drag area (430 cm^2, twice the side area); the
preset says so itself: "stands in for the props unloading at speed, which the model does not have".

**Real** (to read: momentum and blade-element theory): climbing along the thrust axis, the air arrives faster, the
blades' angle of attack falls and the thrust drops, to near zero around the prop's pitch speed (a 5.1x3.5 at about
30 800 loaded rpm: about 46 m/s); moving sideways, a rotor makes more thrust for the same rpm at moderate speed
(translational lift); at high forward speed the tilted quad pushes into its own airflow and the thrust falls again;
falling flat with the throttle down, the props windmill and brake.

**In the sim:** one body-drag number cannot do all of these. Drag grows with speed^2, so the model keeps most of its
push until near the top speed and then meets a wall; a real quad's push fades earlier and more gradually. Punch-outs
reach 40 m/s in one second. The same 430 cm^2 stops a flat fall at 16 m/s; that may be roughly right by coincidence
(idle props brake a fall), but the model cannot tell a fall with spinning props from one with stopped props.

**Feel:** high: punch-outs, the throttle that holds altitude in fast forward flight, how a dive carries speed, how
the quad catches after a dive.

**Improvement:** a per-rotor inflow model. Each prop sees the air velocity at its own hub (body velocity + rotation x
arm - wind), split into axial and in-plane parts, and its thrust follows a standard propeller model; the vertical
drag area goes back to the frame's own. It brings for free rotor damping (the dropping side's prop gets more inflow
and more thrust, which resists a roll) and a physical base for
prop wash (G4). Effort: medium-high. **Chosen by the owner as the first improvement (2026-10-18).**

**Built: sim-core/0.6.0 (2026-10-18).** `Sim.inflowThrust`: blade-element thrust (Gill and D'Andrea 2019, "Computationally
Efficient Force and Moment Models for Propellers in UAV Forward Flight Applications", Drones 3(4):77, eq. 27, parameters
from the static thrust and the prop pitch, their Section 4) with Glauert's momentum theory for the induced inflow,
solved by bisection per prop per tick; the air at each hub includes the body rotation (rotor damping). Nazgul only
(`prop_pitch_in` 3.5, `cda_vertical_inflow_cm2` 150, owner's choice); Settings > Physics > "Classic physics" flies the
0.5.0 model bit for bit (the self-test keeps `cd45c59c…` with it).

*Checked on measured flight:* NeuroBEM (Bauersfeld et al., RSS 2021): 75 min of a 772 g 5-inch quad with every motor's
speed logged (`docs/evidence/2026-10-18-rotor-inflow/`). Measured thrust / (thrust from rotor speed alone), median:

| | climb 2-4 m/s | climb 6-9 m/s | sink 2-4 m/s | forward 6-8 m/s | forward 12-15 m/s | thrust RMSE |
|---|---|---|---|---|---|---|
| measured | 0.961 | 0.905 | 1.046 | 1.051 | 1.125 | - |
| Gill and D'Andrea closed form (eq. 69) | 0.942 | 0.885 | 1.055 | 1.015 | 1.027 | 0.877 N |
| **built: Glauert momentum theory** | 0.936 | 0.867 | 1.071 | 1.070 | 1.109 | **0.713 N** |
| thrust from rotor speed alone (classic) | 1 | 1 | 1 | 1 | 1 | 1.173 N |

The closed form misses most of the forward-flight gain, so Glauert's form was built. The best-fitting pitch for
NeuroBEM's prop is 3.5 in (a plausible 5-inch race prop), so predicting the blade angle from the pitch works.

*The Nazgul now* (`sim-probe-output.txt`; classic in brackets): hover unchanged; full-throttle climb 24.2 m/s after
0.5 s (27.7), top 37.4 (43.1); punch held 75 deg from vertical tops at 40.4 m/s, 145 km/h (45.6); level top speed
134 km/h (150); a flat drop with the throttle cut 26.4 m/s after 6 s (16.2); a nose-down dive unchanged (21 m/s).

*Left open:* (1) **flat drops are faster**: the classic 430 cm^2 also braked falls; the props' own braking at idle is
outside every source (blades stalled; NeuroBEM sinks only to 6 m/s), so it is not modelled (the ratios are held at 0.3,
the edge of Gill and D'Andrea's wind-tunnel data). For the owner to judge by flying. (2) The rotor speed stays at its
loaded value: real props unloading at speed spin faster, so the top speed is a little low. (3) Yaw torque and battery
power still follow the still-air thrust. (4) Sinking at 4-6 m/s the model makes 7-10 % more thrust than measured: the
vortex-ring loss, which prop wash (wake.ts) adds in the sim.

### G2. Rotor drag acts at the centre of mass, not at the props (blade flapping)
**Now:** the in-plane rotor drag (item 6) is a force through the centre of mass, so it never turns the quad.
**Real:** it acts at the rotor plane, and blade flapping tilts each rotor's thrust back against the airflow; together
they make a pitching and rolling moment in fast flight (to read: Faessler et al. 2018, which the preset cites).
**Feel:** low-medium; the PID cancels most of it, but it costs motor headroom. Effort: low once G1 exists.

### G3. The preset's main numbers are estimates (TWR, inertia, motor lag, kappa)
They matter more to feel than any missing effect: acceleration, how fast the quad flips, how crisp the throttle is.
- TWR 8: bench data gives 9.5 static, less with sag. Plausible.
- Inertia 1.6e-3 roll/pitch, 2.8e-3 yaw. The first version of this review guessed from a rough parts check that they
  may be 20-50 % high; **that was wrong**: NeuroBEM's measured 772 g 5-inch quad (a heavier build on a 6-inch frame with
  a computer on board) has 2.5e-3 / 2.1e-3 roll/pitch and 4.3e-3 yaw (its dataset readme). The preset is not shown to
  be high; it may be a little low. Left as it is.
- Motor tau 17 ms, the same up and down. NeuroBEM identified 33 ms on its 2306 motors from step responses (paper,
  Section IV-D): a real 5-inch value, about twice the preset's. The owner chose to leave 17 ms (2026-10-18).

**Improvement:** fit them to a real quad's Betaflight blackbox log: a hover gives TWR and sag, throttle steps with
bidirectional DShot eRPM give tau, flips with motor outputs give inertia. **Waiting for logs (owner, 2026-10-18).**

### G4. Prop wash is an empirical bump
The thrust-loss band follows momentum theory's vortex-ring region, the right idea; its depth (25 %) and shake (30 %)
are guesses, and the shake is random noise, not tied to which rotor is in the wake. **Feel:** medium (dives, power
loops). **Improvement:** after G1, the wash per rotor from that rotor's own inflow; depth and shake tuned by flying.

### G5. No ground or ceiling effect
**Real:** near the ground a rotor makes more thrust for the same power (Cheeseman and Bennett 1955, to read), fading
within about two diameters (about 25 cm for a 5"); under a ceiling the rotors are pulled towards it (to research).
**Feel:** low in the open, noticeable in the bando. Effort: low (a distance query per prop; the contact world has it).

### G6. Contacts
Solved for now (F1-F6 below; the owner: "okay for now"). Still open: friction is a guess (mu 0.4 on every surface);
restitution is measured at one speed only (F6); frames are rigid (F3); a real prop strike also kicks the quad sideways
(the brake is built since 0.7.0, F6, the kick is not).

### G7. Sensor and controller timing
The PID loop runs at 1 kHz with a perfect gyro; real flight controllers usually run faster, with a noisy gyro, RPM
filters and notches (to confirm in Betaflight's docs). The filter delays are modelled, the noise is not; no DShot or
ESC latency. **Feel:** low.

### G8. Smaller items, all low impact
Rotor gyroscopic coupling; the LiPo curve (straight pieces, fixed resistance, no heating); air density fixed at sea
level and 15 deg C; motor speed linear in the command (real ESCs are a little non-linear); motor and ESC heat.

## 3. Improvements ranked by impact and effort

| Rank | What | Feel impact | Effort | Needs |
|---|---|---|---|---|
| 1 | G1: per-rotor inflow thrust (with rotor damping; every prop sees the same airspeed, so no front/rear difference: that needs the front props' wake on the rear ones, not modelled); vertical CdA back to the frame's | High | Medium-high | **built, sim-core/0.6.0** |
| 2 | G3: fit the Nazgul preset to blackbox data (TWR, tau, inertia, hover) | High | Low (code) | the owner's logs (later) |
| 3 | G4: prop wash per rotor on top of G1 | Medium | Low-medium | G1 |
| 4 | G2: rotor drag at the rotor plane / flapping moment | Low-medium | Low | G1 |
| 5 | G5: ground and ceiling effect | Low-medium (bando) | Low | - |
| 6 | G6-G8 | Low | varies | the owner asking |

Every model change bumps `SIM_CORE_VERSION`, changes the trace hashes, needs tests, and needs the owner to fly it.

## Findings recorded before the review (M0-M1)

### F1. A near-level impact on a flat surface becomes a lopsided one (found 2026-10-17, M0)

**What happens.** sim-core resolves one contact point per 1 ms step (`Sim.contact` in
`packages/sim-core/src/sim.ts`: the sweep's first sphere gets the impulse). A craft that hits a flat
surface almost level touches it with one duct a fraction of a millimetre before the others. That duct
takes the whole impulse, which spins the body, and the opposite duct then hits faster than the craft
was moving.

**Measured.** In the mesh test room (`packages/world-mesh/test/respawn-room.test.ts`), pavo20pro-3s
climbing at hover + 0.2 hits the flat ceiling at 2.84 m/s; one tick later the opposite duct hits at
4.56 m/s, over `vCrash` (4 m/s): a crash. It matches the rigid-body result for a rod struck at one end
(the far end gains about (1 + e) / 2 of the approach speed: 1.6 x for e = 0.2). The voxel scan
upstream tested on did not show it, because its ceiling is uneven.

**Why it matters.** A real quad hitting nearly level shares the impact between its ducts, so this
may turn gentle touches of ceilings and floors into crashes, and make landings bouncier than real.
Mesh levels are full of flat surfaces, so pilots will meet it often.

**For the review.** Check against real behaviour (does a level 2.8 m/s ceiling touch crash?), then
consider resolving simultaneous contacts together, as the platform's resting solver already does
(`restOnDisc`, projected Gauss-Seidel over all touching spheres).

**Fixed in sim-core/0.3.0 (2026-10-17).** Every sphere's contacts within 5 mm are solved together each tick
(`Sim.contactsAt`), and a fast impact found by the sweep is solved together with every sphere near the surface
at that pose. A level impact is now shared: B12's old-reference flight (`packages/world-mesh/test/b12-dash.test.ts`)
hits the wall at 3.2 m/s as recorded on upstream's scan, and the rebound is slower (2.7 m/s), where 0.2.0 gave the
5.2 m/s phantom duct hit and a crash. A genuinely tilted impact still pivots: see F3.

### F2. Pinned under a flat ceiling with the throttle at zero (found 2026-10-17, owner's first M1 flight)

**What happens.** A 5-inch quad (nazgulf5v3-6s, acro, airmode) that touches a flat mesh ceiling gently
can stay pressed against it indefinitely with the throttle stick fully down. While it sits there,
level, the gyro reads 2-3 rad/s of roll or yaw that alternate sign (the single-contact solver of F1
rocking the body from tick to tick); the rate PID answers with full mixer authority (mix range up to
2, motor commands swinging between idle and 1.0, mean about 0.5), and that mean thrust is above the
craft's weight, so it presses itself back into the ceiling. Self-sustaining: watched for 127 s in the
owner's browser, and 8 s in the test.

**Measured.** In the bando (storey 2, slab underside at 10.5 m) from a respawn at y = 10.245 m: a 0.4 s
throttle blip at stick -0.25 (near hover) reaches the slab in about 0.1 s; with the stick then at -1
the centre stays at y = 10.453-10.454 m (4.6 cm below the slab, a prop sphere's radius) with
v_y = +0.2-0.3 m/s reported each contact. Reproduction and negative control:
`apps/fly/test/stuck.test.ts`. A firmer blip (stick 0.2) crashes instead.

**Why it matters.** A real quad does not hover against a ceiling at zero throttle; its props would
strike, and with real gyro readings airmode would not see phantom rates. Indoor mesh levels (the bando)
make gentle ceiling touches common.

**Mitigation now (not a physics fix; the owner rejected this kind of fix, see docs/notes/contacts.md §0a).** The respawn director got a "stuck, pinned" rule (armed, still,
touching from above, stick below hover, 1.5 s: rewind), and the game asks rewind spots for 0.5 m of
room beyond the bounding radius instead of 0.05 m (`REWIND_MARGIN_M`, `apps/fly/src/session.ts`), so a
rewind no longer puts the quad 25 cm under a slab.

**For the review.** Fix it at the source together with F1: resolve simultaneous contacts, so a body
resting against a plane does not rock; then check that the gyro reads near zero against a ceiling.
Consider prop strikes: a spinning prop touching a surface should brake its motor or count as a crash.

**Fixed in sim-core/0.3.0 (2026-10-17), with F1.** From the owner's spot under the bando slab, the same blip
reaches the slab, rests against it with the body rotating at 1e-4 rad/s (0.2.0: 2-3 rad/s), and lets go as soon
as the stick goes down (`apps/fly/test/stuck.test.ts`). Pressed under a ceiling by thrust, on a floor or leaning
into a wall, the gyro reads under 1e-4 rad/s (`packages/world-mesh/test/contact-solver.test.ts`). The director's
"stuck, pinned" rule is removed. Still open: prop strikes (a spinning prop touching a surface does not brake its
motor; touching only costs health by the damage model).

### F3. A tilted landing slaps the high arm down faster than the drop (found 2026-10-17, sim-core/0.3.0)

**What happens.** A craft that lands rolled 15-30 deg touches with its low arm first. That contact stops the
arm, and the body pivots on it: the high arm comes down at about 1.6-1.7 times the drop speed (Nazgul, a 2 m/s
drop at 30 deg: 2.0 m/s, then 3.4 m/s). It is the rigid-body result F1 described (the far end of a rod struck at
one end), and it is large here because the preset's roll inertia (0.0016 kg m^2, an estimate) is small next to
mass x arm^2 (0.736 kg x 0.141^2 m^2 = 0.0147 kg m^2). Level landings are not affected.

**Why it matters.** With the damage model a 30 deg landing at 3 m/s costs about 8 % of the health while a level
one at 3 m/s costs nothing. A real frame, its arms and the battery strap give a little, which a rigid body does
not; whether real tilted landings feel as harsh is for the owner to judge by flying.

**For the review.** Check the roll and pitch inertia estimates (a swing test of the real quad would measure them),
and consider a compliant contact (a little give or damping at each sphere) if tilted landings feel too harsh.

### F4. A quad on its props against a wall stays up there (found 2026-10-17, sim-core/0.3.0; fixed in 0.3.1)

**What the owner saw.** "When I hit a wall or floor or anything like that, my whole quad gets stuck."

**What happens.** In forward flight the thrust leans towards the direction of flight, so the top of the quad faces
the wall it flies into. The nose hits first and the impact swings the quad flat against the wall, props first
(15 m/s at 30 deg nose down, Nazgul: flat within 150 ms). Those props kept their full thrust, which pushed the quad
into the wall, and friction (MU 0.4 x that push) held it up: it stayed at the height of the hit at hover throttle,
at full throttle, and in airmode with the throttle down and a stick held (the controller saturates trying to turn
the quad, and the props on the wall get the high commands). Measured: 2.83 m up after 2.5 s in a 3 m room; 5.4 m up
in a 20 m room for 2 s. In 36 forward hits (6-20 m/s, 15-55 deg nose down, 0-25 deg yaw, 0-20 deg roll) every one
ended flat against the wall (a scripted pilot holding hover, then pulling back with some throttle); 9 were still
hanging more than 1 m up 4 s later, the rest had slid down slowly.

**Fix (sim-core/0.3.1).** A real prop pressed against a surface over its intake cannot draw air and its blades hit
the surface, so a duct sphere touching a surface within 30 deg of straight over the prop makes no thrust (none past
60 deg; fading in over the last 0.5 mm of the gap, so it never switches on and off). Now the same hits drop the quad
off the wall in every stick case (`packages/world-mesh/test/contact-solver.test.ts`); a quad sitting upright on the
floor takes off as before; under a ceiling the climb stops a fraction of a millimetre under it and bobs by 1-2 mm
(the thrust share is a stiff spring without damping of its own), rotation under 1e-4 rad/s.

**Left after the fix (asked 2026-10-17; the owner chose turtle mode, below).** The quad still ends a forward wall hit flat against the wall, so it now falls to the
foot of the wall and lies there on its back, like a real quad turtled after a crash. The restitution is upstream's
(0.35 at v_bounce, less above it), so hard hits barely bounce. Floor hits at 20-45 deg nose down recover; at 70 deg
they flip the quad onto its back (both before and after the fix). Options: Betaflight's turtle mode (flip over after
crash), bouncier impacts, or a prop-strike kick away from the surface. Not modelled: the blades' strike itself (a
kick, a motor brake, a broken prop).

**Turtle mode added (sim-core/0.4.0, owner's choice, 2026-10-17).** Betaflight 2026.6.2's crash flip with its
defaults (`packages/sim-core/src/crashflip.ts`). Measured (Nazgul, `packages/world-mesh/test/turtle.test.ts`): on its
back on the floor a full roll or pitch stick flips it upright in 114 ms, half stick in 235 ms; standing on its edge
against a wall after a forward hit, pitch flips it in 86-233 ms and roll does nothing. A flip that ends past 25 deg
of tilt does not arm (Betaflight's small_angle), so some attempts need a second go, as on a real quad. Real crash flips
look slower (props in grass, broken props); not modelled. Reversed thrust is 0.73 of forward, from one thrust-stand
test of a 7x5 prop (Tyto Robotics); a 5" prop's value is unknown. Full yaw in turtle mode spins a diagonal pair hard
enough to lift a quad off upside down; a real one likely does too at full reverse power.

### F5. Moving surfaces (added 2026-10-17, sim-core/0.5.0, for solid traffic)

Cars and people are solid, so the contact solver now works on the craft's velocity relative to the surface it
touches (the world reports each contact's surface velocity). Measured (`packages/sim-core/test/moving-surface.test.ts`,
Pavo20): resting on a box that starts at 3 m/s, the craft is dragged at 3.87 m/s^2 (μg = 3.92 with MU 0.4, the one
friction coefficient for every contact), then rides at 3.000000 m/s with the gyro at 6e-9 rad/s; a box driving into
it at 2 m/s shoves it ahead with no sphere closer than 2 mm to the box. A still world is bit-identical to 0.4.0.
For the review: friction is the same 0.4 on a car roof as on concrete; a car's push is not limited by the car's
mass (movers are kinematic: a quad never slows a car, which is right for a 250 g quad and a 1.5 t car); fast
impacts against a mover are found by the traffic world's sweep at the tick's pose of the movers (conservative
advancement in `packages/traffic/src/world.ts`), not by a sweep of the relative motion.

### F6. A wall hit barely bounces and leaves the quad flat on the wall (found 2026-10-19, owner; fixed in sim-core/0.7.0)

The owner, after flying 0.6.0: "when we impact a wall or surface with throttle, we get essentially pushed into the
wall flat and then end up sliding/stuck on the wall ... in real life we would likely hit and the momentum would bounce
us back off the wall, often stalling the motor out". Reproduced in Node (Nazgul, damage off): 30 deg nose down at
15 m/s, throttle held, the quad came off the wall at under 2 m/s, rotated flat against it with its props on it and slid
down it; motors off it stayed within 0.2 m of the wall. Two causes:
1. **Restitution.** Upstream's curve, 0.35 / (1 + (v - v_bounce) / 2), keeps 7 % of a 15 m/s approach. The one
   measurement found: a rigid carbon-fibre quadrotor (0.84 kg, caged props, motors off) pushed into a rigid wall at
   1.85 m/s keeps 0.526 (0.603 on a mat), contact time 31 ms, peak 235 m/s^2 (Liu and Karydis 2023,
   arXiv:2307.11309, Table III; read in full). A compliant foldable micro quad: 0.5-0.6 (Bilkent thesis, abstract
   only). No measurement at FPV crash speeds found. 0.7.0: sides, props and top keep 0.526 up to 1.85 m/s, then fall
   as (1.85 / v)^(1/4), the shape of the elastic-plastic impact law (Johnson; constant and range not checked against a
   source, "(to read)"): 0.34 at 10 m/s, 0.31 at 15. The underside keeps upstream's curve (landings, accepted by the
   owner), blended over the same 30-60 deg band as the damage.
2. **No stall.** A prop whose disc meets a surface edge-on kept its full speed and thrust: a quad leaning on a wall
   with a prop climbed it. Real props hit the surface every pass and stall (the ESC then has to restart the motor;
   no measured stall or restart time found, ESC docs only describe sync loss and anti-blocking). 0.7.0: blade strike,
   the rotor loses its speed with a 5 ms time constant while the surface is near its disc plane [estimate], and the
   motor lag spins it back up once clear. The wall takes the braking torque, so the body gets no yaw reaction from it.

Measured after the fix (`packages/world-mesh/test/contact-solver.test.ts`): a level hit bounces back at e 0.522
(1.85 m/s) and 0.343 (10 m/s); the 15 m/s nose-down hit leaves at 2.5 m/s, 0.83 m from the wall 0.4 s later motors
off, 0.48 m with the throttle cut (0.6.0: 0.35 m/s, 0.20 m); leaning on a wall in angle mode the front motors stall
to 0.09 (hover 0.30) and it slides down the wall. With the throttle held after a hit, acro holds the attitude the hit
left (often thrust towards the wall) and the quad flies back into it; that is the controller doing its job, as on a
real quad. Free flight is untouched: the brake is exactly 0 and restitution is not used without a contact.
Still open: the sideways kick of a striking prop; a prop that breaks; restitution above 2 m/s measured nowhere.

### F7. "Flat on a car roof, lopsided motors, does not tip" was a quad inside the car (looked into 2026-10-20; not a physics fault)

Seen in the old traffic run-hash flight (traffic.md §1y): armed, angle mode, motor commands up to 0.98 / 0.06, the
quad stayed exactly level (up-vector y 1.000000) and fixed to an SUV for 4 s. Probed in Node:
1. **The resting contacts do not hold a flat craft level.** On a mesh floor with the controller bypassed, commands
   0.36 / 0.06 / 0.98 / 0.51 tip the Nazgul past 60 deg in 0.1 s (0.98 / 0.06 pairs: upside down in 0.1 s); in angle
   mode at 90 % of hover throttle with roll 0.3 / pitch 0.2 it pivots onto its edge at 7.5 deg and sits there; on a
   moving SUV's roof the same, 8.1 deg in 0.3 s (then the ride's airspeed lifts it a few cm: translational lift, G1).
2. **The flight's quad was never on the roof.** It was respawned at road + 0.8 m where the SUV already was (inside its
   body box, 0.25-1.1 m); the push-out moved it up to 1.1 m, which is inside the glass box above (1.1-1.75 m). Every
   sphere then had two contacts in the same plane: the body's top (normal up, gap 0) and the glass box's bottom from
   inside (normal down, 9 cm deep). Contacts in both directions at all five spheres allow no vertical motion of any
   point, so no tilt and no climb; the push-out flipped the quad 9 cm between the two boxes each tick, each box pushing
   it into the other. Its gyro read 0.05 rad/s about yaw only.

So the solver is right and tipping on any surface is now tested (`contact-solver.test.ts`, `traffic.test.ts`). The
trap was a fault of the traffic's shapes: each of a vehicle's boxes was solid on its own, so a point inside one was
pushed out through a face another box covers. Fixed in traffic v10 (traffic.md §1z): a vehicle's boxes are one solid
and a quad inside is pushed out of the whole vehicle. Game respawns (crash rewind, R) still do not check for traffic.

### F8. "No prop sound when rolling at zero throttle" was the sound, not the mixer (looked into 2026-10-20, owner)

The airmode mixer revs one side at zero throttle as Betaflight's does (Nazgul: 1940 rpm idle, 6850-7160 rpm for about
50 ms at the start and stop of a full roll, 2200-3000 rpm while it holds). The sound's flat idle floor equalled the
level of 20 % of top speed, so none of it was heard; fixed in the sound (`docs/notes/physics.md` §2f). Not checked:
whether a real quad holds its motors higher through a sustained zero-throttle roll (a blackbox log would tell).
Dynamic idle was added then (Betaflight's, off by default); it cannot show its real purpose here because rotor speed
does not respond to the airflow through the prop (the inflow gap above).

### F9. Throttle chop at speed: the quad bobbles and motors fire up (found 2026-10-20, owner; OPEN)

Owner: after a throttle cut in fast forward flight the quad "cant maintain steady and shakes out of line" and a motor
is heard firing up; a real quad does not do this (its PID holds attitude, motors stay near idle). Seen in 0.7.0 as
flown, in the 0.8.0 motor model and after the NACA refit (F10); not with classic physics (no airflow on the props).
Mechanism in the model, traced on the owner's 8 s flight (`docs/evidence/2026-10-20-windmill/owner-chop-8s.owfpv.json`,
chop at 4.15 s from 40 m/s, 74 deg nose down, 38-40 m/s through the discs): at idle the props sit where more rpm gives
more drag (the windmill-brake band), so the PID's correction acts backwards, a pair of motors runs up to 14-23 k rpm,
the I-term winds up (to 200 of 400) and holds them for 1-2 s. Detail and the list of unchecked assumptions:
`docs/notes/physics.md` §2g.

### F10. The prop past zero thrust was a 7x-too-steep cliff; refit to NACA's measured windmilling curves (2026-10-20, sim-core/0.8.0 WIP)

The 0.8.0 blade-element range (flat-plate stall at 15-25 deg) made a stopped prop's drag flat, then a cliff to 2.5x it
over a narrow rpm band. NACA Report 464 (Hartman 1933) measured thrust and torque from a locked prop to zero thrust:
a smooth rise to about 2.1x the locked drag near 0.6 of the zero-thrust speed (12 deg blade, zero thrust at J 0.68 as
ours at 0.70); ARR 4H26 (1944) agrees (1.4-2.7x by pitch). Now `WINDMILL_TC/QC` are used with the air from in front,
scaled to the closed form where they join. The reversed band remains (it is measured), so F9 is not fixed by it.

F9 update (2026-10-20): motor spool and ESC braking checked against NeuroBEM's blackbox logs, BLHeli_32's manual and
AM32's source (`docs/evidence/2026-10-20-motor-lag/`). The 0.8.0 motor is 1.3-1.6 x faster than measured and has no
dead time (real 4 ms, about 11-13 ms more from idle); matching it does not remove the bobble, nor do AM32's low-rpm
limits. Finding G9: the motor response is faster than measured (open; a handling change, for the owner to decide).

F9 update (2026-10-20): crossflow checked against NASA TM-20210014010, Simmons AIAA 2021-1190 and NACA TN 3228
(`docs/evidence/2026-10-20-crossflow/`): in the chop its terms change the control moment by at most about 5 % where
data exist. Finding G10: props make no in-plane force or hub moment in the model (measured to add across a vehicle;
small here, larger in edgewise flight; open). Small-prop evidence for the reversed band: Simmons' fit reverses above
Jx 1.37 (to J 2.1 tested).

F9 update (2026-10-21): public Betaflight logs (eRPM, GPS) show the chop's motor pattern (a pair raised, a pair at idle,
a motor above 15 % for 0.45-0.8 s, I swing about 100) on real 5-inch quads at 14-22 m/s with attitude held; the model
matches at those speeds. The open part narrows to the size of the owner's 40 m/s kick (`docs/evidence/2026-10-21-public-logs/`).
