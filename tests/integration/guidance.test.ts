import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import type {
  AssetsData,
  CommandResultData,
  DestinationsData,
  DomainEventData,
  InventoryData,
  MarketTransactionPreviewData,
  NotificationsData,
  OnboardingData,
  RepairPreviewData,
  ResupplyPreviewData,
  ShipData,
  SiteData,
  WreckContentsData,
} from '@protocol';

import { shippedContent } from '../support/content.ts';
import {
  arriveAtScout,
  destroyOpponent,
  lockOpponent,
  reachWreck,
  returnHome,
  startSortie,
  type Sortie,
} from '../support/sortie.ts';

/**
 * The contextual guidance, flown end to end over the protocol
 * (Functional Specification 3.2, 19.7; Technical Specification 10.6, 12.4;
 * MVP-AC-10).
 *
 * A new campaign plays the loop the guidance teaches - choose the scout, fly
 * out, fight, loot, come home, sell, get ready, refit, and try the patrol -
 * using only the commands the interface sends. Every step must complete by
 * being done, never by being skipped, and exactly once. Along the way the
 * notification history must have told the player what mattered.
 */

const PATROL = 'encounter.borrell.pirate-patrol';
const PATROL_SITE = 'site.borrell.derelict-lane';
const AUTOCANNON = 'module.turret.autocannon.small';

interface Recorder {
  readonly events: DomainEventData[];
}

/** Wraps a sortie so every event any command or clock advance published is kept. */
function recorded(sortie: Sortie): Sortie & Recorder {
  const events: DomainEventData[] = [];
  const ask: Sortie['ask'] = async (type, payload) => {
    const response = await sortie.ask(type, payload);
    if (response.ok) {
      const data = response.data as Partial<CommandResultData>;
      if (Array.isArray(data.events)) events.push(...data.events);
    }
    return response as never;
  };
  const data: Sortie['data'] = async (type, payload) => {
    const response = await ask(type, payload);
    if (!response.ok) throw new Error(`${type} failed: ${response.error.messageKey}`);
    return response.data as never;
  };
  const until: Sortie['until'] = async (done, budgetSeconds = 600) => {
    for (let step = 0; step < Math.ceil((budgetSeconds * 1000) / 250); step += 1) {
      await ask('time.advance', { elapsedRealMs: 250 });
      if (await done()) return true;
    }
    return false;
  };
  return { host: sortie.host, ask, data, until, events };
}

async function statuses(sortie: Sortie): Promise<Record<string, string>> {
  const onboarding = await sortie.data<OnboardingData>('onboarding.state');
  return Object.fromEntries(onboarding.chains.flatMap((chain) =>
    chain.steps.map((step) => [step.id, step.status])));
}

async function station(): Promise<string> {
  return shippedContent().rules.economy.startingStationId;
}

async function takeEverything(sortie: Sortie, wreckId: string): Promise<void> {
  const contents = await sortie.data<WreckContentsData>('loot.contents', { wreckId });
  for (const stack of contents.stacks) {
    const room = contents.maximumQuantities.find((entry) => entry.stackId === stack.id);
    const quantity = Math.min(stack.quantity, room?.maximumQuantity ?? stack.quantity);
    if (quantity > 0) await sortie.data('loot.take', { wreckId, stackId: stack.id, quantity });
  }
}

async function sellSomething(sortie: Sortie): Promise<void> {
  const assets = await sortie.data<AssetsData>('assets.list');
  const ship = assets.ships.find((entry) => entry.active)!;
  const cargo = await sortie.data<InventoryData>('inventory.cargo', { shipId: ship.id });
  const stationId = await station();
  for (const stack of cargo.stacks) {
    const preview = await sortie.data<MarketTransactionPreviewData>('market.previewSell', {
      stationId, stackId: stack.id, quantity: 1,
    });
    if (preview.available && preview.token !== null) {
      await sortie.data('market.confirmSell', { token: preview.token });
      return;
    }
  }
  throw new Error('Nothing in the hold could be sold.');
}

async function getReady(sortie: Sortie): Promise<void> {
  const assets = await sortie.data<AssetsData>('assets.list');
  const shipId = assets.activeShipId!;
  const repair = await sortie.data<RepairPreviewData>('repair.preview', { shipId });
  if (repair.available && repair.token !== null) await sortie.data('repair.confirm', { token: repair.token });
  const resupply = await sortie.data<ResupplyPreviewData>('resupply.preview', { shipId });
  if (resupply.available && resupply.token !== null) await sortie.data('resupply.confirm', { token: resupply.token });
  const ready = await sortie.until(async () => {
    const ship = await sortie.data<ShipData>('ship.get', { shipId });
    return ship.capacitor.secondsToFull === 0;
  }, 900);
  if (!ready) throw new Error('The capacitor never filled while docked.');
}

async function fitSecondGun(sortie: Sortie): Promise<void> {
  const stationId = await station();
  const buy = await sortie.data<MarketTransactionPreviewData>('market.previewBuy', {
    stationId, itemId: AUTOCANNON, quantity: 1,
  });
  if (!buy.available || buy.token === null) throw new Error('The autocannon could not be bought.');
  await sortie.data('market.confirmBuy', { token: buy.token });
  const assets = await sortie.data<AssetsData>('assets.list');
  const shipId = assets.activeShipId!;
  await sortie.data('fitting.begin', { shipId });
  await sortie.data('fitting.set', {
    slotKind: 'weapon', slotIndex: 1, moduleId: AUTOCANNON, online: true,
    ammunitionId: 'ammo.projectile.small.fusion',
  });
  await sortie.data('fitting.commit', {});
}

