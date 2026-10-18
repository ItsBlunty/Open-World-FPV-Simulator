// The page: the menus, the HUD and every input (radio, keyboard, mouse). The engine (flight session, Three.js
// scene, frame loop: engine/engine.ts) runs on this page by default. ?render=worker runs it in a worker drawing to
// this page's canvas instead (HANDOFF.md §0i): input arrives sooner there, but the owner felt stutters every 5-10 s
// in Firefox and chose the page (2026-10-18). URL options: ?selftest runs the determinism check, ?demo flies the
// self-test's scripted sticks in real time (no radio needed), ?webgl forces WebGL 2, ?spawn=<id> starts at a spawn
// point, ?cam=chase starts in the chase view, ?noshadows turns the sun's shadows off (for slow GPUs, and to measure
// what they cost), ?render=worker runs the engine in a worker.

import './style.css';
import { compileParams } from '@owfpv/sim-core';
import type { ParamOverrides, PresetJson } from '@owfpv/sim-core';
import { mapFrame, switchOn } from '@owfpv/input';
import type { RadioProfile, RawFrame } from '@owfpv/input';
import type { TrafficConfig } from '@owfpv/traffic';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { loadProfile, loadSettings, saveProfile, saveSettings } from './settings';
import { HidSource } from './devices/hid';
import { GamepadSource, gamepadKey } from './devices/gamepad';
import { findSavedGamepad, findSavedHid } from './devices/reconnect';
import { Hud } from './ui/hud';
import { RadioSetup } from './ui/radio-setup';
import { SettingsUi } from './ui/settings-ui';
import { h, clear } from './ui/dom';
import type { EngineMsg, EngineSettings, HudSnapshot, InitMsg, PageMsg, Port } from './engine/protocol';

const params = new URLSearchParams(location.search);
const preset = nazgul as unknown as PresetJson;
const settings = loadSettings();
const presetRates = compileParams(preset).rates;
const demo = params.has('demo');

function overrides(): ParamOverrides {
    // crashOn always set: off means every hit is a bounce, no damage, no crash (the owner's default for now)
    return settings.rates ? { rates: settings.rates, crashOn: settings.damage } : { crashOn: settings.damage };
}

function trafficConfig(): TrafficConfig {
    return { cars: settings.cars, people: settings.people, signals: settings.signals };
}

function engineSettings(): EngineSettings {
    return { uptiltDeg: settings.uptiltDeg, fovDeg: settings.fovDeg, renderScale: settings.renderScale, overrides: overrides(), traffic: trafficConfig(), spawn: settings.spawn };
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
        if (!lookAround()) return;
        dragging = true;
        if (!mouseCaptured()) c.requestPointerLock()?.catch(() => undefined);
    });
}

// ---------------------------------------------------------------- engine

// read once: switching shadows on a running page crashed Three.js (castShadow toggled), so the setting applies on reload
const shadowsOn = settings.shadows && !params.has('noshadows');
let canvas = newCanvas();
let engine: Port;
let worker: Worker | null = null;
let engineReady = false;
let backend = 'starting…';
let spawns: { id: string; name: string }[] = [];
let spawnId = params.get('spawn') ?? settings.spawn;
let hudSnap: HudSnapshot | null = null;
const asks = new Map<number, (r: { ok: boolean; value: unknown }) => void>();
let askId = 0;
let sentPaused: boolean | null = null;

function newCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    document.body.prepend(c);
    attachMouse(c);
    return c;
}

