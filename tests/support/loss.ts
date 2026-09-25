import { createContentRepository, parseContentBundle } from '@adapters/content';
import {
  attributeValue,
  combatantOf,
  createCampaign,
  draftOf,
  instantiateSite,
  setMovementOrder,
  type CampaignDraft,
  type CampaignState,
  type EntityId,
  type SiteLocation,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import { INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS, runCommand } from '@engine/application';
import {
  advanceCombat,
  advanceEncounter,
  advanceLoss,
  advanceTime,
  instantiateEncounter,
  materializeWrecks,
} from '@engine/simulation';
import { insurancePreview, marketBuyPreview } from '@engine/projections';
import type { CommandResultData, CommandType, EngineError } from '@protocol';
import type { SiteId, StationId } from '@shared';

import { readContentFiles } from '../../scripts/lib/content/read.mjs';

import { TEST_SEED, testSimulation, type TestSimulation } from './campaign.ts';
import { shippedContent } from './content.ts';
import { compilePack, editDocument, type ContentFile } from './contentFixtures.ts';
import { SCOUT_SITE_ID } from './encounter.ts';

/**
 * Fixtures for the player's own destruction and the recovery that follows
 * (Functional Specification 9.12; Technical Specification 10.9).
 *
 * A loss needs a campaign in a particular shape - a pilot short of money, a
 * second hull waiting at the station, enhanced cover bought - and then a ship
 * in a site whose hull gives out. The shape is reached through the real
 * commands wherever a command exists, and the ship is placed in its site the
 * way an arriving warp leaves it, so each test starts one step before the
 * destruction transaction it exercises.
 */

export const HARBOUR = 'station.borrell.harbour' as StationId;
export const ANNEX = 'station.borrell.annex' as StationId;
export const ANNEX_SITE_ID = 'site.borrell.annex' as SiteId;
export const STARTER_HULL = 'hull.independent.starter';
export const AUTOCANNON = 'module.turret.autocannon.small';
export const SHIELD_BOOSTER = 'module.shield.booster.small';
export const FUSION = 'ammo.projectile.small.fusion';
export const PHASED = 'ammo.projectile.small.phased';

/** A simulation context that also counts the autosaves it was asked for. */
export interface LossContext extends TestSimulation {
  autosaves: number;
}

export function lossContext(draft: CampaignDraft, content: ContentRepository): LossContext {
  const base = testSimulation(draft, content);
  const context: LossContext = {
    ...base,
    autosaves: 0,
    requestAutosave(): void {
      context.autosaves += 1;
    },
  };
  return context;
}

export interface LossFixture {
  readonly draft: CampaignDraft;
  readonly content: ContentRepository;
  readonly context: LossContext;
  readonly playerId: EntityId;
}

export interface SiteOptions {
  readonly siteId?: SiteId;
  readonly playerPositionKm?: { readonly x: number; readonly y: number };
  /** Skip the authored encounter, to test a loss with nobody else present. */
  readonly spawn?: boolean;
  readonly content?: ContentRepository;
}

/** A new campaign, docked at the starting station, as `campaign.create` makes it. */
export function newCampaign(seed: string = TEST_SEED, content: ContentRepository = shippedContent()): CampaignState {
  const base = createCampaign({
    displayName: 'Test Pilot',
    seed,
    createdAtRealMs: 1_700_000_000_000,
    initialRate: 1,
  }, content);
  return { ...base, revision: 1 };
}

/**
 * Puts the active ship of a docked campaign into a site exactly as an
 * arriving warp leaves it: site loaded, wrecks materialized and the authored
 * encounter spawned.
 */
export function inSite(state: CampaignState, options: SiteOptions = {}): LossFixture {
  const content = options.content ?? shippedContent();
  const draft = draftOf(state);
  const playerId = draft.assets.activeShipId;
  if (playerId === null) throw new Error('The campaign has no active ship to put in a site.');
  const player = draft.assets.ships[playerId];
  if (player === undefined) throw new Error('The active ship does not exist.');

  const station = content.requireStation(draft.assets.lastDockedStationId);
  const siteId = options.siteId ?? SCOUT_SITE_ID;
  const location: SiteLocation = { kind: 'site', systemId: station.systemId, siteId };
  draft.navigation.currentSite = instantiateSite(
    draft,
    content,
    siteId,
    { ...player, location },
    { ...(options.playerPositionKm ?? { x: 0, y: 0 }) },
    0,
  );
  draft.assets.location = location;
  player.location = location;
  setMovementOrder(draft, playerId, { kind: 'stop' });
  draft.assets.version += 1;

  const context = lossContext(draft, content);
  materializeWrecks(context);
  if (options.spawn !== false) instantiateEncounter(context, siteId);
  return { draft, content, context, playerId };
}

/** A fixture over a campaign whose ship is already in a site, e.g. after a real warp. */
export function fixtureOf(state: CampaignState, content: ContentRepository = shippedContent()): LossFixture {
  const draft = draftOf(state);
  const playerId = draft.assets.activeShipId;
  if (playerId === null) throw new Error('The campaign has no active ship.');
  return { draft, content, context: lossContext(draft, content), playerId };
}

/** Takes the hull of one ship in the loaded site to zero. */
export function breakHull(fixture: LossFixture, shipId: string = fixture.playerId): void {
  const combatant = combatantOf(fixture.draft, fixture.content, shipId);
  const ship = fixture.draft.assets.ships[shipId];
  if (combatant === null || ship === undefined) throw new Error(`No combatant ${shipId}.`);
  ship.condition.damage.hull = attributeValue(combatant.derived, 'hullHitPoints');
}

/**
 * Settles the current instant the way the clock's zero-length pass does after
 * a completion batch: combat finalizes destruction, the encounter settles the
 * opponents, and the loss transaction runs last.
 */
export function settleInstant(fixture: LossFixture): void {
  const now = fixture.draft.time.simulationTimeMs;
  advanceCombat(fixture.context, now, now);
  advanceEncounter(fixture.context, now, now);
  advanceLoss(fixture.context, now, now);
}

/** Breaks the player's hull and settles the instant. */
export function destroyPlayer(fixture: LossFixture): void {
  breakHull(fixture);
  settleInstant(fixture);
}

/** Advances a draft by real milliseconds at 1x with every installed system. */
export function advanceDraft(
  draft: CampaignDraft,
  context: TestSimulation,
  elapsedRealMs: number,
  content: ContentRepository,
): void {
  draft.time.paused = false;
  let remaining = elapsedRealMs;
  const cap = content.rules.time.maxFrameDeltaMs;
  while (remaining > 0) {
    const step = Math.min(remaining, cap);
    advanceTime(context, step, INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS);
    remaining -= step;
  }
}

/** The state a fixture's draft stands for. */
export function stateOf(fixture: LossFixture | CampaignDraft): CampaignState {
  return ('draft' in fixture ? fixture.draft : fixture) as unknown as CampaignState;
}

export interface Committed {
  readonly state: CampaignState;
  readonly data: CommandResultData;
}

/** Runs one command through the real pipeline; a refusal fails the test. */
export function command(
  state: CampaignState,
  type: CommandType,
  payload: unknown,
  content: ContentRepository = shippedContent(),
): Committed {
  const result = runCommand({ campaign: state, content, type, payload });
  if (result.kind === 'failed') {
    throw new Error(`${type} failed: ${result.error.messageKey} ${JSON.stringify(result.error)}`);
  }
  if (result.kind === 'unchanged') return { state, data: result.data };
  if (result.campaign === null) throw new Error(`${type} closed the campaign.`);
  return { state: result.campaign, data: result.data };
}

/** The error a refused command answers with, or `null` when it did not fail. */
export function refusal(
  state: CampaignState,
  type: CommandType,
  payload: unknown,
  content: ContentRepository = shippedContent(),
): EngineError | null {
  const result = runCommand({ campaign: state, content, type, payload });
  return result.kind === 'failed' ? result.error : null;
}

/** The rule-violation reason of an engine error, e.g. `bookmarkUnknown`. */
export function reasonOf(error: EngineError | null): string | null {
  if (error === null) return null;
  return error.messageKey.replace(/^error\.ruleViolation\./, '');
}

/** Buys through the market preview and confirmation, as the station does. */
export function buy(
  state: CampaignState,
  itemId: string,
  quantity: number,
  content: ContentRepository = shippedContent(),
  stationId: string = HARBOUR,
): Committed {
  const preview = marketBuyPreview(state, content, { stationId, itemId, quantity });
  if (!preview.available || preview.token === null) {
    throw new Error(`Cannot buy ${String(quantity)} ${itemId}: ${String(preview.unavailableReason)}`);
  }
  return command(state, 'market.confirmBuy', { token: preview.token }, content);
}

/** Buys enhanced cover for the active ship. */
export function insureEnhanced(state: CampaignState, content: ContentRepository = shippedContent()): Committed {
  const shipId = state.assets.activeShipId;
  if (shipId === null) throw new Error('No active ship to insure.');
  const preview = insurancePreview(state, content, { shipId });
  if (!preview.available || preview.token === null) {
    throw new Error(`Cannot insure: ${String(preview.unavailableReason)}`);
  }
  return command(state, 'insurance.confirm', { token: preview.token }, content);
}

/** Sets the wallet directly, for a pilot the scenario needs short of money. */
export function withCredits(state: CampaignState, credits: number): CampaignState {
  const draft = draftOf(state);
  draft.assets.credits = credits;
  draft.assets.version += 1;
  return draft as unknown as CampaignState;
}

/**
 * The shipped content with a second neutral station on its own site, so a
 * test can tell "the most recently docked station" from "the starting one".
 * It is compiled by the same pipeline as the shipped bundle.
 */
export function twoStationContent(): ContentRepository {
  let files = readContentFiles() as ContentFile[];
  files = editDocument(files, 'universe/stations/borrell.json', (document) => {
    const definitions = document['definitions'] as Record<string, unknown>[];
    definitions.push({ ...definitions[0], id: ANNEX, siteId: ANNEX_SITE_ID });
  });
  files = editDocument(files, 'universe/systems/borrell.json', (document) => {
    const definitions = document['definitions'] as Record<string, unknown>[];
    const sites = definitions[0]?.['sites'] as Record<string, unknown>[];
    sites.push({ ...sites[0], id: ANNEX_SITE_ID, position: { xKm: 30_000, yKm: 20_000 } });
  });
  const harbour = files.find((file) => file.path.endsWith('economy/listings/borrell-harbour.json'));
  if (harbour === undefined) throw new Error('No harbour listings.');
  const listings = JSON.parse(harbour.text) as Record<string, unknown>;
  listings['stationId'] = ANNEX;
  files = [...files, { path: 'content/economy/listings/borrell-annex.json', text: JSON.stringify(listings) }];
  const result = compilePack(files);
  if (!result.ok || result.bundle === null) {
    throw new Error(`Two-station content did not compile: ${result.issues.map((issue) => issue.detail).join('; ')}`);
  }
  return createContentRepository(parseContentBundle(result.bundle), { freeze: true });
}
