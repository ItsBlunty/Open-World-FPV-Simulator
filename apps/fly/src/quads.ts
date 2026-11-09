// The quads the game can fly (Settings > World and physics > Quad). Each is a sim-core preset; a saved flight embeds
// the preset it flew (flights.ts), so changing the quad never changes an old flight.
import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import redone from '@owfpv/sim-core/presets/redone-6s.json';

export interface QuadChoice {
    id: string;
    label: string;
    preset: PresetJson;
}

export const QUADS: readonly QuadChoice[] = [
    { id: 'nazgulf5v3-6s', label: 'Nazgul F5 class (5", 6S, true X)', preset: nazgul as unknown as PresetJson },
    // the owner's own quad, measured from its blackbox log (owner, 2026-11-08; docs/notes/physics.md §2v)
    { id: 'redone-6s', label: 'Red one (5", 6S, squashed X, measured from a real log)', preset: redone as unknown as PresetJson }
];

export const DEFAULT_QUAD = QUADS[0].id;

export function isQuadId(v: unknown): v is string {
    return typeof v === 'string' && QUADS.some((q) => q.id === v);
}

/** The quad with this id; the default for an unknown one. */
export function quadById(id: string): QuadChoice {
    return QUADS.find((q) => q.id === id) ?? QUADS[0];
}
