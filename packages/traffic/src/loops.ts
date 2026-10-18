// The simple traffic model (signals off): cars on the roads around every city block, people on its
// sidewalk, each a function of the tick alone. Each route
// carries a few movers at one speed, evenly spread with a little jitter, so nothing on a route ever
// catches up with anything else on it, and no two routes share a lane.
//
// Lanes (right-hand traffic): a car keeps its block on its right, 3 m out from the kerb, so on every
// road the two blocks' cars pass each other in opposite directions. People walk two lanes on the
// sidewalk in opposite directions, 1.0 m and 1.6 m in from the kerb: clear of the street lamps (0.4 m
// in) and of buildings and walls (at least 2 m in, maps first-map.ts city()). Their corners are tight:
// a wider one cuts across the corner, into a building that stands 2 m in (the test "never drives or
// walks through the level").

import { Rng } from '@owfpv/maps';
import type { Block, Level } from '@owfpv/maps';
import { placeAt, rectRoute } from './route';
import type { Place, Route } from './route';
import { DT } from './model';
import type { Lamp, Mover, SignalHead, StaticBox, TrafficConfig, TrafficModel } from './model';

/** Car lane: 3 m from the kerb (roads are 18 m kerb to kerb, a lane each way); corners of radius 5 m. */
const LANE_OUT = 3;
const CAR_RC = 5;
/** People's lanes in from the kerb, and their corners' radii. */
const WALK_OUTER = 1.0;
const WALK_OUTER_RC = 0.5;
const WALK_INNER = 1.6;
const WALK_INNER_RC = 0.3;

export interface LoopMover extends Mover {
    route: number;
    /** where on the route it is at tick 0, m */
    s0: number;
}

const NO_STATICS: readonly StaticBox[] = [];

export class LoopTraffic implements TrafficModel {
    readonly config: TrafficConfig;
    readonly routes: Route[] = [];
    readonly movers: LoopMover[] = [];
    readonly signals: readonly SignalHead[] = [];
    /** per route, its movers' indices */
    readonly byRoute: number[][] = [];
    /** the fastest mover, m/s (how far a surface can move in a tick) */
    readonly maxSpeed: number;

    constructor(level: Level, config: TrafficConfig) {
        this.config = { cars: config.cars, people: config.people, signals: false };
        // one draw sequence whatever the config, so turning people off leaves the cars where they were
        const r = new Rng(0x7a11c);
        for (const b of level.blocks) {
            const car = this.addRoute(carRoute(b));
            const nCars = r.int(1, 3);
            const vCar = 7 + r.int(0, 40) / 10; // 25-40 km/h
            for (let k = 0; k < nCars; k++) {
                const s0 = (this.routes[car].length * (k + r.int(0, 30) / 100)) / nCars;
                const look = r.u32();
                if (config.cars) this.add({ kind: 'car', route: car, s0, v: vCar, look });
            }
            for (const outer of [true, false]) {
                const w = this.addRoute(walkRoute(b, outer));
                const nPeople = r.int(1, 3);
                const vWalk = 1.1 + r.int(0, 5) / 10; // 1.1-1.6 m/s
                for (let k = 0; k < nPeople; k++) {
                    const s0 = (this.routes[w].length * (k + r.int(0, 40) / 100)) / nPeople;
                    const look = r.u32();
                    if (config.people) this.add({ kind: 'person', route: w, s0, v: vWalk, look });
                }
            }
        }
        let vm = 0;
        for (const m of this.movers) vm = Math.max(vm, m.v);
        this.maxSpeed = vm;
    }

    private addRoute(rt: Route): number {
        this.routes.push(rt);
        this.byRoute.push([]);
        return this.routes.length - 1;
    }

    private add(m: LoopMover): void {
        this.byRoute[m.route].push(this.movers.length);
        this.movers.push(m);
    }

    /** Nothing to do: every place is a function of the tick. */
    at(_tick: number): void {}

    /** Where mover i is at sim tick `tick` (any real tick: the renderer passes fractions). */
    place(i: number, tick: number, out: Place): Place {
        const m = this.movers[i];
        return placeAt(this.routes[m.route], m.s0 + m.v * (tick * DT), out);
    }

    allStatics(): readonly StaticBox[] {
        return NO_STATICS;
    }

    staticsNear(): readonly StaticBox[] {
        return NO_STATICS;
    }

    lamp(): Lamp {
        return 'red';
    }

    braking(): boolean {
        return false;
    }
}

/** The road loop around a block, block on the right: down the east side (+z), west, up the west side, east. */
function carRoute(b: Block): Route {
    const o = LANE_OUT;
    return rectRoute([[b.x1 + o, b.z0 - o], [b.x1 + o, b.z1 + o], [b.x0 - o, b.z1 + o], [b.x0 - o, b.z0 - o]], CAR_RC, 0);
}

/** A sidewalk loop: the outer lane the cars' way round, the inner lane the other way. */
function walkRoute(b: Block, outer: boolean): Route {
    const i = outer ? WALK_OUTER : WALK_INNER;
    const ne: [number, number] = [b.x1 - i, b.z0 + i], se: [number, number] = [b.x1 - i, b.z1 - i];
    const sw: [number, number] = [b.x0 + i, b.z1 - i], nw: [number, number] = [b.x0 + i, b.z0 + i];
    return outer ? rectRoute([ne, se, sw, nw], WALK_OUTER_RC, b.y) : rectRoute([ne, nw, sw, se], WALK_INNER_RC, b.y);
}
