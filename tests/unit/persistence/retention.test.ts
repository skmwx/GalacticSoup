import { describe, expect, it } from 'vitest';

import { planWrite } from '@adapters/persistence';
import {
  captureSnapshot,
  DEFAULT_SAVE_RETENTION,
  type SaveEnvelope,
  type SaveKind,
  type SlotManifest,
} from '@engine';

import { testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * Save rotation (Technical Specification 11.1; Functional Specification 3.4).
 *
 * A slot keeps five rolling autosaves and one replaceable manual save. The
 * plan is pure, so the rule can be proved exhaustively without a store.
 */

const content = shippedContent();

function envelope(sequence: number, kind: SaveKind = 'auto'): SaveEnvelope {
  return captureSnapshot({
    campaign: { ...testCampaign(), revision: sequence },
    content,
    engineVersion: '1.0.0',
    protocolVersion: 1,
    slotId: 'slot-1',
    kind,
    sequence,
    savedAtRealMs: 1_700_000_000_000 + sequence,
  });
}

/** Applies a series of writes, as a store would. */
function after(...envelopes: readonly SaveEnvelope[]): {
  manifest: SlotManifest;
  removed: string[];
} {
  let manifest: SlotManifest | null = null;
  const removed: string[] = [];
  for (const next of envelopes) {
    const plan = planWrite(manifest, next, DEFAULT_SAVE_RETENTION);
    manifest = plan.manifest;
    removed.push(...plan.removeIds);
  }
  if (manifest === null) {
    throw new Error('No write was planned.');
  }
  return { manifest, removed };
}

describe('save rotation', () => {
  it('records the first save as the resumable one [TECH-11.1]', () => {
    const { manifest, removed } = after(envelope(1));

    expect(manifest.slotId).toBe('slot-1');
    expect(manifest.saves).toHaveLength(1);
    expect(manifest.saves[0]?.saveId).toBe('slot-1:auto:1');
    expect(removed).toEqual([]);
  });

  it('orders saves newest first [TECH-11.1]', () => {
    const { manifest } = after(envelope(1), envelope(2), envelope(3));

    expect(manifest.saves.map((save) => save.sequence)).toEqual([3, 2, 1]);
  });

  it('keeps five rolling autosaves and drops the oldest [FUNC-3.4, TECH-11.1]', () => {
    const { manifest, removed } = after(...[1, 2, 3, 4, 5, 6, 7].map((n) => envelope(n)));

    expect(manifest.saves).toHaveLength(5);
    expect(manifest.saves.map((save) => save.sequence)).toEqual([7, 6, 5, 4, 3]);
    expect(removed).toEqual(['slot-1:auto:1', 'slot-1:auto:2']);
  });

  it('keeps one replaceable manual save beside the autosaves [FUNC-3.4]', () => {
    const { manifest, removed } = after(
      envelope(1),
      envelope(2, 'manual'),
      envelope(3),
      envelope(4, 'manual'),
    );

    const kinds = manifest.saves.map((save) => save.kind);
    expect(kinds.filter((kind) => kind === 'manual')).toHaveLength(1);
    expect(manifest.saves.find((save) => save.kind === 'manual')?.sequence).toBe(4);
    expect(removed).toEqual(['slot-1:manual:2']);
  });

  it('never lists the save it just wrote among the removals [TECH-11.1]', () => {
    const { removed } = after(...[1, 2, 3, 4, 5, 6].map((n) => envelope(n)));

    expect(removed).not.toContain('slot-1:auto:6');
  });

  it('replaces a save written under an id that already exists [TECH-11.1]', () => {
    const first = envelope(2);
    const again = { ...first, revision: 99 };
    const { manifest } = after(envelope(1), first, again);

    expect(manifest.saves.filter((save) => save.saveId === first.saveId)).toHaveLength(1);
    expect(manifest.saves[0]?.revision).toBe(99);
  });

  it('empties the slot when a different campaign is written into it [TECH-11.1]', () => {
    const existing = after(envelope(1), envelope(2)).manifest;
    const other = { ...envelope(3), campaignId: 'c000000000000000000000001' };

    const plan = planWrite(existing, other, DEFAULT_SAVE_RETENTION);

    expect(plan.manifest.campaignId).toBe('c000000000000000000000001');
    expect(plan.manifest.saves).toHaveLength(1);
    expect(plan.removeIds).toEqual(['slot-1:auto:1', 'slot-1:auto:2']);
  });

  it('records the campaign and the time of the newest save [TECH-11.1]', () => {
    const newest = envelope(2);
    const { manifest } = after(envelope(1), newest);

    expect(manifest.campaignId).toBe(newest.campaignId);
    expect(manifest.updatedAtRealMs).toBe(newest.savedAtRealMs);
  });
});
