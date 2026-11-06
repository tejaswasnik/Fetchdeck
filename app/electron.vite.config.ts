import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// @fetchdeck/engine and @fetchdeck/queue are TypeScript source, so they must be bundled
// into the main process instead of being treated as external node_modules packages.
const bundled = ['@fetchdeck/engine', '@fetchdeck/queue'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'main/index.ts') } },
    },
  },
  preload: {
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'renderer'),
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'renderer/index.html') } },
    },
  },
});
