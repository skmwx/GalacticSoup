import { describe, expect, it } from 'vitest';

import {
  activateModule,
  advanceLoss,
  beginLock,
  WRECK_EXPIRE_BOUNDARY,
} from '@engine/simulation';
import {
  attributeValue,
  campaignStateHash,
  deriveShipAttributes,
  inventoryService,
  isFlightReady,
  playerWrecks,
  shipFit,
  stacksIn,
  starterReferenceValue,
  undockRefusal,
  validateCampaign,
  type CampaignState,
  type EntityId,
} from '@engine/domain';
import { runCommand } from '@engine/application';
import { lossReportProjection } from '@engine/projections';
import type { HullId } from '@shared';

import { shippedContent } from '../../support/content.ts';
import { BASE_SITE_ID, SCOUT_ENCOUNTER_ID, SCOUT_SITE_ID } from '../../support/encounter.ts';
import {
  advanceDraft,
  AUTOCANNON,
  breakHull,
  buy,
  command,
  destroyPlayer,
  FUSION,
  HARBOUR,
  inSite,
  insureEnhanced,
  newCampaign,
  settleInstant,
  SHIELD_BOOSTER,
  STARTER_HULL,
  stateOf,
  withCredits,
  type LossFixture,
} from '../../support/loss.ts';

/**
 * The player's own destruction as one transaction
 * (Functional Specification 9.12, 22.1, 22.3; Technical Specification 9.2,
 * 10.3, 10.9, 15.3).
 *
 * Each case puts the active ship in a site, breaks its hull and settles the
 * instant the way the clock does, then reads what the transaction left: the
 * wreck, the pilot at the recovery station, the insurance paid, the recovery
 * outcome and the frozen report - and that every invariant still holds.
 */

const content = shippedContent();
const REFERENCE = starterReferenceValue(content);
const STARTING_CREDITS = content.rules.economy.startingCredits;
const BASIC_PAYOUT = Math.floor(REFERENCE * content.rules.economy.basicInsurancePayoutFraction);
const ENHANCED_PAYOUT = Math.floor(REFERENCE * content.rules.economy.enhancedInsurancePayoutFraction);

function valid(fixture: LossFixture | CampaignState): void {
  const state = 'draft' in fixture ? stateOf(fixture) : fixture;
  expect(validateCampaign(state, content)).toEqual([]);
}

function lastLoss(fixture: LossFixture) {
  const loss = fixture.draft.recovery.lastLoss;
  if (loss === null) throw new Error('No loss was recorded.');
  return loss;
}

function opponentOf(fixture: LossFixture): string {
  const shipId = fixture.draft.encounter.active?.npcs[0]?.shipId;
  if (shipId === undefined) throw new Error('The site spawned no opponent.');
  return shipId;
}

function hangarId(state: CampaignState): string {
  const hangar = Object.values(state.assets.inventories).find(
    (inventory) => inventory.location.kind === 'hangar' && inventory.location.stationId === HARBOUR,
  );
  if (hangar === undefined) throw new Error('No hangar.');
  return hangar.id;
}

/** Moves some of the hangar's rounds into the active ship's hold. */
function loadHold(state: CampaignState, rounds: number): CampaignState {
  const shipId = state.assets.activeShipId;
  const ship = shipId === null ? undefined : state.assets.ships[shipId];
  const source = stacksIn(state.assets, hangarId(state)).find((stack) => stack.definitionId === FUSION);
  if (ship === undefined || source === undefined) throw new Error('Nothing to load.');
  return command(state, 'inventory.transfer', {
    stackId: source.id,
    destinationInventoryId: ship.cargoInventoryId,
    quantity: rounds,
  }).state;
}

