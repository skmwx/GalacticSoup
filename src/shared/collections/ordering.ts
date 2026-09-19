/**
 * Stable collection ordering (Technical Specification 5.3).
 *
 * Authoritative logic must not depend on JavaScript object-property order, and
 * any iteration that can affect an outcome is sorted first. Comparison is by
 * UTF-16 code unit — never by locale — so the same corpus orders identically
 * in every environment and in a future Java engine.
 *
 * @implements TECH-5.3
 */

/** Code-unit comparison. `localeCompare` is deliberately not used. */
export function compareStable(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** A new array ordered by the key each item reports. */
export function sortedBy<T>(items: Iterable<T>, key: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareStable(key(a), key(b)));
}

/** Record keys in stable order. */
export function sortedKeys(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).sort(compareStable);
}

/** Record entries in stable key order. */
export function sortedEntries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return sortedKeys(record).map((key) => [key, record[key] as T]);
}

/**
 * Indexes items by a stable id. Returns the duplicate id instead of a map when
 * one appears twice, because a silent last-one-wins index would hide a content
 * error.
 */
export function indexBy<T>(
  items: Iterable<T>,
  key: (item: T) => string,
): { readonly ok: true; readonly index: ReadonlyMap<string, T> } | {
  readonly ok: false;
  readonly duplicateKey: string;
} {
  const index = new Map<string, T>();
  for (const item of sortedBy(items, key)) {
    const id = key(item);
    if (index.has(id)) {
      return { ok: false, duplicateKey: id };
    }
    index.set(id, item);
  }
  return { ok: true, index };
}
