// The airport's traffic (owner, 2026-10-20): ten planes that land on runway 09, taxi to their hangar, are pushed in by a
// tug, stay a while, are towed out, taxi out and take off again; the air ambulance helicopter that flies a patient from
// the airport to the hospital's rooftop pad, where two medics wheel the stretcher in, and flies back; the controllers in
// the tower. Like the cars and the trains, everything is solid and placed from the sim tick alone (replays): the day
// repeats every AIR_DAY seconds, and every mover's day is built once, here, as legs (air-path.ts).
//
// The runway takes one user at a time, as a tower would clear them: the arrivals are fixed in the day (SCHEDULE); each
// departure waits at the holding point until the runway is free for its take-off, and the helicopter waits on its pad
// (rotors turning) until it is free for its crossing. Each hangar's tug does one job at a time. A test flies the whole
// day and checks that no two movers ever touch (packages/traffic/test/air.test.ts).
//
// Real speeds and distances are the types' own (air-shapes.ts); the procedures are the usual ones [estimates marked].
//
// Determinism: only + - * /, Math.sqrt, Math.floor and sim-core's dmath functions.

import type { Airport, AircraftKind, Level } from '@owfpv/maps';
import { datan, dcos, dsin } from '@owfpv/sim-core';
import { DEG, Itin, legAt, newAirPlace, placeOnLeg } from './air-path';
import type { AirPlace, Leg } from './air-path';
import { AIRCRAFT, HELI, SITTER, STRETCHER, TOW_BAR, TUG, TUG_HALF, WALKER } from './air-shapes';
import type { AirShape, AircraftType } from './air-shapes';
import { DT } from './model';

/** Bumped with any change that moves an airport mover or changes a shape: part of the world hash (replays). */
export const AIR_VERSION = 1;
/** The airport's day: everything repeats this often, s (ten arrivals and ten departures: a runway movement every 2.5 min) */
export const AIR_DAY = 3000;

/**
 * When each plane's landing has the runway (s into the day: it is LANDING_FROM m out on final then) and how long it stays
 * in its hangar, s. Chosen so the runway, the taxiways and the tugs are never wanted by two at once (the test checks it).
 */
export type AirSchedule = Record<AircraftKind, { arrive: number; stay: number }>;
export const SCHEDULE: AirSchedule = {
    atr72: { arrive: 0, stay: 420 },
    cub: { arrive: 300, stay: 360 },
    phenom: { arrive: 600, stay: 300 },
    c172: { arrive: 900, stay: 360 },
    kingair: { arrive: 1200, stay: 300 },
    sr22: { arrive: 1500, stay: 360 },
    twinotter: { arrive: 1800, stay: 330 },
    baron: { arrive: 2100, stay: 300 },
    pc12: { arrive: 2400, stay: 330 },
    caravan: { arrive: 2700, stay: 300 }
};
/** The helicopter's two trips to the hospital a day: when it starts its rotors, s into the day */
export const HELI_TRIPS = [300, 1800];

/** Where an arrival appears, m before the threshold, on the extended centre line: well out of sight */
const APPROACH_FROM = 4260;
/** the glide path: 3 deg, crossing the threshold 15 m (50 ft) up [usual] */
const GLIDE = 3 * DEG;
const TCH = 15;
/** a touchdown's sink rate, m/s [estimate: a firm, ordinary landing] */
const SINK_TD = 0.5;
/** taxi speeds: straights, turns, the apron [estimates: about 20, 12 and 8 kn] */
const TAXI = 10;
const TURN = 6;
const APRON_V = 4;
/** the radius of the U-turn in front of a hangar, and how far a wingtip keeps from the doors in it [estimates] */
const UTURN_R = 18;
const DOOR_GAP = 6;
/** the tow's speed and the tug's own [estimates] */
const TOW = 1.5;
const TUG_V = 4;
const TUG_R = 4;
/** where a departure climbs out to before it is out of sight: this far east, this high */
const AWAY_X = 6000;
const AWAY_Y = 450;
/** gaps the runway keeps between users, s [estimate] */
const RUNWAY_GAP = 10;
/** a landing has the runway from this far out on final until it has turned off; a departure from leaving the hold until
 * this long after lift-off [estimates: a tower clears a take-off ahead of an arrival a few km out] */
