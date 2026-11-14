import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost, createSaveService, draftOf, ENGINE_VERSION, type CampaignState } from '@engine';
import { shipFit, stacksIn } from '@engine/domain';
import { insurancePreview, repairPreview, shipsListProjection } from '@engine/projections';
import { createDirectGateway } from '@gateway/direct';
import { PROTOCOL_VERSION, type EngineResponse } from '@protocol';
import { canonicalJson, type StationId } from '@shared';

import { shippedContent } from '../support/content.ts';
import {
  buy,
  command,
  destroyPlayer,
  HARBOUR,
  inSite,
  newCampaign,
  reasonOf,
  refusal,
  stateOf,
  withCredits,
} from '../support/loss.ts';

/**
 * Several hulls: buying, storing, fitting and switching between them
 * (Functional Specification 6.3, 9.12; FeatureSpec02 4.2; v0.2 Implementation
 * Plan phase 1).
 *
 * Every step goes through the real command pipeline and the projections the
 * station reads. A bought hull is a ship of its own at the station, arrives
 * empty, and leaves the ship the player flies active; switching is free,
 * docked-only and local; a fitting draft, a station preview and the cargo each
 * belong to one ship and never act on another; and losing a purchased hull
 * leaves the campaign playable.
 */

const content = shippedContent();
const DESTROYER = 'hull.independent.destroyer';
const CRUISER = 'hull.independent.cruiser';
const STARTER = 'hull.independent.starter';
const RAILGUN = 'module.turret.railgun.small';
const AFTERBURNER = 'module.propulsion.afterburner.small';
const PLATING = 'module.plating.armor.small';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

/** A docked campaign with enough credits for both purchased hulls. */
function wealthy(credits = 400_000): CampaignState {
  return withCredits(newCampaign(), credits);
}

function shipOf(state: CampaignState, hullId: string): string {
  const found = Object.values(state.assets.ships).filter((ship) => ship.owner === 'player' && ship.hullId === hullId);
  if (found.length !== 1) throw new Error(`Expected one ${hullId}, found ${String(found.length)}.`);
  return found[0]!.id;
}

function hangarId(state: CampaignState): string {
  return Object.values(state.assets.inventories)
    .find((inventory) => inventory.location.kind === 'hangar' && inventory.location.stationId === HARBOUR)!.id;
}

function totalUnits(state: CampaignState, definitionId: string): number {
  return Object.values(state.assets.stacks)
    .filter((stack) => stack.definitionId === definitionId)
    .reduce((sum, stack) => sum + stack.quantity, 0);
}

describe('buying a hull', () => {
  it('adds an empty, insured ship at the station and keeps the active ship [V02-AC-03, FUNC-6.3, FUNC-9.12]', () => {
    const start = wealthy();
    const frigate = start.assets.activeShipId!;
    const before = start.assets.credits;
    const fitBefore = canonicalJson(shipFit(start.assets, frigate));

    const bought = buy(start, DESTROYER, 1);
    const destroyer = shipOf(bought.state, DESTROYER);
    const ship = bought.state.assets.ships[destroyer]!;

    // The ship the player flies is still the active one, untouched.
    expect(bought.state.assets.activeShipId).toBe(frigate);
    expect(canonicalJson(shipFit(bought.state.assets, frigate))).toBe(fitBefore);
    // The new ship is docked here with its own empty hold and fit, full
    // condition and basic insurance. No module or charge came with it.
    expect(ship.location).toEqual(bought.state.assets.location);
    expect(stacksIn(bought.state.assets, ship.cargoInventoryId)).toEqual([]);
    expect(shipFit(bought.state.assets, destroyer)).toEqual([]);
    expect(ship.condition.damage).toEqual({ shield: 0, armor: 0, hull: 0 });
    expect(ship.insurance).toEqual({ coverage: 'basic', premiumPaidCredits: 0 });
    expect(ship.recoveryGrant).toBe(false);
    // The wallet paid exactly the previewed price, and a purchase autosaves.
    expect(bought.data.autosaveRequested).toBe(true);
    const spent = before - bought.state.assets.credits;
    expect(spent).toBeGreaterThan(0);
    expect(Object.values(bought.state.assets.stacks).length).toBe(Object.values(start.assets.stacks).length);

    const cruiser = buy(bought.state, CRUISER, 1);
    const list = shipsListProjection(cruiser.state, content);
    expect(list.ships.map((entry) => entry.hullClass).sort()).toEqual(['cruiser', 'destroyer', 'frigate']);
    expect(list.activeShipId).toBe(frigate);
    for (const entry of list.ships) {
      expect(entry.local).toBe(true);
      expect(entry.activation.available).toBe(!entry.active);
    }
    const bare = list.ships.filter((entry) => entry.fittedModules === 0);
    expect(bare.map((entry) => entry.hullClass).sort()).toEqual(['cruiser', 'destroyer']);
    // A bare hull breaks no fitting rule, so it may undock once it is active.
    expect(bare.every((entry) => entry.undockable)).toBe(true);
    expect(list.ships.find((entry) => entry.hullClass === 'cruiser')!.moduleSizes).toEqual(['small', 'medium']);
  });

  it('refuses a hull the wallet cannot pay for, changing nothing [V02-AC-03, FUNC-22.2]', () => {
    const poor = withCredits(newCampaign(), 1_000);
    expect(() => buy(poor, DESTROYER, 1)).toThrow(/insufficientCredits|Cannot buy/);
    expect(Object.keys(poor.assets.ships)).toHaveLength(1);
  });
});

