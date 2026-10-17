// The test room that replaces SuperSplat scene 39e63ce9 (the voxel scan upstream's tests flew in):
// a closed box of triangles with the scan's layout where the tests depend on it, measured on the
// scan with upstream's voxel collision: spawn at y = 1.58, floor under it at y = -0.2, ceiling over
// it at y = 2.05, and the wall B12 dashes into about 5.2 m away along -x. The scan's furniture is
// not modelled. The other walls are far enough that the bot's planner picks the -x wall.

import { MeshBuilder, MeshContactWorld } from '../src/index';

export const ROOM = { x0: -5.2, x1: 6.5, y0: -0.2, y1: 2.05, z0: -6, z1: 6 };
export const SPAWN: [number, number, number] = [0, 1.58, 0];
/** where the spawn looks (sets the spawn heading): towards the x = -5.2 wall */
export const TARGET: [number, number, number] = [-1, 1.58, 0];

export function roomBuilder(): MeshBuilder {
    return new MeshBuilder().box([ROOM.x0, ROOM.y0, ROOM.z0], [ROOM.x1, ROOM.y1, ROOM.z1]);
}

export function room(): MeshContactWorld {
    const b = roomBuilder();
    return new MeshContactWorld(b.positions, b.indices);
}
