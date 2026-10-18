// The lenses offered in Settings: a short list of popular FPV cameras (owner, 2026-10-18), one calibration each.
// Sources and credits: README.md here (Gyroflow lens profiles, CC0).

import { lensFromGyroflow } from '../lens';
import type { LensProfile } from '../lens';
import caddxRatel2 from './caddx-ratel-2.json';
import foxeerRazerPico from './foxeer-razer-pico.json';
import runcamPhoenix2Jb from './runcam-phoenix-2-jb.json';
import djiVista4x3 from './dji-vista-4x3.json';
import djiAirUnit16x9 from './dji-air-unit-16x9.json';
import caddxNebulaPro4x3 from './caddx-nebula-pro-4x3.json';
import djiO316x9 from './dji-o3-16x9.json';
import djiO4Wide16x9 from './dji-o4-wide-16x9.json';
import djiO4Wide4x3 from './dji-o4-wide-4x3.json';
import walksnailAvatarPro16x9 from './walksnail-avatar-pro-16x9.json';
import walksnailAvatarV24x3 from './walksnail-avatar-v2-4x3.json';
import walksnailMoonlight16x9 from './walksnail-moonlight-16x9.json';
import hdzeroNano16x9 from './hdzero-nano-16x9.json';
import hdzeroMicroV24x3 from './hdzero-micro-v2-4x3.json';
import runcamLinkPhoenixHd16x9 from './runcam-link-phoenix-hd-16x9.json';

/** 'none': the flat (rectilinear) camera with the field-of-view slider */
export const NO_LENS = 'none';
/** the owner's choice, 2026-10-18 */
export const DEFAULT_LENS = 'caddx-ratel-2';

const SOURCES: [string, string, unknown][] = [
    ['caddx-ratel-2', 'Caddx Ratel 2 (analog)', caddxRatel2],
    ['foxeer-razer-pico', 'Foxeer Razer Pico (analog)', foxeerRazerPico],
    ['runcam-phoenix-2-jb', 'RunCam Phoenix 2 JB (analog)', runcamPhoenix2Jb],
    ['dji-vista-4x3', 'DJI Vista / Air Unit, 4:3', djiVista4x3],
    ['dji-air-unit-16x9', 'DJI Air Unit, 16:9', djiAirUnit16x9],
    ['caddx-nebula-pro-4x3', 'Caddx Nebula Pro (Vista), 4:3', caddxNebulaPro4x3],
    ['dji-o3-16x9', 'DJI O3, 16:9', djiO316x9],
    ['dji-o4-wide-16x9', 'DJI O4 Air Unit, Flywoo wide lens, 16:9', djiO4Wide16x9],
    ['dji-o4-wide-4x3', 'DJI O4 Air Unit, Flywoo wide lens, 4:3', djiO4Wide4x3],
    ['walksnail-avatar-pro-16x9', 'Walksnail Avatar Pro, 16:9', walksnailAvatarPro16x9],
    ['walksnail-avatar-v2-4x3', 'Walksnail Avatar V2, 4:3', walksnailAvatarV24x3],
    ['walksnail-moonlight-16x9', 'Walksnail Moonlight, 16:9', walksnailMoonlight16x9],
    ['hdzero-nano-16x9', 'HDZero Nano, 16:9', hdzeroNano16x9],
    ['hdzero-micro-v2-4x3', 'HDZero Micro V2, 4:3', hdzeroMicroV24x3],
    ['runcam-link-phoenix-hd-16x9', 'RunCam Link Phoenix HD, 16:9', runcamLinkPhoenixHd16x9]
];

export const LENSES: readonly LensProfile[] = SOURCES.map(([id, label, json]) => lensFromGyroflow(id, label, json));

/** The lens for a settings id; null for the flat camera or an id no longer offered. */
export function lensById(id: string): LensProfile | null {
    return LENSES.find((l) => l.id === id) ?? null;
}
