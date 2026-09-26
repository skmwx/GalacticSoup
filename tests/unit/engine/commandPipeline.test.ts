import { describe, expect, it } from 'vitest';

import {
  beginTransaction,
  campaignStateHash,
  commit,
  createRecentRequests,
  drawUnitInterval,
  InvariantFailure,
  runCommand,
  type CampaignState,
  type MutableRandomStreams,
} from '@engine';

import { TEST_SEED, testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * Transactions and the command pipeline (Technical Specification 7.2).
 *
 * The property these tests exist for: nothing outside a committed transaction
 * changes. A rejected command, an invariant failure and a command that decided
 * to do nothing must all leave the campaign, its revision, its ordinals and
 * its random streams exactly as they were.
 */

const content = shippedContent();

const CREATE = {
  displayName: 'Vela',
  seed: TEST_SEED,
  createdAtRealMs: 1_700_000_000_000,
};

describe('transaction isolation', () => {
  it('applies changes to a copy, not to the committed state [TECH-7.2]', () => {
    const campaign = testCampaign();
    const before = campaignStateHash(campaign);

    const transaction = beginTransaction(campaign, content);
    const draft = transaction.requireDraft();
    draft.time.simulationTimeMs = 5_000;
    draft.nextEntityOrdinal = 99;

    expect(campaignStateHash(campaign)).toBe(before);
    expect(campaign.time.simulationTimeMs).toBe(0);
  });

  it('consumes no randomness when the transaction is abandoned [TECH-9.4]', () => {
    const campaign = testCampaign();
    const before = campaignStateHash(campaign);

    const transaction = beginTransaction(campaign, content);
    const draft = transaction.requireDraft();
    drawUnitInterval(draft.random as MutableRandomStreams, 'combat');
    drawUnitInterval(draft.random as MutableRandomStreams, 'loot');

    expect(draft.random.combat.drawIndex).toBe(1);
    expect(campaign.random.combat.drawIndex).toBe(0);
    expect(campaignStateHash(campaign)).toBe(before);
  });

  it('increments the revision exactly once on commit [TECH-7.2]', () => {
    const transaction = beginTransaction(testCampaign({ revision: 7 }), content);
    transaction.requireDraft().time.paused = false;

    expect(commit(transaction).campaign?.revision).toBe(8);
  });

  it('refuses to commit a state that violates an invariant [TECH-5.4, TECH-15.3]', () => {
    const transaction = beginTransaction(testCampaign(), content);
    transaction.requireDraft().nextEventOrdinal = 0;

    expect(() => commit(transaction)).toThrow(InvariantFailure);
  });

  it('freezes the committed state [TECH-7.2]', () => {
    const transaction = beginTransaction(testCampaign(), content);
    transaction.requireDraft().time.paused = false;

    const committed = commit(transaction).campaign as CampaignState;

    expect(Object.isFrozen(committed)).toBe(true);
    expect(Object.isFrozen(committed.time)).toBe(true);
  });

  it('numbers published events from campaign state [TECH-15.3]', () => {
    const transaction = beginTransaction(testCampaign(), content);
    transaction.publish('time.settingChanged', { paused: false, rate: 1 });
    transaction.publish('time.settingChanged', { paused: true, rate: 1 });

    const result = commit(transaction);

    expect(result.events.map((event) => event.ordinal)).toEqual([1, 2]);
    expect(result.campaign?.nextEventOrdinal).toBe(3);
  });

  it('reports invalidated topics once, in stable order [TECH-7.3]', () => {
    const transaction = beginTransaction(testCampaign(), content);
    transaction.invalidate('session');
    transaction.invalidate('frame');
    transaction.invalidate('session');

    expect(commit(transaction).invalidations).toEqual(['frame', 'session']);
  });
});

describe('command pipeline', () => {
  it('creates a campaign at revision 1 [MVP-AC-01, FUNC-3.1]', () => {
    const result = runCommand({
      campaign: null,
      content,
      type: 'campaign.create',
      payload: CREATE,
    });

    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') {
      return;
    }
    expect(result.campaign?.revision).toBe(1);
    expect(result.data.committed).toBe(true);
    expect(result.data.invalidations).toEqual(
      ['assets', 'combat', 'destinations', 'encounter', 'fitting', 'frame', 'insurance', 'inventory',
        'loss', 'market', 'navigation', 'notifications', 'onboarding', 'repair', 'resupply', 'saves',
        'session', 'ship', 'site', 'station', 'wallet'],
    );
    expect(result.data.events.map((event) => event.kind)).toEqual(['campaign.created']);
    // A new campaign must become durable at once (Functional Specification 3.4).
    expect(result.data.autosaveRequested).toBe(true);
  });

  it('refuses a second campaign while one is open [FUNC-22.10]', () => {
    const result = runCommand({
      campaign: testCampaign(),
      content,
      type: 'campaign.create',
      payload: CREATE,
    });

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('RULE_VIOLATION');
      expect(result.error.messageKey).toBe('error.ruleViolation.campaignAlreadyOpen');
    }
  });

  it.each(['campaign.reset', 'time.set', 'time.advance'] as const)(
    'refuses %s while no campaign is open [FUNC-22.10]',
    (type) => {
      const payload = type === 'time.set' ? { paused: false, rate: 1 } : { elapsedRealMs: 16 };
      const result = runCommand({ campaign: null, content, type, payload });

      expect(result.kind).toBe('failed');
      if (result.kind === 'failed') {
        expect(result.error.messageKey).toBe('error.ruleViolation.noCampaignOpen');
      }
    },
  );

  it('ends the campaign on reset [MVP-AC-01]', () => {
    const result = runCommand({
      campaign: testCampaign(),
      content,
      type: 'campaign.reset',
      payload: {},
    });

    expect(result.kind).toBe('committed');
    if (result.kind === 'committed') {
      expect(result.campaign).toBeNull();
      expect(result.data.campaignId).toBeNull();
      expect(result.data.revision).toBe(0);
      expect(result.data.events.map((event) => event.kind)).toEqual(['campaign.reset']);
    }
  });

  it('refuses a time rate the content does not offer [FUNC-3.3, FUNC-22.10]', () => {
    const result = runCommand({
      campaign: testCampaign(),
      content,
      type: 'time.set',
      payload: { paused: false, rate: 8 },
    });

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.messageKey).toBe('error.ruleViolation.unsupportedTimeRate');
      expect(result.error.params).toEqual({ rate: 8 });
    }
  });
});

