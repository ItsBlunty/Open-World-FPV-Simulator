// The airport's lights drawn (owner, 2026-10-24: "airport lights"; the lights and their solid fixtures are the map's,
// packages/maps airport.ts airportLights). Runway and taxiway edge lights, the runway ends' red and green, runway 09's
// green threshold lights, the PAPI and the tower's rotating beacon. A light shines one way (`face`) or all round; each
// keeps at least a few pixels on screen however far off it is, and none fades into the fog, as real lights carry through
// haze. The PAPI shows each unit white or red from where the camera is, and the beacon sweeps a white and a green beam
// round. Drawn only, at the sim's tick: drawing never feeds back into the sim.

import * as THREE from 'three/webgpu';
import type { AirportLight } from '@owfpv/maps';
import { FULL_KIT } from './kit';
import type { Kit } from './kit';

const COLOURS: Record<AirportLight['colour'], number> = { white: 0xfff4dc, green: 0x2cff6a, red: 0xff2a1c, blue: 0x3c6cff };
/** a lamp's glow, m: just over its fixture's 6 cm glass head (maps airport.ts), which would hide it */
const LAMP_R = 0.07;
/** past this distance a lamp is drawn larger, so it stays about the same size on screen, m */
const NEAR_M = 30;
/** a PAPI unit's lamp, m [estimate] */
const PAPI_R = 0.14;
/**
 * The beacon: a white and a green lens back to back, turning so the flashes come 27 a minute (the AIM's 24 to 30 for a
 * land airport: 13.5 turns a minute, two flashes a turn); each flash while its beam is within BEAM of the camera.
 */
const BEACON_RPM = 13.5;
const BEAM = (6 * Math.PI) / 180;
const BEACON_R = 0.3;

/** a light material: unlit, not fogged, its colour */
function lampMat(kit: Kit, colour: number): THREE.Material {
    const m = kit.flat({ color: colour }) as THREE.Material & { fog: boolean };
    m.fog = false;
    return m;
}

export class AirportLightsView {
    readonly group = new THREE.Group();
    /** each instanced set and the lights in it */
    private readonly sets: { mesh: THREE.InstancedMesh; lights: AirportLight[] }[] = [];
    private readonly papi: { mesh: THREE.Mesh; light: AirportLight; mat: THREE.MeshBasicMaterial }[] = [];
    private beacon: { mesh: THREE.Mesh; light: AirportLight; mat: THREE.MeshBasicMaterial } | null = null;
    private readonly m = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly v = new THREE.Vector3();
    private readonly s = new THREE.Vector3();
    private readonly k = new THREE.Vector3();
    private readonly white = new THREE.Color(COLOURS.white);
    private readonly red = new THREE.Color(COLOURS.red);
    private readonly green = new THREE.Color(COLOURS.green);

    constructor(lights: readonly AirportLight[], kit: Kit = FULL_KIT) {
        this.group.name = 'airport-lights';
        const ball = new THREE.SphereGeometry(LAMP_R, kit.seg(8, 6), kit.seg(6, 4));
        // a lens shining one way: a half ball facing +x (turned onto its face per light)
        const lens = new THREE.SphereGeometry(LAMP_R, kit.seg(8, 6), kit.seg(6, 4), Math.PI / 2, Math.PI);
        const groups = new Map<string, AirportLight[]>();
        for (const l of lights) {
            if (l.papi !== undefined || l.beacon) continue;
            const key = `${l.colour}:${l.face ? 'lens' : 'ball'}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(l);
        }
        for (const [key, ls] of groups) {
            const [colour, kind] = key.split(':') as [AirportLight['colour'], string];
            const mesh = new THREE.InstancedMesh(kind === 'lens' ? lens : ball, lampMat(kit, COLOURS[colour]), ls.length);
            mesh.frustumCulled = false; // spread along the whole runway
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.group.add(mesh);
            this.sets.push({ mesh, lights: ls });
        }
        const disc = new THREE.CircleGeometry(PAPI_R, kit.seg(16, 8)).rotateY(-Math.PI / 2); // facing -x, the approach
        for (const l of lights) {
            if (l.papi === undefined) continue;
            const mat = lampMat(kit, COLOURS.white) as THREE.MeshBasicMaterial;
            const mesh = new THREE.Mesh(disc, mat);
            mesh.position.set(l.x, l.y, l.z);
            this.group.add(mesh);
            this.papi.push({ mesh, light: l, mat });
        }
        const b = lights.find((l) => l.beacon);
        if (b) {
            const mat = lampMat(kit, COLOURS.white) as THREE.MeshBasicMaterial;
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(BEACON_R, kit.seg(12, 8), kit.seg(8, 6)), mat);
            mesh.position.set(b.x, b.y, b.z);
            this.group.add(mesh);
            this.beacon = { mesh, light: b, mat };
        }
    }

    /** How much larger to draw a lamp at (x, y, z) seen from `eye`, so it stays a few pixels across far off. */
    private grow(x: number, y: number, z: number, eye: THREE.Vector3): number {
        const d = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
        return d > NEAR_M ? d / NEAR_M : 1;
    }

    /** Draw the lights for a camera at `eye` at sim time `t` s. */
    update(eye: THREE.Vector3, t: number): void {
        const up = this.v.set(0, 1, 0);
        for (const { mesh, lights } of this.sets) {
            lights.forEach((l, i) => {
                const k = this.grow(l.x, l.y, l.z, eye);
                // a lens turned from +x onto its face (about y)
                this.q.setFromAxisAngle(up, l.face ? Math.atan2(-l.face[1], l.face[0]) : 0);
                this.m.compose(this.s.set(l.x, l.y, l.z), this.q, this.k.set(k, k, k));
                mesh.setMatrixAt(i, this.m);
            });
            mesh.instanceMatrix.needsUpdate = true;
        }
        // the PAPI: each unit white seen from above its angle, red from below
        for (const p of this.papi) {
            const l = p.light;
            const elev = (Math.atan2(eye.y - l.y, Math.hypot(eye.x - l.x, eye.z - l.z)) * 180) / Math.PI;
            p.mat.color.copy(elev > l.papi! ? this.white : this.red);
            p.mesh.scale.setScalar(this.grow(l.x, l.y, l.z, eye));
        }
        // the beacon: the white beam at its turn's angle, the green one opposite; a flash while either sweeps the camera
        const bc = this.beacon;
        if (bc) {
            const l = bc.light;
            const beam = (2 * Math.PI * BEACON_RPM * t) / 60;
            const look = Math.atan2(eye.z - l.z, eye.x - l.x);
            const off = (a: number): number => Math.abs(((((look - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
            const w = off(beam) < BEAM, g = off(beam + Math.PI) < BEAM;
            bc.mesh.visible = w || g;
            if (w || g) bc.mat.color.copy(w ? this.white : this.green);
            bc.mesh.scale.setScalar(Math.max(1, this.grow(l.x, l.y, l.z, eye) * (LAMP_R / BEACON_R) * 2));
        }
    }

    dispose(): void {
        this.group.traverse((o) => {
            if (o instanceof THREE.Mesh) {
                o.geometry.dispose();
                (o.material as THREE.Material).dispose();
            }
        });
    }
}
