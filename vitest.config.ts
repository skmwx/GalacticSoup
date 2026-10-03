import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { aliasEntries } from './config/aliases.mjs';
import { contentPlugin } from './config/contentPlugin.mjs';

const alias = aliasEntries();

// Every project compiles and validates the authored content when it starts, so
// an invalid content set fails the test run rather than one assertion
// (Technical Specification 6.2).
const content = (): ReturnType<typeof contentPlugin> => contentPlugin();

// Named projects back the `test:unit`, `test:integration`, `test:performance`
// and `test:component` entry points (Technical Specification 15.1).
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
        plugins: [content()],
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
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