const LANDING_FROM = 1200;
const DEPARTED_AFTER = 15;

export type AirKind = 'plane' | 'heli' | 'tug' | 'walker' | 'sitter' | 'stretcher';

export interface AirMover {
    kind: AirKind;
    shape: AirShape;
    /** a plane's type */
    type?: AircraftType;
    /** a number for its looks: the renderer's */
    look: number;
    /** its legs, times in the day (they may run on past AIR_DAY into the next) */
    legs: Leg[];
    /** where it is when no leg holds it (a tug parked, a plane away: hidden) */
    rest: AirPlace;
    /** the fastest it goes, m/s (contacts' reach) */
    vmax: number;
}

/** Busy times on a shared thing (the runway, a tug), in the day, kept apart by `gap` s; times wrap round the day. */
class Booking {
    private readonly spans: [number, number][] = [];
    constructor(private readonly gap: number) {}

    private clashes(a: number, b: number): boolean {
        // in the day: a span is the same span a day later
        const k0 = Math.floor(a / AIR_DAY) * AIR_DAY;
        a -= k0; b -= k0;
        for (const [c, d] of this.spans) {
            for (const k of [-AIR_DAY, 0, AIR_DAY]) {
                if (a < d + k + this.gap && c + k < b + this.gap) return true;
            }
        }
        return false;
    }

    /** Book [a, b); it must be free (a fixed arrival). */
    take(a: number, b: number, what: string): void {
        if (this.clashes(a, b)) throw new Error(`the airport schedule asks for the runway twice at ${a.toFixed(0)} s (${what})`);
        this.keep(a, b);
    }

    /** The first start at or after `a` from which `len` s are free (every second tried, then booked). */
    first(a: number, len: number): number {
        const t = this.find(a, len);
        this.keep(t, t + len);
        return t;
    }

    /** The first start at or after `a` from which `len` s are free, not booked. */
    find(a: number, len: number): number {
        let t = a;
        while (this.clashes(t, t + len)) {
            t += 1;
            if (t > a + AIR_DAY) throw new Error(`no room left in the booking for ${len.toFixed(0)} s from ${a.toFixed(0)} s: ${JSON.stringify(this.spans.map(([c, d]) => [Math.round(c), Math.round(d)]))}`);
        }
        return t;
    }

    keep(a: number, b: number): void {
        const k0 = Math.floor(a / AIR_DAY) * AIR_DAY;
        this.spans.push([a - k0, b - k0]);
    }
}

/** A day's piece of a mover that comes and goes (a tug's job, a medic's walk): legs from leaving its rest to coming back. */
interface Piece {
    legs: Leg[];
}

/** Put pieces into one day of legs, with waits at rest between them; their times in [0, AIR_DAY) (a piece may end past it). */
function dayOf(pieces: Piece[], rest: AirPlace, hidden: boolean, what: string): Leg[] {
    const ps = pieces.filter((p) => p.legs.length).map((p) => {
        const t0 = p.legs[0].t0, k = Math.floor(t0 / AIR_DAY) * AIR_DAY;
        return k ? p.legs.map((l) => ({ ...l, t0: l.t0 - k, t1: l.t1 - k })) : p.legs;
    }).sort((a, b) => a[0].t0 - b[0].t0);
    const out: Leg[] = [];
    for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (out.length) {
            const end = out[out.length - 1].t1, start = p[0].t0;
            if (start < end - 1e-9) throw new Error(`${what}: two jobs at once at ${start.toFixed(0)} s`);
            if (start > end) out.push(restLeg(end, start, rest, hidden));
        }
        out.push(...p);
    }
    if (out.length && out[out.length - 1].t1 > out[0].t0 + AIR_DAY) throw new Error(`${what}: the last job runs into the first`);
    return out;
}

