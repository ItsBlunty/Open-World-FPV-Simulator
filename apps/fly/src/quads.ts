// The quads the pilot can fly (Settings > World and physics > Quad, owner 2026-10-21). Each is a sim-core preset; picking
// one reloads the game, since its weight, props and sound are set up at start, and sets the quad's own tune.

import type { PresetJson } from '@owfpv/sim-core';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import kingfisher from '@owfpv/sim-core/presets/uzh-kingfisher-4s.json';
import type { TuneId } from './tunes';

export type QuadId = 'nazgul' | 'kingfisher';

export interface Quad {
    name: string;
    note: string;
    preset: PresetJson;
    /** the tune picking the quad sets */
    tune: TuneId;
}

export const DEFAULT_QUAD: QuadId = 'nazgul';

export const QUADS: Readonly<Record<QuadId, Quad>> = {
    nazgul: {
        name: 'iFlight Nazgul F5 class, 6S',
        note: "A 6S 5-inch freestyle quad, the kind most pilots fly. Its weight, motors and props are iFlight's; its inertia and some aerodynamics are estimates, still being checked against real flights.",
        preset: nazgul as unknown as PresetJson,
        tune: 'supafly5'
    },
    kingfisher: {
        name: 'UZH Kingfisher research quad, 4S',
        note: "The University of Zurich's 5-inch research quad (NeuroBEM, Agilicious): heavier, 4S, with a computer on board, so softer than a freestyle quad. Its geometry, inertia and Betaflight tune are measured, and the simulator reproduces its logged flights. It flies its own tune.",
        preset: kingfisher as unknown as PresetJson,
        tune: 'original'
    }
};

export function isQuadId(v: unknown): v is QuadId {
    return v === 'nazgul' || v === 'kingfisher';
}
