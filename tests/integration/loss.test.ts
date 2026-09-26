import { describe, expect, it } from 'vitest';

import type {
  AssetsData,
  CommandResultData,
  DestinationsData,
  EncounterData,
  InventoryData,
  LossReportData,
  MarketTransactionPreviewData,
  ResupplyPreviewData,
  SaveSlotData,
  SiteData,
  StateHashData,
  WreckContentsData,
} from '@protocol';

import {
  arriveAtScout,
  destroyOpponent,
  lockOpponent,
  returnHome,
  SCOUT,
  SORTIE_SEED,
  startSortie,
  type Sortie,
} from '../support/sortie.ts';

/**
 * The phase 15 exit gate, headless (MVP-AC-08; Functional Specification 9.12,
 * 22.1, 22.7; Technical Specification 10.9, 15.1).
 *
 * A pilot with a spare autocannon in the hangar flies an idle starter ship to
 * the pirate base and is destroyed there. The loss is reported, insured,
 * recovered with a granted ship and saved; the campaign is closed and resumed;
 * the pilot flies back to the wreck through its bookmark, takes what survived,
 * refits with the spare, and completes the easiest encounter again. Every step
 * is a protocol request over the engine host, as the interface makes it.
 */

const HARBOUR = 'station.borrell.harbour';
const BASE_SITE = 'site.borrell.outpost-cradle';
const AUTOCANNON = 'module.turret.autocannon.small';
const SHIELD_BOOSTER = 'module.shield.booster.small';
const FUSION = 'ammo.projectile.small.fusion';

async function advanceUntil(
  sortie: Sortie,
  done: () => Promise<boolean>,
  budgetSeconds: number,
): Promise<CommandResultData[]> {
  const results: CommandResultData[] = [];
  for (let step = 0; step < budgetSeconds * 4; step += 1) {
    results.push(await sortie.data<CommandResultData>('time.advance', { elapsedRealMs: 250 }));
    if (await done()) return results;
  }
  throw new Error('The campaign never reached the expected state.');
}

async function location(sortie: Sortie): Promise<SiteData['location']> {
  return (await sortie.data<SiteData>('navigation.site')).location;
}

async function activeShip(sortie: Sortie) {
  const assets = await sortie.data<AssetsData>('assets.list');
  const ship = assets.ships.find((entry) => entry.id === assets.activeShipId);
  return { assets, ship };
}

