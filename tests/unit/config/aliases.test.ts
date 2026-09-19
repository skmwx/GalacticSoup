import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, tsconfigPaths } from '../../../config/aliases.mjs';
import { PACKAGES } from '../../../config/packages.mjs';

/**
 * Vite, Vitest and TypeScript must agree on where a package lives, or a rule
 * enforced in one tool can be bypassed in another
 * (Technical Specification 4.3, 18).
 */
describe('package aliases', () => {
  it('match the paths declared in tsconfig.json [TECH-4.3]', () => {
    const tsconfig = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions: { paths: Record<string, string[]> } };

    expect(tsconfig.compilerOptions.paths).toEqual(tsconfigPaths());
  });

  it('point at a package that exposes a public index [TECH-4.3]', () => {
    for (const [name, rule] of Object.entries(PACKAGES)) {
      const index = path.join(REPO_ROOT, rule.dir, 'index.ts');
      expect(existsSync(index), `${name} is missing ${rule.dir}/index.ts`).toBe(true);
    }
  });

  it('only allow a package to depend on declared packages [TECH-4.1]', () => {
    for (const [name, rule] of Object.entries(PACKAGES)) {
      for (const dependency of rule.mayImport) {
        expect(Object.keys(PACKAGES), `${name} depends on ${dependency}`).toContain(dependency);
      }
    }
  });

  it('keep test-only packages out of every production package [TECH-4.3]', () => {
    const testOnly = Object.entries(PACKAGES)
      .filter(([, rule]) => rule.testOnly === true)
      .map(([name]) => name);

    for (const [name, rule] of Object.entries(PACKAGES)) {
      if (rule.testOnly === true) {
        continue;
      }
      for (const forbidden of testOnly) {
        expect(rule.mayImport, `${name} may not import ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
