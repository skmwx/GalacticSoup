import { loadBundledContent } from '@adapters/content';
import type { ContentRepository } from '@engine';

/**
 * The content the game ships, compiled by the same plugin the development
 * server and the production build use. A test that needs different content
 * compiles a fixture pack instead (`tests/support/contentFixtures.ts`).
 */
export function shippedContent(): ContentRepository {
  return loadBundledContent();
}
