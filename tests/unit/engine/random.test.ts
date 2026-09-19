import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createRandomState,
  drawChance,
  drawIntegerInRange,
  drawUnitInterval,
  isRandomState,
  nextIntegerInRange,
  nextUint32,
  nextUnitInterval,
  RANDOM_STREAMS,
  seedStreams,
  UINT32_RANGE,
  type MutableRandomStreams,
  type RandomState,
} from '@engine/domain';

import { REPO_ROOT } from '../../../config/aliases.mjs';

/**
 * The generator is fixed by Technical Specification 9.4 because a future Java
 * engine must reproduce every draw. The fixtures were produced by an
 * independent implementation of the published algorithm, so agreement here is
 * evidence of portability rather than of self-consistency.
 */

interface Fixture {
  readonly cases: readonly {
    readonly label: string;
    readonly state: readonly number[];
    readonly values: readonly number[];
    readonly finalState: readonly number[];
  }[];
  readonly streamDerivation: {
    readonly seed: string;
    readonly streams: Readonly<Record<string, readonly number[]>>;
  };
}

const fixture = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'tests/fixtures/random/xoshiro128starstar.json'), 'utf8'),
) as Fixture;

function stateOf(words: readonly number[]): RandomState {
  return createRandomState(words[0] ?? 0, words[1] ?? 0, words[2] ?? 0, words[3] ?? 0);
}

function mutableStreams(seed: string): MutableRandomStreams {
  return structuredClone(seedStreams(seed)) as MutableRandomStreams;
}

describe('xoshiro128** generator', () => {
  it.each(fixture.cases)(
    'reproduces the $label reference sequence [TECH-9.4, TECH-17]',
    ({ state, values, finalState }) => {
      let current = stateOf(state);
      const produced: number[] = [];
      for (let index = 0; index < values.length; index += 1) {
        const draw = nextUint32(current);
        current = draw.state;
        produced.push(draw.value);
      }

      expect(produced).toEqual([...values]);
      expect(current).toEqual(stateOf(finalState));
    },
  );

  it('produces only unsigned 32-bit words [TECH-9.4]', () => {
    let current = stateOf([7, 11, 13, 17]);
    for (let index = 0; index < 5_000; index += 1) {
      const draw = nextUint32(current);
      current = draw.state;
      expect(Number.isInteger(draw.value)).toBe(true);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(UINT32_RANGE);
    }
  });

  it('replaces the forbidden all-zero state [TECH-9.4]', () => {
    const state = createRandomState(0, 0, 0, 0);

    expect(isRandomState(state)).toBe(true);
    expect(nextUint32(state).value).not.toBe(0);
  });

  it('keeps unit-interval draws inside [0, 1) [TECH-9.4]', () => {
    let current = stateOf([3, 5, 7, 9]);
    for (let index = 0; index < 5_000; index += 1) {
      const draw = nextUnitInterval(current);
      current = draw.state;
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
    }
  });

  it('draws integers uniformly and without modulo bias [TECH-9.4]', () => {
    const counts = new Map<number, number>();
    let current = stateOf([0x1234_5678, 0x9abc_def0, 0x0f1e_2d3c, 0x4b5a_6978]);

    for (let index = 0; index < 60_000; index += 1) {
      const draw = nextIntegerInRange(current, 1, 6);
      current = draw.state;
      expect(draw.value).toBeGreaterThanOrEqual(1);
      expect(draw.value).toBeLessThanOrEqual(6);
      counts.set(draw.value, (counts.get(draw.value) ?? 0) + 1);
    }

    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const count of counts.values()) {
      expect(Math.abs(count - 10_000)).toBeLessThan(500);
    }
  });

  it('returns the only value of a single-value range without drawing [TECH-9.4]', () => {
    const state = stateOf([1, 2, 3, 4]);
    const draw = nextIntegerInRange(state, 4, 4);

    expect(draw.value).toBe(4);
    expect(draw.state).toEqual(state);
  });

  it('rejects an inverted range [TECH-9.4]', () => {
    expect(() => nextIntegerInRange(stateOf([1, 2, 3, 4]), 5, 4)).toThrow(RangeError);
  });
});

describe('campaign random streams', () => {
  const seed = fixture.streamDerivation.seed;

  it('derives each stream from the campaign seed [TECH-9.4, TECH-17]', () => {
    const streams = seedStreams(seed);

    for (const name of RANDOM_STREAMS) {
      const expected = fixture.streamDerivation.streams[name];
      expect(expected, name).toBeDefined();
      expect({ ...streams[name], drawIndex: undefined }).toEqual({
        ...stateOf(expected ?? []),
        drawIndex: undefined,
      });
      expect(streams[name].drawIndex).toBe(0);
    }
  });

  it('gives each stream an independent sequence [TECH-9.4]', () => {
    const streams = mutableStreams(seed);
    const first = drawUnitInterval(streams, 'combat').outcome;
    const other = drawUnitInterval(streams, 'loot').outcome;

    expect(first).not.toBe(other);
  });

  it('leaves the other streams untouched when one is drawn from [TECH-9.4]', () => {
    const streams = mutableStreams(seed);
    const before = structuredClone(streams);

    drawIntegerInRange(streams, 'combat', 1, 100);

    expect(streams.combat).not.toEqual(before.combat);
    expect(streams.loot).toEqual(before.loot);
    expect(streams.economy).toEqual(before.economy);
    expect(streams.encounter).toEqual(before.encounter);
    expect(streams.world).toEqual(before.world);
  });

  it('records the stream, draw index and bounds of every check [TECH-9.4]', () => {
    const streams = mutableStreams(seed);

    const first = drawIntegerInRange(streams, 'loot', 2, 5);
    const second = drawChance(streams, 'loot', 0.25);

    expect(first).toMatchObject({
      stream: 'loot',
      drawIndex: 0,
      kind: 'integerInRange',
      minimum: 2,
      maximum: 5,
    });
    expect(second).toMatchObject({ stream: 'loot', drawIndex: 1, kind: 'chance', maximum: 0.25 });
    expect([0, 1]).toContain(second.outcome);
    expect(streams.loot.drawIndex).toBe(2);
  });

  it('resolves an impossible and a certain chance without exception [FUNC-4.2, TECH-9.4]', () => {
    const streams = mutableStreams(seed);

    expect(drawChance(streams, 'world', 0).outcome).toBe(0);
    expect(drawChance(streams, 'world', 1).outcome).toBe(1);
  });

  it('produces the same sequence for the same seed [TECH-9.4, TECH-9.5]', () => {
    const left = mutableStreams(seed);
    const right = mutableStreams(seed);

    const take = (streams: MutableRandomStreams): number[] =>
      Array.from({ length: 20 }, () => drawUnitInterval(streams, 'encounter').outcome);

    expect(take(left)).toEqual(take(right));
  });

  it('produces a different sequence for a different seed [TECH-9.4]', () => {
    const left = mutableStreams(seed);
    const right = mutableStreams('ffffffffffffffffffffffffffffffff');

    expect(drawUnitInterval(left, 'combat').outcome).not.toBe(
      drawUnitInterval(right, 'combat').outcome,
    );
  });
});