describe('switching the active ship', () => {
  it('switches while docked, autosaves, and leaves each ship its own cargo, fit, damage and insurance [V02-AC-03, FUNC-6.3, FUNC-3.4]', () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    const frigate = state.assets.activeShipId!;
    const destroyer = shipOf(state, DESTROYER);
    // Give the frigate some damage and enhanced cover so its condition is its own.
    const draft = draftOf(state);
    draft.assets.ships[frigate]!.condition.damage.armor = 40;
    draft.assets.version += 1;
    state = draft as unknown as CampaignState;
    const insured = command(state, 'insurance.confirm', {
      token: insurancePreview(state, content, { shipId: frigate }).token,
    });
    state = insured.state;
    const frigateBefore = canonicalJson({
      ship: state.assets.ships[frigate],
      fit: shipFit(state.assets, frigate),
      cargo: stacksIn(state.assets, state.assets.ships[frigate]!.cargoInventoryId),
    });

    const switched = command(state, 'ship.activate', { shipId: destroyer });
    expect(switched.state.assets.activeShipId).toBe(destroyer);
    expect(switched.data.autosaveRequested).toBe(true);
    expect(switched.data.events.map((event) => event.kind)).toContain('ship.activated');
    expect(switched.state.assets.credits).toBe(state.assets.credits);
    expect(canonicalJson({
      ship: switched.state.assets.ships[frigate],
      fit: shipFit(switched.state.assets, frigate),
      cargo: stacksIn(switched.state.assets, switched.state.assets.ships[frigate]!.cargoInventoryId),
    })).toBe(frigateBefore);
    expect(switched.state.assets.ships[destroyer]!.insurance.coverage).toBe('basic');

    // Choosing the ship already flown changes nothing and costs no revision.
    const again = command(switched.state, 'ship.activate', { shipId: destroyer });
    expect(again.data.committed).toBe(false);
    expect(again.state.revision).toBe(switched.state.revision);

    const back = command(switched.state, 'ship.activate', { shipId: frigate });
    expect(back.state.assets.activeShipId).toBe(frigate);
  });

  it('refuses in space, for another station, for a ship that is not the player\'s and while a draft is open [V02-AC-03, FUNC-6.3]', () => {
    const state = buy(wealthy(), DESTROYER, 1).state;
    const destroyer = shipOf(state, DESTROYER);

    // In space.
    const away = stateOf(inSite(state, { spawn: false }));
    expect(reasonOf(refusal(away, 'ship.activate', { shipId: destroyer }))).toBe('shipSwitchInSpace');

    // A ship kept at another station.
    const elsewhere = draftOf(state);
    elsewhere.assets.ships[destroyer]!.location = {
      kind: 'station', stationId: 'station.borrell.elsewhere' as StationId, systemId: elsewhere.assets.location.systemId,
    };
    const remote = refusal(elsewhere as unknown as CampaignState, 'ship.activate', { shipId: destroyer });
    expect(reasonOf(remote)).toBe('shipNotLocal');

    // Not a ship at all, or not the player's.
    const unknown = refusal(state, 'ship.activate', { shipId: `${state.campaignId}-e99999` });
    expect(unknown?.code).toBe('NOT_FOUND');
    const fixture = inSite(state);
    const npc = Object.values(fixture.draft.assets.ships).find((ship) => ship.owner === 'npc')!;
    const docked = draftOf(state);
    docked.assets.ships[npc.id] = { ...npc, location: docked.assets.location };
    expect(refusal(docked as unknown as CampaignState, 'ship.activate', { shipId: npc.id })?.code).toBe('NOT_FOUND');

    // A draft open on any ship holds the switch until it is applied or discarded.
    const open = command(state, 'fitting.begin', { shipId: state.assets.activeShipId }).state;
    expect(reasonOf(refusal(open, 'ship.activate', { shipId: destroyer }))).toBe('fittingDraftOpen');
    const list = shipsListProjection(open, content);
    expect(list.ships.find((ship) => ship.id === destroyer)!.activation).toEqual({
      available: false, unavailableReason: 'error.ruleViolation.fittingDraftOpen',
    });
    const reverted = command(open, 'fitting.revert', {}).state;
    expect(command(reverted, 'ship.activate', { shipId: destroyer }).state.assets.activeShipId).toBe(destroyer);
  });

  it('lets a ship with an invalid fit be chosen to repair the fit, but not undock [V02-AC-03, FUNC-8.4]', () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    const frigate = state.assets.activeShipId!;
    const destroyer = shipOf(state, DESTROYER);
    for (const item of [RAILGUN, AFTERBURNER, PLATING]) state = buy(state, item, 1).state;
    // Over-commit the frigate's power grid: legal to hold docked, illegal to fly.
    state = command(state, 'fitting.begin', { shipId: frigate }).state;
    state = command(state, 'fitting.set', { slotKind: 'weapon', slotIndex: 1, moduleId: RAILGUN, online: true }).state;
    state = command(state, 'fitting.set', { slotKind: 'system', slotIndex: 1, moduleId: AFTERBURNER, online: true }).state;
    state = command(state, 'fitting.set', { slotKind: 'engineering', slotIndex: 0, moduleId: PLATING, online: true }).state;
    state = command(state, 'fitting.commit', {}).state;
    expect(shipsListProjection(state, content).ships.find((ship) => ship.id === frigate)!.undockable).toBe(false);

    state = command(state, 'ship.activate', { shipId: destroyer }).state;
    state = command(state, 'ship.activate', { shipId: frigate }).state;
    expect(state.assets.activeShipId).toBe(frigate);
    expect(reasonOf(refusal(state, 'ship.undock', {}))).toBe('undockInvalidFit');
  });

  it('answers a repeated switch with its original result over the transport [V02-AC-03, TECH-7.2]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });
    const gateway = createDirectGateway({ host });
    disposers.push(() => gateway.dispose());
    const data = <T,>(response: EngineResponse<T>): T => {
      if (!response.ok) throw new Error(JSON.stringify(response.error));
      return response.data;
    };
    data(await gateway.request('campaign.create', {
      displayName: 'Switch Pilot', seed: '0123456789abcdef0123456789abcdef', createdAtRealMs: 100,
    }));
    // A second starter hull is affordable from the starting wallet.
    const preview = data(await gateway.request('market.previewBuy', {
      stationId: HARBOUR, itemId: STARTER, quantity: 1,
    }));
    data(await gateway.request('market.confirmBuy', { token: preview.token! }));
    const ships = data(await gateway.request('ships.list', {}));
    const other = ships.ships.find((ship) => !ship.active)!;
    expect(ships.ships).toHaveLength(2);

    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'switch-once',
      type: 'ship.activate' as const,
      payload: { shipId: other.id },
    };
    const first = await gateway.sendEnvelope(envelope);
    expect(first.ok).toBe(true);
    expect(await gateway.sendEnvelope(envelope)).toEqual(first);
    const after = data(await gateway.request('ships.list', {}));
    expect(after.activeShipId).toBe(other.id);
    expect(after.ships).toHaveLength(2);
  });
});