describe('the destruction trigger', () => {
  it('resolves only the player\'s own destroyed ship in a site, and only once [FUNC-9.12, TECH-9.2, TECH-10.9]', () => {
    const fixture = inSite(newCampaign());
    const opponent = opponentOf(fixture);

    // An intact ship is not a loss.
    const intact = campaignStateHash(stateOf(fixture));
    advanceLoss(fixture.context, 0, 0);
    expect(campaignStateHash(stateOf(fixture))).toBe(intact);

    // An opponent's destruction is the encounter's business.
    breakHull(fixture, opponent);
    settleInstant(fixture);
    expect(fixture.draft.recovery.losses).toBe(0);
    expect(fixture.draft.recovery.lastLoss).toBeNull();
    expect(fixture.draft.assets.activeShipId).toBe(fixture.playerId);
    expect(fixture.draft.encounter.active?.status).toBe('completed');

    destroyPlayer(fixture);
    const loss = lastLoss(fixture);
    expect(fixture.draft.recovery.losses).toBe(1);
    expect(loss.shipId).toBe(fixture.playerId);

    // Settling the instant again, or letting time run, never repeats it.
    settleInstant(fixture);
    advanceDraft(fixture.draft, fixture.context, 5_000, content);
    expect(fixture.draft.recovery.losses).toBe(1);
    expect(lastLoss(fixture).lossId).toBe(loss.lossId);
    expect(fixture.context.events.filter((event) => event.kind === 'recovery.shipLost')).toHaveLength(1);
    expect(fixture.context.events.filter((event) => event.kind === 'recovery.insurancePaid')).toHaveLength(1);
    valid(fixture);
  });

  it('removes the ship, its hold, its fitting, its reservations, its runtime and its scheduled work [FUNC-9.12, TECH-8.3, TECH-10.9]', () => {
    const fixture = inSite(loadHold(newCampaign(), 30));
    const opponent = opponentOf(fixture);
    const ship = fixture.draft.assets.ships[fixture.playerId];
    if (ship === undefined) throw new Error('No ship.');
    const cargoRounds = stacksIn(fixture.draft.assets, ship.cargoInventoryId)[0];
    if (cargoRounds === undefined) throw new Error('Nothing in the hold.');
    const reserveId = inventoryService(fixture.draft, content).reserve(cargoRounds.id, 5, fixture.playerId);
    // Work the ship has scheduled: a lock in progress and a booster cycle.
    expect(beginLock(fixture.context, fixture.playerId, opponent)).toBe(true);
    expect(activateModule(fixture.context, fixture.playerId, { kind: 'system', index: 0 })).toBe(true);
    expect(fixture.draft.scheduler.entries.some((entry) => entry.ownerId === fixture.playerId)).toBe(true);
    const stores = [ship.cargoInventoryId, ship.fittingInventoryId, reserveId];

    destroyPlayer(fixture);

    const assets = fixture.draft.assets;
    expect(assets.ships[fixture.playerId]).toBeUndefined();
    for (const inventoryId of stores) {
      expect(assets.inventories[inventoryId]).toBeUndefined();
      expect(stacksIn(assets, inventoryId)).toEqual([]);
    }
    expect(fixture.draft.combat.ships[fixture.playerId]).toBeUndefined();
    expect(fixture.draft.scheduler.entries.filter((entry) => entry.ownerId === fixture.playerId)).toEqual([]);
    // The site the pilot occupied is gone with them.
    expect(fixture.draft.navigation.currentSite).toBeNull();
    expect(fixture.draft.navigation.travel).toBeNull();
    expect(fixture.draft.navigation.movementOrders).toEqual({});
    expect(fixture.draft.fitting).toBeNull();
    // The reserved rounds shared the hold's fate.
    expect(lastLoss(fixture).items.filter((item) => item.origin === 'cargo')
      .reduce((sum, item) => sum + item.quantity, 0)).toBe(30);
    valid(fixture);
  });
});

