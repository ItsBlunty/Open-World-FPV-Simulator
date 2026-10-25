// The page's sound threw on every audio message in Firefox (owner, 2026-10-25): delivered synchronously, the error went
// back into the engine's frame and stopped it before it drew, so the picture froze. A handler's error must stay on its
// side, reported, as with a MessageChannel.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { localPorts } from '../src/engine/protocol';

describe('localPorts', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reports an error in a handler and goes on, without throwing it at the sender', () => {
        const reported: unknown[] = [];
        vi.stubGlobal('reportError', (e: unknown) => reported.push(e));
        const [engine, page] = localPorts();
        const got: unknown[] = [];
        page.onmessage = (e: MessageEvent) => {
            if (e.data === 'bad') throw new Error('sound broke');
            got.push(e.data);
        };
        let after = false;
        expect(() => {
            engine.postMessage('bad');
            after = true;
            engine.postMessage('good');
        }).not.toThrow();
        expect(after).toBe(true);
        expect(got).toEqual(['good']);
        expect(reported.map((e) => (e as Error).message)).toEqual(['sound broke']);
    });

    it('still hands messages over synchronously and keeps those sent before a handler', () => {
        const [a, b] = localPorts();
        a.postMessage(1);
        const got: unknown[] = [];
        b.onmessage = (e: MessageEvent) => got.push(e.data);
        a.postMessage(2);
        expect(got).toEqual([1, 2]);
    });
});
