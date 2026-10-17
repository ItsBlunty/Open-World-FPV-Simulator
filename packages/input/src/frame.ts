// From ShramkoGSFPV packages/input/src/frame.ts, commit 8c90f535 (MIT, Copyright (c) 2026 Andrii Shramko;
// see ../LICENSE-MIT and ../NOTICE). Local changes are listed in ../UPSTREAM.md.

// The button bits a raw frame (calib.ts RawFrame) carries: 24, the EdgeTX USB joystick's 3 button
// bytes. The HID reader, the gamepad source, the wizard, the mode switch and the channel functions
// all use this one number (a leaf module, so every one of them can import it without a cycle).
export const FRAME_BUTTONS = 24;

/** One reading of a device: axes normalised to [-1, 1], buttons a bitmask of FRAME_BUTTONS bits. */
export interface RawFrame {
    t: number; // ms (page clock)
    axes: Float32Array;
    buttons: number;
}
