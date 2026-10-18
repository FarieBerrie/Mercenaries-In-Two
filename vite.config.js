import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The MIT licences of the bundled code and characters ask for their notices to travel with
// every copy, so each build gets THIRD_PARTY_NOTICES.md beside index.html.
const notices = {
  name: 'third-party-notices',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync('THIRD_PARTY_NOTICES.md', 'utf8') });
  },
};

// Relative asset paths so the built game runs from any folder.
export default defineConfig({
  base: './',
  server: { port: 5193 },
  build: { chunkSizeWarningLimit: 1600 }, // three.js is most of the bundle
  plugins: [notices],
});
