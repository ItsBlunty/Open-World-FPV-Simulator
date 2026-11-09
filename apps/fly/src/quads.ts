// The quads the game can fly (Settings > World and physics > Quad). Each is a sim-core preset; a saved flight embeds
// the preset it flew (flights.ts), so changing the quad never changes an old flight.
import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import redone from '@owfpv/sim-core/presets/redone-6s.json';
import air75iiFreestyle from '@owfpv/sim-core/presets/air75ii-freestyle-1s.json';
import air75iiRacing from '@owfpv/sim-core/presets/air75ii-racing-1s.json';
import air75iiChampion from '@owfpv/sim-core/presets/air75ii-champion-1s.json';

export interface QuadChoice {
    id: string;
    label: string;
    preset: PresetJson;
}

export const QUADS: readonly QuadChoice[] = [
    { id: 'nazgulf5v3-6s', label: 'Nazgul F5 class (5", 6S, true X)', preset: nazgul as unknown as PresetJson },
    // the owner's own quad, measured from its blackbox log (owner, 2026-11-08; docs/notes/physics.md §2v)
    { id: 'redone-6s', label: 'Red one (5", 6S, squashed X, measured from a real log)', preset: redone as unknown as PresetJson },
    // BetaFPV's Air75 II tiny whoop in its three versions, from BetaFPV's pages, its motor bench and its CLI files
    // (contributed 2026-11-09; docs/notes/physics.md §2w)
    { id: 'air75ii-freestyle-1s', label: 'BetaFPV Air75 II Freestyle (75 mm whoop, 1S, 22000KV)', preset: air75iiFreestyle as unknown as PresetJson },
    { id: 'air75ii-racing-1s', label: 'BetaFPV Air75 II Racing (75 mm whoop, 1S, 25000KV)', preset: air75iiRacing as unknown as PresetJson },
    { id: 'air75ii-champion-1s', label: 'BetaFPV Air75 II Champion (75 mm whoop, 1S, 28000KV)', preset: air75iiChampion as unknown as PresetJson }
];

export const DEFAULT_QUAD = QUADS[0].id;

export function isQuadId(v: unknown): v is string {
    return typeof v === 'string' && QUADS.some((q) => q.id === v);
}

/** The quad with this id; the default for an unknown one. */
export function quadById(id: string): QuadChoice {
    return QUADS.find((q) => q.id === id) ?? QUADS[0];
}