describe('recovery location and the encounter left behind', () => {
  it('docks the pilot at the most recently docked station with the attempt lost [FUNC-9.12, FUNC-9.11, FUNC-22.7]', () => {
    const fixture = inSite(newCampaign());
    const opponents = fixture.draft.encounter.active?.npcs.map((npc) => npc.shipId) ?? [];
    expect(opponents.length).toBeGreaterThan(0);

    destroyPlayer(fixture);

    const station = content.requireStation(HARBOUR);
    expect(fixture.draft.assets.location).toEqual({ kind: 'station', stationId: HARBOUR, systemId: station.systemId });
    expect(fixture.draft.assets.lastDockedStationId).toBe(HARBOUR);
    expect(lastLoss(fixture).recoveryStationId).toBe(HARBOUR);
    expect(lastLoss(fixture).encounterId).toBe(SCOUT_ENCOUNTER_ID);
    // Hostile ships do not follow the pilot home.
    expect(fixture.draft.encounter.active).toBeNull();
    for (const shipId of opponents) expect(fixture.draft.assets.ships[shipId]).toBeUndefined();
    expect(fixture.draft.encounter.lastOutcome).toMatchObject({
      encounterId: SCOUT_ENCOUNTER_ID,
      status: 'lost',
      bountyCreditsPaid: 0,
      npcsDestroyed: 0,
    });
    expect(fixture.draft.encounter.completions[SCOUT_ENCOUNTER_ID]).toBeUndefined();
    valid(fixture);
  });

  it('keeps an encounter won in the same instant completed and its bounty paid [FUNC-9.11, FUNC-9.12, TECH-9.2]', () => {
    const fixture = inSite(newCampaign());
    const opponent = opponentOf(fixture);
    const profileId = fixture.draft.encounter.active?.npcs[0]?.profileId ?? '';
    const bounty = content.requireNpcProfile(profileId as never).bountyCredits;

    breakHull(fixture, opponent);
    breakHull(fixture);
    settleInstant(fixture);

    expect(fixture.draft.encounter.lastOutcome).toMatchObject({
      encounterId: SCOUT_ENCOUNTER_ID,
      status: 'completed',
      bountyCreditsPaid: bounty,
      npcsDestroyed: 1,
    });
    expect(fixture.draft.encounter.completions[SCOUT_ENCOUNTER_ID]).toBe(1);
    expect(fixture.draft.assets.credits).toBe(STARTING_CREDITS + bounty + BASIC_PAYOUT);
    const owners = Object.values(fixture.draft.encounter.wrecks).map((wreck) => wreck.owner).sort();
    expect(owners).toEqual(['npc', 'player']);
    const kinds = fixture.context.events.map((event) => event.kind);
    expect(kinds.indexOf('encounter.completed')).toBeLessThan(kinds.indexOf('recovery.shipLost'));
    expect(kinds).not.toContain('encounter.abandoned');
    valid(fixture);
  });
});

describe('the player wreck', () => {
  it('lies where the ship was lost and lasts the authored two hours [FUNC-5.4, FUNC-9.12]', () => {
    const fixture = inSite(newCampaign(), { playerPositionKm: { x: 6, y: -4 } });
    const now = fixture.draft.time.simulationTimeMs;
    const hull = content.requireHull(STARTER_HULL as HullId);

    destroyPlayer(fixture);

    const wrecks = playerWrecks(stateOf(fixture));
    expect(wrecks).toHaveLength(1);
    const wreck = wrecks[0]!;
    expect(wreck).toMatchObject({
      owner: 'player',
      siteId: SCOUT_SITE_ID,
      systemId: 'system.borrell',
      hullId: hull.id,
      nameKey: hull.nameKey,
      position: { x: 6, y: -4 },
      createdAtMs: now,
    });
    expect(content.rules.combat.playerWreckLifetimeSeconds).toBe(7_200);
    expect(wreck.expiresAtMs - wreck.createdAtMs).toBe(content.rules.combat.playerWreckLifetimeSeconds * 1000);
    const boundary = fixture.draft.scheduler.entries.find((entry) => entry.entryId === wreck.boundaryEntryId);
    expect(boundary).toMatchObject({ kind: WRECK_EXPIRE_BOUNDARY, ownerId: wreck.id, dueAtMs: wreck.expiresAtMs });
    expect(fixture.draft.assets.inventories[wreck.inventoryId]?.location).toEqual({ kind: 'wreck', wreckId: wreck.id });
    expect(lastLoss(fixture)).toMatchObject({ wreckId: wreck.id, wreckExpiresAtMs: wreck.expiresAtMs, siteId: SCOUT_SITE_ID });

    const report = lossReportProjection(stateOf(fixture), content).report;
    expect(report?.wreck).toMatchObject({
      wreckId: wreck.id,
      present: true,
      remainingSeconds: 7_200,
      itemCount: stacksIn(fixture.draft.assets, wreck.inventoryId).length,
    });
    valid(fixture);
  });

  it('never keeps the loaded magazine [FUNC-9.12]', () => {
    for (const seed of ['0123456789abcdef0123456789abcdef', 'fedcba9876543210fedcba9876543210',
      'bb22cc33dd44ee55ff6677889900aa11', 'aa22cc33dd44ee55ff6677889900aa11']) {
      const fixture = inSite(newCampaign(seed), { spawn: false });
      destroyPlayer(fixture);
      const loaded = lastLoss(fixture).items.filter((item) => item.origin === 'loaded');
      expect(loaded).toEqual([
        { definitionId: FUSION, quantity: 20, origin: 'loaded', survived: false, recoveryGrant: false },
      ]);
      const wreck = playerWrecks(stateOf(fixture))[0]!;
      expect(stacksIn(fixture.draft.assets, wreck.inventoryId).some((stack) => stack.definitionId === FUSION)).toBe(false);
    }
  });
});

