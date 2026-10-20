// The page: the menus, the HUD and every input (radio, keyboard, mouse). The engine (flight session, Three.js
// scene, frame loop: engine/engine.ts) runs on this page by default. ?render=worker runs it in a worker drawing to
// this page's canvas instead (docs/notes/browsers-input-performance.md §0i): input arrives sooner there, but the owner felt stutters every 5-10 s
// in Firefox and chose the page (2026-10-18). URL options: ?selftest runs the determinism check, ?demo flies the
// self-test's scripted sticks in real time (no radio needed; ?demo=tricks flies flips and rolls for the grader), ?webgl forces WebGL 2, ?spawn=<id> starts at a spawn
// point, ?cam=chase starts in the chase view, ?noshadows turns the sun's shadows off (for slow GPUs, and to measure
// what they cost), ?lowspec turns low spec mode on for this visit (?lowspec=0 off), ?render=worker runs the engine in a worker.

import './style.css';
import { S, compileParams } from '@owfpv/sim-core';
import type { ParamOverrides, PresetJson } from '@owfpv/sim-core';
import { mapFrame, switchOn } from '@owfpv/input';
import type { RadioProfile, RawFrame } from '@owfpv/input';
import type { TrafficConfig } from '@owfpv/traffic';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { clearStoredSettings, defaultSettings, loadCollection, loadProfile, loadSettings, loadTrialTimesRaw, saveCollection, saveProfile, saveSettings, saveTrialTimesRaw } from './settings';
import { courseKey, formatDelta, formatTime, parseTrialTimes, recordRun } from './trial-times';
import type { CourseTimes } from './trial-times';
import type { TrialEvent } from './trials';
import { TrialPrompt } from './ui/trial-prompt';
import { TrialsUi } from './ui/trials-ui';
import type { HudExtra } from './ui/hud';
import { HidSource } from './devices/hid';
import { GamepadSource, gamepadKey, padClock } from './devices/gamepad';
import { findSavedGamepad, findSavedHid } from './devices/reconnect';
import { Hud } from './ui/hud';
import { RadioSetup } from './ui/radio-setup';
import { SettingsUi, closeButton } from './ui/settings-ui';
import type { SettingsTab } from './ui/settings-ui';
import { CollectionUi } from './ui/collection-ui';
import { FlightsUi } from './ui/flights-ui';
import { clearFlights, deleteFlight, getFlight, listFlights, putFlight } from './flight-store';
import { flightFromJson, flightToJson } from './flights';
import type { CheckResult, Flight } from './flights';
import { ReplayUi } from './ui/replay-ui';
import { RadioReplayControl } from './replay';
import type { Track } from './replay';
import type { CheckReply } from './check-worker';
import { h, clear } from './ui/dom';
import type { Child } from './ui/dom';
import { localPorts } from './engine/protocol';
import type { EngineMsg, EngineReport, EngineSettings, HudSnapshot, InitMsg, PageMsg, Port, PropInfo, TrialInfo } from './engine/protocol';
import { ReportUi } from './ui/report-ui';
import { ErrorLog } from './report';
import type { PageReport } from './report';
import { PRESET_NAMES, cheaperPreset, graphicsFromParam, isLowSpec, trafficAllowed } from './graphics';
import { AudioEngine } from './audio/audio';
import type { SoundLevels } from './audio/audio';
import { bladesOf } from './audio/quad-sound';

/** the last errors and warnings this page logged, for bug reports (report.ts); the console still gets them */
const errorLog = new ErrorLog();
for (const kind of ['error', 'warn'] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => {
        errorLog.add(kind, args);
        original(...args);
    };
}
addEventListener('error', (e) => errorLog.add('uncaught', [e.error ?? e.message]));
addEventListener('unhandledrejection', (e) => errorLog.add('unhandled rejection', [e.reason]));

const params = new URLSearchParams(location.search);
const preset = nazgul as unknown as PresetJson;
const settings = loadSettings();
const presetRates = compileParams(preset).rates;
const demo = params.has('demo');

function overrides(): ParamOverrides {
    // crashOn always set: off means every hit is a bounce, no damage, no crash (the owner's default for now);
    // classicPhysics only when chosen, so the default flight's overrides stay as they were
    const o: ParamOverrides = settings.rates ? { rates: settings.rates, crashOn: settings.damage } : { crashOn: settings.damage };
    if (settings.classicPhysics) o.classicPhysics = true;
    return o;
}

function trafficConfig(): TrafficConfig {
    // extra and super low spec: no traffic, whatever the switches say (they keep the pilot's choice for the other levels)
    // the train is cheap to draw (eight draws), so it runs at every graphics level unless its own switch is off
    if (!trafficAllowed(graphicsNow)) return { cars: false, people: false, signals: false, train: settings.train };
    return { cars: settings.cars, people: settings.people, signals: settings.signals, train: settings.train };
}

function soundLevels(): SoundLevels {
    return { on: settings.sound, master: settings.volume, quad: settings.quadVolume, world: settings.worldVolume, ambience: settings.ambienceVolume, effects: settings.effectsVolume, lowLatency: settings.soundLowLatency };
}

/**
 * The sound (audio/audio.ts): the quad from its rotor speeds, the trains, the city and park, the game's beeps. It starts
 * on the first click or key press (browsers only play sound after one). The Nazgul's props are 3-blade; a hover takes
 * 1 / sqrt(thrust-to-weight) of the top rotor speed.
 */
const presetFields = (preset as unknown as { fields: Record<string, { value: unknown }> }).fields;
const sound = new AudioEngine(soundLevels(), {
    blades: bladesOf(String(presetFields.prop?.value ?? '')),
    hoverShare: 1 / Math.sqrt(Number(presetFields.twr?.value ?? 4)),
    axles: [],
    base: new URL('sounds/', document.baseURI).href,
    onCrackle: () => {
        settings.soundLowLatency = false;
        saveSettings(settings);
    }
});
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => sound.unlock(), { capture: true });

function engineSettings(): EngineSettings {
    return { uptiltDeg: settings.uptiltDeg, fovDeg: settings.fovDeg, lens: settings.lens, renderScale: settings.renderScale, shadowReach: settings.shadowReach, overrides: overrides(), traffic: trafficConfig(), spawn: settings.spawn };
}

