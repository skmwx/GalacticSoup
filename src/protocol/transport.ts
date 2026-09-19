/**
 * Transport value rules (Technical Specification 4.2).
 *
 * Messages between the client and the engine host use the JSON-compatible
 * subset of structured-clone data: plain objects, arrays, strings, booleans,
 * finite numbers and null. Anything else is rejected at the boundary so a
 * future HTTP or WebSocket transport carries the same payloads.
 *
 * @implements TECH-4.2
 */

export type TransportValue =
  | null
  | boolean
  | number
  | string
  | readonly TransportValue[]
  | { readonly [key: string]: TransportValue };

export type TransportViolationReason =
  | 'undefined'
  | 'non-finite-number'
  | 'bigint'
  | 'symbol'
  | 'function'
  | 'non-plain-object'
  | 'cycle'
  | 'too-deep';

export interface TransportViolation {
  /** JSON path of the offending value, for example `payload.items[0].when`. */
  readonly path: string;
  readonly reason: TransportViolationReason;
}

const MAX_DEPTH = 64;

/** Returns the first transport violation in `value`, or `null` when it is safe. */
export function findTransportViolation(value: unknown, rootPath = ''): TransportViolation | null {
  return inspect(value, rootPath, new Set<object>(), 0);
}

export function isTransportValue(value: unknown): value is TransportValue {
  return findTransportViolation(value) === null;
}

function inspect(
  value: unknown,
  path: string,
  seen: Set<object>,
  depth: number,
): TransportViolation | null {
  if (depth > MAX_DEPTH) {
    return { path, reason: 'too-deep' };
  }

  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null;
    case 'number':
      return Number.isFinite(value) ? null : { path, reason: 'non-finite-number' };
    case 'undefined':
      return { path, reason: 'undefined' };
    case 'bigint':
      return { path, reason: 'bigint' };
    case 'symbol':
      return { path, reason: 'symbol' };
    case 'function':
      return { path, reason: 'function' };
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) {
    return { path, reason: 'cycle' };
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index += 1) {
        const violation = inspect(object[index], `${path}[${index}]`, seen, depth + 1);
        if (violation !== null) {
          return violation;
        }
      }
      return null;
    }

    const prototype = Object.getPrototypeOf(object) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return { path, reason: 'non-plain-object' };
    }

    const record = object as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      const violation = inspect(record[key], childPath, seen, depth + 1);
      if (violation !== null) {
        return violation;
      }
    }
    return null;
  } finally {
    seen.delete(object);
  }
}
