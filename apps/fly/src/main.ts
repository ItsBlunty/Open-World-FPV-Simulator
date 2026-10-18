// The page: builds the map, the flight session and the renderer, connects the radio, and runs the
// frame loop (physics up to now, then draw). URL options: ?selftest runs the determinism check,
// ?demo flies the self-test's scripted sticks in real time (no radio needed), ?webgl forces WebGL 2,
// ?spawn=<id> starts at a spawn point, ?cam=chase starts in the chase view, ?noshadows turns the sun's
// shadows off (for slow GPUs, and to measure what they cost).

import './style.css';
import * as THREE from 'three/webgpu';
import { S, compileParams } from '@owfpv/sim-core';
import type { ParamOverrides, PresetJson } from '@owfpv/sim-core';
import { mapFrame, switchOn } from '@owfpv/input';
import type { RadioProfile, RawFrame } from '@owfpv/input';
import { buildFirstMap } from '@owfpv/maps';
import type { TrafficConfig } from '@owfpv/traffic';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from './session';
import { SELFTEST_HASH, TRAFFIC_HASH, runSelftest, runTrafficSelftest, selftestSticks } from './selftest';
import { loadProfile, loadSettings, saveProfile, saveSettings } from './settings';
import { levelGroup, environment } from './render/world';
import { CraftView } from './render/view';
import { TrafficView } from './render/traffic';
import { FreeCam } from './render/freecam';
import { HidSource } from './devices/hid';
import { GamepadSource, gamepadKey } from './devices/gamepad';
import { findSavedGamepad, findSavedHid } from './devices/reconnect';
import { Hud } from './ui/hud';
import { RadioSetup } from './ui/radio-setup';
import { SettingsUi } from './ui/settings-ui';
import { h, clear } from './ui/dom';

const params = new URLSearchParams(location.search);
const preset = nazgul as unknown as PresetJson;
const level = buildFirstMap();
const settings = loadSettings();
const presetRates = compileParams(preset).rates;

function overrides(): ParamOverrides {
    // crashOn always set: off means every hit is a bounce, no damage, no crash (the owner's default for now)
    return settings.rates ? { rates: settings.rates, crashOn: settings.damage } : { crashOn: settings.damage };
}

function trafficConfig(): TrafficConfig {
    return { cars: settings.cars, people: settings.people, signals: settings.signals };
}

const session = new FlightSession({
    preset,
    overrides: overrides(),
    level,
    traffic: trafficConfig(),
    spawn: level.spawns.find((s) => s.id === (params.get('spawn') ?? settings.spawn)) ?? level.spawns[0]
});

// ---------------------------------------------------------------- renderer

// reversed depth: precise depth from the 1 cm near plane (view.ts CAMERA_NEAR) to 5 km; WebGL 2 needs EXT_clip_control,
// and Three.js falls back to normal depth without it
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has('webgl'), reversedDepthBuffer: true });
const pixelRatio = (): number => Math.min(devicePixelRatio, 2) * settings.renderScale;
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
await renderer.init();
const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

// read once: switching shadows on a running page crashed Three.js (castShadow toggled), so the setting applies on reload
const shadowsOn = settings.shadows && !params.has('noshadows');
renderer.shadowMap.enabled = shadowsOn;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const sun = environment(scene);
scene.add(levelGroup(level));
const trafficView = new TrafficView();
trafficView.rebuild(session.traffic);
scene.add(trafficView.group);
const view = new CraftView();
view.uptiltDeg = settings.uptiltDeg;
view.fovDeg = settings.fovDeg;
view.resize(innerWidth, innerHeight);
scene.add(view.craft);
if (params.get('cam') === 'chase') view.setMode('chase');
/** "Look around" without a radio: fly the camera with WASD and the mouse */
const freeCam = new FreeCam(renderer.domElement);
addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    view.resize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- input

interface Device { kind: 'hid' | 'gamepad'; key: string; name: string; hid?: HidSource; pad?: GamepadSource }
let device: Device | null = null;
let profile: RadioProfile | null = null;
let lastFrameT = -Infinity;
let lastArmOn = false;
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
    session.input(ch, f.t);
    lastFrameT = f.t;
    lastArmOn = ch[4] > 0;
    const r = switchOn(profile.reset, f);
    if (r && !resetWas) session.resetToSpawn();
    resetWas = r;
}

function useDevice(d: Device, p: RadioProfile | null): void {
    if (device && device !== d) {
        device.hid?.close();
        device.pad?.stop();
    }
    device = d;
    profile = p;
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
const demo = params.has('demo');

function anyOverlay(): boolean {
    return !menu.classList.contains('hidden') || setup.open || settingsUi.open;
}

function showMenu(on: boolean): void {
    menu.classList.toggle('hidden', !on);
    if (on && freeCam.mouseCaptured) document.exitPointerLock();
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
        profile = p;
        showMenu(true);
    }, () => showMenu(true));
}