// ---------------------------------------------------------------- keys, mouse, free-fly camera (state)

/** "Look around" without a radio: the engine flies the camera; the page captures the mouse and sends what moves it */
const held = new Set<string>();
let dragging = false;
let lookDx = 0, lookDy = 0;
let camDirty = false;

function attachMouse(c: HTMLCanvasElement): void {
    // dragging with a button held also steers, for when the browser refuses pointer lock
    c.addEventListener('mousedown', () => {
        if (!freeLook()) return;
        dragging = true;
        if (!mouseCaptured()) c.requestPointerLock()?.catch(() => undefined);
    });
}

// ---------------------------------------------------------------- engine

// read once: switching shadows on a running page crashed Three.js (castShadow toggled), so the setting applies on reload
// the graphics level too (it picks the renderer); ?lowspec, ?lowspec=extra, ?lowspec=super or ?lowspec=0 say one for this visit
const graphicsNow = graphicsFromParam(params.get('lowspec')) ?? settings.graphics;
const lowSpecOn = isLowSpec(graphicsNow);
const shadowsOn = settings.shadows && !params.has('noshadows') && !lowSpecOn;
let canvas = newCanvas();
let engine: Port;
let worker: Worker | null = null;
let engineReady = false;
let backend = 'starting…';
let spawns: { id: string; name: string }[] = [];
let spawnId = params.get('spawn') ?? settings.spawn;
let hudSnap: HudSnapshot | null = null;
const asks = new Map<number, (r: { ok: boolean; value: unknown }) => void>();
const reports = new Map<number, (s: EngineReport) => void>();
let askId = 0;
let sentPaused: boolean | null = null;
/** the golden props: every one on this map (from the engine), and the ones found, by map id (kept in this browser) */
let props: PropInfo[] = [];
let mapId = '';
const collection = loadCollection();
const found = (): number[] => collection[mapId] ?? [];
/** the time trial courses (from the engine) and the pilot's times, by map id, by course (kept in this browser) */
let trials: TrialInfo[] = [];
const trialTimes = parseTrialTimes(loadTrialTimesRaw());
const timesOf = (t: TrialInfo): CourseTimes | null => trialTimes[mapId]?.[courseKey(t.id, t.version)] ?? null;
/** page times (ms) until which the HUD shows GO! and FALSE START */
let goUntil = 0;
let falseStartUntil = 0;
/** this visit's saved flight (flights.ts): named by when the page started; nothing in the sim reads it */
const flightId = Date.now();

function newCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    document.body.prepend(c);
    attachMouse(c);
    return c;
}

function initMsg(): InitMsg {
    return {
        type: 'init', timeOrigin: performance.timeOrigin, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        search: location.search, shadows: shadowsOn, graphics: graphicsNow, settings: engineSettings(), collection, flightId
    };
}

function send(m: PageMsg): void {
    engine.postMessage(m);
}

function startWorkerEngine(): void {
    const w = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    w.onmessage = onEngine;
    w.onerror = (e) => fallBack(e.message || 'the engine worker failed to load');
    const off = canvas.transferControlToOffscreen();
    w.postMessage({ ...initMsg(), canvas: off }, [off]);
    engine = w;
}

/** The engine on this page: the same messages as a worker, handed over directly (no copies; protocol.ts localPorts). */
function startPageEngine(): void {
    const [pagePort, enginePort] = localPorts();
    pagePort.onmessage = onEngine;
    engine = pagePort;
    void import('./engine/engine').then(({ startEngine }) => startEngine(enginePort, canvas, initMsg())).catch((err: unknown) => {
        onEngine({ data: { type: 'error', message: err instanceof Error ? err.message : String(err) } } as MessageEvent<EngineMsg>);
    });
}

/** The worker could not start the engine: run it on the page instead, on a fresh canvas (the old one was transferred). */
function fallBack(why: string): void {
    if (!worker || engineReady) return;
    console.warn(`Engine worker failed (${why}); running the engine on the page.`);
    worker.terminate();
    worker = null;
    canvas.remove();
    canvas = newCanvas();
    startPageEngine();
    // what the worker was told is lost with it
    sentPaused = null;
    syncPause();
    send({ type: 'radio', on: profile !== null });
}

function onEngine(e: MessageEvent<EngineMsg>): void {
    const m = e.data;
    if (m.type === 'ready') {
        engineReady = true;
        backend = m.backend;
        spawns = m.spawns;
        spawnId = m.spawn;
        props = m.props;
        trials = m.trials;
        mapId = m.mapId;
        sound.setAxles(m.axles);
        sendFlown();
        renderMenu();
    } else if (m.type === 'trial') {
        onTrial(m.e);
    } else if (m.type === 'flight') {
        void putFlight(m.flight).then((ok) => {
            if (!ok) console.warn('This browser did not keep the flight (storage blocked or full).');
        });
    } else if (m.type === 'collect') {
        const mine = (collection[mapId] ??= []);
        for (const n of m.n) {
            if (mine.includes(n)) continue;
            mine.push(n);
            sound.collect();
            const p = props[n - 1];
            hud.toast(`GOLDEN PROP #${n}`, `${mine.length} / ${props.length} found${p ? ` · ${p.spot}` : ''}`);
        }
        saveCollection(collection);
        collectionUi.refresh();
    } else if (m.type === 'audio') {
        sound.frame(m.a);
    } else if (m.type === 'hud') {
        hudSnap = m.hud;
        drawHud();
    } else if (m.type === 'error') {
        if (worker && !engineReady) return fallBack(m.message);
        menuMsg = `The renderer failed: ${m.message}`;
        renderMenu();
    } else if (m.type === 'report') {
        reports.get(m.id)?.(m.state);
        reports.delete(m.id);
    } else if (m.type === 'answer') {
        asks.get(m.id)?.({ ok: m.ok, value: m.value });
        asks.delete(m.id);
    } else if (m.type === 'replay-at') {
        if (replayUi.open) replayUi.at(m.tick, m.playing);
    }
}

