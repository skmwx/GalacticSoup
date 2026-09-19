/**
 * Structural limits for untrusted content (Technical Specification 14).
 *
 * Authored content and, later, imported saves are untrusted input at their
 * boundary. Total size, collection sizes, string lengths and nesting depth are
 * bounded *before* domain state is constructed, so a malformed or hostile file
 * cannot exhaust memory or stack during parsing.
 *
 * The build tooling imports this module directly, so the limits that guard the
 * compiled bundle at load are the same ones that guard the authored files at
 * build time. It therefore has no imports of its own.
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

export type StructuralViolationReason =
  | 'too-deep'
  | 'string-too-long'
  | 'array-too-long'
  | 'too-many-keys'
  | 'non-finite-number'
  | 'unsupported-value'
  | 'cycle';

export interface StructuralViolation {
  readonly reason: StructuralViolationReason;
  /** JSON path of the offending value, for example `definitions.hulls[0].id`. */
  readonly path: string;
  readonly detail: string;
}

/**
 * Returns the first structural violation in `value`, or `null` when it is
 * within every limit. Only JSON-shaped data is accepted: objects, arrays,
 * strings, booleans, finite numbers and null.
 */
export function findStructuralViolation(
  value: unknown,
  rootPath = '',
): StructuralViolation | null {
  return inspect(value, rootPath, new Set<object>(), 0);
}

function inspect(
  value: unknown,
  path: string,
  seen: Set<object>,
  depth: number,
): StructuralViolation | null {
  if (depth > CONTENT_LIMITS.maxDepth) {
    return { reason: 'too-deep', path, detail: `deeper than ${String(CONTENT_LIMITS.maxDepth)}` };
  }

  if (value === null || typeof value === 'boolean') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? null
      : { reason: 'non-finite-number', path, detail: String(value) };
  }

  if (typeof value === 'string') {
    return value.length <= CONTENT_LIMITS.maxStringLength
      ? null
      : {
          reason: 'string-too-long',
          path,
          detail: `${String(value.length)} characters`,
        };
  }

  if (typeof value !== 'object') {
    return { reason: 'unsupported-value', path, detail: typeof value };
  }

  const object = value as object;
  if (seen.has(object)) {
    return { reason: 'cycle', path, detail: 'value refers to itself' };
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      if (object.length > CONTENT_LIMITS.maxArrayLength) {
        return { reason: 'array-too-long', path, detail: `${String(object.length)} entries` };
      }
      for (let index = 0; index < object.length; index += 1) {
        const violation = inspect(
          object[index],
          `${path}[${String(index)}]`,
          seen,
          depth + 1,
        );
        if (violation !== null) {
          return violation;
        }
      }
      return null;
    }

    const prototype = Object.getPrototypeOf(object) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return { reason: 'unsupported-value', path, detail: 'not a plain object' };
    }

    const record = object as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > CONTENT_LIMITS.maxObjectKeys) {
      return { reason: 'too-many-keys', path, detail: `${String(keys.length)} keys` };
    }
    for (const key of keys) {
      const violation = inspect(
        record[key],
        path === '' ? key : `${path}.${key}`,
        seen,
        depth + 1,
      );
      if (violation !== null) {
        return violation;
      }
    }
    return null;
  } finally {
    seen.delete(object);
  }
}