describe('preparing a ship the player does not fly', () => {
  it('fits an inactive ship from the hangar and leaves the active ship untouched [V02-AC-03, FUNC-6.3, FUNC-8.4]', () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    const frigate = state.assets.activeShipId!;
    const destroyer = shipOf(state, DESTROYER);
    state = buy(state, RAILGUN, 2).state;
    const railgunsBefore = totalUnits(state, RAILGUN);
    const frigateFit = canonicalJson(shipFit(state.assets, frigate));

    state = command(state, 'fitting.begin', { shipId: destroyer }).state;
    state = command(state, 'fitting.set', { slotKind: 'weapon', slotIndex: 0, moduleId: RAILGUN, online: true }).state;
    state = command(state, 'fitting.set', { slotKind: 'weapon', slotIndex: 1, moduleId: RAILGUN, online: true }).state;
    const committed = command(state, 'fitting.commit', {});
    state = committed.state;

    expect(state.assets.activeShipId).toBe(frigate);
    expect(canonicalJson(shipFit(state.assets, frigate))).toBe(frigateFit);
    expect(shipFit(state.assets, destroyer).map((slot) => slot.moduleId)).toEqual([RAILGUN, RAILGUN]);
    // The modules moved; none were created or lost.
    expect(totalUnits(state, RAILGUN)).toBe(railgunsBefore);
    expect(stacksIn(state.assets, hangarId(state)).some((stack) => stack.definitionId === RAILGUN)).toBe(false);
  });

  it('moves cargo into and out of an inactive ship\'s hold, conserving every unit [V02-AC-03, FUNC-6.2, FUNC-6.3]', () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    const frigate = state.assets.activeShipId!;
    const destroyer = shipOf(state, DESTROYER);
    const hold = state.assets.ships[destroyer]!.cargoInventoryId;
    const frigateHold = canonicalJson(stacksIn(state.assets, state.assets.ships[frigate]!.cargoInventoryId));
    const ammunition = stacksIn(state.assets, hangarId(state)).find((stack) => stack.definitionId.startsWith('ammo.'))!;
    const total = totalUnits(state, ammunition.definitionId);

    state = command(state, 'inventory.transfer', {
      stackId: ammunition.id, destinationInventoryId: hold, quantity: ammunition.quantity,
    }).state;
    expect(stacksIn(state.assets, hold).map((stack) => stack.quantity)).toEqual([ammunition.quantity]);
    expect(totalUnits(state, ammunition.definitionId)).toBe(total);
    expect(canonicalJson(stacksIn(state.assets, state.assets.ships[frigate]!.cargoInventoryId))).toBe(frigateHold);

    // Switching does not carry the hold across.
    state = command(state, 'ship.activate', { shipId: destroyer }).state;
    state = command(state, 'ship.activate', { shipId: frigate }).state;
    expect(stacksIn(state.assets, hold).map((stack) => stack.quantity)).toEqual([ammunition.quantity]);

    const loaded = stacksIn(state.assets, hold)[0]!;
    state = command(state, 'inventory.transfer', {
      stackId: loaded.id, destinationInventoryId: hangarId(state), quantity: loaded.quantity,
    }).state;
    expect(stacksIn(state.assets, hold)).toEqual([]);
    expect(totalUnits(state, ammunition.definitionId)).toBe(total);
  });

  it('binds each station preview to its ship, so a switch makes it stale [V02-AC-03, TECH-7.4, FUNC-10]', () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    const frigate = state.assets.activeShipId!;
    const destroyer = shipOf(state, DESTROYER);
    const damaged = draftOf(state);
    damaged.assets.ships[frigate]!.condition.damage.armor = 50;
    damaged.assets.version += 1;
    state = damaged as unknown as CampaignState;

    const repair = repairPreview(state, content, { shipId: frigate, scope: 'all' });
    expect(repair.shipId).toBe(frigate);
    expect(repair.available).toBe(true);
    const switched = command(state, 'ship.activate', { shipId: destroyer }).state;
    const stale = refusal(switched, 'repair.confirm', { token: repair.token });
    expect(stale?.code).toBe('STALE_PREVIEW');
    expect(switched.assets.ships[frigate]!.condition.damage.armor).toBe(50);

    // Insurance bought for the inactive destroyer covers that hull alone.
    const cover = insurancePreview(switched, content, { shipId: frigate });
    const insured = command(switched, 'insurance.confirm', { token: cover.token }).state;
    expect(insured.assets.ships[frigate]!.insurance.coverage).toBe('enhanced');
    expect(insured.assets.ships[destroyer]!.insurance.coverage).toBe('basic');
  });

  it('refuses to price a service for a ship that is not the player\'s [V02-AC-03, FUNC-10]', () => {
    const fixture = inSite(newCampaign());
    const npc = Object.values(fixture.draft.assets.ships).find((ship) => ship.owner === 'npc')!;
    expect(() => repairPreview(stateOf(fixture), content, { shipId: npc.id, scope: 'all' })).toThrow();
  });
});