/** Standing at rest from t0 to t1. */
function restLeg(t0: number, t1: number, rest: AirPlace, hidden: boolean): Leg {
    const it = new Itin(rest.x, rest.z, rest.f[0], rest.f[2], rest.y, { t: t0 });
    it.wait(t1 - t0, { hidden });
    return it.legs[0];
}

function restAt(x: number, y: number, z: number, hx: number, hz: number, hidden: boolean): AirPlace {
    const p = newAirPlace();
    const it = new Itin(x, z, hx, hz, y);
    it.wait(1, { hidden });
    placeOnLeg(it.legs[0], 0, p);
    return p;
}

/**
 * A tug's trip from its rest (heading south) to stand facing south at (x, z), and back from there (tug paths: a back-up,
 * two turns); it backs up to zMax or further, so its run across the apron keeps clear of the hangars' doors.
 */
function tugTo(it: Itin, x: number, z: number, zMax: number): void {
    const za = Math.min(z - 2 * TUG_R - 1, it.z - 2, zMax);
    const back = it.z - za;
    backUp(it, back);
    const west = x < it.x;
    // heading south: a right turn heads west, a left one east
    it.turn(TUG_R, west ? Math.PI / 2 : -Math.PI / 2, 3);
    const run = Math.abs(x - it.x) - TUG_R;
    it.straight(run, TUG_V).turn(TUG_R, west ? -Math.PI / 2 : Math.PI / 2, 2);
    it.straight(z - it.z, 0);
}

function tugHome(it: Itin, px: number, pz: number, zMax: number): void {
    const za = Math.min(it.z - 2 * TUG_R - 1, pz - 2 * TUG_R - 1, zMax);
    const back = it.z - za;
    backUp(it, back);
    const east = px > it.x;
    it.turn(TUG_R, east ? -Math.PI / 2 : Math.PI / 2, 3);
    const run = Math.abs(px - it.x) - TUG_R;
    it.straight(run, TUG_V).turn(TUG_R, east ? Math.PI / 2 : -Math.PI / 2, 2);
    it.straight(pz - it.z, 0);
}

/** Speed along a straight from v0 to vEnd with a cruise vMax in the middle where there is room. */
function cruise(it: Itin, len: number, vMax: number, vEnd: number, o: { rev?: boolean } = {}): void {
    if (len <= 0.01) return;
    const v0 = it.v;
    if (vMax <= Math.max(v0, vEnd) || len < 20) { it.straight(len, vEnd, o); return; }
    it.straight(len * 0.3, vMax, o).straight(len * 0.4, vMax, o).straight(len * 0.3, vEnd, o);
}

export class AirTraffic {
    readonly movers: AirMover[] = [];
    readonly airport: Airport;
    /** the fastest any mover goes, m/s */
    readonly maxSpeed: number;
    /** each plane's mover index, by kind; the helicopter's; the tugs'; the medics' */
    readonly planes: number[] = [];
    readonly heli: number;
    /** per plane: when it touches down and when it lifts off, s into the day (sound, tests) */
    readonly events: { kind: AircraftKind; touchdown: number; liftoff: number }[] = [];
    private readonly runway = new Booking(RUNWAY_GAP);
    private readonly heliTrips: readonly number[];
    /** each hangar's tug: one job at a time */
    private readonly tugs: Booking[] = [];

    private readonly schedule: AirSchedule;

