/**
 * xoshiro128** pseudo-random generator (Technical Specification 9.4).
 *
 * The algorithm is fixed by the specification because a future Java engine
 * must reproduce every draw. It is written with unsigned 32-bit operations
 * only - `Math.imul`, shifts and `>>> 0` - so it is exactly portable and never
 * touches a 53-bit float intermediate.
 *
 * The state is four non-zero 32-bit words. Every function here is pure: a draw
 * returns the next state rather than mutating its argument, so a transaction
 * can discard the draws of a failed command simply by discarding its draft.
 *
 * @implements TECH-9.4
 */

export interface RandomState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

export interface RandomDraw {
  readonly state: RandomState;
  /** The raw 32-bit result of this step. */
  readonly value: number;
}

export const UINT32_RANGE = 0x1_0000_0000;

/** Replacement word used when a seed produces the forbidden all-zero state. */
const FALLBACK_WORD = 0x9e37_79b9;

export function createRandomState(
  s0: number,
  s1: number,
  s2: number,
  s3: number,
): RandomState {
  const words = {
    s0: toUint32(s0),
    s1: toUint32(s1),
    s2: toUint32(s2),
    s3: toUint32(s3),
  };
  const allZero = words.s0 === 0 && words.s1 === 0 && words.s2 === 0 && words.s3 === 0;
  return allZero
    ? { s0: FALLBACK_WORD, s1: FALLBACK_WORD, s2: FALLBACK_WORD, s3: FALLBACK_WORD }
    : words;
}

export function isRandomState(value: unknown): value is RandomState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const words = [candidate['s0'], candidate['s1'], candidate['s2'], candidate['s3']];
  const isWord = (word: unknown): boolean =>
    typeof word === 'number' && Number.isInteger(word) && word >= 0 && word < UINT32_RANGE;
  if (!words.every(isWord)) {
    return false;
  }
  return !words.every((word) => word === 0);
}

/** One step of xoshiro128**. */
export function nextUint32(state: RandomState): RandomDraw {
  const value = rotate(Math.imul(state.s1, 5), 7);
  const result = Math.imul(value, 9) >>> 0;

  const t = (state.s1 << 9) >>> 0;
  let s2 = (state.s2 ^ state.s0) >>> 0;
  let s3 = (state.s3 ^ state.s1) >>> 0;
  const s1 = (state.s1 ^ s2) >>> 0;
  const s0 = (state.s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotate(s3, 11);

  return { state: { s0, s1, s2, s3 }, value: result };
}

/**
 * A double in `[0, 1)`. The raw word is divided by 2^32, which is exact in
 * IEEE-754 and therefore identical in every language that has doubles.
 */
export function nextUnitInterval(state: RandomState): RandomDraw {
  const draw = nextUint32(state);
  return { state: draw.state, value: draw.value / UINT32_RANGE };
}

/**
 * A uniform integer in `[minimum, maximum]`, inclusive.
 *
 * Rejection sampling removes modulo bias, which matters because loot and
 * survival rolls must be uniform and must match a second implementation. The
 * rejection loop is documented rather than clever: it draws again while the
 * word falls in the short final block that would skew the result.
 */
export function nextIntegerInRange(
  state: RandomState,
  minimum: number,
  maximum: number,
): RandomDraw {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new RangeError(`[${String(minimum)}, ${String(maximum)}] is not an integer range.`);
  }

  const span = maximum - minimum + 1;
  if (span === 1) {
    return { state, value: minimum };
  }
  if (span > UINT32_RANGE) {
    throw new RangeError('An integer range wider than 2^32 is not supported.');
  }

  const limit = UINT32_RANGE - (UINT32_RANGE % span);
  let current = state;
  for (;;) {
    const draw = nextUint32(current);
    current = draw.state;
    if (draw.value < limit) {
      return { state: current, value: minimum + (draw.value % span) };
    }
  }
}

function rotate(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function toUint32(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${String(value)} is not a 32-bit word.`);
  }
  return value >>> 0;
}
