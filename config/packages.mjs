/**
 * Package boundaries for the Galactic Soup source tree.
 *
 * This file is the single source of truth for:
 *   - the build/test path aliases (vite.config.ts, vitest.config.ts, tsconfig.json);
 *   - the layer rules enforced by scripts/check-architecture.mjs.
 *
 * It mirrors Technical Specification 4.1 (layers and dependency direction) and
 * 4.3 (source layout). A package is a stable boundary: code outside a package
 * may only reach it through its public index, addressed by the alias below.
 *
 * Later phases add packages (adapters/persistence) by adding an entry here plus
 * the matching tsconfig path. Nothing is declared before the phase that owns it.
 */

/**
 * @typedef {'pure' | 'browser'} PlatformKind
 * `pure` packages must run headless: no DOM, no browser storage, no wall-clock
 * time and no ambient randomness (Technical Specification 2, 9.1, 9.4).
 *
 * @typedef {object} PackageRule
 * @property {string} dir            Directory relative to the repository root.
 * @property {string[]} mayImport    Packages this package may import.
 * @property {string[]} externals    Bare module specifiers this package may import.
 * @property {PlatformKind} platform
 * @property {boolean} [testOnly]    Production code must never import this package.
 * @property {string} purpose
 */

/**
 * The compiled content bundle is supplied by the build as a virtual module
 * (config/contentPlugin.mjs), so the content adapter never reads the file
 * system and the engine never depends on a bundler feature.
 */
export const CONTENT_BUNDLE_MODULE = 'virtual:galactic-soup/content-bundle';

/** @type {Record<string, PackageRule>} */
export const PACKAGES = {
  '@shared': {
    dir: 'src/shared',
    mayImport: [],
    externals: [],
    platform: 'pure',
    purpose: 'Dependency-free primitives and utilities.',
  },
  '@protocol': {
    dir: 'src/protocol',
    mayImport: ['@shared'],
    externals: [],
    platform: 'pure',
    purpose: 'Versioned command, query, response and error contracts.',
  },
  '@engine/ports': {
    dir: 'src/engine/ports',
    mayImport: ['@shared'],
    externals: [],
    platform: 'pure',
    purpose: 'Interfaces the engine owns and adapters implement.',
  },
  '@engine/domain': {
    dir: 'src/engine/domain',
    mayImport: ['@shared', '@engine/ports'],
    externals: [],
    platform: 'pure',
    purpose: 'Campaign aggregates, value objects and rules.',
  },
  '@engine/simulation': {
    dir: 'src/engine/simulation',
    mayImport: ['@shared', '@engine/ports', '@engine/domain'],
    externals: [],
    platform: 'pure',
    purpose: 'Authoritative clock, scheduler and ordered systems.',
  },
  '@engine/projections': {
    dir: 'src/engine/projections',
    mayImport: ['@shared', '@protocol', '@engine/ports', '@engine/domain'],
    externals: [],
    platform: 'pure',
    purpose: 'Domain-to-view-model builders.',
  },
  '@engine/application': {
    dir: 'src/engine/application',
    mayImport: [
      '@shared',
      '@protocol',
      '@engine/ports',
      '@engine/domain',
      '@engine/simulation',
      '@engine/projections',
    ],
    externals: [],
    platform: 'pure',
    purpose: 'Request handling and transaction orchestration.',
  },
  '@engine': {
    dir: 'src/engine',
    mayImport: [
      '@shared',
      '@protocol',
      '@engine/application',
      '@engine/domain',
      '@engine/ports',
      '@engine/projections',
      '@engine/simulation',
    ],
    externals: [],
    platform: 'pure',
    purpose: 'Public engine API used by the hosting adapter.',
  },
  '@adapters/content': {
    dir: 'src/adapters/content',
    mayImport: ['@shared', '@engine/ports'],
    externals: [CONTENT_BUNDLE_MODULE],
    platform: 'pure',
    purpose: 'Content bundle loading, integrity checking and indexing.',
  },
  '@adapters/worker': {
    dir: 'src/adapters/worker',
    mayImport: ['@shared', '@protocol', '@engine', '@adapters/content'],
    externals: [],
    platform: 'browser',
    purpose: 'Worker host and message dispatch.',
  },
  '@gateway': {
    dir: 'src/gateway',
    mayImport: ['@shared', '@protocol'],
    externals: [],
    platform: 'browser',
    purpose: 'Transport-independent client API over the protocol.',
  },
  '@gateway/direct': {
    dir: 'src/gateway/direct',
    mayImport: [
      '@shared',
      '@protocol',
      '@gateway',
      '@engine',
      '@adapters/content',
      '@adapters/worker',
    ],
    externals: [],
    platform: 'browser',
    testOnly: true,
    purpose: 'In-process gateways that host the engine without a worker, for tests.',
  },
  '@ui': {
    dir: 'src/ui',
    mayImport: ['@shared', '@protocol', '@gateway'],
    externals: ['react', 'react-dom', 'react/jsx-runtime'],
    platform: 'browser',
    purpose: 'React views, SVG renderers, input and accessibility.',
  },
  '@app': {
    dir: 'src/app',
    mayImport: ['@shared', '@protocol', '@gateway', '@ui'],
    externals: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    platform: 'browser',
    purpose: 'Application bootstrap and top-level composition.',
  },
};

/** Packages that may spawn the engine worker, and the only entry they may spawn. */
export const WORKER_ENTRY = {
  spawnedBy: ['@gateway'],
  module: 'src/adapters/worker/engineWorker.ts',
};

/**
 * Globals that are unavailable to (or forbidden in) `pure` packages.
 * `Date` and `Math.random` are forbidden because authoritative state may only
 * advance from the simulation clock and seeded random streams.
 */
export const FORBIDDEN_PURE_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'crypto',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'self',
  'performance',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'Date',
  'Math.random',
];

/** Alias -> directory, consumed by Vite, Vitest and tsconfig. */
export const ALIASES = Object.fromEntries(
  Object.entries(PACKAGES).map(([name, rule]) => [name, rule.dir]),
);

/** Package names ordered longest-first so nested packages win prefix matching. */
export const PACKAGE_NAMES_BY_SPECIFICITY = Object.keys(PACKAGES).sort(
  (a, b) => PACKAGES[b].dir.length - PACKAGES[a].dir.length,
);
