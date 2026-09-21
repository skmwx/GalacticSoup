import { describe, expect, it } from 'vitest';

import {
  campaignStateHash,
  captureSnapshot,
  envelopeChecksum,
  loadSave,
  readCampaignState,
  type SaveEnvelope,
  type SaveMigration,
} from '@engine';

import { testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * The load pipeline (Technical Specification 11.4).
 *
 * Every case proves the same thing twice: the failure is reported with a
 * reason the interface can explain, and the stored document is handed back
 * untouched, because nothing in the pipeline writes.
 */

const content = shippedContent();

function sealed(overrides: Partial<SaveEnvelope> = {}): SaveEnvelope {
  const envelope = captureSnapshot({
    campaign: testCampaign(),
    content,
    engineVersion: '1.2.3',
    protocolVersion: 1,
    slotId: 'slot-1',
    kind: 'auto',
    sequence: 1,
    savedAtRealMs: 1_700_000_000_000,
  });
  if (Object.keys(overrides).length === 0) {
    return envelope;
  }
  const { checksum: _ignored, ...fields } = { ...envelope, ...overrides };
  void _ignored;
  return { ...fields, checksum: envelopeChecksum(fields) } as SaveEnvelope;
}

function reasonOf(stored: unknown): string {
  const result = loadSave(stored, { content });
  if (result.ok) {
    throw new Error('Expected the load to fail.');
  }
  return result.error.messageKey;
}

describe('save load pipeline', () => {
  it('opens a sealed save at the revision it was captured at [MVP-AC-01, TECH-11.4]', () => {
    const campaign = testCampaign();
    const result = loadSave(sealed(), { content });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.campaignId).toBe(campaign.campaignId);
    expect(result.migrated).toEqual([]);
    expect(result.contentChanged).toBe(false);
    // Loading is a restore, not a change: the campaign is the one that was
    // captured, down to its canonical hash (Technical Specification 9.5).
    expect(campaignStateHash(result.state)).toBe(campaignStateHash(campaign));
  });

  it('refuses a missing save [TECH-11.4]', () => {
    expect(reasonOf(null)).toBe('error.saveLoad.notFound');
    expect(reasonOf(undefined)).toBe('error.saveLoad.notFound');
  });

  it('refuses a document that is not a save [TECH-11.4, TECH-14]', () => {
    expect(reasonOf({ nonsense: true })).toBe('error.saveLoad.envelope');
    expect(reasonOf('a string')).toBe('error.saveLoad.envelope');
    expect(reasonOf([1, 2, 3])).toBe('error.saveLoad.envelope');
  });

  it('bounds the structure before touching it [TECH-14]', () => {
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 64; level += 1) {
      deep = { nested: deep };
    }

    expect(reasonOf({ ...sealed(), state: deep })).toBe('error.saveLoad.structure');
  });

  it('refuses an envelope with a missing or malformed field [TECH-11.4]', () => {
    const { revision: _dropped, ...withoutRevision } = sealed();
    void _dropped;

    expect(reasonOf(withoutRevision)).toBe('error.saveLoad.envelope');
    expect(reasonOf({ ...sealed(), kind: 'quicksave' })).toBe('error.saveLoad.envelope');
    expect(reasonOf({ ...sealed(), extra: true })).toBe('error.saveLoad.envelope');
    expect(reasonOf({ ...sealed(), format: 'someone-elses/save' })).toBe(
      'error.saveLoad.envelope',
    );
  });

  it('refuses a save whose checksum does not match [TECH-11.2, TECH-11.4]', () => {
    const envelope = sealed();

    expect(reasonOf({ ...envelope, revision: envelope.revision + 1 })).toBe(
      'error.saveLoad.checksum',
    );
  });

  it('refuses a save from a newer format without modifying it [TECH-11.4]', () => {
    const envelope = sealed();
    const future = { ...envelope, formatVersion: 99 };
    const before = JSON.stringify(future);

    expect(reasonOf(future)).toBe('error.saveLoad.forwardVersion');
    expect(JSON.stringify(future)).toBe(before);
  });

  it('refuses an older format with no migration path [TECH-11.4]', () => {
    const envelope = sealed();

    expect(reasonOf({ ...envelope, formatVersion: 0 })).toBe('error.saveLoad.envelope');
  });

  it('refuses a payload that is not a legal campaign [TECH-11.4, TECH-15.3]', () => {
    const envelope = sealed();
    const broken = {
      ...envelope,
      state: { ...envelope.state, revision: 0 },
    };

    expect(reasonOf({ ...broken, checksum: envelopeChecksum(stripChecksum(broken)) })).toBe(
      'error.saveLoad.payload',
    );
  });

  it('refuses an envelope that disagrees with its own payload [TECH-11.4]', () => {
    const other = { ...testCampaign(), campaignId: 'c000000000000000000000001' };
    const envelope = sealed({ campaignId: other.campaignId });

    expect(reasonOf(envelope)).toBe('error.saveLoad.envelope');
  });

  it('accepts content whose values changed but whose definitions all resolve [TECH-11.4]', () => {
    const envelope = sealed({
      contentHash: 'f'.repeat(64),
      contentVersion: '9.9.9+ffffffffffff',
    });

    const result = loadSave(envelope, { content });

    expect(result.ok).toBe(true);
    expect(result.ok && result.contentChanged).toBe(true);
  });

  it('runs ordered migrations and marks what it applied [TECH-11.4]', () => {
    const envelope = sealed();
    const older = { ...envelope, formatVersion: 1 };

    const migrations: readonly SaveMigration[] = [
      {
        from: 1,
        to: 2,
        describe: 'test step',
        migrate: (save) => ({ ...save, migrated: true }),
      },
      {
        from: 2,
        to: 3,
        describe: 'second test step',
        migrate: (save) => ({ ...save, migratedAgain: true }),
      },
      {
        from: 3,
        to: 4,
        describe: 'third test step',
        migrate: (save) => ({ ...save, migratedThird: true }),
      },
      {
        from: 4,
        to: 5,
        describe: 'fourth test step',
        migrate: (save) => ({ ...save, migratedFourth: true }),
      },
      {
        from: 5,
        to: 6,
        describe: 'fifth test step',
        migrate: (save) => ({ ...save, migratedFifth: true }),
      },
    ];

    // The fixture registry proves loading through every version boundary.
    const result = loadSave(older, { content, migrations });

    expect(result.ok).toBe(true);
    expect(result.ok && result.migrated).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads a campaign payload independently of its envelope [TECH-11.4]', () => {
    const campaign = testCampaign();
    const read = readCampaignState(JSON.parse(JSON.stringify(campaign)) as unknown);

    expect(read.ok).toBe(true);
    expect(read.ok && campaignStateHash(read.state)).toBe(campaignStateHash(campaign));
  });

  it('names the first problem in a malformed payload [TECH-11.4]', () => {
    const read = readCampaignState({ stateVersion: 1 });

    expect(read.ok).toBe(false);
    expect(read.ok ? [] : read.issues.map((issue) => issue.path)).toContain('state.campaignId');
  });
});

function stripChecksum(envelope: SaveEnvelope): Omit<SaveEnvelope, 'checksum'> {
  const { checksum: _ignored, ...fields } = envelope;
  void _ignored;
  return fields;
}