    /** `schedule` and `heliTrips`: the day's (tests may try others) */
    constructor(level: Level, schedule: AirSchedule = SCHEDULE, heliTrips: readonly number[] = HELI_TRIPS) {
        this.schedule = schedule;
        this.heliTrips = heliTrips;
        const ap = level.airport;
        if (!ap) throw new Error('this level has no airport');
        this.airport = ap;
        const tugJobs: Piece[][] = ap.tugs.map(() => []);
        for (const _ of ap.tugs) this.tugs.push(new Booking(2));
        // every arrival's runway time first (they are fixed), then each plane's day with its departure fitted in
        const arrivals = AIRCRAFT.map((type) => ({ type, it: this.arrival(type) }));
        for (const a of arrivals) {
            const { start, end } = a.it;
            this.runway.take(start, end, a.type.kind);
        }
        arrivals.sort((a, b) => this.schedule[a.type.kind].arrive - this.schedule[b.type.kind].arrive);
        for (const a of arrivals) {
            const legs = this.ground(a.type, a.it.itin, tugJobs, a.it.touchdown);
            this.planes.push(this.movers.length);
            this.movers.push({ kind: 'plane', shape: a.type.shape, type: a.type, look: this.movers.length, legs, rest: restAt(0, -1000, 0, 1, 0, true), vmax: a.type.perf.vclimb * 1.2 });
        }
        ap.tugs.forEach((p, k) => {
            const rest = restAt(p.x, ap.pave, p.z, 0, 1, false);
            this.movers.push({ kind: 'tug', shape: TUG, look: k, legs: dayOf(tugJobs[k], rest, false, `hangar ${k + 1}'s tug`), rest, vmax: TUG_V });
        });
        const medics: Piece[][] = [[], [], []];
        this.heli = this.movers.length;
        const pad = ap.heliPad;
        const heliRest = restAt(pad.x, pad.y, pad.z, 0, -1, false);
        this.movers.push({ kind: 'heli', shape: HELI, look: 0, legs: this.heliDay(medics), rest: heliRest, vmax: 40 });
        const hidden = restAt(ap.hospitalDoor.in[0], ap.hospitalDoor.in[1], ap.hospitalDoor.in[2], 1, 0, true);
        medics.forEach((pieces, k) => this.movers.push({
            kind: k === 1 ? 'stretcher' : 'walker', shape: k === 1 ? STRETCHER : WALKER, look: 100 + k,
            legs: dayOf(pieces, hidden, true, 'the medics'), rest: hidden, vmax: 2
        }));
        ap.seats.forEach((s, k) => this.movers.push({ kind: 'sitter', shape: SITTER, look: 200 + k, legs: [], rest: restAt(s.x, s.y, s.z, s.hx, s.hz, false), vmax: 0 }));
        this.maxSpeed = this.movers.reduce((m, v) => Math.max(m, v.vmax), 0);
    }

    // ---------------------------------------------------------------- planes

    /**
     * A plane's arrival, from 3.5 km out to its first turn off the runway: the 3 deg glide at its approach speed, the
     * flare, the touchdown, the nose lowered, the roll braking to turn speed and the first turn onto the exit it can make
     * (past its bay, so it never taxis back east). Returns the itinerary and the runway's busy time (from 2 km out until
     * off the runway).
     */
    private arrival(type: AircraftType): { itin: Itin; start: number; end: number; touchdown: number } {
        const ap = this.airport, R = ap.runway, p = type.perf;
        const y = ap.pave, tg = dsin(GLIDE) / dcos(GLIDE);
        const x0 = R.threshold - APPROACH_FROM;
        const hAt = (x: number): number => y + TCH + (R.threshold - x) * tg;
        // it starts out of sight so that it is LANDING_FROM m out at its time in the schedule
        const start = this.schedule[type.kind].arrive;
        const t0 = start - (APPROACH_FROM - LANDING_FROM) / p.vapp;
        const it = new Itin(x0, R.z, 1, 0, hAt(x0), { th: p.pitchApp * DEG, e: 0.45, g: 1, t: t0 });
        it.jump(x0, R.z, 1, 0, hAt(x0), p.vapp);
        // on the glide path to the flare's start
        const xf = R.threshold + (TCH - p.flareH) / tg;
        it.straight(xf - x0, p.vapp, { y: y + p.flareH });
        // the flare: the sink eased from the glide's to SINK_TD over D m: D = 2 h / (glide + touchdown slope)
        const mTd = SINK_TD / p.vtd;
        const D = (2 * p.flareH) / (tg + mTd);
        const flareTh = p.taildragger ? 11 : p.pitchApp + 3.5;
        it.flare(D, p.vtd, -tg, -mTd, { th: flareTh * DEG, e: 0.15 });
        const touchdown = it.t;
        const ground = p.taildragger ? 11 : 0;
        // brakes and reverse: a constant deceleration that stops it in its landing roll
        const dec = (p.vtd * p.vtd) / (2 * p.landRoll);
        // lowering the nose over 2.5 s while braking
        const v1 = Math.max(TURN + 1, p.vtd - dec * 2.5);
        it.straight((p.vtd * p.vtd - v1 * v1) / (2 * dec), v1, { y, th: ground * DEG });
        // brake to turn speed, roll on to the exit
        const bx = ap.bays.find((b) => b.kind === type.kind)!.x;
        const xStop = it.x + (v1 * v1 - TURN * TURN) / (2 * dec);
        const exit = ap.exits.find((x) => x - ap.turnR >= xStop && x >= bx + 5) ?? ap.exits[ap.exits.length - 1];
        it.straight(xStop - it.x, TURN);
        if (exit - ap.turnR > it.x + 0.01) it.straight(exit - ap.turnR - it.x, TURN);
        // off the runway: a right turn onto the exit
        it.turn(ap.turnR, Math.PI / 2, TURN, { e: 0.1 });
        return { itin: it, start, end: it.t, touchdown };
    }

