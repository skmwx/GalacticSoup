/**
 * Deep copying of plain authoritative data (Technical Specification 7.2).
 *
 * A command applies its change to a transaction-local draft, so a failure
 * before commit can leave campaign state untouched. The draft is a deep copy
 * of the committed state, produced here.
 *
 * Only JSON-shaped data is copied: objects, arrays, strings, booleans, finite
 * numbers and null. Authoritative state is exactly that data, so a class
 * instance, `Map`, `Set` or function reaching this function is a defect and is
 * reported rather than copied. `structuredClone` is deliberately not used: it
 * is a host facility, and copying dates, maps and cycles silently would let
 * them into state that must stay serialisable.
 *
 * @implements TECH-7.2
 */

/** The deeply mutable form of a readonly data type. */
export type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer TItem)[]
    ? Mutable<TItem>[]
    : { -readonly [TKey in keyof T]: Mutable<T[TKey]> };

export class CloneError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(path === '' ? message : `${message} (at ${path})`);
    this.name = 'CloneError';
    this.path = path;
  }
}

export function deepClone<T>(value: T): Mutable<T> {
  return copy(value, '') as Mutable<T>;
}

function copy(value: unknown, path: string): unknown {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CloneError(`Cannot copy the non-finite number ${String(value)}`, path);
      }
      return value;
    case 'undefined':
      throw new CloneError('Cannot copy undefined', path);
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new CloneError(`Cannot copy a ${typeof value}`, path);
    default:
      break;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => copy(entry, `${path}[${String(index)}]`));
  }

  const prototype = Object.getPrototypeOf(value as object) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CloneError('Cannot copy a class instance', path);
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const entry = source[key];
    if (entry === undefined) {
      continue;
    }
    result[key] = copy(entry, path === '' ? key : `${path}.${key}`);
  }
  return result;
}
