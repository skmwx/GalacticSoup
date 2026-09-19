/**
 * The canonical JSON profile (Technical Specification 5.3).
 *
 * One documented profile serves every checksum and deterministic state hash.
 * Its rules are:
 *
 *  1. object keys are ordered lexicographically by UTF-16 code unit;
 *  2. order-sensitive arrays keep their order — a set-like collection is
 *     sorted by stable id by its producer, not here;
 *  3. properties whose value is `undefined` are omitted, as are absent
 *     optional fields;
 *  4. negative zero is normalised to zero;
 *  5. non-finite numbers are rejected;
 *  6. a whole number inside the safe-integer range is written as a decimal
 *     integer; any other finite number is written as its shortest round-trip
 *     decimal expanded to plain notation, with no exponent and no trailing
 *     zeros;
 *  7. strings are escaped as ECMA-404 requires: `"` and `\` are escaped, code
 *     points below U+0020 use the short escapes or `\u00xx`, unpaired
 *     surrogates use `\udxxx`, and nothing else is escaped.
 *
 * `tests/fixtures/canonical/numbers.json` and `strings.json` are the
 * cross-language fixtures: a future Java implementation must reproduce them
 * byte for byte so both engines hash the same values.
 *
 * @implements TECH-5.3
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

export class CanonicalJsonError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(path === '' ? message : `${message} (at ${path})`);
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

/** Serialises `value` under the canonical profile. */
export function canonicalJson(value: unknown): string {
  return write(value, '');
}

/** Formats one number under rule 4 and rule 6. */
export function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(`Cannot canonicalise the non-finite number ${String(value)}`, '');
  }
  const normalised = value === 0 ? 0 : value;
  if (Number.isInteger(normalised) && Math.abs(normalised) <= Number.MAX_SAFE_INTEGER) {
    return String(normalised);
  }
  return expand(String(normalised));
}

/** Escapes one string under rule 7. */
export function canonicalString(value: string): string {
  let out = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const char = value[index] as string;

    if (char === '"') {
      out += '\\"';
    } else if (char === '\\') {
      out += '\\\\';
    } else if (code === 0x08) {
      out += '\\b';
    } else if (code === 0x09) {
      out += '\\t';
    } else if (code === 0x0a) {
      out += '\\n';
    } else if (code === 0x0c) {
      out += '\\f';
    } else if (code === 0x0d) {
      out += '\\r';
    } else if (code < 0x20 || isUnpairedSurrogate(value, index, code)) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += char;
    }
  }
  return `${out}"`;
}

function write(value: unknown, path: string): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return numberAt(value, path);
    case 'string':
      return canonicalString(value);
    case 'undefined':
      throw new CanonicalJsonError('Cannot canonicalise undefined', path);
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new CanonicalJsonError(`Cannot canonicalise a ${typeof value}`, path);
    default:
      break;
  }

  if (Array.isArray(value)) {
    const parts = value.map((entry, index) => write(entry, `${path}[${String(index)}]`));
    return `[${parts.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value as object) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError('Cannot canonicalise a class instance', path);
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort(compareCodeUnits)) {
    const entry = record[key];
    if (entry === undefined) {
      continue;
    }
    const childPath = path === '' ? key : `${path}.${key}`;
    parts.push(`${canonicalString(key)}:${write(entry, childPath)}`);
  }
  return `{${parts.join(',')}}`;
}

function numberAt(value: number, path: string): string {
  try {
    return canonicalNumber(value);
  } catch {
    throw new CanonicalJsonError(`Cannot canonicalise the number ${String(value)}`, path);
  }
}

function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** Rewrites an exponent form such as `1e-7` as plain decimal notation. */
function expand(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (match === null) {
    return text;
  }

  const sign = match[1] ?? '';
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const exponent = Number(match[4]);
  const digits = whole + fraction;
  const pointAt = whole.length + exponent;

  let body: string;
  if (pointAt <= 0) {
    body = `0.${'0'.repeat(-pointAt)}${digits}`;
  } else if (pointAt >= digits.length) {
    body = digits + '0'.repeat(pointAt - digits.length);
  } else {
    body = `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  }

  if (body.includes('.')) {
    body = body.replace(/0+$/, '').replace(/\.$/, '');
  }
  return sign + body;
}

function isUnpairedSurrogate(value: string, index: number, code: number): boolean {
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = value.charCodeAt(index - 1);
    return !(previous >= 0xd800 && previous <= 0xdbff);
  }
  return false;
}
