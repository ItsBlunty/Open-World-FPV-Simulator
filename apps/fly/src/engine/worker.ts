// The engine in a worker: the page transfers its canvas (OffscreenCanvas) with the first message, 'init'.

import { startEngine } from './engine';
import type { EngineMsg, PageMsg, Port } from './protocol';

const port = self as unknown as Port;
port.onmessage = (e: MessageEvent<PageMsg & { canvas?: OffscreenCanvas }>) => {
    const m = e.data;
    if (m.type !== 'init' || !m.canvas) return;
    startEngine(port, m.canvas, m).catch((err: unknown) => {
        const msg: EngineMsg = { type: 'error', message: err instanceof Error ? err.message : String(err) };
        port.postMessage(msg);
    });
};
