/**
 * Deep freezing for loaded definitions (Technical Specification 6.3).
 *
 * Content is read-only to the engine. Freezing turns an accidental write into
 * an immediate failure in development and in tests, where the cost of walking
 * the bundle once is irrelevant.
 *
 * @implements TECH-6.3
 */

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}
