import { sha256Hex } from '@shared';

/**
 * Campaign and entity identity (Technical Specification 5.1).
 *
 * The engine is headless and deterministic: it has no clock and no ambient
 * randomness, so it cannot invent an identifier. The client supplies a random
 * campaign seed, and every identifier the engine owns is derived from that
 * seed and a persisted monotonic ordinal. Replaying the same command log
 * therefore reproduces the same identifiers.
 *
 * @implements TECH-5.1
 */

declare const campaignIdBrand: unique symbol;
declare const entityIdBrand: unique symbol;

export type CampaignId = string & { readonly [campaignIdBrand]: 'campaign' };
export type EntityId = string & { readonly [entityIdBrand]: 'entity' };

/** 128 bits of client-supplied randomness, lowercase hexadecimal. */
export const CAMPAIGN_SEED_PATTERN = /^[0-9a-f]{32}$/;

/** `c` followed by 96 bits of the seed digest. */
export const CAMPAIGN_ID_PATTERN = /^c[0-9a-f]{24}$/;

export const ENTITY_ID_PATTERN = /^c[0-9a-f]{24}-e[1-9][0-9]*$/;

/** The largest ordinal an identifier may carry. */
export const MAX_ORDINAL = Number.MAX_SAFE_INTEGER;

export function isCampaignSeed(value: unknown): value is string {
  return typeof value === 'string' && CAMPAIGN_SEED_PATTERN.test(value);
}

export function isCampaignId(value: unknown): value is CampaignId {
  return typeof value === 'string' && CAMPAIGN_ID_PATTERN.test(value);
}

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

/**
 * The campaign identifier for a seed. Deriving it rather than accepting one
 * keeps a single source of campaign identity: two campaigns are the same
 * campaign exactly when they were created from the same seed.
 */
export function deriveCampaignId(seed: string): CampaignId {
  if (!isCampaignSeed(seed)) {
    throw new TypeError(`"${seed}" is not a campaign seed.`);
  }
  return `c${sha256Hex(`galactic-soup/campaign/${seed}`).slice(0, 24)}` as CampaignId;
}

/**
 * An opaque entity identifier in the campaign namespace. Ordinal allocation
 * belongs to the surrounding transaction, so this function only formats an
 * ordinal the caller already reserved.
 */
export function entityIdOf(campaignId: CampaignId, ordinal: number): EntityId {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TypeError(`${String(ordinal)} is not an entity ordinal.`);
  }
  return `${campaignId}-e${String(ordinal)}` as EntityId;
}