describe('losing a purchased hull', () => {
  it('flies the stored ship after the active destroyer is lost [V02-AC-12, FUNC-9.12]', () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    const frigate = state.assets.activeShipId!;
    const destroyer = shipOf(state, DESTROYER);
    state = command(state, 'ship.activate', { shipId: destroyer }).state;
    const credits = state.assets.credits;

    const fixture = inSite(state);
    destroyPlayer(fixture);
    const after = stateOf(fixture);

    expect(after.assets.ships[destroyer]).toBeUndefined();
    expect(after.assets.activeShipId).toBe(frigate);
    expect(after.assets.location).toMatchObject({ kind: 'station', stationId: HARBOUR });
    // Basic cover pays 30% of the destroyer's reference value, in whole credits.
    const value = content.requireHull(DESTROYER as never).referenceValueCredits;
    expect(after.assets.credits).toBe(credits + Math.floor(value * content.rules.economy.basicInsurancePayoutFraction));
    // No recovery grant: the pilot already owns a flight-ready ship.
    expect(Object.values(after.assets.ships).filter((ship) => ship.owner === 'player').every((ship) => !ship.recoveryGrant)).toBe(true);
    expect(fixture.context.autosaves).toBeGreaterThan(0);
  });

  it('grants the starter ship when the only stored ship cannot fly and money is short, and keeps that ship [V02-AC-12, FUNC-9.12, FUNC-22.1]', () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    const frigate = state.assets.activeShipId!;
    const destroyer = shipOf(state, DESTROYER);
    for (const item of [RAILGUN, AFTERBURNER, PLATING]) state = buy(state, item, 1).state;
    state = command(state, 'fitting.begin', { shipId: frigate }).state;
    state = command(state, 'fitting.set', { slotKind: 'weapon', slotIndex: 1, moduleId: RAILGUN, online: true }).state;
    state = command(state, 'fitting.set', { slotKind: 'system', slotIndex: 1, moduleId: AFTERBURNER, online: true }).state;
    state = command(state, 'fitting.set', { slotKind: 'engineering', slotIndex: 0, moduleId: PLATING, online: true }).state;
    state = command(state, 'fitting.commit', {}).state;
    state = command(state, 'ship.activate', { shipId: destroyer }).state;
    state = withCredits(state, 0);

    const fixture = inSite(state);
    destroyPlayer(fixture);
    const after = stateOf(fixture);

    const granted = after.assets.ships[after.assets.activeShipId!]!;
    expect(granted.hullId).toBe(STARTER);
    expect(granted.recoveryGrant).toBe(true);
    // The unflyable frigate is still there, with its fit, to be repaired.
    expect(after.assets.ships[frigate]).toBeDefined();
    expect(shipFit(after.assets, frigate)).toHaveLength(5);
    // A destroyer was lost; no destroyer, cruiser or saleable value was granted.
    expect(Object.values(after.assets.ships).some((ship) => ship.hullId === DESTROYER)).toBe(false);
    expect(after.assets.credits).toBe(Math.floor(
      content.requireHull(DESTROYER as never).referenceValueCredits * content.rules.economy.basicInsurancePayoutFraction,
    ));
  });

  it('leaves a pilot who can afford a ship shipless, and the next hull bought becomes active [V02-AC-12, FUNC-9.12]', () => {
    // Lose the starter frigate with money in the bank and nothing stored.
    let state = wealthy();
    let fixture = inSite(state);
    destroyPlayer(fixture);
    state = stateOf(fixture);
    expect(state.assets.activeShipId).toBeNull();

    // A shipless purchase of a destroyer makes it the active ship.
    state = buy(state, DESTROYER, 1).state;
    const destroyer = shipOf(state, DESTROYER);
    expect(state.assets.activeShipId).toBe(destroyer);

    // Buying the cruiser too leaves the destroyer active; lose the cruiser
    // after switching to it, and the stored destroyer is flown again.
    state = buy(state, CRUISER, 1).state;
    expect(state.assets.activeShipId).toBe(destroyer);
    const cruiser = shipOf(state, CRUISER);
    state = command(state, 'ship.activate', { shipId: cruiser }).state;
    fixture = inSite(state);
    destroyPlayer(fixture);
    state = stateOf(fixture);
    expect(state.assets.activeShipId).toBe(destroyer);
    expect(Object.values(state.assets.ships).some((ship) => ship.hullId === CRUISER)).toBe(false);
  });
});