function openSettings(): void {
    showMenu(false);
    settingsUi.show({
        settings,
        presetRates,
        onCamera: () => {
            view.uptiltDeg = settings.uptiltDeg;
            view.fovDeg = settings.fovDeg;
            view.updateFov();
        },
        onFlight: () => session.setOverrides(overrides()),
        onTraffic: () => {
            session.setTraffic(trafficConfig());
            trafficView.rebuild(session.traffic);
        },
        onGraphics: () => renderer.setPixelRatio(pixelRatio()),
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
        h('div', { class: 'row' }, h('select', { onchange: (e: Event) => {
            const s = level.spawns.find((x) => x.id === (e.target as HTMLSelectElement).value);
            if (!s) return;
            settings.spawn = s.id;
            saveSettings(settings);
            session.setSpawn(s);
        } }, ...level.spawns.map((s) => h('option', { value: s.id, selected: s.id === session.spawn.id }, s.name)))),
        h('div', { class: 'row' },
            h('button', { onclick: openSettings }, 'Settings (camera, traffic, graphics, rates)'),
            h('span', { class: 'spacer' }),
            h('button', { class: 'primary', onclick: () => showMenu(false) }, profile || demo ? 'Fly' : 'Look around')),
        h('p', { class: 'note' }, 'Keys: Esc menu · R back to the spawn point · C chase / FPV camera · Space arm, T turtle mode (only if your radio has no switch for them).'),
        h('p', { class: 'note' }, 'Look around (no radio): click to steer with the mouse · WASD move · Space / E up, Q down · Shift faster · R back to the quad.'),
        h('p', { class: 'note' }, `Renderer: ${backend}. GPL-3.0-or-later; flight model from ShramkoGSFPV by Andrii Shramko (MIT).`)
    );
}

addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        if (setup.open || settingsUi.open) return;
        showMenu(menu.classList.contains('hidden'));
    } else if (anyOverlay()) return;
    else if (e.code === 'KeyR' && freeCam.active) freeCam.enter(view.camera);
    else if (e.code === 'KeyR') session.resetToSpawn();
    else if (freeCam.active) return;
    else if (e.code === 'KeyC') view.setMode(view.mode === 'fpv' ? 'chase' : 'fpv');
    else if (e.code === 'Space' && profile && !profile.arm) keyArm = !keyArm;
    else if (e.code === 'KeyT' && profile && !profile.turtle) keyTurtle = !keyTurtle;
});

// ---------------------------------------------------------------- frame loop

let prevT = performance.now();
let fps = 0;
function frame(): void {
    const now = performance.now();
    const dt = (now - prevT) / 1000;
    prevT = now;
    fps = fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    setup.render();
    const paused = anyOverlay() || document.visibilityState !== 'visible';
    session.pause(paused, now);
    if (!paused) {
        if (demo) session.input(selftestSticks(session.sim.tick, ch), now);
        // a radio that stopped sending (unplugged, asleep) must not keep the quad armed
        else if (profile && lastArmOn && now - lastFrameT > 150) {
            ch[4] = -1;
            session.input(ch, now);
            lastArmOn = false;
        }
        session.advance(now);
    }
    view.update(session.sim.s, dt);
    const lookAround = !profile && !demo;
    if (lookAround && !freeCam.active) freeCam.enter(view.camera);
    else if (!lookAround && freeCam.active) {
        freeCam.exit();
        view.updateFov();
        view.update(session.sim.s, dt);
    }
    if (freeCam.active) {
        freeCam.apply(view.camera, dt, paused);
        view.craft.visible = true;
    }
    const pend = session.director.pending();
    hud.update(session.sim, {
        respawnIn: pend ? pend.atTick - session.sim.tick : null,
        hasRadio: profile !== null || demo,
        noRadioHint: freeCam.mouseCaptured
            ? 'WASD move · Space / E up, Q down · Shift faster'
            : 'No radio set up — click to look around, Esc for the menu',
        armHint: profile && !profile.arm ? 'DISARMED — throttle down, press Space to arm' : 'DISARMED — throttle down, flip the arm switch',
        turtleHint: `TILTED — ${profile && !profile.turtle ? 'press T' : 'turtle switch on'}, then arm to flip over (or R)`,
        footer: `${device ? `${device.name} ${rate.hz} Hz · ` : ''}${backend} · ${Math.round(fps)} fps · ${view.mode.toUpperCase()}`
    });
    trafficView.update(session.sim.tick);
    sun.follow(view.camera.position);
    renderer.render(scene, view.camera);
}

renderMenu();
if (params.has('selftest')) {
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
} else void reconnect();
if (demo) showMenu(false);
renderer.setAnimationLoop(frame);
// for checks from the browser console and automated tests
(globalThis as { __fly?: unknown }).__fly = {
    session, view, sun, renderer, scene, S, trafficView,
    /** a simulated radio for UI checks: frames go through the same path as a real one's reports */
    fakeRadio(): (f: RawFrame) => void {
        useDevice({ kind: 'hid', key: 'test:simulated', name: 'Simulated radio' }, loadProfile('test:simulated'));
        return onRaw;
    }
};
