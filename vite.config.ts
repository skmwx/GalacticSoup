import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { aliasEntries } from './config/aliases.mjs';
import { contentPlugin } from './config/contentPlugin.mjs';

// The engine runs in a module worker; `worker.format: 'es'` keeps the worker
// bundle an ES module in production as well as development
// (Technical Specification 3.1, 4.2).
export default defineConfig({
  plugins: [contentPlugin(), react()],
  resolve: {
    alias: aliasEntries(),
  },
  worker: {
    format: 'es',
    // The worker is bundled separately and does not inherit the plugins above.
    // It hosts the engine, so it is the build that must carry the content.
    plugins: () => [contentPlugin()],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // No gameplay network request may be introduced by the build
    // (Technical Specification 2, 3.2).
    assetsInlineLimit: 0,
    // The preload polyfill is a `fetch` for browsers without module preload.
    // Every release target has it, and without the polyfill the shipped
    // scripts hold no network call at all, which the release gate checks
    // (MVP Scope 7; MVP Implementation Plan phase 21).
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
