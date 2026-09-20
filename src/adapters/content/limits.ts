/**
 * Structural limits for untrusted content (Technical Specification 14).
 *
 * Only the bounds live here; the traversal that applies them is the shared one
 * in `@shared`, so content and saves are guarded by the same code with
 * different numbers.
 *
 * The build tooling imports this module directly by path, so it deliberately
 * has no imports of its own: the limits that guard the compiled bundle at load
 * are the same ones that guard the authored files at build time.
 *
 * @implements TECH-14
 */

export const CONTENT_LIMITS = {
  /** One authored file. */
  maxFileBytes: 1_048_576,
  /** Every authored file together, and the compiled bundle. */
  maxTotalBytes: 16_777_216,
  maxDepth: 24,
  maxStringLength: 4_096,
  maxArrayLength: 8_192,
  maxObjectKeys: 8_192,
} as const;