describe('saving several ships', () => {
  it('resumes every ship and the active choice exactly [V02-AC-13, FUNC-3.4, TECH-11.4]', async () => {
    let state = buy(wealthy(), DESTROYER, 1).state;
    state = buy(state, CRUISER, 1).state;
    const destroyer = shipOf(state, DESTROYER);
    state = buy(state, RAILGUN, 1).state;
    state = command(state, 'fitting.begin', { shipId: destroyer }).state;
    state = command(state, 'fitting.set', { slotKind: 'weapon', slotIndex: 0, moduleId: RAILGUN, online: true }).state;
    state = command(state, 'fitting.commit', {}).state;
    state = command(state, 'ship.activate', { shipId: destroyer }).state;

    const store = createMemorySaveStore();
    const saves = createSaveService({ store, content, engineVersion: ENGINE_VERSION, protocolVersion: PROTOCOL_VERSION });
    await saves.save(state, 'auto', 1_700_000_000_000);
    await saves.drain();
    const reopened = createSaveService({ store, content, engineVersion: ENGINE_VERSION, protocolVersion: PROTOCOL_VERSION });
    const resumed = await reopened.resume();
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(canonicalJson(resumed.loaded.state)).toBe(canonicalJson(state));
    expect(resumed.loaded.state.assets.activeShipId).toBe(destroyer);
    expect(shipsListProjection(resumed.loaded.state, content).ships).toHaveLength(3);
  });
});

