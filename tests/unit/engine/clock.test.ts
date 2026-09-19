import { describe, expect, it } from 'vitest';

import { advanceTime, scheduleBoundary, type BoundaryResolvers } from '@engine';

import { testDraft, testSimulation } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * The authoritative clock (Technical Specification 9.1; Functional
 * Specification 3.3). The quantum and the per-delta cap are content values,
 * so the tests read them rather than restating them.
 */

const content = shippedContent();
const QUANTUM = content.rules.time.simulationQuantumMs;
const CAP = content.rules.time.maxFrameDeltaMs;
const NO_RESOLVERS: BoundaryResolvers = {};

function running(): ReturnType<typeof testDraft> {
  const draft = testDraft();
  draft.time.paused = false;
  return draft;
}

describe('simulation clock', () => {
  it('does not advance while paused [FUNC-3.3, TECH-9.1]', () => {
    const draft = testDraft();
    const context = testSimulation(draft, content);

    const outcome = advanceTime(context, 1_000, NO_RESOLVERS);

    expect(draft.time.paused).toBe(true);
    expect(draft.time.simulationTimeMs).toBe(0);
    expect(draft.time.accumulatorMs).toBe(0);
    expect(outcome.changed).toBe(false);
    expect(outcome.quanta).toBe(0);
  });

  it('advances whole quanta at 1x [FUNC-3.3, TECH-9.1]', () => {
    const draft = running();

    const outcome = advanceTime(testSimulation(draft, content), QUANTUM * 3, NO_RESOLVERS);

    expect(outcome.quanta).toBe(3);
    expect(draft.time.simulationTimeMs).toBe(QUANTUM * 3);
    expect(draft.time.accumulatorMs).toBe(0);
  });

  it('carries a sub-quantum remainder to the next delta [TECH-9.1]', () => {
    const draft = running();
    const context = testSimulation(draft, content);
    const half = Math.floor(QUANTUM / 2);

    const first = advanceTime(context, half, NO_RESOLVERS);
    expect(first.quanta).toBe(0);
    expect(first.changed).toBe(true);
    expect(draft.time.simulationTimeMs).toBe(0);
    expect(draft.time.accumulatorMs).toBe(half);

    advanceTime(context, QUANTUM - half, NO_RESOLVERS);
    expect(draft.time.simulationTimeMs).toBe(QUANTUM);
    expect(draft.time.accumulatorMs).toBe(0);
  });

  it('discards anything above the per-delta cap instead of catching up [FUNC-22.12, TECH-9.1]', () => {
    const draft = running();

    const outcome = advanceTime(testSimulation(draft, content), 3_600_000, NO_RESOLVERS);

    expect(outcome.acceptedMs).toBe(CAP);
    expect(outcome.discardedMs).toBe(3_600_000 - CAP);
    expect(draft.time.simulationTimeMs).toBe(Math.floor(CAP / QUANTUM) * QUANTUM);
  });

  it('treats a zero or negative delta as no progress [TECH-9.1]', () => {
    const draft = running();
    const context = testSimulation(draft, content);

    expect(advanceTime(context, 0, NO_RESOLVERS).changed).toBe(false);
    expect(advanceTime(context, -50, NO_RESOLVERS).changed).toBe(false);
    expect(draft.time.simulationTimeMs).toBe(0);
  });

  it('scales an accepted delta by the selected rate [FUNC-3.3, TECH-9.1]', () => {
    const draft = running();
    draft.time.rate = 4;

    advanceTime(testSimulation(draft, content), QUANTUM, NO_RESOLVERS);

    expect(draft.time.simulationTimeMs).toBe(QUANTUM * 4);
  });

  it('invalidates the frame only when simulation time moved [TECH-7.3]', () => {
    const draft = running();
    const context = testSimulation(draft, content);

    advanceTime(context, 1, NO_RESOLVERS);
    expect([...context.invalidations]).toEqual([]);

    advanceTime(context, QUANTUM, NO_RESOLVERS);
    expect([...context.invalidations]).toEqual(['frame']);
  });

  it('resolves a boundary at its own timestamp, not at the quantum edge [TECH-9.2]', () => {
    const draft = running();
    const context = testSimulation(draft, content);
    const dueAtMs = Math.floor(QUANTUM / 2);
    const seen: number[] = [];

    scheduleBoundary(draft, { kind: 'test.mark', dueAtMs });
    advanceTime(context, QUANTUM, {
      'test.mark': (inner) => {
        seen.push(inner.draft.time.simulationTimeMs);
      },
    });

    expect(seen).toEqual([dueAtMs]);
    expect(draft.time.simulationTimeMs).toBe(QUANTUM);
  });

  it('leaves a later boundary queued [TECH-9.2]', () => {
    const draft = running();
    const context = testSimulation(draft, content);
    let resolved = 0;

    scheduleBoundary(draft, { kind: 'test.mark', dueAtMs: QUANTUM * 5 });
    advanceTime(context, QUANTUM, { 'test.mark': () => { resolved += 1; } });

    expect(resolved).toBe(0);
    expect(draft.scheduler.entries).toHaveLength(1);
  });

  it('reports a boundary whose system is not installed [TECH-9.2]', () => {
    const draft = running();
    const context = testSimulation(draft, content);

    scheduleBoundary(draft, { kind: 'phase.unknown', dueAtMs: 0 });
    advanceTime(context, QUANTUM, NO_RESOLVERS);

    expect(context.events.map((event) => event.kind)).toEqual(['scheduler.boundaryUnhandled']);
    expect(draft.scheduler.entries).toHaveLength(0);
  });

  it('lets a resolver schedule its next cycle [TECH-9.2]', () => {
    const draft = running();
    const context = testSimulation(draft, content);
    let cycles = 0;

    scheduleBoundary(draft, { kind: 'test.cycle', dueAtMs: QUANTUM });
    const resolvers: BoundaryResolvers = {
      'test.cycle': (inner, entry) => {
        cycles += 1;
        if (cycles < 3) {
          scheduleBoundary(inner.draft, {
            kind: entry.kind,
            dueAtMs: entry.dueAtMs + QUANTUM,
          });
        }
      },
    };

    advanceTime(context, QUANTUM * 3, resolvers);

    expect(cycles).toBe(3);
    expect(draft.scheduler.entries).toHaveLength(0);
  });
});
