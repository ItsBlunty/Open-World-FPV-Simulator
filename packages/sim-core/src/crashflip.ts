/*
 * This file is part of Cleanflight and Betaflight.
 *
 * Cleanflight and Betaflight are free software. You can redistribute
 * this software and/or modify this software under the terms of the
 * GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Cleanflight and Betaflight are distributed in the hope that they
 * will be useful, but WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this software.
 *
 * If not, see <http://www.gnu.org/licenses/>.
 */

// Turtle mode ("crash flip", Betaflight's FLIP OVER AFTER CRASH / CRASHFLIP mode): the motor mix that turns a quad
// lying on its back over with reversed motors. Ported to TypeScript for this project (sim-core/0.4.0,
// GPL-3.0-or-later) from Betaflight 2026.6.2, src/main/flight/mixer.c, applyCrashFlipModeToMotors()
// (https://github.com/betaflight/betaflight/blob/2026.6.2/src/main/flight/mixer.c), with the defaults of a normal
// (non-RACE_PRO) build: crashflip_motor_percent 0 (motors on the other side stay stopped), crashflip_rate 0 (no
// rate or attitude attenuation) and yaw_motors_reversed off. Throttle plays no part. The arming rules around it are in
// sim.ts arming(), from the same release's src/main/fc/core.c. Only + - * / and Math.sqrt: deterministic.

/** a motor driven under this share is sent the disarm value (stopped); Betaflight's CRASHFLIP_MOTOR_DEADBAND */
export const CRASHFLIP_MOTOR_DEADBAND = 0.02;
/** stick deflection (length of roll and pitch, or yaw) under which nothing spins; Betaflight's CRASHFLIP_STICK_DEADBAND */
export const CRASHFLIP_STICK_DEADBAND = 0.15;

const SQRT2 = Math.sqrt(2);
/** cos(30 deg): a roll-and-pitch stick closer than 30 deg to an axis drives that axis only */
const COS_THRESHOLD = Math.sqrt(3) / 2;

/**
 * Betaflight's crash-flip mix for sticks roll, pitch, yaw in -1..1 (its rcDeflection) and the quad's mixer columns:
 * each motor's drive in 0..1 into out (0: stopped, under CRASHFLIP_MOTOR_DEADBAND counts as 0). The motors whose mixer
 * sign matches the stick's opposite spin: roll right spins the right-hand pair, which (reversed, on its back) lifts
 * that side; a diagonal stick spins one motor; yaw, when it is the largest deflection, spins one diagonal pair.
 */
export function crashFlipMix(roll: number, pitch: number, yaw: number, mixR: readonly number[], mixP: readonly number[], mixY: readonly number[], out: Float64Array): void {
    const pitchAbs = pitch < 0 ? -pitch : pitch;
    const rollAbs = roll < 0 ? -roll : roll;
    const yawAbs = yaw < 0 ? -yaw : yaw;
    let signPitch = pitch < 0 ? 1 : -1;
    let signRoll = roll < 0 ? 1 : -1;
    // yaw_motors_reversed off: Betaflight multiplies by -1
    let signYaw = (yaw < 0 ? 1 : -1) * -1;
    let length = Math.sqrt(pitchAbs * pitchAbs + rollAbs * rollAbs);
    if (yawAbs > (pitchAbs > rollAbs ? pitchAbs : rollAbs)) {
        // yaw dominant: no pitch or roll
        length = yawAbs;
        signRoll = 0;
        signPitch = 0;
    } else {
        // pitch or roll dominant: no yaw
        signYaw = 0;
    }
    const cosPhi = length > 0 ? (pitchAbs + rollAbs) / (SQRT2 * length) : 0;
    if (cosPhi < COS_THRESHOLD) {
        // roll or pitch only, unless near the diagonal
        if (rollAbs > pitchAbs) signPitch = 0;
        else signRoll = 0;
    }
    const power = length > CRASHFLIP_STICK_DEADBAND ? length : 0;
    for (let i = 0; i < 4; i++) {
        let n = signPitch * mixP[i] + signRoll * mixR[i] + signYaw * mixY[i];
        // crashflip_motor_percent 0: the other motors do not spin
        if (n < 0) n = 0;
        n = power * n;
        if (n > 1) n = 1;
        out[i] = n < CRASHFLIP_MOTOR_DEADBAND ? 0 : n;
    }
}
