import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { aliasEntries } from './config/aliases.mjs';

const alias = aliasEntries();

// Three named projects back the `test:unit`, `test:integration` and
// `test:component` entry points (Technical Specification 15.1).
// Browser and accessibility levels run under Playwright.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
});
