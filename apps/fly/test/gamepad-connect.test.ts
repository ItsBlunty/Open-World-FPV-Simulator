// The owner's Boxer in Firefox (2026-10-18): "Use gamepad" kept saying "Move a stick…" and never saw the radio.
// A browser fires 'gamepadconnected' once per page; a pad touched before the button was clicked sends no second
// event. GamepadSource must announce a pad it finds by polling getGamepads(), and announce each pad only once.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GamepadSource } from '../src/devices/gamepad';

type Listener = (e: { gamepad: Gamepad }) => void;
let pads: (Gamepad | null)[] = [];
let listeners: Listener[] = [];
const g = globalThis as Record<string, unknown>;
const saved = { navigator: g.navigator, document: g.document, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };

function fakePad(index: number, id: string): Gamepad {
    return {
        index, id, connected: true, mapping: '', timestamp: 1,
        axes: [0, 0, -1, 0, 0, 0, 0, 0],
        buttons: Array.from({ length: 24 }, () => ({ pressed: false, touched: false, value: 0 }))
    } as unknown as Gamepad;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
    pads = [];
    listeners = [];
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
    g.document = { visibilityState: 'visible' };
    g.addEventListener = (type: string, fn: Listener) => { if (type === 'gamepadconnected') listeners.push(fn); };
    g.removeEventListener = (_type: string, fn: Listener) => { listeners = listeners.filter((l) => l !== fn); };
});

afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true });
    g.document = saved.document;
    g.addEventListener = saved.addEventListener;
    g.removeEventListener = saved.removeEventListener;
});

describe('GamepadSource connect', () => {
    it('announces a pad that was already connected before start (no event)', async () => {
        pads = [fakePad(0, 'Radiomaster Boxer Joystick')];
        const src = new GamepadSource();
        const seen: string[] = [];
        src.onConnect = (p) => seen.push(p.id);
        src.start();
        await wait(50);
        src.stop();
        expect(seen).toEqual(['Radiomaster Boxer Joystick']);
        expect(src.index).toBe(0);
    });

    it('announces once when the event and the poll both see the pad', async () => {
        const src = new GamepadSource();
        const seen: string[] = [];
        src.onConnect = (p) => seen.push(p.id);
        src.start();
        await wait(20);
        pads = [fakePad(0, 'Radiomaster Boxer Joystick')];
        for (const l of listeners) l({ gamepad: pads[0]! });
        await wait(30);
        src.stop();
        expect(seen).toEqual(['Radiomaster Boxer Joystick']);
    });

    it('keeps the first pad when a second one connects', async () => {
        pads = [fakePad(0, 'Radiomaster Boxer Joystick')];
        const src = new GamepadSource();
        const seen: string[] = [];
        src.onConnect = (p) => seen.push(p.id);
        src.start();
        await wait(20);
        pads = [pads[0], fakePad(1, 'Xbox Controller')];
        for (const l of listeners) l({ gamepad: pads[1]! });
        await wait(20);
        src.stop();
        expect(seen).toEqual(['Radiomaster Boxer Joystick']);
        expect(src.id).toBe('Radiomaster Boxer Joystick');
    });
});