describe('insurance settlement', () => {
  it('pays basic cover at 30% of the hull reference value [FUNC-9.12, FUNC-4.1]', () => {
    const fixture = inSite(newCampaign());
    destroyPlayer(fixture);

    expect(lastLoss(fixture).insurance).toEqual({
      coverage: 'basic',
      hullReferenceValueCredits: REFERENCE,
      payoutFraction: 0.3,
      payoutCredits: 3_600,
      enhancedConsumed: false,
      recoveryGrantHull: false,
    });
    expect(fixture.draft.assets.credits).toBe(STARTING_CREDITS + BASIC_PAYOUT);
    expect(fixture.context.events.find((event) => event.kind === 'recovery.insurancePaid')?.params)
      .toEqual({ coverage: 'basic', credits: 3_600 });
    const trace = lossReportProjection(stateOf(fixture), content).report?.insurance.trace;
    expect(trace?.formulaKey).toBe('insurance.payout');
    valid(fixture);
  });

  it('pays enhanced cover at 70% and spends it on that loss [FUNC-9.12]', () => {
    const insured = insureEnhanced(newCampaign()).state;
    const premium = Math.ceil(REFERENCE * content.rules.economy.enhancedInsurancePremiumFraction);
    expect(insured.assets.credits).toBe(STARTING_CREDITS - premium);
    const fixture = inSite(insured);

    destroyPlayer(fixture);

    expect(lastLoss(fixture).insurance).toMatchObject({
      coverage: 'enhanced',
      payoutFraction: 0.7,
      payoutCredits: ENHANCED_PAYOUT,
      enhancedConsumed: true,
      recoveryGrantHull: false,
    });
    expect(ENHANCED_PAYOUT).toBe(8_400);
    expect(fixture.draft.assets.credits).toBe(STARTING_CREDITS - premium + ENHANCED_PAYOUT);
    // The cover went with the hull: the next hull starts on free basic cover.
    const rebought = buy(stateOf(fixture), STARTER_HULL, 1).state;
    const next = rebought.assets.ships[rebought.assets.activeShipId ?? ''];
    expect(next?.insurance).toEqual({ coverage: 'basic', premiumPaidCredits: 0 });
    valid(rebought);
  });
});

