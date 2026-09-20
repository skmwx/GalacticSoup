import { shippedContent } from '../../support/content.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  authoritativeView,
  CAMPAIGN_STATE_VERSION,
  MAX_DISPLAY_NAME_LENGTH,
  campaignStateHash,
  createCampaign,
  deriveCampaignId,
  entityIdOf,
  isCampaignId,
  isEntityId,
  RANDOM_STREAMS,
  scheduleBoundary,
  validateCampaign,
  type CampaignState,
} from '@engine';

import { validatePayload } from '@protocol';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import { OTHER_SEED, TEST_SEED, testCampaign, testDraft } from '../../support/campaign.ts';

/**
 * The campaign aggregate and its invariants
 * (Technical Specification 8.1, 9.5, 15.3).
 */

const AjvConstructor = (
  Ajv2020 as unknown as { default?: typeof Ajv2020 }
).default as unknown as typeof Ajv2020;

const stateSchema = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'schemas/save/campaign-state.schema.json'), 'utf8'),
) as object;

const validateStateSchema = new AjvConstructor({ allErrors: true, strict: true }).compile(
  stateSchema,
);

describe('campaign creation', () => {
  it('starts paused at time zero with the declared state version [FUNC-3.3, TECH-8.1]', () => {
    const state = createCampaign({
      displayName: 'Vela',
      seed: TEST_SEED,
      createdAtRealMs: 42,
      initialRate: 1,
    }, shippedContent());

    expect(state.stateVersion).toBe(CAMPAIGN_STATE_VERSION);
    expect(state.time).toEqual({
      simulationTimeMs: 0,
      paused: true,
      rate: 1,
      accumulatorMs: 0,
    });
    expect(state.revision).toBe(0);
    expect(state.nextEntityOrdinal).toBe(9);
    expect(state.nextEventOrdinal).toBe(1);
    expect(state.scheduler.entries).toEqual([]);
  });

  it('derives its identity from the seed [TECH-5.1]', () => {
    const state = testCampaign();

    expect(isCampaignId(state.campaignId)).toBe(true);
    expect(state.campaignId).toBe(deriveCampaignId(TEST_SEED));
    expect(deriveCampaignId(OTHER_SEED)).not.toBe(state.campaignId);
    expect(isEntityId(entityIdOf(state.campaignId, 1))).toBe(true);
  });

  it('refuses to derive an identity from something that is not a seed [TECH-5.1]', () => {
    expect(() => deriveCampaignId('not-a-seed')).toThrow(TypeError);
    expect(() => entityIdOf(deriveCampaignId(TEST_SEED), 0)).toThrow(TypeError);
  });

  it('seeds every declared random stream [TECH-9.4]', () => {
    const state = testCampaign();

    expect(Object.keys(state.random).sort()).toEqual([...RANDOM_STREAMS].sort());
  });

  it('matches the published authoritative-state schema [TECH-11.2]', () => {
    const draft = testDraft();
    draft.time.simulationTimeMs = 500;
    scheduleBoundary(draft, { kind: 'test.mark', dueAtMs: 900 });

    const valid = validateStateSchema(draft);
    expect(validateStateSchema.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });
});

describe('authoritative state hash', () => {
  it('is stable for the same state [TECH-9.5]', () => {
    expect(campaignStateHash(testCampaign())).toBe(campaignStateHash(testCampaign()));
  });

  it('excludes the real creation timestamp [TECH-9.5]', () => {
    const early = testCampaign({ createdAtRealMs: 1 });
    const late = testCampaign({ createdAtRealMs: 1_900_000_000_000 });

    expect(campaignStateHash(early)).toBe(campaignStateHash(late));
    expect(Object.keys(authoritativeView(early))).not.toContain('createdAtRealMs');
  });

  it('changes when an authoritative value changes [TECH-9.5]', () => {
    const base = testCampaign();

    expect(campaignStateHash({ ...base, revision: 2 })).not.toBe(campaignStateHash(base));
    expect(
      campaignStateHash({ ...base, time: { ...base.time, simulationTimeMs: 50 } }),
    ).not.toBe(campaignStateHash(base));
    expect(campaignStateHash(testCampaign({ displayName: 'Other' }))).not.toBe(
      campaignStateHash(base),
    );
  });

  it('is a sha-256 digest [TECH-5.3, TECH-9.5]', () => {
    expect(campaignStateHash(testCampaign())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('campaign invariants', () => {
  it('accepts a freshly created campaign [TECH-15.3]', () => {
    expect(validateCampaign(testCampaign())).toEqual([]);
  });

  it.each([
    ['a zero revision', { revision: 0 }, 'revisionMonotonic'],
    ['a fractional revision', { revision: 1.5 }, 'revisionMonotonic'],
    ['a zero entity ordinal', { nextEntityOrdinal: 0 }, 'ordinalsMonotonic'],
    ['a zero event ordinal', { nextEventOrdinal: 0 }, 'ordinalsMonotonic'],
    ['an unknown state version', { stateVersion: 99 }, 'stateVersion'],
    ['a blank display name', { displayName: '   ' }, 'boundedValues'],
    ['an over-long display name', { displayName: 'x'.repeat(49) }, 'boundedValues'],
  ])('rejects %s [TECH-15.3]', (_label, overrides, rule) => {
    const issues = validateCampaign(testCampaign(overrides as Partial<CampaignState>));

    expect(issues.map((issue) => issue.rule)).toContain(rule);
  });

  it('rejects negative or fractional simulation time [TECH-15.3]', () => {
    const base = testCampaign();

    for (const simulationTimeMs of [-1, 0.5, 2e12]) {
      const issues = validateCampaign({ ...base, time: { ...base.time, simulationTimeMs } });
      expect(issues.map((issue) => issue.rule)).toContain('simulationTime');
    }
  });

  it('rejects a non-positive time rate [FUNC-4.2, TECH-15.3]', () => {
    const base = testCampaign();
    const issues = validateCampaign({ ...base, time: { ...base.time, rate: 0 } });

    expect(issues.map((issue) => issue.rule)).toContain('boundedValues');
  });

  it('rejects an all-zero random stream [TECH-9.4, TECH-15.3]', () => {
    const base = testCampaign();
    const issues = validateCampaign({
      ...base,
      random: { ...base.random, combat: { s0: 0, s1: 0, s2: 0, s3: 0, drawIndex: 0 } },
    });

    expect(issues.map((issue) => issue.rule)).toContain('randomStreams');
  });

  it('reports the path of the value it rejected [TECH-15.3]', () => {
    const issues = validateCampaign(testCampaign({ nextEntityOrdinal: 0 }));

    expect(issues[0]?.path).toBe('nextEntityOrdinal');
  });
});

describe('display-name bound', () => {
  /**
   * The protocol rejects an oversized name before any engine code runs, and
   * `@protocol` may not import the engine, so the bound is stated in both
   * places. This is the check that keeps the two honest.
   */
  it('is the same in the protocol and in the domain [TECH-7.2, TECH-8.1]', () => {
    const payload = (length: number): Record<string, unknown> => ({
      displayName: 'x'.repeat(length),
      seed: TEST_SEED,
      createdAtRealMs: 0,
    });

    expect(validatePayload('campaign.create', payload(MAX_DISPLAY_NAME_LENGTH))).toBeNull();
    expect(validatePayload('campaign.create', payload(MAX_DISPLAY_NAME_LENGTH + 1))).not.toBeNull();
    const longest = testCampaign({ displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH) });
    expect(validateCampaign(longest)).toEqual([]);
  });
});