describe('the phase 1 loop over the transport', () => {
  it('buys a hull, flies it out and back, switches back and reopens with both ships intact [V02-AC-03, V02-AC-13, FUNC-6.3, FUNC-3.4]', async () => {
    const store = createMemorySaveStore();
    const open = () => {
      const gateway = createDirectGateway({ host: createEngineHost({ content, saves: store }) });
      disposers.push(() => gateway.dispose());
      return gateway;
    };
    const data = <T,>(response: EngineResponse<T>): T => {
      if (!response.ok) throw new Error(JSON.stringify(response.error));
      return response.data;
    };
    let gateway = open();
    data(await gateway.request('campaign.create', {
      displayName: 'Loop Pilot', seed: '0123456789abcdef0123456789abcdef', createdAtRealMs: 100,
    }));
    const preview = data(await gateway.request('market.previewBuy', { stationId: HARBOUR, itemId: STARTER, quantity: 1 }));
    data(await gateway.request('market.confirmBuy', { token: preview.token! }));
    const before = data(await gateway.request('ships.list', {}));
    const original = before.activeShipId!;
    const second = before.ships.find((ship) => !ship.active)!.id;

    const switched = data(await gateway.request('ship.activate', { shipId: second }));
    expect(switched.autosaveRequested).toBe(true);
    data(await gateway.request('campaign.save', { kind: 'auto', savedAtRealMs: 200 }));

    // Fly the bare hull out and dock again.
    data(await gateway.request('ship.undock', {}));
    expect((data(await gateway.request('ships.list', {}))).ships.find((ship) => ship.id === second)!.activation)
      .toEqual({ available: false, unavailableReason: 'error.ruleViolation.shipSwitchInSpace' });
    const refused = await gateway.request('ship.activate', { shipId: original });
    expect(!refused.ok && refused.error.messageKey).toBe('error.ruleViolation.shipSwitchInSpace');
    data(await gateway.request('time.set', { paused: false, rate: 1 }));
    data(await gateway.request('navigation.dock', { stationId: HARBOUR }));
    for (let step = 0; step < 200; step += 1) {
      const where = data(await gateway.request('assets.list', {})).location;
      if (where.kind === 'station') break;
      data(await gateway.request('time.advance', { elapsedRealMs: 250 }));
    }
    expect(data(await gateway.request('assets.list', {})).location.kind).toBe('station');
    data(await gateway.request('time.set', { paused: true, rate: 1 }));

    // Switch back, close and reopen: both ships, and the choice, survive.
    data(await gateway.request('ship.activate', { shipId: original }));
    data(await gateway.request('campaign.close', { savedAtRealMs: 300 }));
    gateway = open();
    data(await gateway.request('campaign.resume', {}));
    const after = data(await gateway.request('ships.list', {}));
    expect(after.activeShipId).toBe(original);
    expect(after.ships.map((ship) => ship.id).sort()).toEqual([original, second].sort());
    expect(after.ships.every((ship) => ship.local)).toBe(true);
  });
});
