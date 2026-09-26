import type { ContentIdentity, CreateCampaignInput, SaveKind } from '@engine';

/**
 * Inputs of the golden save fixture (Technical Specification 11.2, 11.4).
 *
 * `tests/fixtures/saves/format-10.json` is the artefact these inputs produce.
 * It pins the envelope's shape, its canonical serialisation and its checksum,
 * so a change to any of the three is a deliberate format change rather than a
 * silent one - and so a second implementation of the format can be held to the
 * same bytes.
 *
 * The asset definitions come from the stable minimal fixture pack; the envelope's
 * content identity is synthetic on purpose. A golden save built against
 * the shipped bundle would change every time a balance value moved, which
 * would prove nothing about the format.
 */

export const GOLDEN_CONTENT: ContentIdentity = {
  contentVersion: '1.0.0+000000000000',
  contentHash: '0'.repeat(64),
  defaultLocale: 'en',
  locales: ['en'],
};

export const GOLDEN_CAPTURE: {
  readonly campaign: CreateCampaignInput;
  readonly envelope: {
    readonly content: ContentIdentity;
    readonly engineVersion: string;
    readonly protocolVersion: number;
    readonly slotId: string;
    readonly kind: SaveKind;
    readonly sequence: number;
    readonly savedAtRealMs: number;
  };
} = {
  campaign: {
    displayName: 'Golden Pilot',
    seed: '0123456789abcdef0123456789abcdef',
    createdAtRealMs: 1_700_000_000_000,
    initialRate: 1,
  },
  envelope: {
    content: GOLDEN_CONTENT,
    engineVersion: '1.0.0',
    protocolVersion: 4,
    slotId: 'slot-1',
    kind: 'auto',
    sequence: 1,
    savedAtRealMs: 1_700_000_123_456,
  },
};