const engineWhere = (): string => (worker ? 'in a worker' : 'on the page');
const workerCanvas = typeof canvas.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined';
if (workerCanvas && params.get('render') === 'worker') startWorkerEngine();
else startPageEngine();
addEventListener('resize', () => send({ type: 'resize', width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));

// ---------------------------------------------------------------- input

interface Device { kind: 'hid' | 'gamepad'; key: string; name: string; hid?: HidSource; pad?: GamepadSource }
let device: Device | null = null;
let profile: RadioProfile | null = null;
let keyArm = false;
/** the turtle switch for a radio without one (T key) */
let keyTurtle = false;
let resetWas = false;
let rate = { n: 0, t0: 0, hz: 0 };
const ch = new Float32Array(8);

function onRaw(f: RawFrame): void {
    rate.n++;
    if (f.t - rate.t0 >= 1000) rate = { n: 0, t0: f.t, hz: Math.round((rate.n * 1000) / (f.t - rate.t0)) };
    if (setup.open) {
        setup.feed(f);
        return;
    }
    if (!profile || demo) return;
    mapFrame(profile, f, ch, { arm: profile.arm ? undefined : keyArm, turtle: profile.turtle ? undefined : keyTurtle, fallbackMode: settings.mode });
    // the time trial offer is answered with the sticks (the engine holds them centred for the quad meanwhile)
    if (trialPrompt.open) trialPrompt.feed(ch);
    // watching a replay: the sticks fly nothing; with the option on, deliberate moves steer the replay (replay.ts)
    if (replayUi.open) {
        if (!replayUi.radioOn) return;
        const r = radioReplay.update(ch);
        if (r.toggle) replayUi.togglePlay();
        if (r.shuttle !== sentShuttle) {
            sentShuttle = r.shuttle;
            send({ type: 'replay-ctl', shuttle: r.shuttle });
        }
        return;
    }
    // the engine stamps it on its own clock (protocol.ts pageToEngineMs) and disarms a radio that went quiet
    send({ type: 'input', ch, t: f.t });
    const r = switchOn(profile.reset, f);
    if (r && !resetWas) send({ type: 'reset' });
    resetWas = r;
}

function setProfile(p: RadioProfile | null): void {
    profile = p;
    send({ type: 'radio', on: p !== null });
}

function useDevice(d: Device, p: RadioProfile | null): void {
    if (device && device !== d) {
        device.hid?.close();
        device.pad?.stop();
    }
    device = d;
    setProfile(p);
    if (d.hid) d.hid.onFrame = onRaw;
    if (d.pad) d.pad.onFrame = onRaw;
    settings.lastDevice = d.key;
    saveSettings(settings);
    renderMenu();
}

async function connectHid(): Promise<void> {
    const src = new HidSource();
    let dev: HIDDevice | null = null;
    try {
        dev = await src.request();
    } catch (e) {
        menuMsg = `Could not open the device: ${(e as Error).message}`;
    }
    if (!dev) return renderMenu();
    await src.open(dev);
    // the profile key includes the report length: wait for the first report
    await new Promise<void>((res) => {
        const t = setTimeout(res, 1500);
        src.onFrame = () => { clearTimeout(t); src.onFrame = null; res(); };
    });
    const key = src.key || `hid:${dev.vendorId.toString(16)}:${dev.productId.toString(16)}:${dev.productName}`;
    menuMsg = src.reports === 0 ? 'The radio sends nothing yet. Is it in USB Joystick mode?' : '';
    useDevice({ kind: 'hid', key, name: dev.productName || 'HID device', hid: src }, loadProfile(key));
}

function connectGamepad(): void {
    if (!navigator.getGamepads) {
        menuMsg = 'This browser gives the page no gamepads. Open the sim from localhost or https.';
        return renderMenu();
    }
    const pad = new GamepadSource();
    menuMsg = 'Move a stick or press a button on the controller…';
    renderMenu();
    pad.onConnect = (g) => {
        menuMsg = '';
        const key = gamepadKey(g);
        useDevice({ kind: 'gamepad', key, name: g.id, pad }, loadProfile(key));
    };
    pad.start();
}

async function reconnect(): Promise<void> {
    const hid = await findSavedHid((k) => loadProfile(k), settings.lastDevice).catch(() => null);
    if (hid?.hid) return useDevice({ kind: 'hid', key: hid.profile.deviceKey, name: hid.profile.deviceName, hid: hid.hid }, hid.profile);
    const pad = await findSavedGamepad((k) => loadProfile(k)).catch(() => null);
    if (pad?.gamepad) useDevice({ kind: 'gamepad', key: pad.profile.deviceKey, name: pad.profile.deviceName, pad: pad.gamepad }, pad.profile);
}

// ---------------------------------------------------------------- screens

const hud = new Hud();
const setup = new RadioSetup();
const settingsUi = new SettingsUi();
const collectionUi = new CollectionUi();
const trialsUi = new TrialsUi();
const trialPrompt = new TrialPrompt();
const flightsUi = new FlightsUi();
const reportUi = new ReportUi();
const replayUi = new ReplayUi();
const radioReplay = new RadioReplayControl();
let sentShuttle = 0;
const menuBody = h('div');
const menuPanel = h('div', { class: 'panel' }, menuBody);
const menu = h('div', { class: 'overlay' }, menuPanel);
/** the pilot has left the title card (Start flying): from then on Esc opens the pause menu */
let started = demo;
document.body.append(hud.el, trialPrompt.el, menu, setup.el, settingsUi.el, collectionUi.el, trialsUi.el, flightsUi.el, reportUi.el, replayUi.el);
let menuMsg = '';

/** a screen is open: the sim pauses (the replay viewer too: it plays a track, the sim stays where it was) */
function anyOverlay(): boolean {
    return !menu.classList.contains('hidden') || setup.open || settingsUi.open || collectionUi.open || trialsUi.open || flightsUi.open || reportUi.open || replayUi.open;
}

function showMenu(on: boolean): void {
    menu.classList.toggle('hidden', !on);
    if (on && mouseCaptured()) document.exitPointerLock();
    if (on) renderMenu();
}

/** radio setup, opened from Settings > Radio and controls; back there when it ends */
function openSetup(): void {
    if (!device) return;
    const d = device;
    settingsUi.hide();
    setup.show({ key: d.key, name: d.name, nAxes: 8 }, settings.stickMode, (p) => {
        saveProfile(p);
        settings.stickMode = p.stickMode;
        saveSettings(settings);
        setProfile(p);
        openSettings();
    }, openSettings);
}

function openSettings(): void {
    showMenu(false);
    confirmData = null;
    settingsUi.show({
        settings,
        presetRates,
        onCamera: () => send({ type: 'settings', what: 'camera', settings: engineSettings() }),
        onFlight: () => send({ type: 'settings', what: 'flight', settings: engineSettings() }),
        onTraffic: () => send({ type: 'settings', what: 'traffic', settings: engineSettings() }),
        onGraphics: () => send({ type: 'settings', what: 'graphics', settings: engineSettings() }),
        onSound: () => sound.setLevels(soundLevels()),
        shadowsPending: () => settings.shadows !== shadowsOn && !params.has('noshadows') && !lowSpecOn,
        graphicsNow,
        graphicsPending: () => settings.graphics !== graphicsNow && graphicsFromParam(params.get('lowspec')) === null,
        save: () => saveSettings(settings),
        close: () => { settingsUi.hide(); showMenu(true); },
        pageSections
    });
}

function openCollection(): void {
    showMenu(false);
    collectionUi.show({
        props,
        isTaken: (n) => found().includes(n),
        reset: () => {
            collection[mapId] = [];
            saveCollection(collection);
            send({ type: 'collection', taken: [] });
        },
        close: () => { collectionUi.hide(); showMenu(true); }
    });
}

function openTrials(): void {
    showMenu(false);
    trialsUi.show({
        trials,
        times: timesOf,
        reset: () => {
            trialTimes[mapId] = {};
            saveTrialTimesRaw(trialTimes);
            sendFlown();
        },
        close: () => { trialsUi.hide(); showMenu(true); }
    });
}

/** Which courses the pilot has a time on, to the engine: their pads keep only the TIME TRIAL sign. */
function sendFlown(): void {
    send({ type: 'trial-flown', flown: trials.map((t) => timesOf(t) !== null) });
}

/** What the engine says happened in a time trial (trials.ts): the offer, false starts, GO, the finish. */

function onTrial(e: TrialEvent): void {
    const t = trials[e.course];
    if (!t) return;
    sound.trial(e.type);
    if (e.type === 'ask') {
        const c = timesOf(t);
        if (mouseCaptured()) document.exitPointerLock();
        trialPrompt.show({ name: t.name, area: t.area, gates: t.gates.length, best: c ? formatTime(c.best) : null, stickMode: profile?.stickMode ?? settings.stickMode },
            (a) => send({ type: 'trial', act: a }));
    } else if (e.type === 'false-start') {
        falseStartUntil = performance.now() + 1500;
    } else if (e.type === 'go') {
        goUntil = performance.now() + 800;
    } else if (e.type === 'finish') {
        const r = recordRun(trialTimes, mapId, courseKey(t.id, t.version), e.ms, Date.now());
        saveTrialTimesRaw(trialTimes);
        const vs = r.previous === null ? 'First time on this course'
            : r.best ? `New best, ${formatDelta(r.ms - r.previous)} (was ${formatTime(r.previous)})` : `${formatDelta(r.ms - r.previous)} on your best ${formatTime(r.previous)}`;
        hud.result(t.name, formatTime(e.ms), vs, r.previous === null ? '' : r.best ? 'best' : 'slower');
        sendFlown();
        trialsUi.refresh();
    } else if (e.type === 'quit') {
        hud.toast('TIME TRIAL LEFT', t.name);
    }
}

/** The next gate's name and how far it is from the quad, m. */
function nextGate(x: HudSnapshot, t: TrialInfo, gate: number): string {
    const at = t.at[gate];
    if (!at) return '';
    const d = Math.hypot(at[0] - x.s[S.px], at[1] - x.s[S.py], at[2] - x.s[S.pz]);
    return `${t.gates[gate]} · ${Math.round(d)} m`;
}

/** The HUD's time trial parts from the engine's status (trials.ts TrialStatus). */

function raceHud(x: HudSnapshot): Pick<HudExtra, 'race' | 'count' | 'padHint'> {
    const st = x.trial, t = trials[st.course], now = performance.now();
    const none = { race: null, count: null, padHint: '' };
    if (!t) return none;
    if (st.phase === 'free') return { ...none, padHint: st.hold > 0 ? `${t.name.toUpperCase()} · stay on the pad` : '' };
    if (st.phase === 'asking') return none;
    const falseStart = now < falseStartUntil ? { text: 'FALSE START', kind: 'small' as const } : null;
    if (st.phase === 'countdown') {
        return {
            race: { clock: formatTime(0), line: t.name, next: `First: ${t.gates[0]}` },
            count: falseStart ?? (st.toGo === null ? null : { text: String(Math.max(1, Math.ceil(st.toGo / 1000))), kind: '' }),
            padHint: ''
        };
    }
    return {
        race: { clock: formatTime(st.ms), line: `${t.name} · GATE ${Math.min(st.gate + 1, st.gates)} / ${st.gates}`, next: nextGate(x, t, st.gate) },
        count: falseStart ?? (now < goUntil ? { text: 'GO!', kind: 'go' } : null),
        padHint: ''
    };
}

/** checks and replay tracks are made in a worker (check-worker.ts), so a long replay does not freeze the page */
let checker: Worker | null = null;
let checkSeq = 0;
const checking = new Map<number, (r: CheckReply) => void>();

function toChecker(want: 'check' | 'track', flight: Flight, onReply: (r: CheckReply) => void): number {
    if (!checker) {
        checker = new Worker(new URL('./check-worker.ts', import.meta.url), { type: 'module' });
        checker.onmessage = (e: MessageEvent<CheckReply>) => checking.get(e.data.id)?.(e.data);
    }
    const seq = ++checkSeq;
    checking.set(seq, onReply);
    checker.postMessage({ id: seq, want, flight });
    return seq;
}

async function checkSaved(id: number): Promise<CheckResult | null> {
    const flight = await getFlight(id);
    if (!flight) return null;
    return new Promise((resolve) => {
        const seq = toChecker('check', flight, (r) => {
            if (!('result' in r)) return;
            checking.delete(seq);
            resolve(r.result);
        });
    });
}

/** the replay viewer: the flight is flown again in the worker to make its track, then the engine plays the track */
let replaySeq = 0;
let replayStarted = false;

async function watchSaved(id: number): Promise<void> {
    flightsUi.hide();
    replayStarted = false;
    replayUi.begin({
        ctl: (m) => send({ type: 'replay-ctl', ...m }),
        exit: closeReplay,
        hasRadio: profile !== null,
        stickMode: profile?.stickMode ?? settings.stickMode
    });
    const title = flightTitle(id);
    replayUi.loading(0, title);
    const flight = await getFlight(id);
    if (!flight) return replayUi.failed('The flight could not be read from this browser.');
    replaySeq = toChecker('track', flight, (r) => {
        if (!replayUi.open) return;
        if ('progress' in r) return replayUi.loading(r.progress, title);
        checking.delete(r.id);
        if ('error' in r) return replayUi.failed(r.error);
        if ('track' in r) startReplay(r.track, title);
    });
}

function startReplay(track: Track, title: string): void {
    replayStarted = true;
    sentShuttle = 0;
    replayUi.cam = 'fpv';
    replayUi.path = 'whole';
    send({ type: 'replay', track, cam: replayUi.cam, path: replayUi.path });
    replayUi.show(track, title);
}

function closeReplay(): void {
    // a track still being made is dropped when it arrives
    checking.delete(replaySeq);
    if (replayStarted) send({ type: 'replay-exit' });
    replayStarted = false;
    if (mouseCaptured()) document.exitPointerLock();
    held.clear();
    camDirty = true;
    replayUi.hide();
    openFlights();
}

const flightTitle = (id: number): string =>
    new Date(id).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function downloadSaved(id: number): Promise<void> {
    const flight = await getFlight(id);
    if (!flight) return;
    const url = URL.createObjectURL(new Blob([flightToJson(flight)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `flight-${new Date(id).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.owfpv.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** a downloaded flight file, kept with the flights flown here (the viewer and the check then treat it the same) */
async function openFlightFile(file: File): Promise<{ id: number } | { error: string }> {
    let flight: Flight;
    try {
        flight = flightFromJson(await file.text());
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    // this visit's flight is saved again every minute and would overwrite it
    if (flight.id === flightId) return { error: 'it is the flight of this visit, already here' };
    if (!(await putFlight(flight, true))) return { error: 'this browser would not store it (private window, or storage full?)' };
    return { id: flight.id };
}

/** The GPU the browser names, read once from a throwaway WebGL context (null when it will not say). */
let gpuName: string | null | undefined;
function gpu(): string | null {
    if (gpuName !== undefined) return gpuName;
    try {
        const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        gpuName = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
        gpuName = null;
    }
    return gpuName;
}

/** The engine's state for a report, or null if it does not answer within 2 s (still starting, or failed). */
function engineReport(): Promise<EngineReport | null> {
    if (!engineReady) return Promise.resolve(null);
    const id = ++askId;
    return new Promise((resolve) => {
        const timer = setTimeout(() => { reports.delete(id); resolve(null); }, 2000);
        reports.set(id, (st) => { clearTimeout(timer); resolve(st); });
        send({ type: 'report', id });
    });
}

function pageReport(saved: boolean): PageReport {
    const input = device
        ? `${device.name} (${device.kind === 'hid' ? 'USB HID' : 'gamepad'}), ${rate.hz} Hz, stick mode ${settings.stickMode}${profile ? '' : ', not set up'}`
        : demo ? 'none: the scripted demo sticks' : 'none: looking around with the mouse and keys';
    return {
        build: __BUILD__, url: location.href, userAgent: navigator.userAgent,
        screen: `${innerWidth} x ${innerHeight} CSS px, ${devicePixelRatio}x`, gpu: gpu(), fps: hudSnap?.fps ?? null,
        engineWhere: engineWhere(), input, settings, savedFlight: saved ? flightId : null,
        uptimeS: performance.now() / 1000, errors: [...errorLog.lines]
    };
}

/** the Report screen, opened from Settings > Help and about; back there when it closes */
function openReport(): void {
    // opened in the same task as Settings closes: with no screen open between them, the sim would run on
    settingsUi.hide();
    void reportUi.show({
        repo: REPO,
        gather: async () => {
            const saved = (await listFlights().catch(() => [])).some((f) => f.id === flightId);
            return { page: pageReport(saved), engine: await engineReport() };
        },
        downloadFlight: () => downloadSaved(flightId),
        close: () => { reportUi.hide(); openSettings(); }
    });
}

function openFlights(): void {
    showMenu(false);
    void flightsUi.show({
        list: listFlights, check: checkSaved, watch: (id) => void watchSaved(id), download: downloadSaved, open: openFlightFile, remove: deleteFlight, currentId: flightId,
        close: () => { flightsUi.hide(); showMenu(true); }
    });
}

const REPO = 'https://github.com/ItsBlunty/Open-World-FPV-Simulator';

const isFirefox = /firefox\//i.test(navigator.userAgent);
/** the "How to connect a radio" box stays open across menu redraws */
let helpOpen = false;

/** Firefox is shelved (docs/decisions.md, owner 2026-10-18); other browsers without WebHID only lose the direct USB path */
function browserNotice(hidOk: boolean): HTMLElement | null {
    if (isFirefox) {
        return h('div', { class: 'callout' },
            h('strong', {}, 'Firefox: limited support for now. '),
            'Radios work only as a gamepad, which Firefox reads at most about 250 times a second, and you may see short stutters. ',
            'For the best experience use Chrome or Edge, which read a USB radio directly at its full rate.');
    }
    if (!hidOk) {
        return h('div', { class: 'callout' },
            h('strong', {}, 'This browser cannot read a USB radio directly '), '(no WebHID). ',
            'Radios and gamepads still work through "Connect radio or gamepad". For the full input rate use Chrome or Edge on a computer.');
    }
    return null;
}

function controllerSection(hidOk: boolean): Child[] {
    const needsSetup = device !== null && profile === null;
    const help = h('details', { class: 'help', ontoggle: (e: Event) => { helpOpen = (e.target as HTMLDetailsElement).open; } },
        h('summary', {}, 'How to connect a radio'),
        h('ol', {},
            h('li', {}, 'Plug the radio into the computer by USB. On an EdgeTX radio choose "USB Joystick (HID)".'),
            h('li', {}, hidOk ? 'Click "Connect USB radio" and pick it from the list. (A gamepad or other controller: "Connect gamepad", then move a stick.)' : 'Click "Connect radio or gamepad", then move a stick.'),
            h('li', {}, 'Run "Radio setup" once. It asks you to move each stick and flip your arm, mode, respawn and turtle switches, and remembers them for next time.')),
        h('p', { class: 'note' }, 'Tip: turning off the radio\'s internal and external RF modules makes EdgeTX run its mixer at 1000 Hz (EdgeTX manual, USB Joystick).'));
    help.open = helpOpen;
    return [
        h('h2', {}, 'Radio'),
        radioStatus(true),
        menuMsg ? h('p', { class: 'hint' }, menuMsg) : null,
        h('div', { class: 'row' },
            hidOk ? h('button', { onclick: () => void connectHid() }, device?.kind === 'hid' ? 'Connect a different USB radio' : 'Connect USB radio') : null,
            h('button', { onclick: connectGamepad }, hidOk ? 'Connect gamepad' : 'Connect radio or gamepad'),
            device ? h('button', { class: needsSetup ? 'primary' : '', onclick: openSetup }, needsSetup ? 'Run radio setup' : 'Redo radio setup') : null),
        help
    ];
}

/** the radio connected now, on the title card and in Settings (which needs no pointer to itself) */
function radioStatus(inSettings = false): HTMLElement {
    const go = inSettings ? '' : ' (Settings > Radio and controls)';
    return device
        ? h('div', { class: 'status' },
            h('span', { class: `dot ${profile ? 'ok' : 'pending'}` }),
            h('strong', {}, device.name),
            h('span', { class: 'muted' }, profile ? ` · ready (Mode ${profile.stickMode})` : ` · connected, not set up yet${go}`))
        : h('div', { class: 'status' }, h('span', { class: 'dot' }), h('span', { class: 'muted' }, `No radio connected${go}. Without one you look around with the mouse and keyboard.`));
}

/** where the quad starts (and goes back to with R or a respawn), on the title card (owner, 2026-10-19: out of Settings) */
function startPoint(): HTMLElement {
    const where = spawns.length === 0
        ? h('span', { class: 'muted' }, 'Loading the map…')
        : h('select', { 'aria-label': 'Start point', onchange: (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            settings.spawn = id;
            spawnId = id;
            saveSettings(settings);
            send({ type: 'settings', what: 'spawn', settings: engineSettings() });
        } }, ...spawns.map((s) => h('option', { value: s.id, selected: s.id === spawnId }, s.name)));
    return h('div', { class: 'start-point' },
        h('div', { class: 'row' }, h('span', {}, 'Start at'), where),
        h('p', { class: 'note' }, 'R (or the respawn switch) brings the quad back here.'));
}

/** which of the Help and about tab's data buttons waits for its second click */
let confirmData: 'defaults' | 'all' | null = null;

/** Settings > Help and about: back to the default settings, or forget everything kept in this browser (owner, 2026-10-19). */
function dataSection(): Child[] {
    const button = (what: 'defaults' | 'all', label: string, sure: string, act: () => Promise<void> | void): HTMLElement =>
        h('button', {
            class: confirmData === what ? 'danger' : '',
            onclick: async () => {
                if (confirmData !== what) {
                    confirmData = what;
                    return settingsUi.refresh();
                }
                confirmData = null;
                await act();
                // graphics and shadows only apply on a fresh page, and every screen should show what is kept now
                location.reload();
            }
        }, confirmData === what ? sure : label);
    return [
        h('h2', {}, 'Your data'),
        h('p', { class: 'note' }, 'Default settings puts every setting back as it was at first (your radio setup stays). Clear all data also forgets your radio setup, golden props, time trial times and saved flights. Both reload the game.'),
        h('div', { class: 'row' },
            button('defaults', 'Default settings', 'Click again to reset every setting', () => saveSettings(defaultSettings(settings))),
            button('all', 'Clear all data', 'Click again to erase everything', async () => {
                clearStoredSettings();
                await clearFlights();
            }))
    ];
}

const keyList = (rows: [string, string][], cls = 'keys'): HTMLElement =>
    h('dl', { class: cls }, ...rows.flatMap(([k, what]) => [h('dt', {}, k), h('dd', {}, what)]));

function controlsSection(): Child[] {
    const keys = keyList;
    const rows: [string, string][] = profile || demo
        ? [['Esc', 'menu'], ['R', 'back to the start point'], ['C', 'FPV / chase camera'], ['M', 'sound on / off']]
        : [['Click', 'steer with the mouse'], ['W A S D', 'move'], ['Space or E', 'up'], ['Q', 'down'], ['Shift', 'faster'], ['R', 'back to the quad'], ['Esc', 'menu']];
    if (profile && !profile.arm) rows.push(['Space', 'arm / disarm (your radio has no arm switch set up)']);
    if (profile && !profile.turtle) rows.push(['T', 'turtle mode (your radio has no turtle switch set up)']);
    return [h('h2', {}, 'Keys'), keys(rows)];
}

function credits(): HTMLElement {
    return h('p', { class: 'note footer' },
        `Renderer: ${backend}, ${engineWhere()}. Free and open source (GPL-3.0-or-later): `,
        h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'source code and issues'),
        '. Flight model from ShramkoGSFPV by Andrii Shramko (MIT). Sounds: recordings from Freesound (5deMayo, qubodup, CHallSmith, cauby43, Garuda1982, Oldome; CC0) and Kenney (CC0), listed in sounds/SOURCES.md.');
}

/** what the page adds to the Settings tabs (settings-ui.ts): everything the old main menu held that was not a screen */
function pageSections(tab: SettingsTab, where: 'top' | 'bottom'): Child[] {
    const hidOk = HidSource.supported();
    if (tab === 'radio') return where === 'top' ? [browserNotice(hidOk), ...controllerSection(hidOk)] : controlsSection();
    if (tab === 'about' && where === 'top') {
        return [
            h('h2', {}, 'Problems or ideas'),
            h('p', { class: 'note' }, 'Found a bug, or want something in the game? This opens it as an issue on GitHub, with the game\'s state attached so it can be found and replayed.'),
            h('div', { class: 'row' }, h('button', { onclick: openReport }, 'Report or suggest')),
            ...dataSection(),
            h('h2', {}, 'About'),
            h('p', { class: 'muted' }, 'Milestone 1 prototype: blockout map, 5" freestyle quad (Nazgul F5 class, 6S). Your flights are kept in this browser as stick inputs, so each replays exactly.'),
            credits()
        ];
    }
    return [];
}

/** The menu's big buttons: the title card's and the pause menu's. */
function menuButtons(first: HTMLElement | null, last: HTMLElement | null = null): HTMLElement {
    const n = found().length;
    return h('div', { class: 'menu-buttons' },
        first,
        h('button', { onclick: openSettings }, 'Settings'),
        h('button', { onclick: openCollection, disabled: props.length === 0 }, props.length ? `Collection  ${n} / ${props.length}` : 'Collection'),
        h('button', { onclick: openTrials, disabled: trials.length === 0 }, 'Time trials'),
        h('button', { onclick: openFlights }, 'Flight replay'),
        last);
}

/**
 * The title card before the first flight, the pause menu after it (owner, 2026-10-19: a cleaner start, and a pause
 * popup as games have). Settings, Collection and Flight replay open their screens; closing those comes back here.
 */
function renderMenu(): void {
    settingsUi.refresh();
    if (!started) {
        menuPanel.className = 'panel title-card';
        clear(menuBody,
            h('h1', { class: 'game-title' }, 'Open World FPV Simulator'),
            h('p', { class: 'muted' }, '5" freestyle in an open city'),
            browserNotice(HidSource.supported()),
            h('div', { class: 'title-radio' }, radioStatus()),
            startPoint(),
            menuButtons(h('button', { class: 'primary', onclick: startFlying }, 'Start flying')),
            h('p', { class: 'note' }, h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'GitHub ↗'), ` · ${backend}`));
        return;
    }
    menuPanel.className = 'panel pause-card';
    const racing = hudSnap !== null && (hudSnap.trial.phase === 'countdown' || hudSnap.trial.phase === 'racing');
    clear(menuBody,
        h('div', { class: 'title' }, h('h1', {}, 'Paused'), closeButton(() => showMenu(false))),
        menuButtons(racing ? h('button', { onclick: () => { send({ type: 'trial', act: 'quit' }); showMenu(false); } }, 'Leave time trial') : null,
            h('button', { onclick: backToTitle }, 'Back to main menu')),
        h('p', { class: 'note' }, 'Esc goes back to flying.'));
}

/** Pause > Back to main menu (owner, 2026-10-19): any time trial ends, the quad goes back to the start point, the title card shows. */
function backToTitle(): void {
    send({ type: 'trial', act: 'quit' });
    send({ type: 'reset' });
    started = false;
    renderMenu();
}

function startFlying(): void {
    started = true;
    showMenu(false);
}

// ---------------------------------------------------------------- keys, mouse, free-fly camera (events)

function lookAround(): boolean {
    return !profile && !demo;
}

/** the mouse and keys fly a camera: looking around without a radio, or the replay viewer's free camera */
function freeLook(): boolean {
    return replayUi.open ? replayUi.cam === 'free' : lookAround();
}

function mouseCaptured(): boolean {
    return document.pointerLockElement === canvas;
}

addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
    if (!freeLook() || !(mouseCaptured() || dragging)) return;
    lookDx += e.movementX;
    lookDy += e.movementY;
    camDirty = true;
});
addEventListener('keyup', (e) => { if (held.delete(e.code)) camDirty = true; });
addEventListener('blur', () => { held.clear(); camDirty = true; });

addEventListener('keydown', (e) => {
    // the time trial offer: Enter races, Esc declines
    if (trialPrompt.open && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape')) {
        trialPrompt.answer(e.code === 'Escape' ? 'decline' : 'race');
        e.preventDefault();
        return;
    }
    if (replayUi.open) {
        if (e.code === 'Escape') return closeReplay();
        if (e.repeat && !e.code.startsWith('Arrow')) return;
        // the free camera's keys first (Space is "up" there), then the viewer's
        if (replayUi.cam === 'free' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
            held.add(e.code);
            camDirty = true;
            e.preventDefault();
        } else if (replayUi.key(e.code)) e.preventDefault();
        return;
    }
    if (e.code === 'Escape') {
        // a screen goes back to where it was opened from: the report to Settings, the rest to the menu
        if (reportUi.open) {
            reportUi.hide();
            openSettings();
            return;
        }
        for (const ui of [flightsUi, collectionUi, trialsUi, settingsUi]) {
            if (!ui.open) continue;
            ui.hide();
            showMenu(true);
            return;
        }
        if (setup.open) return;
        // the title card stays until Start flying; after that Esc opens and closes the pause menu
        if (started) showMenu(menu.classList.contains('hidden'));
    } else if (anyOverlay()) return;
    else if (e.code === 'KeyR' && lookAround()) send({ type: 'freecam', keys: [...held], dx: 0, dy: 0, enter: true });
    else if (e.code === 'KeyR') send({ type: 'reset' });
    else if (e.code === 'KeyM') {
        settings.sound = !settings.sound;
        saveSettings(settings);
        sound.setLevels(soundLevels());
        if (settings.sound) sound.unlock();
        hud.toast(settings.sound ? 'SOUND ON' : 'SOUND OFF', 'M to switch · volumes in Esc > Settings > Sound');
    }
    else if (lookAround()) {
        held.add(e.code);
        camDirty = true;
    } else if (e.code === 'KeyC') send({ type: 'view', mode: 'toggle' });
    else if (e.code === 'Space' && profile && !profile.arm) keyArm = !keyArm;
    else if (e.code === 'KeyT' && profile && !profile.turtle) keyTurtle = !keyTurtle;
});

// ---------------------------------------------------------------- page loop (UI only; the engine has its own)

function syncPause(): void {
    const paused = anyOverlay() || document.visibilityState !== 'visible';
    if (paused === sentPaused) return;
    sentPaused = paused;
    send({ type: 'pause', on: paused });
}
document.addEventListener('visibilitychange', syncPause);
document.addEventListener('visibilitychange', () => sound.visible(document.visibilityState === 'visible'));

/** when the frame rate first fell under SLOW_FPS while flying this visit (ms), and whether the low spec hint was shown */
let slowSince: number | null = null;
let slowHinted = false;
const SLOW_FPS = 30;

/** Running slowly for 5 s of flying: point at the next cheaper quality preset (none past super low), once a visit. */
function hintLowSpec(fps: number): void {
    // the preset to suggest, from what this visit runs with (a change waiting for a reload does not count)
    const next = cheaperPreset({ graphics: graphicsNow, shadows: shadowsOn, shadowReach: settings.shadowReach, renderScale: settings.renderScale });
    if (slowHinted || !next || sentPaused !== false || replayUi.open) {
        slowSince = null;
        return;
    }
    const now = performance.now();
    if (fps >= SLOW_FPS) slowSince = null;
    else if (slowSince === null) slowSince = now;
    else if (now - slowSince > 5000) {
        slowHinted = true;
        hud.toast('RUNNING SLOWLY', `Try the ${PRESET_NAMES[next]} quality preset: Esc > Settings > Graphics`);
    }
}

function drawHud(): void {
    const x = hudSnap;
    if (!x) return;
    hintLowSpec(x.fps);
    // the engine stopped asking (R, a new start point): the offer goes
    if (trialPrompt.open && x.trial.phase !== 'asking') trialPrompt.hide();
    hud.el.classList.toggle('asking', trialPrompt.open);

    hud.update(x, {
        respawnIn: x.respawnIn,
        hasRadio: profile !== null || demo,
        noRadioHint: mouseCaptured()
            ? 'WASD move · Space / E up, Q down · Shift faster'
            : 'No radio set up — click to look around, Esc for the menu',
        armHint: profile && !profile.arm ? 'DISARMED — throttle down, press Space to arm' : 'DISARMED — throttle down, flip the arm switch',
        turtleHint: `TILTED — ${profile && !profile.turtle ? 'press T' : 'turtle switch on'}, then arm to flip over (or R)`,
        props: props.length ? `${found().length} / ${props.length}` : '',
        footer: `${device ? `${device.name} ${rate.hz} Hz · ` : ''}${backend} · ${Math.round(x.fps)} fps · ${x.freeCam ? 'LOOK AROUND' : x.mode.toUpperCase()}`,
        ...raceHud(x)
    });
}

function pageFrame(): void {
    setup.render();
    trialPrompt.draw(performance.now());

    syncPause();
    // the replay viewer shows its own numbers
    hud.el.classList.toggle('hidden', replayUi.open);
    if (camDirty) {
        send({ type: 'freecam', keys: [...held], dx: lookDx, dy: lookDy, enter: false });
        lookDx = lookDy = 0;
        camDirty = false;
    }
    requestAnimationFrame(pageFrame);
}

async function runSelftestPage(): Promise<void> {
    const [{ CLASSIC_SELFTEST_HASH, SELFTEST_HASH, TRAFFIC_HASH, runSelftest, runTrafficSelftest }, { buildFirstMap }] = await Promise.all([import('./selftest'), import('@owfpv/maps')]);
    const level = buildFirstMap();
    const r = runSelftest(preset, level);
    // the same flight with classic physics (sim-core/0.6.0): checks the old model too
    const classic = runSelftest(preset, level, { classicPhysics: true }).hash;
    const traffic = runTrafficSelftest(level);
    const flightOk = r.hash === SELFTEST_HASH && classic === CLASSIC_SELFTEST_HASH, trafficOk = traffic === TRAFFIC_HASH;
    const ok = flightOk && trafficOk;
    const result = { ...r, expected: SELFTEST_HASH, classic, classicExpected: CLASSIC_SELFTEST_HASH, traffic, trafficExpected: TRAFFIC_HASH };
    (globalThis as { __selftest?: unknown }).__selftest = { ...result, ok, flightOk, trafficOk };
    clear(menuBody, h('h1', {}, 'Determinism self-test'),
        h('p', { class: ok ? 'status-ok' : 'status-bad' }, ok
            ? 'MATCH: this browser flies and moves the traffic bit-identically to Node.'
            : `MISMATCH with Node (flight ${flightOk ? 'matches' : 'differs'}, traffic ${trafficOk ? 'matches' : 'differs'})`),
        h('pre', { class: 'note', id: 'selftest' }, JSON.stringify(result, null, 2)));
}

renderMenu();
if (params.has('selftest')) void runSelftestPage();
else void reconnect();
if (demo) showMenu(false);
syncPause();
requestAnimationFrame(pageFrame);

// for checks from the browser console and automated tests
(globalThis as { __fly?: unknown }).__fly = {
    settings,
    /** the sound (audio/audio.ts): spectrum() for checks */
    sound,
    get engine(): string {
        return `${backend} ${engineWhere()}${engineReady ? '' : ' (starting)'}`;
    },
    /** which clock the gamepad poll runs on (devices/gamepad.ts startClock) */
    get padClock(): string {
        return padClock;
    },
    /** run `code` in the engine with `fly` (session, view, renderer, scene, S, trafficView, freeCam, radio) in scope; resolves to its cloned return value */
    ask(code: string): Promise<unknown> {
        const id = ++askId;
        return new Promise((resolve, reject) => {
            asks.set(id, (r) => (r.ok ? resolve(r.value) : reject(new Error(String(r.value)))));
            send({ type: 'ask', id, code });
        });
    },
    /** a simulated radio for UI checks: frames go through the same path as a real one's reports */
    fakeRadio(): (f: RawFrame) => void {
        useDevice({ kind: 'hid', key: 'test:simulated', name: 'Simulated radio' }, loadProfile('test:simulated'));
        return onRaw;
    }
};