async function enterPatrol(sortie: Sortie): Promise<void> {
  await sortie.data('navigation.selectDestination', { encounterId: PATROL });
  await sortie.data('ship.undock');
  await sortie.data('navigation.warp', { destinationSiteId: PATROL_SITE, arrivalDistanceKm: 30 });
  const arrived = await sortie.until(async () => {
    const site = await sortie.data<SiteData>('navigation.site');
    return site.location.kind === 'site' && site.location.siteId === PATROL_SITE;
  }, 120);
  if (!arrived) throw new Error('The ship never reached the patrol.');
}

describe('guidance through the complete loop', () => {
  it('completes every step by playing, once each, and tells the player what mattered [FUNC-3.2, FUNC-19.7, TECH-10.6, TECH-12.4, MVP-AC-10]', async () => {
    const sortie = recorded(await startSortie());

    const first = await sortie.data<OnboardingData>('onboarding.state');
    expect(first.hidden).toBe(false);
    expect(first.currentStepId).toBe('guide.loop.choose-site');

    const opponent = await arriveAtScout(sortie);
    expect(await statuses(sortie)).toMatchObject({
      'guide.loop.choose-site': 'completed',
      'guide.loop.undock': 'completed',
      'guide.loop.warp': 'completed',
    });

    await lockOpponent(sortie, opponent);
    await destroyOpponent(sortie, opponent);
    const wreckId = await reachWreck(sortie);
    await takeEverything(sortie, wreckId);
    await returnHome(sortie);

    // The ready-check waited for the return, so it was not completed at the
    // start, when the new ship was already ready. Now it is open.
    expect((await statuses(sortie))['guide.loop.ready']).toBe('open');

    await sellSomething(sortie);
    await getReady(sortie);
    await fitSecondGun(sortie);
    await enterPatrol(sortie);

    const finished = await sortie.data<OnboardingData>('onboarding.state');
    expect(finished.currentStepId).toBeNull();
    const chain = finished.chains[0]!;
    expect(chain.finished).toBe(true);
    expect(chain.skippedCount).toBe(0);
    expect(chain.steps.every((step) => step.status === 'completed')).toBe(true);

    // Each step was granted exactly once, however many events matched it later.
    const completions = sortie.events.filter((event) => event.kind === 'onboarding.stepCompleted');
    expect(completions.map((event) => event.params?.['stepId']).sort())
      .toEqual(chain.steps.map((step) => step.id).sort());

    const history = await sortie.data<NotificationsData>('notifications.list');
    const raised = new Set(history.entries.map((entry) => entry.definitionId));
    for (const expected of [
      'notify.combat.hostile-lock',
      'notify.encounter.bounty',
      'notify.encounter.completed',
      'notify.encounter.loot',
      'notify.navigation.docked',
      'notify.station.sold',
      'notify.station.fitted',
      'notify.guidance.step',
    ]) {
      expect(raised, expected).toContain(expected);
    }
    // Danger is audible and is never grouped away from its level.
    const lock = history.entries.find((entry) => entry.definitionId === 'notify.combat.hostile-lock')!;
    expect(lock.severity).toBe('danger');
    expect(lock.cueId).not.toBeNull();
    expect(lock.params['attackerKey']).toBe('content.npc.pirate.scout.name');
    // Guidance steps are grouped per step, so the history names each one.
    const stepEntries = history.entries.filter((entry) => entry.definitionId === 'notify.guidance.step');
    expect(stepEntries.length).toBeGreaterThanOrEqual(1);
    expect(history.entries.length).toBeLessThanOrEqual(64);
  }, 240_000);

  it('keeps guidance progress and the history through close and resume [FUNC-3.2, TECH-11.2, MVP-AC-01]', async () => {
    const saves = createMemorySaveStore();
    const sortie = await startSortie(undefined, undefined, saves);
    await sortie.data('navigation.selectDestination', { encounterId: 'encounter.borrell.pirate-scout' });
    await sortie.data('onboarding.skipStep', { stepId: 'guide.loop.undock' });
    await sortie.data('onboarding.hide');
    const before = await sortie.data<OnboardingData>('onboarding.state');
    const history = await sortie.data<NotificationsData>('notifications.list');

    await sortie.data('campaign.close', { savedAtRealMs: 1_700_000_100_000 });
    await sortie.data('campaign.resume');

    expect(await sortie.data<OnboardingData>('onboarding.state')).toEqual(before);
    expect(await sortie.data<NotificationsData>('notifications.list')).toEqual(history);
    expect(before.hidden).toBe(true);
    const statusOf = Object.fromEntries(before.chains[0]!.steps.map((step) => [step.id, step.status]));
    expect(statusOf['guide.loop.choose-site']).toBe('completed');
    expect(statusOf['guide.loop.undock']).toBe('skipped');

    const destinations = await sortie.data<DestinationsData>('navigation.destinations');
    expect(destinations.destinations.some((entry) => entry.selected)).toBe(true);
  });
});