describe('recovery outcomes', () => {
  it('leaves a pilot who can afford the starter hull docked and shipless [FUNC-9.12, FUNC-22.1]', () => {
    const fixture = inSite(newCampaign());
    destroyPlayer(fixture);

    expect(lastLoss(fixture).recovery).toEqual({
      outcome: 'noShip',
      activeShipId: null,
      creditsAfter: 23_600,
      starterReferenceValueCredits: REFERENCE,
    });
    expect(fixture.draft.assets.activeShipId).toBeNull();
    expect(Object.values(fixture.draft.assets.ships).filter((ship) => ship.owner === 'player')).toEqual([]);
    expect(fixture.context.events.map((event) => event.kind)).not.toContain('recovery.shipGranted');
    // Nothing can be flown until another hull is bought.
    expect(undockRefusal({ state: stateOf(fixture), content })).toBe('noActiveShip');
    valid(fixture);
  });

  it('flies a ship already waiting at the station rather than granting one [FUNC-9.12]', () => {
    const bought = buy(newCampaign(), STARTER_HULL, 1).state;
    const waitingId = Object.keys(bought.assets.ships).find((id) => id !== bought.assets.activeShipId) as EntityId;
    expect(bought.assets.credits).toBeLessThan(REFERENCE - BASIC_PAYOUT);
    const fixture = inSite(bought);

    destroyPlayer(fixture);

    expect(lastLoss(fixture).recovery).toMatchObject({ outcome: 'otherShip', activeShipId: waitingId });
    expect(fixture.draft.assets.activeShipId).toBe(waitingId);
    // Below the reference value, but a flight-ready ship is owned: no grant.
    expect(fixture.draft.assets.credits).toBeLessThan(REFERENCE);
    expect(fixture.draft.assets.ships[waitingId]?.recoveryGrant).toBe(false);
    const kinds = fixture.context.events.map((event) => event.kind);
    expect(kinds).toContain('recovery.activeShipChanged');
    expect(kinds).not.toContain('recovery.shipGranted');
    valid(fixture);
  });

  it('grants the starter hull in its original fit with a full magazine, every unit marked [FUNC-9.12, FUNC-22.1, TECH-8.3]', () => {
    const fixture = inSite(withCredits(newCampaign(), 1_000));
    destroyPlayer(fixture);

    const loss = lastLoss(fixture);
    expect(loss.recovery.outcome).toBe('granted');
    expect(loss.recovery.creditsAfter).toBe(1_000 + BASIC_PAYOUT);
    const grantedId = fixture.draft.assets.activeShipId;
    expect(grantedId).not.toBeNull();
    expect(loss.recovery.activeShipId).toBe(grantedId);
    const ship = fixture.draft.assets.ships[grantedId ?? '']!;
    const hull = content.requireHull(STARTER_HULL as HullId);
    expect(ship).toMatchObject({
      owner: 'player',
      hullId: STARTER_HULL,
      recoveryGrant: true,
      insurance: { coverage: 'basic', premiumPaidCredits: 0 },
      location: { kind: 'station', stationId: HARBOUR },
    });
    expect(ship.condition.damage).toEqual({ shield: 0, armor: 0, hull: 0 });
    const derived = deriveShipAttributes({ hull, fit: shipFit(fixture.draft.assets, ship.id), content });
    expect(ship.condition.capacitorCharge).toBe(attributeValue(derived, 'capacitorCapacity'));

    // The original basic fit, each weapon with a full magazine.
    const fit = shipFit(fixture.draft.assets, ship.id).map((fitted) => ({
      slot: fitted.slot.kind,
      index: fitted.slot.index,
      moduleId: fitted.moduleId,
      online: fitted.online,
      charge: fitted.charge === null ? null : { ammunitionId: fitted.charge.ammunitionId, quantity: fitted.charge.quantity },
    })).sort((a, b) => a.slot.localeCompare(b.slot));
    const expected = content.rules.economy.startingFit.map((entry) => {
      const module = content.requireModule(entry.moduleId as never);
      return {
        slot: entry.slot,
        index: entry.index,
        moduleId: entry.moduleId,
        online: entry.online,
        charge: entry.ammunitionId === undefined || module.category !== 'turret'
          ? null
          : { ammunitionId: entry.ammunitionId, quantity: module.turret.magazineSize },
      };
    }).sort((a, b) => a.slot.localeCompare(b.slot));
    expect(fit).toEqual(expected);
    expect(fit.find((entry) => entry.moduleId === AUTOCANNON)?.charge?.quantity).toBe(20);

    // Every unit of it is a recovery grant, with no purchase in its history.
    const stacks = stacksIn(fixture.draft.assets, ship.fittingInventoryId);
    expect(stacks.length).toBe(3);
    for (const stack of stacks) {
      expect(stack.recoveryGrant).toBe(true);
      expect(stack.provenance).toEqual({ grantedQuantity: stack.quantity, purchasedQuantity: 0, purchaseCostCredits: 0 });
    }
    expect(stacksIn(fixture.draft.assets, ship.cargoInventoryId)).toEqual([]);
    expect(fixture.draft.assets.inventories[ship.cargoInventoryId]?.capacity)
      .toEqual({ kind: 'limited', volumeCubicDecimetres: hull.cargoCapacityCubicDecimetres });

    // It can leave at once.
    expect(isFlightReady(fixture.draft.assets, content, ship)).toBe(true);
    expect(undockRefusal({ state: stateOf(fixture), content })).toBeNull();
    expect(fixture.context.events.find((event) => event.kind === 'recovery.shipGranted')?.params)
      .toEqual({ shipId: ship.id, stationId: HARBOUR });
    valid(fixture);
  });

  it('grants again when a granted ship is lost, which pays no insurance [FUNC-9.12]', () => {
    const first = inSite(withCredits(newCampaign(), 1_000));
    destroyPlayer(first);
    const firstGrant = first.draft.assets.activeShipId;
    const second = inSite(stateOf(first), { siteId: BASE_SITE_ID });

    destroyPlayer(second);

    const loss = lastLoss(second);
    expect(second.draft.recovery.losses).toBe(2);
    expect(loss.shipId).toBe(firstGrant);
    expect(loss.insurance).toMatchObject({ payoutCredits: 0, recoveryGrantHull: true, coverage: 'basic' });
    expect(loss.items.every((item) => item.recoveryGrant)).toBe(true);
    expect(loss.recovery).toMatchObject({ outcome: 'granted', creditsAfter: 1_000 + BASIC_PAYOUT });
    const regranted = second.draft.assets.activeShipId;
    expect(regranted).not.toBeNull();
    expect(regranted).not.toBe(firstGrant);
    expect(second.draft.assets.ships[regranted ?? '']?.recoveryGrant).toBe(true);
    expect(second.context.events.find((event) => event.kind === 'recovery.insurancePaid')?.params)
      .toEqual({ coverage: 'basic', credits: 0 });
    expect(lossReportProjection(stateOf(second), content).report?.insurance.trace.formulaKey)
      .toBe('insurance.payoutRecoveryGrant');
    // Both wrecks remain bookmarks until they expire.
    expect(playerWrecks(stateOf(second))).toHaveLength(2);
    valid(second);
  });
});