    /** The rest of a plane's day: taxi in, the tug, its stay, the tug again, taxi out, take-off and away. */
    private ground(type: AircraftType, it: Itin, tugJobs: Piece[][], touchdown: number): Leg[] {
        const ap = this.airport, sh = type.shape, y = ap.pave, r = ap.turnR;
        const bay = ap.bays.find((b) => b.kind === type.kind)!;
        const X = bay.x;
        // the exit's straight, then a right turn onto taxiway A, westbound
        it.straight(ap.taxiZ - r - it.z, TURN);
        it.turn(r, Math.PI / 2, TURN);
        // west along A to its turn in, left into the apron
        const ru = UTURN_R;
        cruise(it, it.x - (X - 2 * ru + r), TAXI, TURN);
        it.turn(r, -Math.PI / 2, APRON_V);
        // south to the U-turn, then the U-turn (left) to stop facing north, its wingtips DOOR_GAP m from the doors at the turn's bottom
        const zu = ap.doorZ - DOOR_GAP - ru - sh.half;
        if (zu > it.z + 0.5) it.straight(zu - it.z, APRON_V);
        else throw new Error(`no room for the ${type.perf.name}'s U-turn`);
        it.turn(ru, -Math.PI, 0.5, { e: 0.1 }).straight(0.25, 0);
        // engines off
        it.wait(20, { e: 0 });
        // the tug: from its rest to the nose, the push back into the hangar (tail first), and home; later the pull out
        const tug = ap.tugs[bay.hangar];
        const zIn = ap.doorZ + bay.depth - 2 + sh.tail; // the origin where the tail is 2 m from the back wall (tail is -)
        const dIn = zIn - it.z;
        const zc = it.z - sh.nose - TOW_BAR - TUG_HALF;
        if (dIn < 1 || ap.doorZ + 1 > zIn - sh.nose) throw new Error(`the ${type.perf.name} does not fit its hangar`);
        // the tug crosses the apron 3 m out from the door line
        const lane = ap.doorZ - 3 - TUG_R;
        /** A tug job asked for at tWant: when its tow starts (booked, or only looked up when !book). */
        const job = (tWant: number, zTug: number, push: boolean, book = true): number => {
            const make = (t0: number): { t: Itin; moveStart: number } => {
                const t = new Itin(tug.x, tug.z, 0, 1, y, { t: t0 });
                tugTo(t, X, zTug, lane);
                t.wait(20);
                const moveStart = t.t;
                cruiseTow(t, dIn, !push);
                t.wait(15);
                tugHome(t, tug.x, tug.z, lane);
                return { t, moveStart };
            };
            // how long the job takes (a dry run), then the first time the tug is free for all of it
            const len = make(0).t.t;
            const booking = this.tugs[bay.hangar];
            const tStart = book ? booking.first(tWant, len) : booking.find(tWant, len);
            const { t, moveStart } = make(tStart);
            if (book) tugJobs[bay.hangar].push({ legs: t.legs });
            return moveStart;
        };
        // the tug sets off once the plane has stopped; the plane goes when it is hooked up
        const pushAt = job(it.t - 15, zc, true);
        it.wait(pushAt - it.t);
        cruiseTow(it, dIn, true);
        // in the hangar for its stay; then out when the tug and, by the time it reaches the hold, the runway are free (the
        // tower holds it in the hangar rather than in a queue at the hold): how long from the tow's start to the hold
        const out = (it2: Itin): void => {
            cruiseTow(it2, dIn, false);
            // the tug unhooks and backs away (15 s + its way home), the engines start
            it2.wait(45, { e: 0.15 });
            it2.wait(25, { e: 0.25 });
            // north to taxiway A, a left turn onto it, west to the hold
            it2.straight(it2.z - (ap.taxiZ + r), APRON_V);
            it2.turn(r, -Math.PI / 2, TURN, { e: 0.3 });
            cruise(it2, it2.x - ap.holdX, TAXI, 0);
        };
        const dry = new Itin(it.x, it.z, it.hx, it.hz, y, { t: 0 });
        out(dry);
        const toHold = dry.t;
        const dep = this.departure(type, new Itin(dry.x, dry.z, dry.hx, dry.hz, y, { t: 0, e: 0.3 }));
        // the first time (5 s steps) from which it waits at the hold no more than 20 s
        let want = it.t + this.schedule[type.kind].stay, go = 0;
        for (const end = want + AIR_DAY; ; want += 5) {
            const hold = job(want, zc + dIn, false, false) + toHold;
            go = this.runway.find(hold + 10, dep.busy);
            if (go - 10 - hold <= 20) break;
            if (want > end) throw new Error(`no time for the ${type.perf.name} to leave`);
        }
        const pullAt = job(want, zc + dIn, false);
        this.runway.keep(go, go + dep.busy);
        it.wait(pullAt - it.t);
        out(it);
        if (go < it.t) throw new Error(`the ${type.perf.name} misses its runway slot`);
        it.wait(go - it.t);
        this.departure(type, it);
        this.events.push({ kind: type.kind, touchdown, liftoff: go + dep.liftoff });
        if (it.t - it.legs[0].t0 > AIR_DAY - 30) throw new Error(`the ${type.perf.name}'s day is longer than the airport's`);
        return it.legs;
    }

