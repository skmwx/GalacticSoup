/**
 * Structural bounds for untrusted JSON (Technical Specification 14).
 *
 * Authored content and stored saves are untrusted input at their boundary.
 * Total size, collection sizes, string lengths and nesting depth are bounded
 * *before* domain state is constructed, so a malformed or hostile document
 * cannot exhaust memory or stack while it is being read.
 *
 * The limits themselves belong to the boundary that applies them - content has
 * one set, saves another - so this module takes them as an argument and holds
 * none of its own. It has no imports, because the build tooling loads it
 * directly.
 *
 * @implements TECH-14
 */

export interface StructuralLimits {
  readonly maxDepth: number;
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
}

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
  /** JSON path of the offending value, for example `state.scheduler.entries[0]`. */
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
  limits: StructuralLimits,
  rootPath = '',
): StructuralViolation | null {
  return inspect(value, limits, rootPath, new Set<object>(), 0);
}

function inspect(
  value: unknown,
  limits: StructuralLimits,
  path: string,
  seen: Set<object>,
  depth: number,
): StructuralViolation | null {
  if (depth > limits.maxDepth) {
    return { reason: 'too-deep', path, detail: `deeper than ${String(limits.maxDepth)}` };
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
    return value.length <= limits.maxStringLength
      ? null
      : { reason: 'string-too-long', path, detail: `${String(value.length)} characters` };
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
      if (object.length > limits.maxArrayLength) {
        return { reason: 'array-too-long', path, detail: `${String(object.length)} entries` };
      }
      for (let index = 0; index < object.length; index += 1) {
        const violation = inspect(
          object[index],
          limits,
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
    if (keys.length > limits.maxObjectKeys) {
      return { reason: 'too-many-keys', path, detail: `${String(keys.length)} keys` };
    }
    for (const key of keys) {
      const violation = inspect(
        record[key],
        limits,
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
