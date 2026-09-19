/**
 * Content bundle loading, integrity checking and indexing
 * (Technical Specification 4.3, 6.3).
 *
 * This adapter implements the engine's content port. It knows how a bundle is
 * shaped and how it reaches the process; the engine knows neither.
 */
export { loadBundledContent } from './bundled.ts';
export { CONTENT_LIMITS, findStructuralViolation } from './limits.ts';
export type { StructuralViolation, StructuralViolationReason } from './limits.ts';
export { BUNDLE_DEFINITION_KINDS, bundleDigest, parseContentBundle } from './parseBundle.ts';
export type { ParsedContent } from './parseBundle.ts';
export { createContentRepository } from './repository.ts';
export type { ContentRepositoryOptions } from './repository.ts';