    /**
     * From the hold on taxiway A: onto the entry, line up on runway 09, the take-off roll, rotation, the climb out east and
     * away. Returns how long the runway is busy from the start (until it is 150 m up) and when it lifts off, from the start.
     */
    private departure(type: AircraftType, it: Itin): { busy: number; liftoff: number } {
        const ap = this.airport, p = type.perf, r = ap.turnR, R = ap.runway, y = ap.pave;
        const t0 = it.t;
        it.straight(it.x - (ap.entryX + r), TURN, { e: 0.3 });
        it.turn(r, Math.PI / 2, TURN);
        it.straight(ap.taxiZ - r - (R.z + r), TURN);
        it.turn(r, Math.PI / 2, 2);
        it.straight(5, 0);
        it.wait(5, { e: 0.4 });
        // take-off power and the roll: a constant acceleration to lift-off speed in the type's ground roll
        const acc = (p.vlof * p.vlof) / (2 * p.toRoll);
        const vr = 0.92 * p.vlof;
        if (p.taildragger) {
            // the tail comes up first
            const v1 = 0.5 * p.vlof;
            it.straight((v1 * v1) / (2 * acc), v1, { e: 1, th: 1 * DEG });
            it.straight((vr * vr - v1 * v1) / (2 * acc), vr);
        } else it.straight((vr * vr) / (2 * acc), vr, { e: 1 });
        // rotation to lift-off
        it.straight((p.vlof * p.vlof - vr * vr) / (2 * acc), p.vlof, { th: p.pitchLof * DEG });
        const liftoff = it.t - t0;
        // the first climb, accelerating to climb speed at half the roll's acceleration [estimate] (gear up on the way)
        const gamma = datan(p.roc / Math.sqrt(p.vclimb * p.vclimb - p.roc * p.roc));
        const tg = dsin(gamma) / dcos(gamma);
        const d1 = (p.vclimb * p.vclimb - p.vlof * p.vlof) / acc;
        it.straight(d1, p.vclimb, { y: y + d1 * tg * 0.6, th: p.pitchClimb * DEG, g: p.retract ? 0 : 1 });
        const busy = liftoff + DEPARTED_AFTER;
        // climbing on to the height it leaves at, then on east out of sight
        it.straight((AWAY_Y - it.y) / tg, p.vclimb, { y: AWAY_Y, th: (gamma / DEG + 3) * DEG });
        const toGo = AWAY_X - it.x;
        if (toGo > 1) it.straight(toGo, p.vclimb, { th: 3 * DEG, e: 0.8 });
        return { busy, liftoff };
    }

