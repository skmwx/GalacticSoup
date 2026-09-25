import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { captureSnapshot, loadSave } from '@engine';
import { runCommand } from '@engine/application';
import {
  campaignStateHash,
  draftOf,
  playerWrecks,
  validateCampaign,
  type CampaignState,
} from '@engine/domain';
import { PROTOCOL_VERSION, type CommandType } from '@protocol';

import { shippedContent } from '../../support/content.ts';
import { BASE_SITE_ID } from '../../support/encounter.ts';
import {
  command,
  destroyPlayer,
  inSite,
  newCampaign,
  stateOf,
  withCredits,
} from '../../support/loss.ts';

/**
 * A campaign after a loss, as saved state (Technical Specification 9.5,
 * 11.2, 11.4, 15.3).
 *
 * Losing a ship leaves history, scheduled work and restricted goods behind:
 * the loss record, the player's wreck and its expiry, a chosen bookmark, a
 * warp aimed at one, a shipless pilot or a granted ship. Each must come back
 * from a snapshot exactly, and the same inputs must lose the same ship the
 * same way every time.
 */

const content = shippedContent();

const AjvConstructor = (Ajv2020 as unknown as { default: typeof Ajv2020 }).default;
const validateStateSchema = new AjvConstructor({ strict: true, allErrors: true }).compile(
  JSON.parse(readFileSync('schemas/save/campaign-state.schema.json', 'utf8')) as object,
);

function roundTrip(state: CampaignState): CampaignState {
  const envelope = captureSnapshot({
    campaign: state,
    content,
    engineVersion: 'test',
    protocolVersion: PROTOCOL_VERSION,
    slotId: 'slot-1',
    kind: 'auto',
    sequence: 1,
    savedAtRealMs: 1,
  });
  const loaded = loadSave(JSON.parse(JSON.stringify(envelope)) as unknown, { content });
  if (!loaded.ok) throw new Error(`The snapshot did not load: ${JSON.stringify(loaded.error)}`);
  return loaded.state;
}

function expectRoundTrip(state: CampaignState): CampaignState {
  expect(validateCampaign(state, content)).toEqual([]);
  expect(validateStateSchema(state), JSON.stringify(validateStateSchema.errors)).toBe(true);
  const restored = roundTrip(state);
  expect(restored).toEqual(JSON.parse(JSON.stringify(state)));
  expect(campaignStateHash(restored)).toBe(campaignStateHash(state));
  return restored;
}

function advance(state: CampaignState, milliseconds: number): CampaignState {
  let current = state;
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 250) {
    current = command(current, 'time.advance', { elapsedRealMs: 250 }).state;
  }
  return current;
}

describe('a campaign after a loss, saved and loaded', () => {
  it('round-trips a shipless pilot, the loss record and the wreck with its expiry [TECH-11.2, TECH-11.4, FUNC-9.12]', () => {
    const fixture = inSite(newCampaign());
    destroyPlayer(fixture);
    const state = stateOf(fixture);
    expect(state.assets.activeShipId).toBeNull();

    const restored = expectRoundTrip(state);
    expect(restored.recovery.lastLoss).toEqual(state.recovery.lastLoss);
    const wreck = playerWrecks(restored)[0];
    expect(wreck?.owner).toBe('player');
    expect(restored.scheduler.entries.some((entry) => entry.entryId === wreck?.boundaryEntryId)).toBe(true);
  });

  it('round-trips a granted ship, a chosen bookmark and two losses [TECH-11.2, TECH-11.4, FUNC-9.12]', () => {
    const first = inSite(withCredits(newCampaign(), 1_000));
    destroyPlayer(first);
    const second = inSite(stateOf(first), { siteId: BASE_SITE_ID });
    destroyPlayer(second);
    let state = stateOf(second);
    const wreck = playerWrecks(state)[1];
    state = command(state, 'navigation.selectBookmark', { bookmarkId: wreck?.id ?? '' }).state;

    const restored = expectRoundTrip(state);
    expect(restored.recovery.losses).toBe(2);
    expect(restored.navigation.selectedBookmarkId).toBe(wreck?.id);
    const ship = restored.assets.ships[restored.assets.activeShipId ?? ''];
    expect(ship?.recoveryGrant).toBe(true);
    expect(Object.values(restored.assets.stacks).filter((stack) => stack.inventoryId === ship?.fittingInventoryId)
      .every((stack) => stack.recoveryGrant)).toBe(true);
  });

  it('resumes a warp aimed at a bookmark and reaches the same state as the uninterrupted run [TECH-9.5, TECH-11.4, FUNC-7.3]', () => {
    const fixture = inSite(withCredits(newCampaign(), 1_000), { playerPositionKm: { x: 12, y: -7 }, spawn: false });
    destroyPlayer(fixture);
    let state = command(stateOf(fixture), 'time.set', { paused: false, rate: 1 }).state;
    const wreck = playerWrecks(state)[0];
    state = command(state, 'ship.undock', {}).state;
    state = command(state, 'navigation.warpToBookmark', { bookmarkId: wreck?.id ?? '', arrivalDistanceKm: 10 }).state;
    state = advance(state, 2_000);
    expect(state.navigation.travel).toMatchObject({ kind: 'warp', bookmarkId: wreck?.id });

    const restored = expectRoundTrip(state);
    const continued = advance(state, 20_000);
    const resumed = advance(restored, 20_000);
    expect(continued.assets.location.kind).toBe('site');
    expect(campaignStateHash(resumed)).toBe(campaignStateHash(continued));
  });
});

