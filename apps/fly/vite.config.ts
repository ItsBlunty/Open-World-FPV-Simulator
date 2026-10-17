import { defineConfig } from 'vite';

export default defineConfig({
    // relative asset paths: the same build runs at a domain root and under GitHub Pages' /<repo>/
    base: './',
    build: { target: 'es2022', chunkSizeWarningLimit: 2000 }
});