    // ---------------------------------------------------------------- the helicopter

    /**
     * The air ambulance's day: for each trip, rotors up on the airport pad, lift into the hover, turn towards the hospital,
     * a climbing transition to 70 m, cruise, a decelerating approach to the hover 6 m over the hospital pad, settle; the
     * medics wheel the patient in (their legs are added to `medics`); lift, turn, back the same way, settle, rotors down.
     * Each crossing of the airport waits on its pad until the runway is free [the tower's clearance].
     */
    private heliDay(medics: Piece[][]): Leg[] {
        const ap = this.airport, A = ap.heliPad, H = ap.hospitalPad;
        const it = new Itin(A.x, A.z, 0, -1, A.y, { t: this.heliTrips[0] });
        for (const t of this.heliTrips) {
            if (t > it.t) it.wait(t - it.t);
            // rotors up (40 s), then wait for the runway
            it.wait(40, { e: 1 });
            const leg = this.heliLeg(new Itin(A.x, A.z, it.hx, it.hz, A.y, { t: 0, e: 1 }), H.x, H.z, H.y);
            const go = this.runway.first(it.t, leg.cross);
            it.wait(go - it.t, { e: 1 });
            this.heliLeg(it, H.x, H.z, H.y);
            // on the roof: rotors at flight idle, the medics out with the stretcher
            const landed = it.t;
            this.walkIn(medics, it, landed + 8);
            it.wait(75, { e: 0.8 });
            it.wait(5, { e: 1 });
            const back = this.heliLeg(new Itin(H.x, H.z, it.hx, it.hz, H.y, { t: 0, e: 1 }), A.x, A.z, A.y);
            // over the airport the runway must be free: book the way back's crossing for its last part
            const goBack = this.runway.first(it.t + back.total - back.cross, back.cross) - (back.total - back.cross);
            it.wait(Math.max(0.001, goBack - it.t), { e: 1 });
            this.heliLeg(it, A.x, A.z, A.y);
            it.wait(50, { e: 0 });
        }
        return it.legs;
    }

    /**
     * One flight from where `it` stands on a pad to the pad at (x, z, y): lift to 4 m, turn to face it, the transition and
     * climb, cruise at 70 m, the approach to a 6 m hover over it, settle. Returns its length in time and how much of it
     * (from the start for an outbound, the end for an inbound: the same, as the airport is at one end) crosses the airport.
     */
    private heliLeg(it: Itin, x: number, z: number, y: number): { total: number; cross: number } {
        const t0 = it.t;
        const y0 = it.y;
        it.rise(y0 + 1.5, 3, { e: 1 }).rise(y0 + 4, 3);
        const dx = x - it.x, dz = z - it.z, d = Math.sqrt(dx * dx + dz * dz);
        const hx = dx / d, hz = dz / d;
        it.spinTo(hx, hz, 5);
        it.jump(it.x, it.z, hx, hz, it.y, 0.0001);
        const CR = 70, V = 30;
        const up = 200, down = 260;
        it.straight(up, V, { y: Math.max(CR, y + 30), th: -10 * DEG });
        it.straight(d - up - down, V, { th: -4 * DEG });
        it.straight(down, 0.0001, { y: y + 6, th: 8 * DEG });
        it.wait(3, { th: 0 });
        it.rise(y + 1, 5).rise(y, 2, { e: 0.9 });
        const total = it.t - t0;
        return { total, cross: Math.min(total, 30) };
    }

