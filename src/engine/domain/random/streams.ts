import { sha256Hex } from '@shared';

import {
  createRandomState,
  isRandomState,
  nextIntegerInRange,
  nextUint32,
  nextUnitInterval,
  type RandomState,
} from './xoshiro';

/**
 * Named random streams (Technical Specification 9.4).
 *
 * One campaign seed produces one independent stream per subject area, so a
 * combat roll can never shift the loot a later wreck contains, and adding a
 * draw to one system does not move every other system's results. Each stream
 * persists its four words and the number of draws taken from it; the draw
 * index is what a random check records alongside its outcome.
 *
 * @implements TECH-9.4
 */

/** Stable order: it defines how streams are seeded and serialised. */
export const RANDOM_STREAMS = ['combat', 'economy', 'encounter', 'loot', 'world'] as const;

export type RandomStreamName = (typeof RANDOM_STREAMS)[number];

export interface RandomStreamState extends RandomState {
  /** Draws taken from this stream since the campaign was created. */
  readonly drawIndex: number;
}

export type RandomStreams = Readonly<Record<RandomStreamName, RandomStreamState>>;

/** A mutable streams record, as held by a transaction draft. */
export type MutableRandomStreams = Record<RandomStreamName, {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  drawIndex: number;
}>;

/**
 * One record of a random check: which stream produced it, which draw it was,
 * and what the bounds and outcome were. The trace is transaction-local
 * development detail; a normal save keeps only the stream state.
 */
export interface RandomDrawRecord {
  readonly stream: RandomStreamName;
  readonly drawIndex: number;
  readonly kind: 'unitInterval' | 'integerInRange' | 'chance';
  readonly minimum: number;
  readonly maximum: number;
  readonly outcome: number;
}

/**
 * Derives each stream's four words from the campaign seed. The stream name is
 * part of the hashed input, so streams are independent and adding a stream in
 * a later phase does not disturb the ones that already exist.
 */
export function seedStreams(seed: string): RandomStreams {
  const streams = {} as Record<RandomStreamName, RandomStreamState>;
  for (const name of RANDOM_STREAMS) {
    const digest = sha256Hex(`galactic-soup/random/${seed}/${name}`);
    streams[name] = {
      ...createRandomState(
        wordAt(digest, 0),
        wordAt(digest, 1),
        wordAt(digest, 2),
        wordAt(digest, 3),
      ),
      drawIndex: 0,
    };
  }
  return streams;
}

export function isRandomStreams(value: unknown): value is RandomStreams {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== RANDOM_STREAMS.length) {
    return false;
  }
  return RANDOM_STREAMS.every((name) => {
    const stream = candidate[name];
    if (!isRandomState(stream)) {
      return false;
    }
    const drawIndex = (stream as unknown as Record<string, unknown>)['drawIndex'];
    return typeof drawIndex === 'number' && Number.isSafeInteger(drawIndex) && drawIndex >= 0;
  });
}

/**
 * Draws a double in `[0, 1)` from `stream`, advancing it in place.
 *
 * The mutation is deliberate and confined: `streams` is always a transaction
 * draft, so a command that fails before commit consumes no randomness.
 */
export function drawUnitInterval(
  streams: MutableRandomStreams,
  stream: RandomStreamName,
): RandomDrawRecord {
  const current = streams[stream];
  const draw = nextUnitInterval(current);
  return apply(streams, stream, draw.state, {
    stream,
    drawIndex: current.drawIndex,
    kind: 'unitInterval',
    minimum: 0,
    maximum: 1,
    outcome: draw.value,
  });
}

/** Draws a uniform integer in `[minimum, maximum]`, advancing `stream`. */
export function drawIntegerInRange(
  streams: MutableRandomStreams,
  stream: RandomStreamName,
  minimum: number,
  maximum: number,
): RandomDrawRecord {
  const current = streams[stream];
  const draw = nextIntegerInRange(current, minimum, maximum);
  return apply(streams, stream, draw.state, {
    stream,
    drawIndex: current.drawIndex,
    kind: 'integerInRange',
    minimum,
    maximum,
    outcome: draw.value,
  });
}

/**
 * Resolves a probability. The outcome is `1` when the check succeeded and `0`
 * when it did not, so the recorded trace stays a plain number.
 */
export function drawChance(
  streams: MutableRandomStreams,
  stream: RandomStreamName,
  chance: number,
): RandomDrawRecord {
  const current = streams[stream];
  const draw = nextUint32(current);
  const rolled = draw.value / 0x1_0000_0000;
  return apply(streams, stream, draw.state, {
    stream,
    drawIndex: current.drawIndex,
    kind: 'chance',
    minimum: 0,
    maximum: chance,
    outcome: rolled < chance ? 1 : 0,
  });
}

function apply(
  streams: MutableRandomStreams,
  stream: RandomStreamName,
  state: RandomState,
  record: RandomDrawRecord,
): RandomDrawRecord {
  const target = streams[stream];
  target.s0 = state.s0;
  target.s1 = state.s1;
  target.s2 = state.s2;
  target.s3 = state.s3;
  target.drawIndex += 1;
  return record;
}

function wordAt(digest: string, index: number): number {
  return Number.parseInt(digest.slice(index * 8, index * 8 + 8), 16);
}
