import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { aliasEntries } from './config/aliases.mjs';

// The engine runs in a module worker; `worker.format: 'es'` keeps the worker
// bundle an ES module in production as well as development
// (Technical Specification 3.1, 4.2).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: aliasEntries(),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // No gameplay network request may be introduced by the build
    // (Technical Specification 2, 3.2).
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