    /** The medics wheeling the stretcher from the helicopter (landed, `it`'s place) to the stair house and in, from time t. */
    private walkIn(medics: Piece[][], it: Itin, t: number): void {
        const D = this.airport.hospitalDoor, H = this.airport.hospitalPad;
        // out of its right-hand door, 1.6 m from its middle
        const sx = -it.hz, sz = it.hx;
        const door = [it.x + sx * 1.6, it.z + sz * 1.6];
        const V = 1.0;
        const route: [number, number, number][] = [
            [door[0], H.y, door[1]],
            [D.out[0] - 11, H.y, D.out[2]],
            [D.out[0] - 9.5, D.out[1], D.out[2]],
            [D.out[0], D.out[1], D.out[2]],
            [D.in[0], D.in[1], D.in[2]]
        ];
        // the front medic, the stretcher 1.5 m behind, the back medic 1.5 m behind that
        for (let k = 0; k < 3; k++) {
            const t0 = t + (k * 1.5) / V;
            const [x0, y0, z0] = route[0];
            const w = new Itin(x0, z0, 1, 0, y0, { t: t0 });
            w.jump(x0, z0, 1, 0, y0, V);
            for (let j = 1; j < route.length; j++) {
                const [x, yy, z] = route[j];
                const dx = x - w.x, dz = z - w.z;
                if (dx * dx + dz * dz < 0.01) continue;
                w.to(x, z, V, { y: yy });
            }
            medics[k].push({ legs: w.legs });
        }
    }

    // ---------------------------------------------------------------- placing

    /** Mover i's place at `tick` (fractions too, for drawing). */
    place(i: number, tick: number, out: AirPlace): AirPlace {
        const m = this.movers[i];
        const t = tick * DT;
        let tau = t - Math.floor(t / AIR_DAY) * AIR_DAY;
        let k = legAt(m.legs, tau);
        if (k < 0) {
            k = legAt(m.legs, tau + AIR_DAY);
            if (k >= 0) tau += AIR_DAY;
        }
        if (k < 0) return copyPlace(m.rest, out);
        return placeOnLeg(m.legs[k], tau, out);
    }
}

/** A tow: `d` m straight at walking pace and to a stop, the mover backing (push) or going ahead (pull). */
function cruiseTow(it: Itin, d: number, back: boolean): void {
    if (d <= 0.05) return;
    const ramp = Math.min(2, d / 3);
    it.straight(ramp, TOW, { rev: back }).straight(d - 2 * ramp, TOW, { rev: back }).straight(ramp, 0, { rev: back });
}

/** A tug backing straight up `d` m: to 3 m/s and to a stop [estimate]. */
function backUp(it: Itin, d: number): void {
    const ramp = Math.min(3, d / 3);
    it.straight(ramp, 3, { rev: true }).straight(d - 2 * ramp, 3, { rev: true }).straight(ramp, 0, { rev: true });
}

function copyPlace(a: AirPlace, out: AirPlace): AirPlace {
    out.x = a.x; out.y = a.y; out.z = a.z;
    out.f[0] = a.f[0]; out.f[1] = a.f[1]; out.f[2] = a.f[2];
    out.u[0] = a.u[0]; out.u[1] = a.u[1]; out.u[2] = a.u[2];
    out.s[0] = a.s[0]; out.s[1] = a.s[1]; out.s[2] = a.s[2];
    out.e = a.e; out.g = a.g; out.hidden = a.hidden; out.run = 0; out.v = 0;
    return out;
}

/** The airport's traffic for a level (null: switched off, or a level without an airport). */
export function makeAir(level: Level, on: boolean | undefined): AirTraffic | null {
    if (!on || !level.airport) return null;
    return new AirTraffic(level);
}
