// The golden props (owner, 2026-10-18; maps golden-props.ts): which ones the pilot has taken. No DOM, so the Node
// tests check exactly what the page does.
//
// Determinism (CLAUDE.md): a prop is taken on the sim tick the quad's centre comes within COLLECT_RADIUS of it,
// checked after every 1 ms step (FlightSession hooks the runner's onStep), so a replay of the same sticks takes the
// same props on the same ticks. Taking one changes nothing in the flight: the props are not solid.

import type { Collectible } from '@owfpv/maps';

/**
 * How near the quad's centre must come, m. Generous on purpose, like the pickups it is modelled on: the drawn prop is
 * 0.8 m across, a 5-inch quad about 0.25 m, so brushing past it counts.
 */
export const COLLECT_RADIUS = 1.0;

export class Collector {
    readonly items: readonly Collectible[];
    private readonly taken: Uint8Array;
    private readonly xyz: Float64Array;
    private left: number;
    /** props taken since the last `drain`, by number, in the order taken */
    private fresh: number[] = [];

    constructor(items: readonly Collectible[]) {
        this.items = items;
        this.taken = new Uint8Array(items.length);
        this.xyz = new Float64Array(items.length * 3);
        items.forEach((c, i) => this.xyz.set([c.x, c.y, c.z], i * 3));
        this.left = items.length;
    }

    /** Mark these (by number) taken, and the rest not: the pilot's saved collection. */
    setTaken(ns: Iterable<number>): void {
        this.taken.fill(0);
        for (const n of ns) if (n >= 1 && n <= this.items.length) this.taken[n - 1] = 1;
        this.left = this.taken.reduce((a, t) => a - t, this.items.length);
        this.fresh = [];
    }

    isTaken(n: number): boolean {
        return this.taken[n - 1] === 1;
    }

    get count(): number {
        return this.items.length - this.left;
    }

    /** The quad's centre is at x, y, z: take any prop it reaches. */
    check(x: number, y: number, z: number): void {
        if (this.left === 0) return;
        const r2 = COLLECT_RADIUS * COLLECT_RADIUS;
        const p = this.xyz;
        for (let i = 0; i < this.taken.length; i++) {
            if (this.taken[i]) continue;
            const dx = p[i * 3] - x, dy = p[i * 3 + 1] - y, dz = p[i * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz > r2) continue;
            this.taken[i] = 1;
            this.left--;
            this.fresh.push(i + 1);
        }
    }

    /** The props taken since the last call, by number. */
    drain(): number[] {
        const f = this.fresh;
        this.fresh = [];
        return f;
    }
}
