// The free-fly camera for "Look around" (no radio set up): WASD moves, the mouse steers once the canvas has
// captured it (click; or drag with a button held), Space / E up, Q down, Shift faster. Rendering only: it moves the Three.js camera and never
// touches the sim, so it uses the frame time freely. No DOM since the engine left the page (2026-10-18): the page
// captures the mouse and hands in the held keys and mouse movement (main.ts, engine/protocol.ts 'freecam').

import * as THREE from 'three/webgpu';

/** m/s; Shift multiplies by FAST */
const SPEED = 10;
const FAST = 4;
/** radians per pixel of mouse movement */
const LOOK = 0.0025;
/** vertical FOV, deg: a normal lens, like the chase camera */
const FOV = 60;

export class FreeCam {
    active = false;
    private yaw = 0;
    private pitch = 0;
    private readonly pos = new THREE.Vector3();
    private readonly keys = new Set<string>();
    private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly move = new THREE.Vector3();

    /** The keys held now (KeyboardEvent.code). */
    setKeys(codes: readonly string[]): void {
        this.keys.clear();
        if (this.active) for (const c of codes) this.keys.add(c);
    }

    /** Mouse movement, pixels (the page sends it only while the mouse is captured or dragging). */
    look(dx: number, dy: number): void {
        if (!this.active) return;
        this.yaw -= dx * LOOK;
        this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * LOOK));
    }

    /** Start from where the camera is now, so switching in does not jump. */
    enter(cam: THREE.PerspectiveCamera): void {
        this.active = true;
        this.pos.copy(cam.position);
        this.euler.setFromQuaternion(cam.quaternion, 'YXZ');
        this.yaw = this.euler.y;
        this.pitch = this.euler.x;
        this.keys.clear();
    }

    exit(): void {
        this.active = false;
        this.keys.clear();
    }

    /** Move by the held keys and place the camera (call after CraftView.update, which it overrides). */
    apply(cam: THREE.PerspectiveCamera, dtS: number, paused: boolean): void {
        const k = this.keys;
        this.move.set(
            (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
            (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0),
            (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0));
        this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
        cam.quaternion.setFromEuler(this.euler);
        if (!paused && this.move.lengthSq() > 0) {
            // forward and sideways follow the view (pitch included, so W flies where you look); up and down stay vertical
            const v = this.move.y;
            this.move.y = 0;
            this.move.normalize().applyQuaternion(cam.quaternion);
            this.move.y += v;
            const speed = SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? FAST : 1);
            this.pos.addScaledVector(this.move, speed * Math.min(dtS, 0.1));
        }
        cam.position.copy(this.pos);
        if (cam.fov !== FOV) {
            cam.fov = FOV;
            cam.updateProjectionMatrix();
        }
    }
}
