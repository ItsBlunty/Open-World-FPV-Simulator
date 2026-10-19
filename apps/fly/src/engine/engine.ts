// The engine: the flight session, the Three.js scene and the frame loop (physics up to now, then draw). It talks to
// the page only through `Port` messages (protocol.ts), so the same code runs in a worker on an OffscreenCanvas
// (worker.ts, ?render=worker) or on the page (main.ts, the default).

import * as THREE from 'three/webgpu';
import { WebGLRenderer } from 'three';
import { S, SIM_CORE_VERSION } from '@owfpv/sim-core';
import type { PresetJson } from '@owfpv/sim-core';
import { buildFirstMap } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from '../session';
import { demoTrickSticks, selftestSticks } from '../selftest';
import { levelGroup, environment } from '../render/world';
import { CraftView } from '../render/view';
import { TrafficView } from '../render/traffic';
import { BuildingsView } from '../render/buildings';
import { CollectiblesView } from '../render/collectibles';
import { FreeCam } from '../render/freecam';
import { FisheyeView } from '../render/fisheye';
import { lensById } from '../render/lenses';
import { FULL_KIT, LOW_SPEC_KIT } from '../render/kit';
import { HUD_HZ } from './protocol';
import { captureFlight } from '../flights';
import { T, lifeAt, poseAt } from '../replay';
import type { Track } from '../replay';
import { PathLine, Spotter } from '../render/replay-view';
import { TRAFFIC_VERSION, makeTraffic } from '@owfpv/traffic';
import type { TrafficConfig, TrafficModel } from '@owfpv/traffic';
import type { EngineMsg, EngineReport, EngineSettings, InitMsg, PageMsg, PathMode, Port, ReplayCam } from './protocol';
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
    const demoSticks = params.get('demo') === 'tricks' ? demoTrickSticks : selftestSticks;

    const session = new FlightSession({
        preset,
        overrides: cfg.overrides,
        level,
        traffic: cfg.traffic,
        // per-life state hashes, so a saved flight can be checked by replaying it (flights.ts)
        traceHash: true,
        spawn: level.spawns.find((s) => s.id === (params.get('spawn') ?? cfg.spawn)) ?? level.spawns[0]
    });

    // Low spec mode (docs/notes/low-spec.md): Three.js's classic WebGL 2 renderer, matte materials, no multisampling, no
    // shadows, no fisheye lens, at most one device pixel per CSS pixel. Read once: it applies on reload.
    const lowSpec = init.lowSpec;
    const kit = lowSpec ? LOW_SPEC_KIT : FULL_KIT;
    // reversed depth: precise depth from the 1 cm near plane (view.ts CAMERA_NEAR) to 5 km; WebGL 2 needs EXT_clip_control,
    // and Three.js falls back to normal depth without it
    const gpuRenderer = lowSpec ? null : new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: params.has('webgl'), reversedDepthBuffer: true });
    const renderer = gpuRenderer ?? new WebGLRenderer({ canvas, antialias: false, reversedDepthBuffer: true });
    let size = { width: init.width, height: init.height, dpr: init.dpr };
    const pixelRatio = (): number => Math.min(size.dpr, lowSpec ? 1 : 2) * cfg.renderScale;
    renderer.setPixelRatio(pixelRatio());
    // false: an OffscreenCanvas has no style; the page's CSS sizes the canvas element
    renderer.setSize(size.width, size.height, false);
    await gpuRenderer?.init();
    const backend = !gpuRenderer ? 'WebGL 2, low spec' : (gpuRenderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

    // read once: switching shadows on a running page crashed Three.js (castShadow toggled), so the setting applies on reload
    renderer.shadowMap.enabled = init.shadows && !lowSpec;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const sun = environment(scene, kit);
    scene.add(levelGroup(level, kit));
    const trafficView = new TrafficView(kit);
    trafficView.rebuild(session.traffic);
    scene.add(trafficView.group);
    const buildingsView = new BuildingsView(level, kit);
    scene.add(buildingsView.group);
    session.collector.setTaken(init.collection[level.id] ?? []);
    const collectView = new CollectiblesView(level.collectibles, kit);
    collectView.setTaken((n) => session.collector.isTaken(n));
    scene.add(collectView.group);
    const view = new CraftView(kit);
    view.uptiltDeg = cfg.uptiltDeg;
    view.fovDeg = cfg.fovDeg;
    view.resize(size.width, size.height);
    scene.add(view.craft);
    /**
     * the FPV camera's lens (render/fisheye.ts), also on the free camera (owner, 2026-10-18); the chase camera stays flat.
     * None in low spec: the lens draws the scene up to five times a frame. The flat camera's field of view applies then.
     */
    const fisheye = gpuRenderer ? new FisheyeView() : null;
    const bufferSize = new THREE.Vector2();
    const fitFisheye = (): void => {
        renderer.getDrawingBufferSize(bufferSize);
        fisheye?.setSize(bufferSize.x, bufferSize.y);
    };
    fisheye?.setLens(lensById(cfg.lens));
    fitFisheye();
    if (params.get('cam') === 'chase') view.setMode('chase');
    /** "Look around" without a radio: fly the camera with WASD and the mouse */
    const freeCam = new FreeCam();
    const radio = new RadioLink(init.timeOrigin, performance.timeOrigin);
    const ch = new Float32Array(8);
    let paused = true;
    let lookDx = 0, lookDy = 0;

    /** the replay viewer (replay.ts): a saved flight's track playing, while the sim stays paused; null when flying */
    interface Replay {
        track: Track;
        /** the playhead, a fractional tick */
        tick: number;
        playing: boolean;
        speed: number;
        shuttle: number;
        cam: ReplayCam;
        path: PathLine;
        pose: Float32Array;
        /** the pose as a sim state, for CraftView */
        s: Float64Array;
        life: number;
        traffic: TrafficModel | null;
        /** golden props of the flight the playhead has passed, and whether the playhead jumped since the last frame */
        propsDone: number;
        jumped: boolean;
        took: Set<number>;
        /** the camera mode to go back to */
        flyMode: 'fpv' | 'chase';
    }
    let replay: Replay | null = null;
    const spotter = new Spotter();
    /** each life's cars and people, by its traffic toggles (built once a viewing) */
    const replayTraffic = new Map<string, TrafficModel | null>();
    const replayAt: EngineMsg & { type: 'replay-at' } = { type: 'replay-at', tick: 0, playing: false };

    const fly = { session, view, sun, renderer, lowSpec, scene, S, trafficView, buildingsView, collectView, freeCam, radio, fisheye, get replay() { return replay; } };

    function startReplay(track: Track, cam: ReplayCam, path: PathMode): void {
        if (replay) stopReplay();
        const line = new PathLine(track, kit);
        line.setMode(path);
        scene.add(line.line);
        replay = {
            track, tick: track.startTick, playing: true, speed: 1, shuttle: 0, cam: 'fpv', path: line,
            pose: new Float32Array(T.size), s: new Float64Array(S.size), life: -1, traffic: null,
            propsDone: -1, jumped: true, took: new Set(track.props.map(([n]) => n)), flyMode: view.mode
        };
        replayTraffic.clear();
        setCam(cam);
    }

    function stopReplay(): void {
        const r = replay;
        if (!r) return;
        scene.remove(r.path.line);
        r.path.dispose();
        replay = null;
        replayTraffic.clear();
        trafficView.rebuild(session.traffic);
        collectView.setTaken((n) => session.collector.isTaken(n));
        if (freeCam.active) freeCam.exit();
        view.setMode(r.flyMode);
    }

    function trafficFor(c: TrafficConfig): TrafficModel | null {
        const key = `${c.cars ? 1 : 0}${c.people ? 1 : 0}${c.signals ? 1 : 0}`;
        if (!replayTraffic.has(key)) replayTraffic.set(key, makeTraffic(level, c));
        return replayTraffic.get(key) ?? null;
    }

    /** Places the replay's pose at the playhead into r.s (a sim state, for CraftView). */
    function replayPose(r: Replay): void {
        const p = poseAt(r.track, r.tick, r.pose), s = r.s;
        s[S.px] = p[T.px]; s[S.py] = p[T.py]; s[S.pz] = p[T.pz];
        s[S.qx] = p[T.qx]; s[S.qy] = p[T.qy]; s[S.qz] = p[T.qz]; s[S.qw] = p[T.qw];
        s[S.vx] = p[T.vx]; s[S.vy] = p[T.vy]; s[S.vz] = p[T.vz];
    }

    function setCam(cam: ReplayCam): void {
        const r = replay;
        if (!r) return;
        const was = r.cam;
        r.cam = cam;
        if (cam === 'spotter') {
            replayPose(r);
            if (was === 'free') spotter.place(view.camera.position, true, () => null);
            else {
                // 8 m behind the quad along its heading, standing on what is under that spot
                const q = new THREE.Quaternion(r.s[S.qx], r.s[S.qy], r.s[S.qz], r.s[S.qw]);
                const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
                back.y = 0;
                if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
                back.normalize();
                const at = new THREE.Vector3(r.s[S.px], r.s[S.py], r.s[S.pz]).addScaledVector(back, 8);
                spotter.place(at, false, (x, y, z) => session.world.queryRay(x, y + 0.5, z, 0, -1, 0, 1000)?.y ?? null);
            }
        }
        if (cam === 'free' && !freeCam.active) freeCam.enter(view.camera);
        if (cam !== 'free' && freeCam.active) freeCam.exit();
        view.setMode(cam === 'fpv' ? 'fpv' : 'chase');
    }

    function replayFrame(now: number, dt: number): void {
        const r = replay!;
        const tr = r.track;
        const rate = r.shuttle !== 0 ? r.shuttle : r.playing ? r.speed : 0;
        if (rate !== 0) {
            r.tick += rate * Math.min(dt, 0.1) * 1000;
            if (r.tick >= tr.endTick) {
                r.tick = tr.endTick;
                r.playing = false;
            } else if (r.tick < tr.startTick) r.tick = tr.startTick;
        }
        replayPose(r);
        const tick = Math.floor(r.tick);
        const li = lifeAt(tr, r.tick);
        if (li !== r.life) {
            r.life = li;
            const t = trafficFor(tr.lives[li].traffic);
            if (t !== r.traffic || r.traffic === null) trafficView.rebuild(t);
            r.traffic = t;
        }
        // the golden props as they were at the playhead: one this flight took pops as the replay plays through it
        let done = 0;
        while (done < tr.props.length && tr.props[done][1] <= r.tick) done++;
        if (done !== r.propsDone) {
            if (done > r.propsDone && r.propsDone >= 0 && !r.jumped) collectView.take(tr.props.slice(r.propsDone, done).map(([n]) => n), now / 1000);
            else {
                const before = new Set(tr.props.slice(0, done).map(([n]) => n));
                // taken on an earlier visit: gone already when this flight was flown
                collectView.setTaken((n) => before.has(n) || (session.collector.isTaken(n) && !r.took.has(n)));
            }
            r.propsDone = done;
        }
        r.jumped = false;
        view.update(r.s, dt);
        if (r.cam === 'free') {
            freeCam.look(lookDx, lookDy);
            freeCam.apply(view.camera, dt, false);
            view.craft.visible = true;
        } else if (r.cam === 'spotter') {
            spotter.apply(view.camera, view.craft.position);
            view.craft.visible = true;
        }
        lookDx = lookDy = 0;
        r.path.update(r.tick);
        collectView.update(now / 1000);
        trafficView.update(tick, view.camera.position);
        buildingsView.update(r.traffic, tick);
        sun.follow(view.camera.position);
        draw(r.cam === 'fpv' || r.cam === 'free');
        replayAt.tick = r.tick;
        replayAt.playing = r.playing;
        post(replayAt);
    }

    function handle(m: PageMsg): void {
        switch (m.type) {
            case 'input':
                if (!demo) radio.input(session, m.ch, m.t);
                break;
            case 'radio':
                radio.hasRadio = m.on;
                break;
            case 'pause':
                if (m.on && !paused) saveFlight();
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
                    fisheye?.setLens(lensById(cfg.lens));
                } else if (m.what === 'flight') session.setOverrides(cfg.overrides);
                else if (m.what === 'traffic') {
                    session.setTraffic(cfg.traffic);
                    trafficView.rebuild(session.traffic);
                } else if (m.what === 'graphics') {
                    renderer.setPixelRatio(pixelRatio());
                    fitFisheye();
                }
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
                fitFisheye();
                break;
            case 'collection':
                session.collector.setTaken(m.taken);
                collectView.setTaken((n) => session.collector.isTaken(n));
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
            case 'replay':
                startReplay(m.track, m.cam, m.path);
                break;
            case 'replay-ctl': {
                const r = replay;
                if (!r) break;
                if (m.speed !== undefined) r.speed = m.speed;
                if (m.shuttle !== undefined) r.shuttle = m.shuttle;
                if (m.playing !== undefined) {
                    r.playing = m.playing;
                    // play at the end: from the start again
                    if (m.playing && r.tick >= r.track.endTick) {
                        r.tick = r.track.startTick;
                        r.jumped = true;
                        view.setMode(view.mode);
                    }
                }
                if (m.seek !== undefined) {
                    r.tick = Math.max(r.track.startTick, Math.min(r.track.endTick, m.seek));
                    r.jumped = true;
                    // the chase camera starts again behind the quad instead of swinging there
                    view.setMode(view.mode);
                }
                if (m.cam !== undefined && m.cam !== r.cam) setCam(m.cam);
                if (m.path !== undefined) r.path.setMode(m.path);
                break;
            }
            case 'replay-exit':
                stopReplay();
                break;
            case 'report':
                post({ type: 'report', id: m.id, state: report() });
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
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const deg = (r: number): number => Math.round((r * 180) / Math.PI);
    const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
    /** The flight's state for a bug report: where it is and how it is drawn (protocol.ts EngineReport). */
    function report(): EngineReport {
        const sim = session.sim, s = replay ? replay.s : sim.s;
        euler.setFromQuaternion(new THREE.Quaternion(s[S.qx], s[S.qy], s[S.qz], s[S.qw]));
        const info = renderer.info.render as { calls?: number; drawCalls?: number; triangles: number };
        return {
            simCore: SIM_CORE_VERSION, mapId: level.id, mapVersion: level.version, trafficVersion: TRAFFIC_VERSION,
            spawn: session.spawn.id, traffic: session.trafficConfig, overrides: cfg.overrides,
            tick: sim.tick, lives: session.runner.lives().length, hitches: session.runner.hitches, paused,
            pos: [round(s[S.px]), round(s[S.py]), round(s[S.pz])], vel: [round(s[S.vx]), round(s[S.vy]), round(s[S.vz])],
            roll: deg(euler.z), pitch: deg(euler.x), yaw: deg(euler.y),
            armed: sim.s[S.armed] > 0, crashed: sim.s[S.crashed] > 0,
            view: view.mode, freeCam: freeCam.active, replayTick: replay ? Math.round(replay.tick) : null,
            renderer: backend, lowSpec, drawCalls: info.calls ?? info.drawCalls ?? 0, triangles: info.triangles
        };
    }
    for (const m of early) handle(m);
    port.onmessage = (e: MessageEvent<PageMsg>) => handle(e.data);

    /** a radio flew in this visit (a look around with the free camera alone is not saved), and when it was last saved */
    let flew = false;
    let savedAtTick = 0;
    /** sends the run so far to the page to keep (flights.ts) */
    function saveFlight(): void {
        if (!flew || session.sim.tick === savedAtTick) return;
        savedAtTick = session.sim.tick;
        try {
            post({ type: 'flight', flight: captureFlight(session, init.flightId, session.collector.history) });
        } catch (err) {
            console.warn('Could not save the flight:', err);
        }
    }

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
        if (replay) {
            session.pause(true, now);
            return replayFrame(now, dt);
        }
        session.pause(paused, now);
        if (!paused) {
            if (demo) session.input(demoSticks(session.sim.tick, ch), now);
            else radio.checkStale(session, now);
            session.advance(now);
            if (radio.hasRadio || demo) flew = true;
            // every minute of flying, so a closed tab or a crash of the page loses at most a minute
            if (session.sim.tick - savedAtTick >= 60000) saveFlight();
            const got = session.collector.drain();
            if (got.length) {
                collectView.take(got, now / 1000);
                post({ type: 'collect', n: got });
            }
        }
        collectView.update(now / 1000);
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
        trafficView.update(session.sim.tick, view.camera.position);
        buildingsView.update(session.traffic, session.sim.tick);
        sun.follow(view.camera.position);
        draw(freeCam.active || view.mode === 'fpv');
    }

    /** The frame from view.camera: through the lens when there is one and `lens` says this camera has it. */
    function draw(lens: boolean): void {
        if (lens && fisheye?.active && gpuRenderer) fisheye.render(gpuRenderer, scene, view.camera, renderer.shadowMap.enabled ? sun.light.shadow : null);
        else renderer.render(scene, view.camera);
    }

    warmUp();
    // Firefox compiles WebGPU pipelines in its GPU process after they are asked for: until the warm-up's work has run
    // there, the first frames waited (~1 s of stall when the menu was closed right after loading, 2026-10-18)
    const device = (gpuRenderer?.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } } | undefined)?.device;
    if (device) await device.queue.onSubmittedWorkDone();
    post({
        type: 'ready', backend, spawns: level.spawns.map((s) => ({ id: s.id, name: s.name })), spawn: session.spawn.id, mapId: level.id,
        props: level.collectibles.map((c) => ({ n: c.n, area: c.area, spot: c.spot }))
    });

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
        buildingsView.update(session.traffic, session.sim.tick);
        collectView.update(0);
        sun.follow(p);
        for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            // looking straight up or down, the camera's up must not be along the view
            cam.up.set(0, y === 0 ? 1 : 0, y === 0 ? 0 : -1);
            cam.lookAt(p.x + x, p.y + y, p.z + z);
            renderer.render(scene, cam);
            // the lens faces draw into half-float multisampled targets: other pipelines than the canvas's
            if (gpuRenderer) fisheye?.warmUp(gpuRenderer, scene, cam);
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