describe('commands that change nothing', () => {
  it('commits nothing and consumes no revision [TECH-7.2]', () => {
    const campaign = testCampaign();

    const unchanged = runCommand({
      campaign,
      content,
      type: 'time.set',
      payload: { paused: true, rate: 1 },
    });
    const paused = runCommand({
      campaign,
      content,
      type: 'time.advance',
      payload: { elapsedRealMs: 1_000 },
    });

    for (const result of [unchanged, paused]) {
      expect(result.kind).toBe('unchanged');
      if (result.kind === 'unchanged') {
        expect(result.data.committed).toBe(false);
        expect(result.data.revision).toBe(campaign.revision);
        expect(result.data.invalidations).toEqual([]);
      }
    }
  });

  it('abandons a transaction whose result violates an invariant [TECH-5.4, TECH-15.3]', () => {
    const invalid = testCampaign({ displayName: '   ' });

    const result = runCommand({
      campaign: invalid,
      content,
      type: 'time.set',
      payload: { paused: false, rate: 1 },
    });

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.messageKey).toBe('error.internalError.invariant');
      expect(result.error.params).toMatchObject({ rule: 'boundedValues' });
    }
    expect(invalid.time.paused).toBe(true);
  });
});

describe('recent request cache', () => {
  it('returns the response a request id already produced [TECH-7.2]', () => {
    const cache = createRecentRequests(4);
    const response = { requestId: 'a', ok: true as const, revision: 1, data: null };

    cache.remember('a', response);

    expect(cache.find('a')).toBe(response);
    expect(cache.find('b')).toBeUndefined();
  });

  it('stays bounded and evicts the oldest entry [TECH-7.2, TECH-13]', () => {
    const cache = createRecentRequests(2);
    for (const id of ['a', 'b', 'c']) {
      cache.remember(id, { requestId: id, ok: true, revision: 1, data: null });
    }

    expect(cache.size).toBe(2);
    expect(cache.find('a')).toBeUndefined();
    expect(cache.find('c')).toBeDefined();
  });
});

describe('time settings the player may always reach', () => {
  it('accepts pause whatever the campaign is doing [FUNC-22.13]', () => {
    const running = runCommand({
      campaign: testCampaign({
        time: { simulationTimeMs: 90_000, paused: false, rate: 1, accumulatorMs: 10 },
      }),
      content,
      type: 'time.set',
      payload: { paused: true, rate: 1 },
    });

    expect(running.kind).toBe('committed');
    if (running.kind === 'committed') {
      expect(running.campaign?.time.paused).toBe(true);
      // Pausing does not disturb the selected rate or the clock itself.
      expect(running.campaign?.time.rate).toBe(1);
      expect(running.campaign?.time.simulationTimeMs).toBe(90_000);
    }
  });

  it('keeps the selected rate across a pause and a resume [FUNC-3.3]', () => {
    const paused = runCommand({
      campaign: testCampaign({
        time: { simulationTimeMs: 0, paused: false, rate: 1, accumulatorMs: 0 },
      }),
      content,
      type: 'time.set',
      payload: { paused: true, rate: 1 },
    });

    expect(paused.kind).toBe('committed');
    if (paused.kind === 'committed' && paused.campaign !== null) {
      const resumed = runCommand({
        campaign: paused.campaign,
        content,
        type: 'time.set',
        payload: { paused: false, rate: 1 },
      });
      expect(resumed.kind).toBe('committed');
      if (resumed.kind === 'committed') {
        expect(resumed.campaign?.time.rate).toBe(1);
      }
    }
  });
});
