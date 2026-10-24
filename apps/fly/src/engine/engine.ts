// The engine: the flight session, the Three.js scene and the frame loop (physics up to now, then draw). It talks to
// the page only through `Port` messages (protocol.ts), so the same code runs in a worker on an OffscreenCanvas
// (worker.ts, ?render=worker) or on the page (main.ts, the default).

import * as THREE from 'three/webgpu';
import { SRGBColorSpace, WebGLRenderTarget, WebGLRenderer } from 'three';
import { S, SIM_CORE_VERSION } from '@owfpv/sim-core';
import type { PresetJson } from '@owfpv/sim-core';
import { buildFirstMap, courseProblem, customArches } from '@owfpv/maps';
import type { CourseFile, Gate } from '@owfpv/maps';
import nazgul from '@owfpv/sim-core/presets/nazgulf5v3-6s.json';
import { FlightSession } from '../session';
import { demoTrickSticks, selftestSticks } from '../selftest';
import { levelGroup, environment } from '../render/world';
import { CraftView } from '../render/view';
import { TrafficView } from '../render/traffic';
import { TrainView } from '../render/train';
import { AirView } from '../render/air';
import { BuildingsView } from '../render/buildings';
import { CollectiblesView } from '../render/collectibles';
import { TrialsView } from '../render/trials';
import { AirportLightsView } from '../render/airport-lights';
import { CloudsView, IN_CLOUD_COLOUR, cloudFog } from '../render/clouds';
import { CraneView } from '../render/crane';
import { FreeCam } from '../render/freecam';
import { FisheyeView, LOW_SPEC_OVERSAMPLE, NO_GPU_OVERSAMPLE } from '../render/fisheye';
import { SeeThrough, blocked } from '../render/see-through';
import { lensById } from '../render/lenses';
import { shadowReach } from '../render/shadow-follow';
import { kitFor } from '../render/kit';
import { VIEW_DISTANCES, graphicsName } from '../graphics';
import { HUD_HZ } from './protocol';
import { captureFlight } from '../flights';
import { T, lifeAt, poseAt } from '../replay';
import type { Track } from '../replay';
import { PathLine, Spotter } from '../render/replay-view';
import { EditorView, FlownLine } from '../render/course-editor';
import { CourseEditor } from '../course-editor';
import type { EditorCam } from '../course-editor';
import { TRAFFIC_VERSION, TRAINS, makeAir, makeTraffic, makeTrains } from '@owfpv/traffic';
import type { AirTraffic, TrafficConfig, TrafficModel, Train } from '@owfpv/traffic';
import type { EditorMode, EngineMsg, EngineReport, EngineSettings, InitMsg, PageMsg, PathMode, Port, ReplayCam, TrialInfo } from './protocol';
import { RadioLink } from './radio-link';
import { A, cityWeight, fastestHit, putAir, putQuad, putTrains, trainAxles } from '../audio/frame';

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

    // the creator's courses for this map (a course the page kept that no longer checks out is left out)
    const builtIn = level.trials.map((t) => t.id);
    const usable = (list: readonly unknown[]) => list.filter((c) => courseProblem(c, level.id) === null && !builtIn.includes((c as { id: string }).id)) as CourseFile[];
    const session = new FlightSession({
        preset,
        overrides: cfg.overrides,
        level,
        traffic: cfg.traffic,
        courses: usable(init.courses[level.id] ?? []),
        // per-life state hashes, so a saved flight can be checked by replaying it (flights.ts)
        traceHash: true,
        spawn: level.spawns.find((s) => s.id === (params.get('spawn') ?? cfg.spawn)) ?? level.spawns[0]
    });

    // The low spec modes (graphics.ts, docs/notes/low-spec.md): Three.js's classic WebGL 2 renderer, matte materials, no
    // multisampling, no shadows, a cheaper fisheye lens, at most one device pixel per CSS pixel; extra and super low spec at a
    // fixed lower resolution and a nearer fog. Read once: it applies on reload.
    const kit = kitFor(init.graphics);
    const lowSpec = kit.lowSpec;
    // reversed depth: precise depth from the 1 cm near plane (view.ts CAMERA_NEAR) to 15 km (view.ts FULL_FAR); WebGL 2 needs EXT_clip_control,
    // and Three.js falls back to normal depth without it
    // the Ultra preset's shadow map is 16384² (render/shadow-follow.ts); WebGPU gives 8192 unless asked for more, so ask for
    // what the adapter has, up to that (the adapter asked for as Three.js asks for its own, so it is the same one)
    type Gpu = { requestAdapter(o: object): Promise<{ limits: { maxTextureDimension2D: number } } | null> };
    const gpu = (navigator as { gpu?: Gpu }).gpu;
    const adapter = lowSpec || params.has('webgl') || !gpu ? null : await gpu.requestAdapter({ featureLevel: 'compatibility' }).catch(() => null);
    const requiredLimits = adapter ? { maxTextureDimension2D: Math.min(16384, adapter.limits.maxTextureDimension2D) } : undefined;
    const gpuRenderer = lowSpec ? null : new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: params.has('webgl'), reversedDepthBuffer: true, requiredLimits });
    const renderer = gpuRenderer ?? new WebGLRenderer({ canvas, antialias: false, reversedDepthBuffer: true });
    let size = { width: init.width, height: init.height, dpr: init.dpr };
    const pixelRatio = (): number => Math.min(size.dpr, lowSpec ? 1 : 2) * (kit.resolution ?? cfg.renderScale);
    renderer.setPixelRatio(pixelRatio());
    // false: an OffscreenCanvas has no style; the page's CSS sizes the canvas element
    renderer.setSize(size.width, size.height, false);
    await gpuRenderer?.init();
    const backend = !gpuRenderer ? `WebGL 2, ${graphicsName(kit.graphics)}` : (gpuRenderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

    // read once: switching shadows on a running page crashed Three.js (castShadow toggled), so the setting applies on reload
    renderer.shadowMap.enabled = init.shadows && !lowSpec;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const sun = environment(scene, kit);
    // the shadow map may not be bigger than the GPU's largest texture (8192 is WebGPU's default limit)
    const gpuBackend = gpuRenderer?.backend as { device?: { limits: { maxTextureDimension2D: number } }; gl?: WebGL2RenderingContext } | undefined;
    const maxTexture: number = gpuBackend?.device?.limits.maxTextureDimension2D ?? (gpuBackend?.gl?.getParameter(0x0d33 /* MAX_TEXTURE_SIZE */) as number | undefined) ?? 4096;
    const reachShadows = (): void => sun.setReach(shadowReach(cfg.shadowReach, maxTexture));
    reachShadows();
    /** the clouds (full graphics only, clouds.ts); the setting shows or hides them */
    const cloudsView = lowSpec ? null : new CloudsView();
    if (cloudsView) {
        scene.add(cloudsView.group);
        // the sun's light cut where the clouds' shadows fall (clouds.ts)
        cloudsView.shade(sun.light);
    }
    const skyColour = (scene.background as THREE.Color).clone();
    const cloudColour = new THREE.Color(IN_CLOUD_COLOUR);
    /**
     * Full graphics' fog, each frame: the View distance setting's (the low spec kits keep their own), closing in and
     * turning white as the camera flies into a cloud, the sky behind with it (clouds.ts cloudFog); the clouds where the
     * wind has carried them at sim tick `tick`, and the airport's lights hazed with the fog.
     */
    const viewFog = (tick: number): void => {
        if (lowSpec || !cloudsView || !(scene.fog instanceof THREE.Fog)) return;
        cloudsView.group.visible = cfg.clouds;
        if (cfg.clouds) cloudsView.update(tick / 1000);
        const f = VIEW_DISTANCES[cfg.viewDistance];
        const w = cloudsView.whiteout(view.camera.position);
        const g = cloudFog(w, f.near, f.far);
        scene.fog.near = g.near;
        scene.fog.far = g.far;
        scene.fog.color.copy(skyColour).lerp(cloudColour, w);
        (scene.background as THREE.Color).copy(scene.fog.color);
        lightsView?.setHaze(scene.fog.color, g.far);
    };
    scene.add(levelGroup(level, kit));
    const trafficView = new TrafficView(kit);
    trafficView.rebuild(session.traffic);
    scene.add(trafficView.group);
    /** one view per train (the second in green: TrainView's livery) */
    const trainViews = Array.from({ length: TRAINS }, (_, k) => new TrainView(kit, k));
    const showTrains = (ts: readonly Train[]): void => trainViews.forEach((v, k) => v.rebuild(ts[k] ?? null));
    const drawTrains = (tick: number): void => { for (const v of trainViews) v.update(tick); };
    showTrains(session.trains);
    for (const v of trainViews) scene.add(v.group);
    /** the airport's planes, helicopter, tugs and people */
    const airView = new AirView(kit);
    airView.rebuild(session.air);
    scene.add(airView.group);
    /** the airport's runway, taxiway, PAPI and beacon lights (the map's, there whether its traffic is on or not) */
    const lightsView = level.airport ? new AirportLightsView(level.airport.lights, kit) : null;
    if (lightsView) scene.add(lightsView.group);
    /** the tower crane at work (always, on a level that has one) */
    const craneView = new CraneView(session.crane, kit);
    scene.add(craneView.group);
    const buildingsView = new BuildingsView(level, kit);
    scene.add(buildingsView.group);
    session.collector.setTaken(init.collection[level.id] ?? []);
    const collectView = new CollectiblesView(level.collectibles, kit);
    collectView.setTaken((n) => session.collector.isTaken(n));
    scene.add(collectView.group);
    let trialsView = new TrialsView(session.courses, kit);
    scene.add(trialsView.group);
    /** the custom courses' pads, arches and flags (the map's own are part of the map) */
    let archGroup = levelGroup(customArches(session.courses), kit);
    scene.add(archGroup);
    let flown: boolean[] = [];
    /** The courses changed: their views built again. */
    function showCourses(): void {
        scene.remove(trialsView.group, archGroup);
        trialsView.dispose();
        archGroup.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
        trialsView = new TrialsView(session.courses, kit);
        trialsView.setFlown(flown);
        archGroup = levelGroup(customArches(session.courses), kit);
        scene.add(trialsView.group, archGroup);
    }
    const trialInfos = (): TrialInfo[] => session.courses.map((t) => ({
        id: t.id, name: t.name, area: t.area, version: t.version, gates: t.gates.map((g) => g.name),
        at: t.gates.map((g): [number, number, number] => [g.x, g.y, g.z]), custom: t.custom === true
    }));

    /** the time trial creator (owner, 2026-10-20): the course being made, its view and the flown line; null when closed */
    interface Editing {
        ed: CourseEditor;
        mode: EditorMode;
        view: EditorView;
        line: FlownLine;
    }
    let editing: Editing | null = null;
    const camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    function editorCam(): EditorCam {
        const c = view.camera;
        camEuler.setFromQuaternion(c.quaternion, 'YXZ');
        return { x: c.position.x, y: c.position.y, z: c.position.z, yaw: camEuler.y, pitch: camEuler.x };
    }
    /** the first surface straight down from a point (the map; the creator puts pads and race gate legs on it) */
    const groundRay = (x: number, y: number, z: number): number | null => session.world.queryRay(x, y, z, 0, -1, 0, 2000)?.y ?? null;
    function postEditor(): void {
        const e = editing;
        if (!e) return;
        post({ type: 'editor', state: { course: e.ed.course, hasPad: e.ed.hasPad, selected: e.ed.selected, mode: e.mode, reach: e.ed.reach, problem: e.ed.problem(), line: e.line.segments } });
    }
    function editorMode(mode: EditorMode): void {
        const e = editing;
        if (!e) return;
        e.mode = mode;
        if (mode === 'camera' && !freeCam.active) freeCam.enter(view.camera);
        else if (mode === 'fly' && freeCam.active && radio.hasRadio) {
            freeCam.exit();
            view.updateFov();
        }
        postEditor();
    }
    function closeEditor(): void {
        const e = editing;
        if (!e) return;
        scene.remove(e.view.group, e.line.line);
        e.view.dispose();
        e.line.line.geometry.dispose();
        editing = null;
        if (freeCam.active && radio.hasRadio) {
            freeCam.exit();
            view.updateFov();
        }
    }
    /** Where the quad's centre is now, with its heading (deg, as a spawn's): a respawn there sets it down where it is. */
    function quadPose(): [number, number, number, number] {
        const s = session.sim.s;
        camEuler.setFromQuaternion(new THREE.Quaternion(s[S.qx], s[S.qy], s[S.qz], s[S.qw]), 'YXZ');
        return [s[S.px], s[S.py], s[S.pz], (-camEuler.y * 180) / Math.PI];
    }
    /** Where a gate placed now would go (an open gate's size), at the crosshair point. */
    function previewGate(e: Editing): Gate {
        const cam = editorCam();
        const t = e.ed.target(cam);
        const flat = e.ed.flatNow(cam);
        const l = Math.hypot(t.fx, t.fz) || 1;
        return { x: t.x, y: t.y, z: t.z, nx: flat ? 0 : t.fx / l, ny: flat ? 1 : 0, nz: flat ? 0 : t.fz / l, hw: 1.5, hh: 1.0, name: 'next' };
    }
    /** the quad's last place on the flown line (a jump longer than this between samples is a respawn: no segment) */
    const LINE_JUMP_M = 4;
    let lineLast: [number, number, number] | null = null;
    const view = new CraftView(kit);
    view.uptiltDeg = cfg.uptiltDeg;
    view.fovDeg = cfg.fovDeg;
    view.resize(size.width, size.height);
    scene.add(view.craft);
    /**
     * the FPV camera's lens (render/fisheye.ts), also on the free camera (owner, 2026-10-18); the chase camera stays flat.
     * Low spec has its own cheaper build of it, one wide face (owner, 2026-10-22), culled at the FPV camera's nearer far plane.
     */
    const fisheye = new FisheyeView({
        lowSpec, far: view.camera.far, oversample: !lowSpec ? 1 : kit.graphics === 'low' ? LOW_SPEC_OVERSAMPLE : NO_GPU_OVERSAMPLE
    });
    const bufferSize = new THREE.Vector2();
    const fitFisheye = (): void => {
        renderer.getDrawingBufferSize(bufferSize);
        fisheye.setSize(bufferSize.x, bufferSize.y);
    };
    fisheye.setLens(lensById(cfg.lens));
    fitFisheye();
    if (params.get('cam') === 'chase') view.setMode('chase');
    /** the chase camera's see-through circle when a wall hides the quad (render/see-through.ts); same target kind as the lens faces */
    const seeThrough = new SeeThrough(kit, () => gpuRenderer
        ? new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true })
        : new WebGLRenderTarget(1, 1, { colorSpace: SRGBColorSpace, depthBuffer: true }));
    const rayT = session.world.rayT.bind(session.world);
    /** "Look around" without a radio: fly the camera with WASD and the mouse */
    const freeCam = new FreeCam();
    const radio = new RadioLink(init.timeOrigin, performance.timeOrigin);
    const ch = new Float32Array(8);
    /** the pilot's sticks held centred while a time trial's offer is up (trials.ts filter) */
    const heldSticks = new Float32Array(8);
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
        trains: readonly Train[];
        air: AirTraffic | null;
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
    /** the trains, for lives flown with them (they run the same in every life) */
    let replayTrains: Train[] | null = null;
    /** the airport's traffic, for lives flown with it */
    let replayAir: AirTraffic | null = null;
    const replayAt: EngineMsg & { type: 'replay-at' } = { type: 'replay-at', tick: 0, playing: false };

    const fly = { session, view, sun, renderer, lowSpec, scene, S, trafficView, trainViews, airView, lightsView, cloudsView, craneView, buildingsView, collectView, get trialsView() { return trialsView; }, freeCam, radio, fisheye, seeThrough, get replay() { return replay; }, get editing() { return editing; } };

    function startReplay(track: Track, cam: ReplayCam, path: PathMode): void {
        if (replay) stopReplay();
        const line = new PathLine(track, kit);
        line.setMode(path);
        scene.add(line.line);
        replay = {
            track, tick: track.startTick, playing: true, speed: 1, shuttle: 0, cam: 'fpv', path: line,
            pose: new Float32Array(T.size), s: new Float64Array(S.size), life: -1, traffic: null, trains: [], air: null,
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
        showTrains(session.trains);
        airView.rebuild(session.air);
        collectView.setTaken((n) => session.collector.isTaken(n));
        if (freeCam.active) freeCam.exit();
        view.setMode(r.flyMode);
    }

    function trafficFor(c: TrafficConfig): TrafficModel | null {
        const key = `${c.cars ? 1 : 0}${c.people ? 1 : 0}${c.signals ? 1 : 0}${c.train ? 1 : 0}`;
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
            const tn = tr.lives[li].traffic.train ? (replayTrains ??= makeTrains(level, true)) : [];
            if (tn !== r.trains || r.trains.length === 0) showTrains(tn);
            r.trains = tn;
            const an = tr.lives[li].traffic.air ? (replayAir ??= makeAir(level, true)) : null;
            if (an !== r.air || !an) airView.rebuild(an);
            r.air = an;
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
        trialsView.update(null, now / 1000);
        trafficView.update(tick, view.camera.position);
        drawTrains(r.tick);
        airView.update(r.tick);
        lightsView?.update(view.camera.position, r.tick / 1000);
        viewFog(r.tick);
        craneView.update(r.tick);
        buildingsView.update(r.traffic, tick);
        sun.follow(view.camera.position);
        chaseCircle(r.cam === 'chase', dt);
        {
            // the sound of the flight as it was: rotor speeds from the track; no hits yet (docs/notes/sound.md)
            const a = audioMsg.a, s = r.s, p = r.pose;
            putQuad(a, s, 0);
            for (let i = 0; i < 4; i++) a[A.w0 + i] = p[T.w0 + i];
            a[A.hit] = 0;
            a[A.crash] = 0;
            for (let i = 0; i < 4; i++) a[A.k0 + i] = 0;
            a[A.toGo] = -1;
            postAudio(rate !== 0 && rate > 0, r.cam !== 'fpv', r.tick, r.trains, r.air);
        }
        draw(r.cam === 'fpv' || r.cam === 'free');
        replayAt.tick = r.tick;
        replayAt.playing = r.playing;
        post(replayAt);
    }

    function handle(m: PageMsg): void {
        switch (m.type) {
            case 'input':
                if (!demo) radio.input(session, session.trials.filter(m.ch, heldSticks), m.t);
                break;
            case 'radio':
                radio.hasRadio = m.on;
                break;
            case 'pause':
                if (m.on && !paused) saveFlight();
                paused = m.on;
                break;
            case 'reset':
                // in a time trial: back on its pad for the countdown again; while asked to race: no, and the start point
                if (session.trials.restart()) break;
                session.trials.quit();
                session.resetToSpawn();
                break;
            case 'trial-flown':
                flown = m.flown;
                trialsView.setFlown(m.flown);
                break;
            case 'courses': {
                // set down on the named course's pad (its index in the new list), or where the quad is
                const files = usable(m.files);
                const pad = [...level.trials.map((t) => t.pad), ...files.map((c) => c.pad)][[...builtIn, ...files.map((c) => c.id)].indexOf(m.pad ?? '')];
                // on its top as TrialRunner.padPose puts it, facing the race's heading
                session.setCourses(files, pad ? [pad.x, pad.y + session.sim.p.bodyBottom + 0.01, pad.z, pad.yawDeg] : quadPose());
                showCourses();
                post({ type: 'courses', trials: trialInfos() });
                break;
            }
            case 'editor-open':
                closeEditor();
                session.trials.quit();
                editing = { ed: new CourseEditor(m.course, m.hasPad, groundRay), mode: 'camera', view: new EditorView(kit), line: new FlownLine(kit) };
                lineLast = null;
                scene.add(editing.view.group, editing.line.line);
                editorMode('camera');
                break;
            case 'editor-close':
                closeEditor();
                break;
            case 'editor-mode':
                editorMode(m.mode);
                break;
            case 'editor-op':
                if (!editing) break;
                editing.ed.apply(m.op, editorCam());
                postEditor();
                break;
            case 'editor-clear-line':
                editing?.line.clear();
                lineLast = null;
                postEditor();
                break;
            case 'trial':

                if (m.act === 'quit') session.trials.quit();
                else session.trials.answer(m.act === 'race');
                break;
            case 'settings':
                cfg = m.settings;
                if (m.what === 'camera') {
                    view.uptiltDeg = cfg.uptiltDeg;
                    view.fovDeg = cfg.fovDeg;
                    view.updateFov();
                    fisheye.setLens(lensById(cfg.lens));
                } else if (m.what === 'flight') session.setOverrides(cfg.overrides);
                else if (m.what === 'traffic') {
                    session.setTraffic(cfg.traffic);
                    trafficView.rebuild(session.traffic);
                    showTrains(session.trains);
                    airView.rebuild(session.air);
                } else if (m.what === 'graphics') {
                    renderer.setPixelRatio(pixelRatio());
                    fitFisheye();
                    reachShadows();
                    viewFog(session.sim.tick);
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
        hud: { s: new Float64Array(session.sim.s.length), ch: new Float32Array(8), p: { cells: 0, crashOn: false, smallAngleDeg: 25 }, respawnIn: null, fps: 0, mode: 'fpv', freeCam: false, trial: session.trials.status() }
    };
    /** the sound's frame (audio/frame.ts), refilled and posted every frame; sim events read up to here */
    const audioMsg: EngineMsg & { type: 'audio' } = { type: 'audio', a: new Float32Array(A.size) };
    let eventsRead = session.runner.events.length;
    let groundAt = 0, groundFrames = 0;
    /** Fills and posts the sound's frame: the listener (the camera), and the rest set by the caller first. */
    function postAudio(on: boolean, external: boolean, tick: number, trains: readonly Train[], air: AirTraffic | null): void {
        const a = audioMsg.a, cam = view.camera, p = cam.position, q = cam.quaternion;
        a[A.on] = on ? 1 : 0;
        a[A.external] = external ? 1 : 0;
        a[A.lx] = p.x; a[A.ly] = p.y; a[A.lz] = p.z;
        a[A.lqx] = q.x; a[A.lqy] = q.y; a[A.lqz] = q.z; a[A.lqw] = q.w;
        a[A.wRef] = session.sim.p.omegaMaxPerVolt * session.sim.p.cells * 4.2;
        a[A.city] = cityWeight(level.blocks, p.x, p.z);
        // the ground under the camera, every tenth frame (a ray down the map)
        if (groundFrames-- <= 0) {
            groundAt = session.groundY(p.x, p.z);
            groundFrames = 10;
        }
        a[A.agl] = p.y - groundAt;
        putTrains(a, trains, tick);
        putAir(a, air, tick);
        post(audioMsg);
    }

    function frame(): void {
        const now = performance.now();
        const dt = (now - prevT) / 1000;
        prevT = now;
        fps = fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
        if (replay) {
            session.pause(true, now);
            return replayFrame(now, dt);
        }
        // the creator's camera: the sim waits while the course is laid out
        const still = paused || editing?.mode === 'camera';
        session.pause(still, now);
        if (!still) {
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
            for (const e of session.trials.drain()) post({ type: 'trial', e });
            if (editing) {
                // the flown line: where the quad went, so gates can be put on it (a jump is a respawn: no segment)
                const s = session.sim.s, x = s[S.px], y = s[S.py], z = s[S.pz];
                const jump = lineLast !== null && Math.hypot(x - lineLast[0], y - lineLast[1], z - lineLast[2]) > LINE_JUMP_M;
                const before = editing.line.segments;
                editing.line.add(x, y, z, Math.hypot(s[S.vx], s[S.vy], s[S.vz]), now, jump);
                if (editing.line.segments !== before || lineLast === null || jump) lineLast = [x, y, z];
                if (editing.line.segments % 100 === 0 && editing.line.segments !== before) postEditor();
            }
        }
        {
            const a = audioMsg.a, ev = session.runner.events;
            const hit = fastestHit(ev, Math.min(eventsRead, ev.length));
            eventsRead = ev.length;
            a[A.hit] = paused ? 0 : hit.speed;
            a[A.crash] = hit.crash ? 1 : 0;
            session.takeStrikes(a, A.k0);
            putQuad(a, session.sim.s, session.sim.p.omegaMaxPerVolt);
            const st = session.trials.status();
            a[A.toGo] = st.toGo ?? -1;
        }
        collectView.update(now / 1000);
        trialsView.update(session.trials.status(), now / 1000, view.camera.position);
        view.update(session.sim.s, dt);
        const lookAround = (!radio.hasRadio && !demo) || editing?.mode === 'camera';
        if (lookAround && !freeCam.active) freeCam.enter(view.camera);
        else if (!lookAround && freeCam.active) {
            freeCam.exit();
            view.updateFov();
            view.update(session.sim.s, dt);
        }
        if (freeCam.active) {
            freeCam.look(lookDx, lookDy);
            freeCam.apply(view.camera, dt, paused);
        }
        if (editing) {
            editing.view.update(editing.ed.course, editing.ed.hasPad, editing.ed.selected, editing.ed.rev, editing.mode === 'camera' ? previewGate(editing) : null, view.camera.position);
        }
        if (freeCam.active) {
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
            h.p.smallAngleDeg = sim.p.smallAngleDeg;
            h.respawnIn = pend ? pend.atTick - sim.tick : null;
            h.fps = fps;
            h.mode = view.mode;
            h.freeCam = freeCam.active;
            h.trial = session.trials.status();
            post(hudMsg);
        }
        trafficView.update(session.sim.tick, view.camera.position);
        drawTrains(session.sim.tick);
        airView.update(session.sim.tick);
        lightsView?.update(view.camera.position, session.sim.tick / 1000);
        viewFog(session.sim.tick);
        craneView.update(session.sim.tick);
        buildingsView.update(session.traffic, session.sim.tick);
        sun.follow(view.camera.position);
        chaseCircle(!freeCam.active && view.mode === 'chase', dt);
        postAudio(!paused, freeCam.active || view.mode !== 'fpv', session.sim.tick, session.trains, session.air);
        draw(freeCam.active || view.mode === 'fpv');
    }

    /** The see-through circle fades in while the chase camera's view of the quad is blocked. */
    function chaseCircle(chase: boolean, dt: number): void {
        seeThrough.update(chase && blocked(view.camera.position, view.craft.position, rayT), dt, !chase);
    }

    /** The frame from view.camera: through the lens when there is one and `lens` says this camera has it. */
    function draw(lens: boolean): void {
        // the clouds' shadow map first, where they are this frame
        if (gpuRenderer) cloudsView?.drawShadow(gpuRenderer);
        if (lens && fisheye.active) fisheye.render(renderer, scene, view.camera, renderer.shadowMap.enabled ? sun.light.shadow : null);
        else {
            renderer.render(scene, view.camera);
            seeThrough.render(renderer, scene, view.camera, view.craft.position, renderer.shadowMap.enabled && gpuRenderer ? sun.light.shadow : null);
        }
    }

    warmUp();
    // Firefox compiles WebGPU pipelines in its GPU process after they are asked for: until the warm-up's work has run
    // there, the first frames waited (~1 s of stall when the menu was closed right after loading, 2026-10-18)
    const device = (gpuRenderer?.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } } | undefined)?.device;
    if (device) await device.queue.onSubmittedWorkDone();
    post({
        type: 'ready', backend, spawns: level.spawns.map((s) => ({ id: s.id, name: s.name })), spawn: session.spawn.id, mapId: level.id,
        props: level.collectibles.map((c) => ({ n: c.n, area: c.area, spot: c.spot })),
        trials: trialInfos(),
        axles: level.railway ? trainAxles(session.train ?? makeTrains(level, true)[0]) : []
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
        drawTrains(session.sim.tick);
        airView.update(session.sim.tick);
        lightsView?.update(view.camera.position, session.sim.tick / 1000);
        viewFog(session.sim.tick);
        craneView.update(session.sim.tick);
        buildingsView.update(session.traffic, session.sim.tick);
        collectView.update(0);
        // a gate outline, its see-through copy and the next one shown, so their materials are built now too
        trialsView.update({ phase: 'racing', course: 0, hold: 1, toGo: null, throttleUp: false, ms: 0, gate: 0, gates: 0 }, 0);
        sun.follow(p);
        if (gpuRenderer) cloudsView?.drawShadow(gpuRenderer);
        for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            // looking straight up or down, the camera's up must not be along the view
            cam.up.set(0, y === 0 ? 1 : 0, y === 0 ? 0 : -1);
            cam.lookAt(p.x + x, p.y + y, p.z + z);
            renderer.render(scene, cam);
            // the lens faces draw into their own kind of target: other pipelines than the canvas's
            fisheye.warmUp(renderer, scene, cam);
        }
        seeThrough.warmUp(renderer, scene, cam);
        trialsView.update(session.trials.status(), 0);

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
