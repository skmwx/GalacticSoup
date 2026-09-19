import type { ContentRepository } from '@engine/ports';

import bundle from 'virtual:galactic-soup/content-bundle';
import { parseContentBundle } from './parseBundle.ts';
import { createContentRepository } from './repository.ts';

/**
 * The content the build compiled (Technical Specification 6.3).
 *
 * `virtual:galactic-soup/content-bundle` is produced by
 * `config/contentPlugin.mjs`, which compiles and validates `content/` when the
 * development server starts, when the test run starts and when the production
 * bundle is built. Invalid content therefore fails the build rather than the
 * game, and this module never touches a file system.
 *
 * @implements TECH-6.3
 */

let repository: ContentRepository | null = null;

export function loadBundledContent(): ContentRepository {
  repository ??= createContentRepository(parseContentBundle(bundle), {
    freeze: import.meta.env?.DEV === true,
  });
  return repository;
}
