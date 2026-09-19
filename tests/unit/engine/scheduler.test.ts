import { describe, expect, it } from 'vitest';

import {
  cancelBoundariesOwnedBy,
  cancelBoundary,
  entityIdOf,
  nextBoundary,
  scheduleBoundary,
  takeBoundaryDue,
  validateCampaign,
  type CampaignState,
  type EntityId,
} from '@engine';

import { testDraft } from '../../support/campaign.ts';

/**
 * Scheduler ordering (Technical Specification 9.2). The order must be total
 * and stable: due time, then priority, then insertion ordinal. Two entries due
 * at the same instant may never depend on iteration or insertion order to
 * decide which one runs first.
 */

describe('scheduler', () => {
  it('orders entries by due time [TECH-9.2]', () => {
    const draft = testDraft();

    scheduleBoundary(draft, { kind: 'c', dueAtMs: 300 });
    scheduleBoundary(draft, { kind: 'a', dueAtMs: 100 });
    scheduleBoundary(draft, { kind: 'b', dueAtMs: 200 });

    expect(draft.scheduler.entries.map((entry) => entry.kind)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie by priority, then by insertion ordinal [TECH-9.2]', () => {
    const draft = testDraft();

    scheduleBoundary(draft, { kind: 'late', dueAtMs: 100, priority: 50 });
    scheduleBoundary(draft, { kind: 'first', dueAtMs: 100, priority: 10 });
    scheduleBoundary(draft, { kind: 'later', dueAtMs: 100, priority: 50 });

    expect(draft.scheduler.entries.map((entry) => entry.kind)).toEqual([
      'first',
      'late',
      'later',
    ]);
  });

  it('gives the same order however the same set was inserted [TECH-9.2, TECH-9.5]', () => {
    const requests = [
      { kind: 'a', dueAtMs: 100, priority: 10 },
      { kind: 'b', dueAtMs: 100, priority: 10 },
      { kind: 'c', dueAtMs: 100, priority: 5 },
      { kind: 'd', dueAtMs: 50, priority: 99 },
    ];

    const forward = testDraft();
    for (const request of requests) {
      scheduleBoundary(forward, request);
    }

    // Reversing the insertion order changes which entry holds which ordinal,
    // so the resolution order changes with it - deterministically, and
    // identically on every run and in every engine.
    const backward = testDraft();
    for (const request of [...requests].reverse()) {
      scheduleBoundary(backward, request);
    }

    expect(forward.scheduler.entries.map((entry) => entry.kind)).toEqual(['d', 'c', 'a', 'b']);
    expect(backward.scheduler.entries.map((entry) => entry.kind)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('allocates an entity id and an insertion ordinal per entry [TECH-5.1, TECH-9.2]', () => {
    const draft = testDraft();

    const first = scheduleBoundary(draft, { kind: 'a', dueAtMs: 10 });
    const second = scheduleBoundary(draft, { kind: 'b', dueAtMs: 20 });

    expect(first.entryId).toBe(entityIdOf(draft.campaignId, 1));
    expect(second.entryId).toBe(entityIdOf(draft.campaignId, 2));
    expect(first.insertionOrdinal).toBe(1);
    expect(second.insertionOrdinal).toBe(2);
    expect(draft.nextEntityOrdinal).toBe(3);
    expect(draft.scheduler.nextInsertionOrdinal).toBe(3);
  });

  it('refuses a boundary in the past [TECH-9.2]', () => {
    const draft = testDraft();
    draft.time.simulationTimeMs = 1_000;

    expect(() => scheduleBoundary(draft, { kind: 'a', dueAtMs: 999 })).toThrow(RangeError);
    expect(() => scheduleBoundary(draft, { kind: 'a', dueAtMs: 1.5 })).toThrow(RangeError);
  });

  it('takes only entries that are due [TECH-9.2]', () => {
    const draft = testDraft();
    scheduleBoundary(draft, { kind: 'now', dueAtMs: 100 });
    scheduleBoundary(draft, { kind: 'later', dueAtMs: 400 });

    expect(takeBoundaryDue(draft, 100)?.kind).toBe('now');
    expect(takeBoundaryDue(draft, 100)).toBeNull();
    expect(nextBoundary(draft.scheduler)?.kind).toBe('later');
  });

  it('cancels one entry and every entry of one owner [TECH-9.2, FUNC-22.5]', () => {
    const draft = testDraft();
    const owner = entityIdOf(draft.campaignId, 999) as EntityId;

    const solo = scheduleBoundary(draft, { kind: 'solo', dueAtMs: 10 });
    scheduleBoundary(draft, { kind: 'owned', dueAtMs: 20, ownerId: owner });
    scheduleBoundary(draft, { kind: 'owned', dueAtMs: 30, ownerId: owner });

    expect(cancelBoundary(draft, solo.entryId)).toBe(true);
    expect(cancelBoundary(draft, solo.entryId)).toBe(false);
    expect(cancelBoundariesOwnedBy(draft, owner)).toBe(2);
    expect(draft.scheduler.entries).toHaveLength(0);
  });

  it('keeps a scheduled campaign valid [TECH-15.3]', () => {
    const draft = testDraft();
    scheduleBoundary(draft, { kind: 'a', dueAtMs: 5_000 });

    expect(validateCampaign(draft as CampaignState)).toEqual([]);
  });

  it('rejects a real timestamp used as a due time [TECH-15.3]', () => {
    const draft = testDraft();
    scheduleBoundary(draft, { kind: 'a', dueAtMs: 10 });
    const entry = draft.scheduler.entries[0];
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      entry.dueAtMs = 1_762_000_000_000;
    }

    expect(validateCampaign(draft as CampaignState).map((issue) => issue.rule)).toContain(
      'schedulerHorizon',
    );
  });

  it('rejects entries stored out of resolution order [TECH-15.3]', () => {
    const draft = testDraft();
    scheduleBoundary(draft, { kind: 'a', dueAtMs: 10 });
    scheduleBoundary(draft, { kind: 'b', dueAtMs: 20 });
    draft.scheduler.entries.reverse();

    expect(validateCampaign(draft as CampaignState).map((issue) => issue.rule)).toContain(
      'schedulerOrder',
    );
  });
});
