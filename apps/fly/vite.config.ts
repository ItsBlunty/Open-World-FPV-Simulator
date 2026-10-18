import { defineConfig } from 'vite';

export default defineConfig({
    // relative asset paths: the same build runs at a domain root and under GitHub Pages' /<repo>/
    base: './',
    build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
    // the engine worker (engine/worker.ts) is a module worker (Chrome 80, Firefox 114; MDN browser-compat-data)
    worker: { format: 'es' }
});
