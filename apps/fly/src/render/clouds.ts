// Volumetric clouds (owner, 2026-10-24: "they should be 3d pillowy clouds"; "lets test volumetric for performance").
// Fair-weather cumulus between CLOUD_BASE and CLOUD_TOP, ray-marched per pixel as games do (Schneider, "The real-time
// volumetric cloudscapes of Horizon Zero Dawn", SIGGRAPH 2015; Hillaire, "Physically based sky, atmosphere and cloud
// rendering in Frostbite", SIGGRAPH 2016): a coverage map says where clouds stand and how tall they grow, a 3D noise
// volume gives their billows (cloud-texture.ts), a few samples towards the sun give each point its light (dark bellies,
// bright tops and edges), and the light is summed along the ray with Beer's law. The volume is a cylinder round the
// camera, drawn from inside (its far faces), so anything nearer hides it by the depth test; the clouds themselves stay
// put over the ground and drift with the wind at the sim's tick, so replays show the same sky. Full graphics only: the
// low spec renderers see no further than their fog (view.ts). Drawn only: nothing here reaches the sim.

import * as THREE from 'three/webgpu';
import { Break, Fn, If, Loop, abs, cameraPosition, color, dot, exp, float, fract, max, min, mix, positionWorld, screenCoordinate, select, smoothstep, texture, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { COVERAGE_TEX, SHAPE_TEX, coverageMap, shapeVolume } from './cloud-texture';
import { SUN_DIR } from './world';

/** the clouds' base and the highest tops, m: fair-weather cumulus form from 1000-2000 m and stay under 1-2 km deep */
export const CLOUD_BASE = 1500;
export const CLOUD_TOP = 2800;
/**
 * The layer bends down with distance as round a planet of this radius, m, as flight sims' cloud layers do: a flat layer
 * 1.5 km up would meet a level view only at infinity, leaving the sky near the horizon empty. Round a 60 km planet the
 * base meets the horizon 13 km out and the tops 18 km out; 5 km off the layer is 200 m lower (round the Earth, 2 m).
 */
const PLANET_R = 60000;
/** how far out the clouds are drawn, m: they fade into the sky from FADE_FROM (view.ts FULL_FAR reaches past it) */
export const CLOUD_R = 20000;
const FADE_FROM = 14000;
/** ground covered by one coverage map, m (its 5 base cells 4 km across, its finer ones single clouds) */
const COVER_TILE = 20000;
/** ground covered by one shape volume, m (its biggest lumps 750 m, the smallest ~200 m), and the finer erosion's */
const SHAPE_TILE = 3000;
const DETAIL_TILE = 700;
/** the share of the sky that is cloud, about: coverage above 1 - this ("few" to "scattered") */
const COVER = 0.5;
/** extinction per metre in a cloud's thick: a cumulus' insides are a few tens of metres' visibility */
const SIGMA = 0.025;
/** ray-march steps along the view, and the samples towards the sun (at these distances, m) */
const STEPS = 64;
const LIGHT_AT = [25, 80, 180, 360];
/** the wind at the clouds' height, m/s along +x (west to east) and +z [estimate: a light breeze aloft] */
const WIND = { x: 6, z: 2 };
/** a whole number of COVER_TILE, SHAPE_TILE and DETAIL_TILE, m */
const WIND_SPAN = 420000;

type FloatNode = THREE.Node<'float'>;
type Vec3Node = THREE.Node<'vec3'>;

function dataTexture2D(): THREE.DataTexture {
    const t = new THREE.DataTexture(coverageMap(), COVERAGE_TEX, COVERAGE_TEX, THREE.RedFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
}

function dataTexture3D(): THREE.Data3DTexture {
    const t = new THREE.Data3DTexture(shapeVolume(), SHAPE_TEX, SHAPE_TEX, SHAPE_TEX);
    t.format = THREE.RedFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
}

export class CloudsView {
    readonly group = new THREE.Group();
    private readonly mesh: THREE.Mesh;
    /** how far the wind has carried the clouds, m */
    private readonly wind = uniform(new THREE.Vector3());

    constructor() {
        this.group.name = 'clouds';
        const cover = dataTexture2D(), shape = dataTexture3D();
        const wind = this.wind;
        const sun = vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
        /** the bent layer's centre, under the camera */
        const centre = vec3(cameraPosition.x, -PLANET_R, cameraPosition.z);
        /** height above the bent ground at p, m */
        const alt = (p: Vec3Node): FloatNode => p.sub(centre).length().sub(PLANET_R);

        /** cloud density (0-1) at world point p; `detail`: with the fine erosion (the view's samples, not the light's) */
        const density = (p: Vec3Node, detail: boolean): FloatNode => {
            const q = p.sub(wind);
            const cov = texture(cover, q.xz.div(COVER_TILE)).level(float(0)).r;
            const c = smoothstep(float(1 - COVER), float(1 - COVER + 0.3), cov);
            const h = alt(p).sub(CLOUD_BASE).div(CLOUD_TOP - CLOUD_BASE);
            // a flat base, a rounded top that stands higher where the cover is thicker
            const top = c.mul(0.8).add(0.2);
            const profile = smoothstep(float(0), float(0.08), h).mul(float(1).sub(smoothstep(top.mul(0.45), top, h)));
            const base = c.mul(profile);
            const s = smoothstep(float(0.3), float(0.62), texture3D(shape, q.div(SHAPE_TILE)).level(float(0)).r);
            // Schneider's remap: the billows show where the base is thick, eat it away where thin
            let d: FloatNode = s.sub(float(1).sub(base)).div(max(base, 0.01)).clamp(0, 1);
            if (detail) {
                const e = smoothstep(float(0.3), float(0.62), texture3D(shape, q.div(DETAIL_TILE)).level(float(0)).r);
                d = d.sub(float(1).sub(e).mul(0.4).mul(float(1).sub(d))).clamp(0, 1);
            }
            return d;
        };

        /** Henyey-Greenstein's phase function, times 4 pi (1 for light scattered evenly) */
        const hg = (c: FloatNode, g: number): FloatNode => float(1 - g * g).div(float(1 + g * g).sub(c.mul(2 * g)).pow(1.5));

        const march = Fn(() => {
            const ro = cameraPosition;
            const rd = positionWorld.sub(ro).normalize().toVar();
            // where the ray crosses the base's and the tops' spheres: -b -+ sqrt(disc), the camera inside both below the base
            const oc = ro.sub(centre);
            const b = dot(oc, rd);
            const cc = dot(oc, oc);
            const discB = b.mul(b).sub(cc).add((PLANET_R + CLOUD_BASE) ** 2);
            const discT = b.mul(b).sub(cc).add((PLANET_R + CLOUD_TOP) ** 2);
            const sB = max(discB, 0).sqrt(), sT = max(discT, 0).sqrt();
            const a0 = oc.length().sub(PLANET_R);
            // a downward ray that meets the base from above or inside: it ends there
            const hitsBase = discB.greaterThan(0).and(b.negate().sub(sB).greaterThan(0));
            const topOut = b.negate().add(sT);
            const below = a0.lessThan(CLOUD_BASE), above = a0.greaterThan(CLOUD_TOP);
            const tIn = select(below, b.negate().add(sB), select(above, b.negate().sub(sT), float(0))).toVar();
            const endAbove = select(hitsBase, b.negate().sub(sB), topOut);
            const tOut = min(select(below, topOut, select(hitsBase, min(b.negate().sub(sB), topOut), topOut)), CLOUD_R).toVar();
            If(above, () => {
                tOut.assign(min(select(discT.greaterThan(0), endAbove, float(-1)), CLOUD_R));
            });
            const out = vec4(0, 0, 0, 0).toVar();
            If(tOut.greaterThan(tIn), () => {
                const step = tOut.sub(tIn).div(STEPS).toVar();
                // a different start per pixel (a hash of the pixel: no pattern to it) turns banding into fine grain
                const jitter = fract(dot(screenCoordinate.xy, vec2(12.9898, 78.233)).sin().mul(43758.5453));
                const t = tIn.add(step.mul(jitter)).toVar();
                const T = float(1).toVar();
                const L = vec3(0, 0, 0).toVar();
                const cosSun = dot(rd, sun);
                const phase = mix(hg(cosSun, -0.25), hg(cosSun, 0.65), 0.7);
                const sunLight = vec3(1.0, 0.95, 0.86).mul(2.4);
                Loop(STEPS, () => {
                    const p = ro.add(rd.mul(t)).toVar();
                    const d = density(p, true).toVar();
                    If(d.greaterThan(0.002), () => {
                        // the cloud between here and the sun
                        let od: FloatNode = float(0);
                        let last = 0;
                        for (const at of LIGHT_AT) {
                            od = od.add(density(p.add(sun.mul(at)), false).mul(at - last));
                            last = at;
                        }
                        const toSun = exp(od.mul(-SIGMA));
                        // the powder effect: a cloud's edges facing the sun are darker than Beer's law alone (Schneider)
                        const powder = float(1).sub(exp(od.mul(-SIGMA * 2))).mul(0.6).add(0.4);
                        const h = alt(p).sub(CLOUD_BASE).div(CLOUD_TOP - CLOUD_BASE).clamp(0, 1);
                        // skylight: bluish from above, greyer low in the cloud
                        const ambient = mix(vec3(0.3, 0.34, 0.42), vec3(0.66, 0.74, 0.9), h);
                        // light scattered many times inside the cloud reaches deeper than Beer's law alone lets the
                        // direct sun (Wrenninge's octaves: weaker extinction, flatter phase)
                        const many = exp(od.mul(-SIGMA * 0.25)).mul(mix(float(1), phase, 0.3)).mul(0.25);
                        const S = sunLight.mul(toSun.mul(phase).mul(powder).add(many)).add(ambient);
                        const Ts = exp(d.mul(-SIGMA).mul(step));
                        L.addAssign(S.mul(T).mul(float(1).sub(Ts)));
                        T.mulAssign(Ts);
                    });
                    If(T.lessThan(0.02), () => {
                        Break();
                    });
                    t.addAssign(step);
                });
                const a = float(1).sub(T).toVar();
                // far clouds fade into the sky's haze, then out
                const far = smoothstep(float(3000), float(CLOUD_R), tIn);
                const col = mix(L.div(max(a, 1e-4)), color(0x9cc4e4), far.mul(0.6));
                out.assign(vec4(col, a.mul(float(1).sub(smoothstep(float(FADE_FROM), float(CLOUD_R), tIn)))));
            });
            return out;
        });

        const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide });
        mat.colorNode = march();
        mat.fog = false;
        // a dome round the camera holding every ray's stretch through the layer (its far faces are drawn)
        const geo = new THREE.SphereGeometry(CLOUD_R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        // behind everything else that is see-through (glass, the see-through circle)
        this.mesh.renderOrder = -1;
        this.group.add(this.mesh);
    }

    /** Keep the volume round the camera, and the clouds where the wind has carried them by `t` s. */
    update(cam: THREE.Vector3, t: number): void {
        this.mesh.position.set(cam.x, 0, cam.z);
        // only where it falls in the maps matters: kept within a span all three tile into whole times (420 km), so the
        // numbers stay small and the clouds never jump
        this.wind.value.set((WIND.x * t) % WIND_SPAN, 0, (WIND.z * t) % WIND_SPAN);
    }
}
