// Building the traffic for a level and naming it in the life header.

import type { Level } from '@owfpv/maps';
import { sha256Hex } from '@owfpv/sim-core';
import { LoopTraffic } from './loops';
import { NetTraffic } from './network';
import { TRAFFIC_VERSION } from './model';
import type { TrafficConfig, TrafficModel } from './model';

/** The traffic a config asks for: the network model with signals, the loops without; null when nothing moves. */
export function makeTraffic(level: Level, config: TrafficConfig): TrafficModel | null {
    if (!config.cars && !config.people) return null;
    return config.signals ? new NetTraffic(level, config) : new LoopTraffic(level, config);
}

/**
 * The hash a life header records for the collision (its collisionSha256): the level's own when no
 * traffic moves in it, else one over the level's hash, the traffic version and what is on.
 */
export function worldSha256(levelSha: string, config: TrafficConfig): string {
    if (!config.cars && !config.people) return levelSha;
    const on = (b: boolean): number => (b ? 1 : 0);
    const text = `${levelSha}|traffic/${TRAFFIC_VERSION}|cars=${on(config.cars)}|people=${on(config.people)}|signals=${on(config.signals)}`;
    // the text is ASCII: one byte per character
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return sha256Hex(bytes);
}
