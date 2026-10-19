// The page: the menus, the HUD and every input (radio, keyboard, mouse). The engine (flight session, Three.js
// scene, frame loop: engine/engine.ts) runs on this page by default. ?render=worker runs it in a worker drawing to
// this page's canvas instead (docs/notes/browsers-input-performance.md §0i): input arrives sooner there, but the owner felt stutters every 5-10 s
// in Firefox and chose the page (2026-10-18). URL options: ?selftest runs the determinism check, ?demo flies the
// self-test's scripted sticks in real time (no radio needed; ?demo=tricks flies flips and rolls for the grader), ?webgl forces WebGL 2, ?spawn=<id> starts at a spawn
// point, ?cam=chase starts in the chase view, ?noshadows turns the sun's shadows off (for slow GPUs, and to measure
// what they cost), ?lowspec turns low spec mode on for this visit (?lowspec=0 off), ?render=worker runs the engine in a worker.

import './style.css';
import { compileParams } from '@owfpv/sim-core';
import type { ParamOverrides, PresetJson } from '@owfpv/sim-core';
import { mapFrame, switchOn } from '@owfpv/input';
import type { RadioProfile, RawFrame } from '@owfpv/input';
import type { TrafficConfig } from '@owfpv/traffic';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { loadCollection, loadProfile, loadSettings, saveCollection, saveProfile, saveSettings } from './settings';
import { HidSource } from './devices/hid';
import { GamepadSource, gamepadKey, padClock } from './devices/gamepad';
import { findSavedGamepad, findSavedHid } from './devices/reconnect';
import { Hud } from './ui/hud';
import { RadioSetup } from './ui/radio-setup';
import { LENSES } from './render/lenses';
import { SettingsUi } from './ui/settings-ui';
import { CollectionUi } from './ui/collection-ui';
import { FlightsUi } from './ui/flights-ui';
import { deleteFlight, getFlight, listFlights, putFlight } from './flight-store';
import { flightToJson } from './flights';
import type { CheckResult, Flight } from './flights';
import { ReplayUi } from './ui/replay-ui';
import { RadioReplayControl } from './replay';
import type { Track } from './replay';
import type { CheckReply } from './check-worker';
import { h, clear } from './ui/dom';
import type { Child } from './ui/dom';
import { localPorts } from './engine/protocol';
import type { EngineMsg, EngineReport, EngineSettings, HudSnapshot, InitMsg, PageMsg, Port, PropInfo } from './engine/protocol';
import { ReportUi } from './ui/report-ui';
import { ErrorLog } from './report';
import type { PageReport } from './report';
import { cheaper, graphicsFromParam, graphicsName, isLowSpec, trafficAllowed } from './graphics';

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

