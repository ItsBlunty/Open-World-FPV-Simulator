// The engine: the flight session, the Three.js scene and the frame loop (physics up to now, then draw). It talks to
// the page only through `Port` messages (protocol.ts), so the same code runs in a worker on an OffscreenCanvas
// (worker.ts, ?render=worker) or on the page (main.ts, the default).

import * as THREE from 'three/webgpu';
import { S } from '@owfpv/sim-core';
import type { PresetJson } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from '../session';
import { selftestSticks } from '../selftest';
import { levelGroup, environment } from '../render/world';
import { CraftView } from '../render/view';
import { TrafficView } from '../render/traffic';
import { FreeCam } from '../render/freecam';
import { HUD_HZ } from './protocol';
import type { EngineMsg, EngineSettings, InitMsg, PageMsg, Port } from './protocol';
import { RadioLink } from './radio-link';

export async function startEngine(port: Port, canvas: HTMLCanvasElement | OffscreenCanvas, init: InitMsg): Promise<void> {
    const post = (m: EngineMsg): void => port.postMessage(m);
    // what the page says while the map and the renderer start up is kept, then handled in order
    const early: PageMsg[] = [];
    port.onmessage = (e: MessageEvent<PageMsg>) => early.push(e.data);
    const params = new URLSearchParams(init.search);
    const preset = nazgul as unknown as PresetJson;
    const level = buildFirstMap();
    let cfg: EngineSettings = init.settings;
    const demo = params.has('demo');

    const session = new FlightSession({
        preset,
        overrides: cfg.overrides,
        level,
        traffic: cfg.traffic,
        spawn: level.spawns.find((s) => s.id === (params.get('spawn') ?? cfg.spawn)) ?? level.spawns[0]
    });

    // reversed depth: precise depth from the 1 cm near plane (view.ts CAMERA_NEAR) to 5 km; WebGL 2 needs EXT_clip_control,
    // and Three.js falls back to normal depth without it
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: params.has('webgl'), reversedDepthBuffer: true });
    let size = { width: init.width, height: init.height, dpr: init.dpr };
    const pixelRatio = (): number => Math.min(size.dpr, 2) * cfg.renderScale;
    renderer.setPixelRatio(pixelRatio());
    // false: an OffscreenCanvas has no style; the page's CSS sizes the canvas element
    renderer.setSize(size.width, size.height, false);
    await renderer.init();
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

    // read once: switching shadows on a running page crashed Three.js (castShadow toggled), so the setting applies on reload
    renderer.shadowMap.enabled = init.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const sun = environment(scene);
    scene.add(levelGroup(level));
    const trafficView = new TrafficView();
    trafficView.rebuild(session.traffic);
    scene.add(trafficView.group);
    const view = new CraftView();
    view.uptiltDeg = cfg.uptiltDeg;
    view.fovDeg = cfg.fovDeg;
    view.resize(size.width, size.height);
    scene.add(view.craft);
    if (params.get('cam') === 'chase') view.setMode('chase');
    /** "Look around" without a radio: fly the camera with WASD and the mouse */
    const freeCam = new FreeCam();
    const radio = new RadioLink(init.timeOrigin, performance.timeOrigin);
    const ch = new Float32Array(8);
    let paused = true;
    let lookDx = 0, lookDy = 0;

    const fly = { session, view, sun, renderer, scene, S, trafficView, freeCam, radio };

    function handle(m: PageMsg): void {
        switch (m.type) {
            case 'input':
                if (!demo) radio.input(session, m.ch, m.t);
                break;
            case 'radio':
                radio.hasRadio = m.on;
                break;
            case 'pause':
                paused = m.on;
                break;
            case 'reset':
                session.resetToSpawn();
                break;
            case 'settings':
                cfg = m.settings;
                if (m.what === 'camera') {
                    view.uptiltDeg = cfg.uptiltDeg;
                    view.fovDeg = cfg.fovDeg;
                    view.updateFov();
                } else if (m.what === 'flight') session.setOverrides(cfg.overrides);
                else if (m.what === 'traffic') {
                    session.setTraffic(cfg.traffic);
                    trafficView.rebuild(session.traffic);
                } else if (m.what === 'graphics') renderer.setPixelRatio(pixelRatio());
                else if (m.what === 'spawn') {
                    const s = level.spawns.find((x) => x.id === cfg.spawn);
                    if (s) session.setSpawn(s);
                }
                break;
            case 'resize':
                size = { width: m.width, height: m.height, dpr: m.dpr };
                renderer.setPixelRatio(pixelRatio());
                renderer.setSize(size.width, size.height, false);
                view.resize(size.width, size.height);
                break;
            case 'view':
                if (!freeCam.active) view.setMode(view.mode === 'fpv' ? 'chase' : 'fpv');
                break;
            case 'freecam':
                freeCam.setKeys(m.keys);
                lookDx += m.dx;
                lookDy += m.dy;
                if (m.enter && freeCam.active) freeCam.enter(view.camera);
                break;
            case 'ask': {
                let answer: EngineMsg;
                try {
                    // console debugging only (the page's __fly.ask): the code the developer typed, run against the engine
                    const value: unknown = new Function('fly', m.code)(fly);
                    answer = { type: 'answer', id: m.id, ok: true, value: structuredClone(value) };
                } catch (err) {
                    answer = { type: 'answer', id: m.id, ok: false, value: String(err) };
                }
                post(answer);
                break;
            }
        }
    }
    for (const m of early) handle(m);
    port.onmessage = (e: MessageEvent<PageMsg>) => handle(e.data);

    let prevT = performance.now();
    let fps = 0;
    let lastHud = -Infinity;
    const hudMsg: EngineMsg & { type: 'hud' } = {
        type: 'hud',
        hud: { s: new Float64Array(session.sim.s.length), ch: new Float32Array(8), p: { cells: 0, crashOn: false }, respawnIn: null, fps: 0, mode: 'fpv', freeCam: false }
    };
    function frame(): void {
        const now = performance.now();
        const dt = (now - prevT) / 1000;
        prevT = now;
        fps = fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
        session.pause(paused, now);
        if (!paused) {
            if (demo) session.input(selftestSticks(session.sim.tick, ch), now);
            else radio.checkStale(session, now);
            session.advance(now);
        }
        view.update(session.sim.s, dt);
        const lookAround = !radio.hasRadio && !demo;
        if (lookAround && !freeCam.active) freeCam.enter(view.camera);
        else if (!lookAround && freeCam.active) {
            freeCam.exit();
            view.updateFov();
            view.update(session.sim.s, dt);
        }
        if (freeCam.active) {
            freeCam.look(lookDx, lookDy);
            freeCam.apply(view.camera, dt, paused);
            view.craft.visible = true;
        }
        lookDx = lookDy = 0;
        if (now - lastHud >= 1000 / HUD_HZ) {
            lastHud = now;
            const pend = session.director.pending();
            const sim = session.sim;
            // one snapshot, refilled: a worker port copies it on send, the page's port hands it over and the page draws it at once
            if (hudMsg.hud.s.length !== sim.s.length) hudMsg.hud.s = new Float64Array(sim.s.length);
            const h = hudMsg.hud;
            h.s.set(sim.s);
            h.ch.set(sim.ch);
            h.p.cells = sim.p.cells;
            h.p.crashOn = sim.p.crashOn;
            h.respawnIn = pend ? pend.atTick - sim.tick : null;
            h.fps = fps;
            h.mode = view.mode;
            h.freeCam = freeCam.active;
            post(hudMsg);
        }
        trafficView.update(session.sim.tick);
        sun.follow(view.camera.position);
        renderer.render(scene, view.camera);
    }

    warmUp();
    // Firefox compiles WebGPU pipelines in its GPU process after they are asked for: until the warm-up's work has run
    // there, the first frames waited (~1 s of stall when the menu was closed right after loading, 2026-10-18)
    const device = (renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
    if (device) await device.queue.onSubmittedWorkDone();
    post({ type: 'ready', backend, spawns: level.spawns.map((s) => ({ id: s.id, name: s.name })), spawn: session.spawn.id });

    /**
     * First-sight stutter (owner, 2026-10-18): Three.js builds an object's pipelines and uploads its buffers the first
     * time it is drawn, and only for what the camera sees (Renderer._projectObject culls to the view, compileAsync too),
     * so the first turn after loading hitched 150-180 ms (Firefox 158). Drawing once along each cube face (90 deg) from
     * the spawn, with the chase-view quad shown, does all of it while the map loads.
     */
    function warmUp(): void {
        const cam = view.camera;
        const pos = cam.position.clone(), quat = cam.quaternion.clone(), fov = cam.fov, aspect = cam.aspect;
        view.update(session.sim.s, 0);
        view.craft.visible = true;
        cam.fov = 90;
        cam.aspect = 1;
        cam.updateProjectionMatrix();
        const p = cam.position;
        trafficView.update(session.sim.tick);
        sun.follow(p);
        for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            // looking straight up or down, the camera's up must not be along the view
            cam.up.set(0, y === 0 ? 1 : 0, y === 0 ? 0 : -1);
            cam.lookAt(p.x + x, p.y + y, p.z + z);
            renderer.render(scene, cam);
        }
        cam.up.set(0, 1, 0);
        cam.position.copy(pos);
        cam.quaternion.copy(quat);
        cam.fov = fov;
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
        view.update(session.sim.s, 0);
    }
    renderer.setAnimationLoop(frame);
}
