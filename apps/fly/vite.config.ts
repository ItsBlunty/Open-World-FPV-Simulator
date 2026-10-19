import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** The commit this build is from, for bug reports (report.ts): CI's GITHUB_SHA, else git, else "unknown". */
function commit(): string {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
    try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        return 'unknown';
    }
}

export default defineConfig({
    // relative asset paths: the same build runs at a domain root and under GitHub Pages' /<repo>/
    base: './',
    build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
    // the engine worker (engine/worker.ts) is a module worker (Chrome 80, Firefox 114; MDN browser-compat-data)
    worker: { format: 'es' },
    define: { __BUILD__: JSON.stringify({ commit: commit(), date: new Date().toISOString().slice(0, 10) }) }
});