describe('destruction, recovery and a return to the easiest encounter', () => {
  it('loses the ship, recovers, resumes, loots the wreck and completes the scout again [MVP-AC-08, FUNC-9.12, FUNC-22.1, FUNC-22.7, TECH-10.9, TECH-15.1]', async () => {
    const sortie = await startSortie(SORTIE_SEED);

    // A spare autocannon waits in the hangar.
    const preview = await sortie.data<MarketTransactionPreviewData>('market.previewBuy', {
      stationId: HARBOUR, itemId: AUTOCANNON, quantity: 1,
    });
    expect(preview.available).toBe(true);
    await sortie.data('market.confirmBuy', { token: preview.token });
    const creditsBefore = (await activeShip(sortie)).assets.credits;

    // Idle at the pirate base until the ship is destroyed.
    await sortie.data('ship.undock');
    await sortie.data('navigation.warp', { destinationSiteId: BASE_SITE, arrivalDistanceKm: 10 });
    await sortie.data('time.set', { paused: false, rate: 1 });
    const advances = await advanceUntil(sortie, async () => (await location(sortie)).kind === 'station', 300);

    const lossStep = advances.find((result) => result.events.some((event) => event.kind === 'recovery.shipLost'));
    expect(lossStep).toBeDefined();
    expect(lossStep?.autosaveRequested).toBe(true);
    expect(lossStep?.invalidations).toContain('loss');
    const lossKinds = lossStep?.events.map((event) => event.kind) ?? [];
    expect(lossKinds).toEqual(expect.arrayContaining([
      'combat.shipDestroyed', 'recovery.shipLost', 'recovery.insurancePaid', 'recovery.shipGranted',
    ]));

    // The report: who did it, what was lost, what survived, what was paid.
    const loss = (await sortie.data<LossReportData>('loss.report')).report;
    expect(loss).not.toBeNull();
    if (loss === null) return;
    expect(loss.siteId).toBe(BASE_SITE);
    expect(loss.recoveryStationId).toBe(HARBOUR);
    expect(loss.incoming.length).toBeGreaterThan(0);
    expect(loss.finalDamage?.appliedTotal).toBeGreaterThan(0);
    expect(loss.totalAppliedDamage).toBeGreaterThan(0);
    expect(loss.items.map((item) => [item.definitionId, item.origin, item.survived])).toEqual([
      [AUTOCANNON, 'fitted', false],
      [FUSION, 'loaded', false],
      [SHIELD_BOOSTER, 'fitted', true],
    ]);
    expect(loss.insurance).toMatchObject({ coverage: 'basic', payoutCredits: 3_600, recoveryGrantHull: false });
    expect(loss.recovery).toMatchObject({ outcome: 'granted', creditsAfter: creditsBefore + 3_600 });
    expect(loss.recovery.creditsAfter).toBe(11_600);
    expect(loss.wreck).toMatchObject({ present: true, itemCount: 1 });

    // The granted ship is docked, active and wholly restricted.
    const { assets, ship } = await activeShip(sortie);
    expect(ship).toMatchObject({ hullId: 'hull.independent.starter', recoveryGrant: true, active: true });
    expect(assets.location).toMatchObject({ kind: 'station', stationId: HARBOUR });
    const fitting = assets.inventories.find((inventory) => inventory.id === ship?.fittingInventoryId);
    expect(fitting?.stacks.length).toBe(3);
    expect(fitting?.stacks.every((stack) => stack.recoveryGrant)).toBe(true);

    // The interface answers the autosave request; the snapshot is resumable.
    await sortie.data('campaign.save', { kind: 'auto', savedAtRealMs: 1_700_000_050_000 });
    const saved = await sortie.data<StateHashData>('diagnostics.stateHash');
    const slot = await sortie.data<SaveSlotData>('campaign.saves');
    expect(slot.resumable?.revision).toBe(saved.revision);

    // Close the game (pausing first, as the interface does) and open it again.
    await sortie.data('time.set', { paused: true, rate: 1 });
    const before = await sortie.data<StateHashData>('diagnostics.stateHash');
    await sortie.data('campaign.close', { savedAtRealMs: 1_700_000_100_000 });
    await sortie.data('campaign.resume');
    const after = await sortie.data<StateHashData>('diagnostics.stateHash');
    expect(after.stateHash).toBe(before.stateHash);
    expect((await sortie.data<LossReportData>('loss.report')).report?.lossId).toBe(loss.lossId);

    // Back to the wreck through its bookmark, arriving on top of it.
    const destinations = await sortie.data<DestinationsData>('navigation.destinations');
    expect(destinations.bookmarks).toHaveLength(1);
    const bookmark = destinations.bookmarks[0]!;
    expect(bookmark).toMatchObject({ bookmarkId: loss.wreck.wreckId, siteId: BASE_SITE, kind: 'playerWreck' });
    await sortie.data('navigation.selectBookmark', { bookmarkId: bookmark.bookmarkId });
    await sortie.data('ship.undock');
    await sortie.data('navigation.warpToBookmark', { bookmarkId: bookmark.bookmarkId, arrivalDistanceKm: 0 });
    await sortie.data('time.set', { paused: false, rate: 1 });
    await advanceUntil(sortie, async () => {
      const where = await location(sortie);
      return where.kind === 'site' && where.siteId === BASE_SITE;
    }, 120);

    const contents = await sortie.data<WreckContentsData>('loot.contents', { wreckId: bookmark.bookmarkId });
    expect(contents.accessible).toBe(true);
    expect(contents.stacks.map((stack) => stack.item.definitionId)).toEqual([SHIELD_BOOSTER]);
    for (const stack of contents.stacks) {
      await sortie.data('loot.take', { wreckId: bookmark.bookmarkId, stackId: stack.id, quantity: stack.quantity });
    }
    const hold = await sortie.data<InventoryData>('inventory.cargo', { shipId: ship?.id ?? '' });
    expect(hold.stacks.map((stack) => [stack.item.definitionId, stack.recoveryGrant])).toEqual([[SHIELD_BOOSTER, false]]);

    // Leave before the base finishes this ship too.
    await returnHome(sortie);
    expect(await location(sortie)).toMatchObject({ kind: 'station', stationId: HARBOUR });

    // Refit with the spare autocannon and load its rounds.
    const shipId = ship?.id ?? '';
    await sortie.data('fitting.begin', { shipId });
    await sortie.data('fitting.set', {
      slotKind: 'weapon', slotIndex: 1, moduleId: AUTOCANNON, online: true, ammunitionId: FUSION,
    });
    await sortie.data('fitting.commit');
    const refitted = (await activeShip(sortie)).assets.inventories.find((inventory) => inventory.id === ship?.fittingInventoryId);
    const cannons = refitted?.stacks.filter((stack) => stack.item.definitionId === AUTOCANNON) ?? [];
    expect(cannons.map((stack) => stack.recoveryGrant).sort()).toEqual([false, true]);
    const resupply = await sortie.data<ResupplyPreviewData>('resupply.preview', { shipId });
    if (resupply.available) await sortie.data('resupply.confirm', { token: resupply.token });

    // The easiest encounter, completed again with the recovered ship.
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await destroyOpponent(sortie, opponent);
    const won = await sortie.data<EncounterData>('encounter.state');
    expect(won.instance?.status).toBe('completed');
    await returnHome(sortie);

    const home = await sortie.data<EncounterData>('encounter.state');
    expect(home.lastOutcome).toMatchObject({ encounterId: SCOUT, status: 'completed' });
    const again = await sortie.data<DestinationsData>('navigation.destinations');
    const scout = again.destinations.find((entry) => entry.encounterId === SCOUT);
    expect(scout?.commands.find((entry) => entry.command === 'navigation.selectDestination')?.available).toBe(true);
    await sortie.data('navigation.selectDestination', { encounterId: SCOUT });
  }, 60_000);
});
