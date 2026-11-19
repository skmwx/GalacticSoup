import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { aliasEntries } from './config/aliases.mjs';
import { contentPlugin } from './config/contentPlugin.mjs';
import {
  INTEGRATION_FAST_PROJECT,
  INTEGRATION_INCLUDE,
  INTEGRATION_RELEASE_INCLUDE,
  INTEGRATION_RELEASE_PROJECT,
} from './config/testSelections.mjs';

const alias = aliasEntries();

// Every project compiles and validates the authored content when it starts, so
// an invalid content set fails the test run rather than one assertion
// (Technical Specification 6.2).
const content = (): ReturnType<typeof contentPlugin> => contentPlugin();

// Named projects back the `test:unit`, `test:integration` (both integration
// projects), `test:integration:fast`, `test:integration:release`,
// `test:performance` and `test:component` entry points (Technical
// Specification 15.1).
// Browser and accessibility levels run under Playwright.
// @implements TECH-15.1
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        plugins: [content()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        // The integration suite in two disjoint selections whose union is
        // every file under tests/integration (config/testSelections.mjs):
        // the fast one for feature verification, the long simulations for
        // the release gate and `npm run balance`.
        plugins: [content()],
        resolve: { alias },
        test: {
          name: INTEGRATION_FAST_PROJECT,
          environment: 'node',
          include: INTEGRATION_INCLUDE,
          exclude: INTEGRATION_RELEASE_INCLUDE,
        },
      },
      {
        plugins: [content()],
        resolve: { alias },
        test: {
          name: INTEGRATION_RELEASE_PROJECT,
          environment: 'node',
          include: INTEGRATION_RELEASE_INCLUDE,
        },
      },
      {
        // Timing against the targets of Technical Specification 13. It is a
        // level of its own so that it never shares a processor with the
        // integration suite, which would measure the neighbours instead.
        plugins: [content()],
        resolve: { alias },
        test: {
          name: 'performance',
          environment: 'node',
          include: ['tests/performance/**/*.test.ts'],
          fileParallelism: false,
        },
      },
      {
        plugins: [content(), react()],
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