describe('the loss report', () => {
  it('freezes who hit the ship, by layer, and the burst that ended it [FUNC-9.12, TECH-10.3]', () => {
    const fixture = inSite(newCampaign(), { siteId: BASE_SITE_ID });
    const hull = content.requireHull(STARTER_HULL as HullId);
    const profiles = new Map<string, string>(
      fixture.draft.encounter.active?.npcs.map((npc) => [npc.shipId, npc.profileId]),
    );
    let elapsed = 0;
    while (fixture.draft.assets.location.kind === 'site' && elapsed < 300_000) {
      advanceDraft(fixture.draft, fixture.context, 1_000, content);
      elapsed += 1_000;
    }
    const loss = lastLoss(fixture);

    expect(loss.incoming.length).toBeGreaterThan(0);
    let previousFirst = 0;
    let hullTaken = 0;
    for (const source of loss.incoming) {
      const profileId = profiles.get(source.sourceId);
      expect(profileId).toBeDefined();
      expect(source.nameKey).toBe(content.requireNpcProfile(profileId as never).nameKey);
      expect(source.firstAtMs).toBeGreaterThanOrEqual(previousFirst);
      expect(source.lastAtMs).toBeLessThanOrEqual(loss.destroyedAtMs);
      previousFirst = source.firstAtMs;
      const applied = Object.values(source.appliedDamage).reduce((sum, value) => sum + value, 0);
      const layered = source.layerDamage.shield + source.layerDamage.armor + source.layerDamage.hull;
      expect(layered).toBeCloseTo(applied, 6);
      hullTaken += source.layerDamage.hull;
    }
    // Every hull point the ship had came off through the recorded fire. The
    // stored damage is rounded to a millionth at each hit, so the recorded
    // totals agree with it only to within that rounding per hit.
    expect(hullTaken).toBeCloseTo(hull.defenses.hull.hitPoints, 4);

    const final = loss.finalDamage;
    expect(final).not.toBeNull();
    expect(final?.atMs).toBe(loss.destroyedAtMs);
    expect(loss.incoming.map((source) => source.sourceId)).toContain(final?.sourceId);
    // The burst that broke the hull, not a shot that landed on an empty one.
    expect(Object.values(final?.appliedDamage ?? {}).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);

    expect(loss.items.map((item) => [item.definitionId, item.origin])).toEqual([
      [AUTOCANNON, 'fitted'],
      [FUSION, 'loaded'],
      [SHIELD_BOOSTER, 'fitted'],
    ]);
    valid(fixture);
  }, 20_000);

  it('names what had stopped working: an empty weapon and a flat capacitor [FUNC-9.12]', () => {
    const fixture = inSite(newCampaign(), { spawn: false });
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    const magazine = stacksIn(fixture.draft.assets, ship.fittingInventoryId).find((stack) => stack.state.kind === 'charge');
    inventoryService(fixture.draft, content).remove(magazine?.id ?? '', magazine?.quantity ?? 0);
    fixture.draft.assets.ships[fixture.playerId]!.condition.capacitorCharge = 0;

    destroyPlayer(fixture);

    const byKind = (a: { kind: string }, b: { kind: string }) => a.kind.localeCompare(b.kind);
    expect([...lastLoss(fixture).disablingEffects].sort(byKind)).toEqual([
      { kind: 'ammunitionExhausted', slot: { kind: 'weapon', index: 0 }, moduleId: AUTOCANNON },
      { kind: 'capacitorDepleted', slot: { kind: 'system', index: 0 }, moduleId: SHIELD_BOOSTER },
    ]);
    expect(lastLoss(fixture).items.map((item) => item.origin)).toEqual(['fitted', 'fitted']);
    valid(fixture);
  });

  it('records a weapon with rounds in the hold as still able to reload [FUNC-9.12]', () => {
    const fixture = inSite(loadHold(newCampaign(), 10), { spawn: false });
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    const magazine = stacksIn(fixture.draft.assets, ship.fittingInventoryId).find((stack) => stack.state.kind === 'charge');
    inventoryService(fixture.draft, content).remove(magazine?.id ?? '', magazine?.quantity ?? 0);

    destroyPlayer(fixture);

    expect(lastLoss(fixture).disablingEffects).toEqual([]);
    expect(lastLoss(fixture).items.filter((item) => item.origin === 'cargo')).toEqual([
      expect.objectContaining({ definitionId: FUSION, quantity: 10 }),
    ]);
  });
});

