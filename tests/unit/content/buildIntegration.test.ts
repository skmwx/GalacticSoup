import path from 'node:path';

import { describe, expect, it } from 'vitest';

import viteConfig from '../../../vite.config.ts';
import vitestConfig from '../../../vitest.config.ts';
import { compileContentOrThrow, contentPlugin } from '../../../config/contentPlugin.mjs';
import { CONTENT_BUNDLE_MODULE } from '../../../config/packages.mjs';

/**
 * Content validation runs at development startup, at test startup and at
 * production build time, and a failure stops all three
 * (Technical Specification 6.2).
 *
 * The plugin is the single place that enforces it, so these tests check both
 * that it refuses bad content and that every build configuration installs it.
 * This test file is itself evidence of the test-startup case: the bundle it
 * imports was compiled when this run started.
 */

const BROKEN_ROOT = path.resolve('tests/fixtures/content/broken');

function pluginNames(plugins: unknown): string[] {
  return (Array.isArray(plugins) ? plugins : [])
    .flat(Number.POSITIVE_INFINITY)
    .map((plugin) => (plugin as { name?: string } | null)?.name)
    .filter((name): name is string => typeof name === 'string');
}

describe('content build integration', () => {
  it('compiles the shipped content [TECH-6.2, TECH-6.3]', () => {
    const result = compileContentOrThrow();

    expect(result.ok).toBe(true);
    expect(result.stats.definitions).toBeGreaterThan(0);
  });

  it('refuses to start when content is invalid, naming every problem [TECH-6.2]', () => {
    expect(() => compileContentOrThrow(BROKEN_ROOT)).toThrow(/Content validation failed/);
    expect(() => compileContentOrThrow(BROKEN_ROOT)).toThrow(/unresolvedReference/);
  });

  it('fails the build start rather than serving bad content [TECH-6.2]', () => {
    const plugin = contentPlugin({ root: BROKEN_ROOT }) as unknown as {
      buildStart: () => void;
    };

    expect(() => plugin.buildStart()).toThrow(/Content validation failed/);
  });

  it('serves the compiled bundle as the virtual module [TECH-6.3]', () => {
    const plugin = contentPlugin() as unknown as {
      buildStart: () => void;
      resolveId: (id: string) => string | null;
      load: (id: string) => string | null;
    };

    const resolved = plugin.resolveId(CONTENT_BUNDLE_MODULE);
    expect(resolved).not.toBeNull();
    expect(plugin.resolveId('some/other/module')).toBeNull();

    plugin.buildStart();
    const code = plugin.load(resolved as string);
    expect(code).toContain('export default');
    expect(plugin.load('some/other/module')).toBeNull();
  });

  it('is installed in the production build, including the worker [TECH-6.2, TECH-4.2]', () => {
    const config = viteConfig as unknown as {
      plugins: unknown;
      worker: { plugins: () => unknown };
    };

    expect(pluginNames(config.plugins)).toContain('galactic-soup:content');
    expect(pluginNames(config.worker.plugins())).toContain('galactic-soup:content');
  });

  it('is installed in every test project [TECH-6.2, TECH-15.1]', () => {
    const config = vitestConfig as unknown as {
      test: { projects: { plugins?: unknown; test: { name: string } }[] };
    };

    expect(config.test.projects.length).toBeGreaterThan(0);
    for (const project of config.test.projects) {
      expect(pluginNames(project.plugins), project.test.name).toContain('galactic-soup:content');
    }
  });
});
