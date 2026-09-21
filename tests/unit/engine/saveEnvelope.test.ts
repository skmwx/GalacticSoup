import { fixtureRepository } from '../../support/contentFixtures.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  captureSnapshot,
  createCampaign,
  envelopeChecksum,
  isSealed,
  SAVE_FORMAT_VERSION,
  saveIdOf,
  summaryOf,
  type SaveEnvelope,
} from '@engine';
import { canonicalJson } from '@shared';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import { testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';
import { GOLDEN_CAPTURE, GOLDEN_CONTENT } from '../../support/goldenSave.ts';

/**
 * The save envelope: shape, sealing and stability
 * (Technical Specification 11.2).
 */

const content = shippedContent();

function golden(): SaveEnvelope {
  const file = path.join(REPO_ROOT, 'tests', 'fixtures', 'saves', 'format-7.json');
  return JSON.parse(readFileSync(file, 'utf8')) as SaveEnvelope;
}

function capture(overrides: Partial<Parameters<typeof captureSnapshot>[0]> = {}): SaveEnvelope {
  return captureSnapshot({
    campaign: testCampaign(),
    content,
    engineVersion: '1.2.3',
    protocolVersion: 1,
    slotId: 'slot-1',
    kind: 'auto',
    sequence: 1,
    savedAtRealMs: 1_700_000_000_000,
    ...overrides,
  });
}

describe('save envelope', () => {
  it('reproduces the golden save byte for byte [TECH-11.2, TECH-17]', () => {
    const campaign = { ...createCampaign(GOLDEN_CAPTURE.campaign, fixtureRepository()), revision: 1 };
    const produced = captureSnapshot({ ...GOLDEN_CAPTURE.envelope, campaign });

    expect(canonicalJson(produced as unknown as Record<string, unknown>)).toBe(
      canonicalJson(golden() as unknown as Record<string, unknown>),
    );
  });

  it('seals itself with a digest over every other field [TECH-11.2]', () => {
    const envelope = capture();

    expect(isSealed(envelope)).toBe(true);
    expect(envelope.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects a changed field through the checksum [TECH-11.2, TECH-14]', () => {
    const envelope = capture();

    for (const tampered of [
      { ...envelope, revision: envelope.revision + 1 },
      { ...envelope, campaignId: 'c000000000000000000000000' },
      { ...envelope, state: { ...envelope.state, displayName: 'Someone Else' } },
      { ...envelope, savedAtRealMs: envelope.savedAtRealMs + 1 },
    ]) {
      expect(isSealed(tampered as SaveEnvelope)).toBe(false);
    }
  });

  it('does not depend on the order the fields happen to carry [TECH-5.3, TECH-11.2]', () => {
    const envelope = capture();
    const reordered = Object.fromEntries(
      Object.entries(envelope).reverse(),
    ) as unknown as SaveEnvelope;
    const { checksum: _ignored, ...fields } = reordered;
    void _ignored;

    expect(envelopeChecksum(fields)).toBe(envelope.checksum);
  });

  it('records the build and content it was written against [TECH-11.2, TECH-11.4]', () => {
    const envelope = capture({ content: GOLDEN_CONTENT });

    expect(envelope.format).toBe('galactic-soup/save');
    expect(envelope.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(envelope.protocolVersion).toBe(1);
    expect(envelope.engineVersion).toBe('1.2.3');
    expect(envelope.contentVersion).toBe(GOLDEN_CONTENT.contentVersion);
    expect(envelope.contentHash).toBe(GOLDEN_CONTENT.contentHash);
  });

  it('copies the payload rather than referencing campaign state [TECH-11.2]', () => {
    const campaign = testCampaign();
    const envelope = capture({ campaign });

    expect(envelope.state).not.toBe(campaign);
    expect(envelope.state['campaignId']).toBe(campaign.campaignId);
    expect(envelope.state['time']).toEqual(campaign.time);
  });

  it('names a save uniquely within its slot [TECH-11.1]', () => {
    expect(saveIdOf('slot-1', 'auto', 7)).toBe('slot-1:auto:7');
    expect(saveIdOf('slot-1', 'manual', 7)).not.toBe(saveIdOf('slot-1', 'auto', 7));
    expect(capture({ sequence: 4 }).saveId).toBe(saveIdOf('slot-1', 'auto', 4));
  });

  it('summarises itself for the manifest [TECH-11.1]', () => {
    const envelope = capture({ sequence: 3, kind: 'manual' });

    expect(summaryOf(envelope)).toEqual({
      saveId: envelope.saveId,
      campaignId: envelope.campaignId,
      displayName: envelope.displayName,
      kind: 'manual',
      sequence: 3,
      revision: envelope.revision,
      simulationTimeMs: envelope.simulationTimeMs,
      savedAtRealMs: envelope.savedAtRealMs,
      formatVersion: SAVE_FORMAT_VERSION,
      contentVersion: content.contentVersion,
      contentHash: content.contentHash,
    });
  });

  it('validates the golden save against the published save schema [TECH-11.2, TECH-17]', () => {
    const schema = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'schemas', 'save', 'save-envelope.schema.json'), 'utf8'),
    ) as { required: string[] };

    expect(Object.keys(golden()).sort()).toEqual([...schema.required].sort());
  });
});