describe('commit, autosave and events', () => {
  it('commits as one transaction that asks for an autosave and publishes the loss [FUNC-9.12, FUNC-3.4, TECH-7.2, TECH-10.9]', () => {
    const fixture = inSite(withCredits(newCampaign(), 1_000), { spawn: false });
    breakHull(fixture);
    fixture.draft.time.paused = false;
    const before = stateOf(fixture);

    const result = runCommand({ campaign: before, content, type: 'time.advance', payload: { elapsedRealMs: 50 } });

    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed' || result.campaign === null) return;
    const after = result.campaign;
    expect(result.autosaveRequested).toBe(true);
    const kinds = result.data.events.map((event) => event.kind);
    const order = ['combat.shipDestroyed', 'recovery.shipLost', 'recovery.insurancePaid', 'recovery.shipGranted'];
    expect(order.map((kind) => kinds.indexOf(kind))).toEqual([...order.map((kind) => kinds.indexOf(kind))].sort((a, b) => a - b));
    expect(order.every((kind) => kinds.includes(kind))).toBe(true);
    const loss = after.recovery.lastLoss!;
    const shipLost = result.data.events.find((event) => event.kind === 'recovery.shipLost');
    expect(shipLost?.params).toEqual({
      shipId: loss.shipId,
      wreckId: loss.wreckId,
      siteId: SCOUT_SITE_ID,
      survivors: loss.items.filter((item) => item.survived).length,
      lost: loss.items.filter((item) => !item.survived).length,
    });
    for (const topic of ['loss', 'assets', 'wallet', 'navigation', 'destinations', 'station', 'insurance']) {
      expect(result.data.invalidations).toContain(topic);
    }
    expect(after.revision).toBe(before.revision + 1);
    valid(after);

    // At draft level the same transaction asks the context for the snapshot.
    const direct = inSite(withCredits(newCampaign(), 1_000), { spawn: false });
    destroyPlayer(direct);
    expect(direct.context.autosaves).toBe(1);
  });

  it('reports no loss before the first one [FUNC-9.12]', () => {
    const report = lossReportProjection(newCampaign(), content);
    expect(report).toMatchObject({ losses: 0, report: null });
  });

  it('carries the recovery-grant mark into the loss record of a survivor [FUNC-9.12, TECH-8.3]', () => {
    const first = inSite(withCredits(newCampaign(), 1_000), { spawn: false });
    destroyPlayer(first);
    const second = inSite(stateOf(first), { spawn: false });
    destroyPlayer(second);
    const wreck = playerWrecks(stateOf(second)).find((entry) => entry.id === lastLoss(second).wreckId)!;
    for (const stack of stacksIn(second.draft.assets, wreck.inventoryId)) {
      expect(stack.recoveryGrant).toBe(true);
      expect(stack.state.kind).toBe('plain');
    }
    expect(lastLoss(second).items.filter((item) => item.survived).length)
      .toBe(stacksIn(second.draft.assets, wreck.inventoryId).length);
  });
});