function engineSettings(): EngineSettings {
    return { uptiltDeg: settings.uptiltDeg, fovDeg: settings.fovDeg, lens: settings.lens, renderScale: settings.renderScale, overrides: overrides(), traffic: trafficConfig(), spawn: settings.spawn };
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
        mapId = m.mapId;
        renderMenu();
    } else if (m.type === 'flight') {
        void putFlight(m.flight).then((ok) => {
            if (!ok) console.warn('This browser did not keep the flight (storage blocked or full).');
        });
    } else if (m.type === 'collect') {
        const mine = (collection[mapId] ??= []);
        for (const n of m.n) {
            if (mine.includes(n)) continue;
            mine.push(n);
            const p = props[n - 1];
            hud.toast(`GOLDEN PROP #${n}`, `${mine.length} / ${props.length} found${p ? ` · ${p.spot}` : ''}`);
        }
        saveCollection(collection);
        collectionUi.refresh();
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
const flightsUi = new FlightsUi();
const reportUi = new ReportUi();
const replayUi = new ReplayUi();
const radioReplay = new RadioReplayControl();
let sentShuttle = 0;
const menuBody = h('div');
const menu = h('div', { class: 'overlay' }, h('div', { class: 'panel' }, menuBody));
document.body.append(hud.el, menu, setup.el, settingsUi.el, collectionUi.el, flightsUi.el, reportUi.el, replayUi.el);
let menuMsg = '';

/** a screen is open: the sim pauses (the replay viewer too: it plays a track, the sim stays where it was) */
function anyOverlay(): boolean {
    return !menu.classList.contains('hidden') || setup.open || settingsUi.open || collectionUi.open || flightsUi.open || reportUi.open || replayUi.open;
}

function showMenu(on: boolean): void {
    menu.classList.toggle('hidden', !on);
    if (on && mouseCaptured()) document.exitPointerLock();
    if (on) renderMenu();
}

function openSetup(): void {
    if (!device) return;
    const d = device;
    showMenu(false);
    setup.show({ key: d.key, name: d.name, nAxes: 8 }, settings.stickMode, (p) => {
        saveProfile(p);
        settings.stickMode = p.stickMode;
        saveSettings(settings);
        setProfile(p);
        showMenu(true);
    }, () => showMenu(true));
}

function openSettings(): void {
    showMenu(false);
    settingsUi.show({
        settings,
        presetRates,
        onCamera: () => send({ type: 'settings', what: 'camera', settings: engineSettings() }),
        onFlight: () => send({ type: 'settings', what: 'flight', settings: engineSettings() }),
        onTraffic: () => send({ type: 'settings', what: 'traffic', settings: engineSettings() }),
        onGraphics: () => send({ type: 'settings', what: 'graphics', settings: engineSettings() }),
        shadowsPending: () => settings.shadows !== shadowsOn && !params.has('noshadows') && !lowSpecOn,
        graphicsNow,
        graphicsPending: () => settings.graphics !== graphicsNow && graphicsFromParam(params.get('lowspec')) === null,
        save: () => saveSettings(settings),
        close: () => { settingsUi.hide(); showMenu(true); }
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

function openReport(): void {
    // opened in the same task as the menu closes: with no screen open between them, the sim would run on
    showMenu(false);
    void reportUi.show({
        repo: REPO,
        gather: async () => {
            const saved = (await listFlights().catch(() => [])).some((f) => f.id === flightId);
            return { page: pageReport(saved), engine: await engineReport() };
        },
        downloadFlight: () => downloadSaved(flightId),
        close: () => { reportUi.hide(); showMenu(true); }
    });
}

function openFlights(): void {
    showMenu(false);
    void flightsUi.show({
        list: listFlights, check: checkSaved, watch: (id) => void watchSaved(id), download: downloadSaved, remove: deleteFlight, currentId: flightId,
        close: () => { flightsUi.hide(); showMenu(true); }
    });
}

const REPO = 'https://github.com/ItsBlunty/Open-World-FPV-Simulator';

/** an 8-tooth gear outline with a hole (24 x 24 box), drawn here rather than taken from an icon set */
const GEAR_PATH = ((): string => {
    const pt = (r: number, deg: number): string => {
        const a = (deg * Math.PI) / 180;
        return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
    };
    const teeth = Array.from({ length: 8 }, (_, i) => {
        const c = i * 45;
        return [pt(7.6, c - 15), pt(10.5, c - 9), pt(10.5, c + 9), pt(7.6, c + 15)].join(' L ');
    });
    return `M ${teeth.join(' L ')} Z M 15.2 12 A 3.2 3.2 0 1 0 8.8 12 A 3.2 3.2 0 1 0 15.2 12 Z`;
})();

/** the gear alone (top-right corner), or the gear with a label */
function gearButton(label?: string): HTMLButtonElement {
    const b = h('button', { class: label ? 'gear-btn' : 'icon-btn', onclick: openSettings, title: 'Settings', 'aria-label': label ?? 'Settings' });
    b.innerHTML = `<svg viewBox="0 0 24 24" width="${label ? 18 : 22}" height="${label ? 18 : 22}" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${GEAR_PATH}"/></svg>`;
    if (label) b.append(label);
    return b;
}

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
    const status = device
        ? h('div', { class: 'status' },
            h('span', { class: `dot ${profile ? 'ok' : 'pending'}` }),
            h('strong', {}, device.name),
            h('span', { class: 'muted' }, profile ? ` · ready (Mode ${profile.stickMode})` : ' · connected, not set up yet'))
        : h('div', { class: 'status' }, h('span', { class: 'dot' }), h('span', { class: 'muted' }, 'No radio connected. You can still look around the map with the mouse and keyboard.'));
    const help = h('details', { class: 'help', ontoggle: (e: Event) => { helpOpen = (e.target as HTMLDetailsElement).open; } },
        h('summary', {}, 'How to connect a radio'),
        h('ol', {},
            h('li', {}, 'Plug the radio into the computer by USB. On an EdgeTX radio choose "USB Joystick (HID)".'),
            h('li', {}, hidOk ? 'Click "Connect USB radio" and pick it from the list. (A gamepad or other controller: "Connect gamepad", then move a stick.)' : 'Click "Connect radio or gamepad", then move a stick.'),
            h('li', {}, 'Run "Radio setup" once. It asks you to move each stick and flip your arm, mode, respawn and turtle switches, and remembers them for next time.')),
        h('p', { class: 'note' }, 'Tip: turning off the radio\'s internal and external RF modules makes EdgeTX run its mixer at 1000 Hz (EdgeTX manual, USB Joystick).'));
    help.open = helpOpen;
    return [
        h('h2', {}, '1 · Controller'),
        status,
        menuMsg ? h('p', { class: 'hint' }, menuMsg) : null,
        h('div', { class: 'row' },
            hidOk ? h('button', { onclick: () => void connectHid() }, device?.kind === 'hid' ? 'Connect a different USB radio' : 'Connect USB radio') : null,
            h('button', { onclick: connectGamepad }, hidOk ? 'Connect gamepad' : 'Connect radio or gamepad'),
            device ? h('button', { class: needsSetup ? 'primary' : '', onclick: openSetup }, needsSetup ? 'Run radio setup' : 'Redo radio setup') : null),
        help
    ];
}

function startSection(): Child[] {
    const flying = profile !== null || demo;
    const where = spawns.length === 0
        ? h('span', { class: 'muted' }, 'Loading the map…')
        : h('select', { 'aria-label': 'Start point', onchange: (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            settings.spawn = id;
            spawnId = id;
            saveSettings(settings);
            send({ type: 'settings', what: 'spawn', settings: engineSettings() });
        } }, ...spawns.map((s) => h('option', { value: s.id, selected: s.id === spawnId }, s.name)));
    return [
        h('h2', {}, '2 · Start'),
        h('div', { class: 'row' },
            h('label', { class: 'muted' }, 'Start at'), where,
            h('span', { class: 'spacer' }),
            h('button', { class: device && !profile ? '' : 'primary', onclick: () => showMenu(false) }, flying ? 'Fly' : 'Look around')),
        flying ? null : h('p', { class: 'note' }, 'Without a set-up radio, "Look around" flies a free camera so you can explore the map.')
    ];
}

/** the golden props found so far, and the way to the collection screen */
function propsSection(): Child[] {
    if (!props.length) return [];
    const n = found().length;
    return [
        h('div', { class: 'section-head' }, h('h2', {}, 'Golden props'), h('button', { onclick: openCollection }, 'Collection')),
        h('p', { class: 'muted' }, n === 0
            ? `${props.length} golden props are hidden around the map, some of them well. Fly through one to take it.`
            : `${n} of ${props.length} found.${n === props.length ? ' Every one: well flown.' : ''}`)
    ];
}

/** saved flights: every visit flown with a radio, as stick inputs that replay exactly */
function flightsSection(): Child[] {
    return [
        h('div', { class: 'section-head' }, h('h2', {}, 'Saved flights'), h('button', { onclick: openFlights }, 'Flights')),
        h('p', { class: 'muted' }, 'Every visit you fly is kept as your stick inputs, so it can be replayed exactly.')
    ];
}

const keyList = (rows: [string, string][], cls = 'keys'): HTMLElement =>
    h('dl', { class: cls }, ...rows.flatMap(([k, what]) => [h('dt', {}, k), h('dd', {}, what)]));

/** what Settings holds, with the current values, so nobody has to guess that the camera and rates live there */
function settingsSection(): Child[] {
    // low spec mode draws no lens: the flat camera's field of view applies
    const lens = lowSpecOn ? undefined : LENSES.find((l) => l.id === settings.lens);
    const camera = `uptilt ${settings.uptiltDeg}°, ${lens ? `${lens.label} lens` : `flat, ${settings.fovDeg}° field of view`}`;
    const traffic = !trafficAllowed(graphicsNow) ? `off in ${graphicsName(graphicsNow)} mode` : [settings.cars && 'cars', settings.people && 'people', settings.cars && settings.signals && 'traffic lights'].filter(Boolean).join(', ') || 'off';
    return [
        h('div', { class: 'section-head' }, h('h2', {}, 'Settings'), gearButton('Open settings')),
        keyList([
            ['FPV camera', `${camera}. Fisheye profiles of real FPV cameras, or a flat view.`],
            ['Rates', `${settings.rates ? 'your own' : 'the preset\'s'}. Type in your Betaflight rates.`],
            ['Flight mode', `${settings.mode[0].toUpperCase()}${settings.mode.slice(1)}, used when your radio has no mode switch.`],
            ['Traffic', `${traffic}.`],
            ['Trains', settings.train ? 'on: two steam trains round the whole map, over the city, through the tunnel.' : 'off.'],
            ['Graphics', lowSpecOn
                ? `${graphicsName(graphicsNow)} mode (simple lighting, no shadows, flat camera), resolution ${graphicsNow === 'extra' ? 50 : graphicsNow === 'super' ? 25 : Math.round(settings.renderScale * 100)}%.`
                : `resolution ${Math.round(settings.renderScale * 100)}%, sun shadows ${settings.shadows ? 'on' : 'off'}.`],
            ['Physics', settings.classicPhysics ? 'classic (sim-core 0.5): thrust from motor speed alone.' : 'props feel the airflow: thrust fades as you climb fast and grows flying forward.'],
            ['Crashes', settings.damage ? 'damage on.' : 'damage off: every hit is a bounce.']
        ].map(([k, v]): [string, string] => [k, v[0].toUpperCase() + v.slice(1)]), 'keys plain')
    ];
}

function controlsSection(): Child[] {
    const keys = keyList;
    const rows: [string, string][] = profile || demo
        ? [['Esc', 'menu'], ['R', 'back to the start point'], ['C', 'FPV / chase camera']]
        : [['Click', 'steer with the mouse'], ['W A S D', 'move'], ['Space or E', 'up'], ['Q', 'down'], ['Shift', 'faster'], ['R', 'back to the quad'], ['Esc', 'menu']];
    if (profile && !profile.arm) rows.push(['Space', 'arm / disarm (your radio has no arm switch set up)']);
    if (profile && !profile.turtle) rows.push(['T', 'turtle mode (your radio has no turtle switch set up)']);
    return [h('h2', {}, 'Controls'), keys(rows)];
}

function renderMenu(): void {
    const hidOk = HidSource.supported();
    clear(menuBody,
        h('div', { class: 'title' },
            h('h1', {}, 'Open World FPV Simulator'),
            h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'GitHub ↗'),
            gearButton()),
        h('p', { class: 'muted' }, 'Milestone 1 prototype: blockout map, 5" freestyle quad (Nazgul F5 class, 6S).'),
        browserNotice(hidOk),
        ...controllerSection(hidOk),
        ...startSection(),
        ...propsSection(),
        ...flightsSection(),
        ...settingsSection(),
        ...controlsSection(),
        h('div', { class: 'section-head' }, h('h2', {}, 'Problems or ideas'), h('button', { onclick: openReport }, 'Report or suggest')),
        h('p', { class: 'note' }, 'Found a bug, or want something in the game? This opens it as an issue on GitHub, with the game\'s state attached so it can be found and replayed.'),
        h('p', { class: 'note footer' },
            `Renderer: ${backend}, ${engineWhere()}. Free and open source (GPL-3.0-or-later): `,
            h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'source code and issues'),
            '. Flight model from ShramkoGSFPV by Andrii Shramko (MIT).')
    );
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
        if (flightsUi.open) {
            flightsUi.hide();
            showMenu(true);
            return;
        }
        if (reportUi.open) {
            reportUi.hide();
            showMenu(true);
            return;
        }
        if (collectionUi.open) {
            collectionUi.hide();
            showMenu(true);
            return;
        }
        if (setup.open || settingsUi.open) return;
        showMenu(menu.classList.contains('hidden'));
    } else if (anyOverlay()) return;
    else if (e.code === 'KeyR' && lookAround()) send({ type: 'freecam', keys: [...held], dx: 0, dy: 0, enter: true });
    else if (e.code === 'KeyR') send({ type: 'reset' });
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

/** when the frame rate first fell under SLOW_FPS while flying this visit (ms), and whether the low spec hint was shown */
let slowSince: number | null = null;
let slowHinted = false;
const SLOW_FPS = 30;

/** Running slowly for 5 s of flying: point at the next cheaper graphics level (none past super low spec), once a visit. */
function hintLowSpec(fps: number): void {
    const next = cheaper(graphicsNow);
    if (slowHinted || !next || sentPaused !== false || replayUi.open) {
        slowSince = null;
        return;
    }
    const now = performance.now();
    if (fps >= SLOW_FPS) slowSince = null;
    else if (slowSince === null) slowSince = now;
    else if (now - slowSince > 5000) {
        slowHinted = true;
        hud.toast('RUNNING SLOWLY', `Try ${graphicsName(next)[0].toUpperCase()}${graphicsName(next).slice(1)} mode: Esc > Settings > Graphics`);
    }
}

function drawHud(): void {
    const x = hudSnap;
    if (!x) return;
    hintLowSpec(x.fps);
    hud.update(x, {
        respawnIn: x.respawnIn,
        hasRadio: profile !== null || demo,
        noRadioHint: mouseCaptured()
            ? 'WASD move · Space / E up, Q down · Shift faster'
            : 'No radio set up — click to look around, Esc for the menu',
        armHint: profile && !profile.arm ? 'DISARMED — throttle down, press Space to arm' : 'DISARMED — throttle down, flip the arm switch',
        turtleHint: `TILTED — ${profile && !profile.turtle ? 'press T' : 'turtle switch on'}, then arm to flip over (or R)`,
        props: props.length ? `${found().length} / ${props.length}` : '',
        footer: `${device ? `${device.name} ${rate.hz} Hz · ` : ''}${backend} · ${Math.round(x.fps)} fps · ${x.freeCam ? 'LOOK AROUND' : x.mode.toUpperCase()}`
    });
}

function pageFrame(): void {
    setup.render();
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
