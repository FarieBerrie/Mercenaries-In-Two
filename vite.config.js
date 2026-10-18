import { defineConfig } from 'vite';

// Relative asset paths so the built game runs from any folder.
export default defineConfig({
  base: './',
  server: { port: 5193 },
  build: { chunkSizeWarningLimit: 1600 }, // three.js is most of the bundle
});