describe('deterministic replay through a loss', () => {
  /** One scripted sortie to the pirate base, idling until the ship is lost. */
  function sortie(seed: string, save?: (state: CampaignState) => CampaignState): CampaignState {
    const run = (state: CampaignState | null, type: CommandType, payload: unknown): CampaignState => {
      const result = runCommand({ campaign: state, content, type, payload });
      if (result.kind === 'failed') throw new Error(`${type}: ${result.error.messageKey}`);
      if (result.kind === 'unchanged') {
        if (state === null) throw new Error(`${type} left no campaign.`);
        return state;
      }
      if (result.campaign === null) throw new Error(`${type} closed the campaign.`);
      return result.campaign;
    };
    let state = run(null, 'campaign.create', { displayName: 'Replay', seed, createdAtRealMs: 1_700_000_000_000 });
    // The ship leaves already badly damaged, so the fight is short.
    const damaged = draftOf(state);
    const ship = damaged.assets.ships[damaged.assets.activeShipId ?? '']!;
    const hull = content.requireHull(ship.hullId);
    ship.condition.damage = {
      shield: hull.defenses.shield.hitPoints,
      armor: hull.defenses.armor.hitPoints,
      hull: hull.defenses.hull.hitPoints - 40,
    };
    state = run(damaged as unknown as CampaignState, 'time.set', { paused: false, rate: 1 });
    state = run(state, 'ship.undock', {});
    state = run(state, 'navigation.warp', { destinationSiteId: BASE_SITE_ID, arrivalDistanceKm: 10 });
    let saved = false;
    for (let step = 0; step < 2_000 && state.recovery.losses === 0; step += 1) {
      state = run(state, 'time.advance', { elapsedRealMs: 250 });
      if (save !== undefined && !saved && state.combat.events.length > 0) {
        state = save(state);
        saved = true;
      }
    }
    // A little further, so the replay also covers what follows the loss.
    for (let step = 0; step < 20; step += 1) state = run(state, 'time.advance', { elapsedRealMs: 250 });
    return state;
  }

  it('loses the same ship the same way from the same seed and inputs [TECH-9.5, TECH-15.1, FUNC-9.12]', () => {
    const seed = 'bb22cc33dd44ee55ff6677889900aa11';
    const first = sortie(seed);
    const second = sortie(seed);
    expect(first.recovery.losses).toBe(1);
    expect(campaignStateHash(second)).toBe(campaignStateHash(first));
    expect(second.recovery.lastLoss).toEqual(first.recovery.lastLoss);

    // Saving and loading in the middle of the fight changes nothing.
    const interrupted = sortie(seed, (state) => roundTrip(state));
    expect(campaignStateHash(interrupted)).toBe(campaignStateHash(first));

    expect(validateCampaign(first, content)).toEqual([]);
  }, 30_000);
});
