// The HID reader (hid-layout.ts, from upstream) on an EdgeTX radio in USB Joystick Classic mode. The
// descriptor is upstream's test fixture (ShramkoGSFPV packages/input/src/sim/devices.ts, MIT,
// Andrii Shramko), which its author built from the EdgeTX source, not read from a radio. When the
// owner's Boxer is plugged in, the app shows its real descriptor: add it here as a fixture.

import { describe, expect, it } from 'vitest';
import { layoutsFromCollections, makeHidReader, parseEdgeTxReport, readsAsEdgeTx } from '../src/index';
import type { HidCollectionInfo, HidItemInfo, RawFrame } from '../src/index';

const P1 = 0x10000;
const P9 = 0x90000;
const items: HidItemInfo[] = [
    { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 0x01, usageMaximum: P9 | 0x18, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 },
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37].map((u) => P1 | u), reportSize: 16, reportCount: 8, logicalMinimum: 0, logicalMaximum: 2047 }
];
const CLASSIC: HidCollectionInfo[] = [{
    usagePage: 0x01,
    usage: 0x05,
    inputReports: [{ reportId: 0, items }],
    children: [{ usagePage: 0x01, usage: 0x00, inputReports: [{ reportId: 0, items }], children: [] }]
}];

function report(raw: number[], buttons: number): DataView {
    const out = new Uint8Array(19);
    const dv = new DataView(out.buffer);
    out[0] = buttons & 0xff;
    out[1] = (buttons >> 8) & 0xff;
    out[2] = (buttons >> 16) & 0xff;
    for (let i = 0; i < 8; i++) dv.setUint16(3 + i * 2, raw[i], true);
    return dv;
}

const frame = (): RawFrame => ({ t: 0, axes: new Float32Array(8), buttons: 0 });

describe('HID reader, EdgeTX Classic', () => {
    it('reads the descriptor as the fixed EdgeTX layout', () => {
        const lay = layoutsFromCollections(CLASSIC);
        expect(lay).toHaveLength(1);
        expect(lay[0].axes).toHaveLength(8);
        expect(lay[0].buttons).toHaveLength(24);
        expect(readsAsEdgeTx(lay)).toBe(true);
    });

    it('scales 0..2047 to -1..1 with 1024 at 0, and reads buttons', () => {
        const read = makeHidReader({ collections: CLASSIC });
        const f = frame();
        expect(read(0, report([0, 1024, 2047, 512, 1536, 1024, 1024, 1024], 0b101), f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 5))).toEqual([-1, 0, 1023 / 1024, -0.5, 0.5]);
        expect(f.buttons).toBe(0b101);
        // the same bytes through the fixed layout: bit for bit equal
        const g = frame();
        parseEdgeTxReport(report([0, 1024, 2047, 512, 1536, 1024, 1024, 1024], 0b101), g);
        expect(Array.from(g.axes)).toEqual(Array.from(f.axes));
    });

    it('falls back to the fixed layout without a descriptor and refuses a short report', () => {
        const read = makeHidReader({});
        const f = frame();
        expect(read(0, new DataView(new ArrayBuffer(10)), f)).toBe(false);
        expect(read(0, report([1024, 1024, 0, 1024, 1024, 1024, 1024, 1024], 0), f)).toBe(true);
        expect(f.axes[2]).toBe(-1);
    });
});
