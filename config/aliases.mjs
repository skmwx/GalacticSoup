/**
 * Build-tool view of the package boundaries declared in `packages.mjs`.
 * Vite, Vitest and tsconfig all derive their aliases from here so the three
 * cannot drift apart (tests/unit/config/aliases.test.ts checks tsconfig.json).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGES } from './packages.mjs';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Rollup/Vite alias entries, most specific alias first. */
export function aliasEntries() {
  return Object.entries(PACKAGES)
    .sort(([a], [b]) => b.length - a.length)
    .map(([name, rule]) => ({
      find: name,
      replacement: path.resolve(REPO_ROOT, rule.dir),
    }));
}

/** `compilerOptions.paths` content for tsconfig.json. */
export function tsconfigPaths() {
  const paths = {};
  for (const name of Object.keys(PACKAGES).sort()) {
    paths[name] = [`./${PACKAGES[name].dir}/index.ts`];
  }
  return paths;
}