function initMsg(): InitMsg {
    return {
        type: 'init', timeOrigin: performance.timeOrigin, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        search: location.search, shadows: shadowsOn, settings: engineSettings()
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

/** The engine on this page, through a MessageChannel: the same messages as a worker. */
function startPageEngine(): void {
    const mc = new MessageChannel();
    mc.port1.onmessage = onEngine;
    engine = mc.port1;
    const enginePort = mc.port2 as unknown as Port;
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
        renderMenu();
    } else if (m.type === 'hud') {
        hudSnap = m.hud;
        drawHud();
    } else if (m.type === 'error') {
        if (worker && !engineReady) return fallBack(m.message);
        menuMsg = `The renderer failed: ${m.message}`;
        renderMenu();
    } else if (m.type === 'answer') {
        asks.get(m.id)?.({ ok: m.ok, value: m.value });
        asks.delete(m.id);
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
const menuBody = h('div');
const menu = h('div', { class: 'overlay' }, h('div', { class: 'panel' }, menuBody));
document.body.append(hud.el, menu, setup.el, settingsUi.el);
let menuMsg = '';

function anyOverlay(): boolean {
    return !menu.classList.contains('hidden') || setup.open || settingsUi.open;
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
        shadowsPending: () => settings.shadows !== shadowsOn && !params.has('noshadows'),
        save: () => saveSettings(settings),
        close: () => { settingsUi.hide(); showMenu(true); }
    });
}

function renderMenu(): void {
    const hidOk = HidSource.supported();
    const status = device
        ? h('div', {}, h('span', { class: profile ? 'status-ok' : 'warn' }, `${device.name}`), profile ? ` — set up (Mode ${profile.stickMode})` : ' — not set up yet: run Radio setup')
        : h('div', { class: 'muted' }, 'No radio connected.');
    clear(menuBody,
        h('h1', {}, 'Open World FPV Simulator'),
        h('p', { class: 'muted' }, 'Milestone 1 prototype: blockout map, 5" freestyle quad (Nazgul F5 class, 6S).'),
        h('h2', {}, 'Radio'),
        status,
        menuMsg ? h('p', { class: 'hint' }, menuMsg) : null,
        h('div', { class: 'row' },
            h('button', { onclick: () => void connectHid(), disabled: !hidOk }, 'Connect USB radio'),
            h('button', { onclick: connectGamepad }, 'Use gamepad / other controller'),
            h('button', { onclick: openSetup, disabled: !device }, 'Radio setup')),
        h('p', { class: 'note' },
            'EdgeTX radio: plug in USB and choose "USB Joystick (HID)". Turning off the radio\'s internal and external RF modules makes EdgeTX run its mixer at 1000 Hz (EdgeTX manual, USB Joystick).',
            hidOk ? '' : ' This browser has no WebHID (use Chrome or Edge), so only the gamepad path works here.'),
        h('h2', {}, 'Where to start'),
        h('div', { class: 'row' }, spawns.length === 0
            ? h('span', { class: 'muted' }, 'Loading the map…')
            : h('select', { onchange: (e: Event) => {
                const id = (e.target as HTMLSelectElement).value;
                settings.spawn = id;
                spawnId = id;
                saveSettings(settings);
                send({ type: 'settings', what: 'spawn', settings: engineSettings() });
            } }, ...spawns.map((s) => h('option', { value: s.id, selected: s.id === spawnId }, s.name)))),
        h('div', { class: 'row' },
            h('button', { onclick: openSettings }, 'Settings (camera, traffic, graphics, rates)'),
            h('span', { class: 'spacer' }),
            h('button', { class: 'primary', onclick: () => showMenu(false) }, profile || demo ? 'Fly' : 'Look around')),
        h('p', { class: 'note' }, 'Keys: Esc menu · R back to the spawn point · C chase / FPV camera · Space arm, T turtle mode (only if your radio has no switch for them).'),
        h('p', { class: 'note' }, 'Look around (no radio): click to steer with the mouse · WASD move · Space / E up, Q down · Shift faster · R back to the quad.'),
        h('p', { class: 'note' }, `Renderer: ${backend}, ${engineWhere()}. GPL-3.0-or-later; flight model from ShramkoGSFPV by Andrii Shramko (MIT).`)
    );
}

// ---------------------------------------------------------------- keys, mouse, free-fly camera (events)

function lookAround(): boolean {
    return !profile && !demo;
}

function mouseCaptured(): boolean {
    return document.pointerLockElement === canvas;
}

addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
    if (!lookAround() || !(mouseCaptured() || dragging)) return;
    lookDx += e.movementX;
    lookDy += e.movementY;
    camDirty = true;
});
addEventListener('keyup', (e) => { if (held.delete(e.code)) camDirty = true; });
addEventListener('blur', () => { held.clear(); camDirty = true; });

addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
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

function drawHud(): void {
    const x = hudSnap;
    if (!x) return;
    hud.update(x, {
        respawnIn: x.respawnIn,
        hasRadio: profile !== null || demo,
        noRadioHint: mouseCaptured()
            ? 'WASD move · Space / E up, Q down · Shift faster'
            : 'No radio set up — click to look around, Esc for the menu',
        armHint: profile && !profile.arm ? 'DISARMED — throttle down, press Space to arm' : 'DISARMED — throttle down, flip the arm switch',
        turtleHint: `TILTED — ${profile && !profile.turtle ? 'press T' : 'turtle switch on'}, then arm to flip over (or R)`,
        footer: `${device ? `${device.name} ${rate.hz} Hz · ` : ''}${backend} · ${Math.round(x.fps)} fps · ${x.freeCam ? 'LOOK AROUND' : x.mode.toUpperCase()}`
    });
}

function pageFrame(): void {
    setup.render();
    syncPause();
    if (camDirty) {
        send({ type: 'freecam', keys: [...held], dx: lookDx, dy: lookDy, enter: false });
        lookDx = lookDy = 0;
        camDirty = false;
    }
    requestAnimationFrame(pageFrame);
}

async function runSelftestPage(): Promise<void> {
    const [{ SELFTEST_HASH, TRAFFIC_HASH, runSelftest, runTrafficSelftest }, { buildFirstMap }] = await Promise.all([import('./selftest'), import('@owfpv/maps')]);
    const level = buildFirstMap();
    const r = runSelftest(preset, level);
    const traffic = runTrafficSelftest(level);
    const flightOk = r.hash === SELFTEST_HASH, trafficOk = traffic === TRAFFIC_HASH;
    const ok = flightOk && trafficOk;
    const result = { ...r, expected: SELFTEST_HASH, traffic, trafficExpected: TRAFFIC_HASH };
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
