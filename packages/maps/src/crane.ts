// The tower crane's site (owner, 2026-10-24: "crane should turn and pickup and drop boxes around the worksite, Put a
// little guy in the crane tower working as well"). The map keeps the crane's tower and foundation; everything above its
// slewing ring turns and moves (the jib, the counter-jib, the cab and its operator, the trolley, the rope and hook, the
// crates it carries), so it is packages/traffic's crane.ts, placed from the sim's tick. This is where it stands and where
// its crates go: not part of the collision, nor of its hash.

/** The crane at the construction site (first-map.ts towerCrane). */
export interface CraneSite {
    /** the tower's axis, m */
    x: number;
    z: number;
    /** the top of the tower: the slewing ring, m */
    ring: number;
    /** where crates rest: the middle of a crate's bottom, m (a free cell on the ground inside the frame, or the top deck) */
    spots: [number, number, number][];
    /** a carried crate's bottom stays this high while the crane slews, clear of the frame and its top deck, m */
    clear: number;
}
