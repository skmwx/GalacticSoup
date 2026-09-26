import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ClientGateway } from '@gateway';
import { createDirectGateway } from '@gateway/direct';
import {
  EMPTY_PAYLOAD,
  type AssetsData,
  type DestinationsData,
  type LossData,
  type MarketListingsData,
  type SiteData,
} from '@protocol';
import type { LocalizationIssue } from '@shared';
import { formatSimulationDuration, GameRoot, LocalizationProvider } from '@ui';

import { closeSortie, startSortie, type Sortie } from '../support/sortie.ts';

/**
 * Losing the ship, over a real engine
 * (MVP-AC-08, MVP-AC-10; Functional Specification 5.4, 9.12, 19.6, 20;
 * Technical Specification 10.9, 11.3, 12).
 *
 * Each case drives a campaign headlessly into a real destruction - an idle
 * starter ship warped into the Pirate Base, which destroys it about eighty
 * simulated seconds after arrival - closes it, and opens the shipped interface
 * on the same engine. With the fixed seed and no purchases the autocannon is
 * lost, the shield booster survives into the wreck, and the pilot is left
 * below the reference value of a starter ship with its original fit, so the
 * recovery service grants a replacement. A pilot who sold the autocannon
 * before flying holds more than that value after the payout, so no ship is
 * supplied and they must buy one. Every figure asserted is one the engine
 * projected.
 */

const STATION = 'station.borrell.harbour';
const BASE_SITE = 'site.borrell.outpost-cradle';
const AUTOCANNON = 'module.turret.autocannon.small';

interface Harness {
  readonly sortie: Sortie;
  readonly gateway: ClientGateway;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly issues: LocalizationIssue[];
}

/** Undocks, warps idle into the Pirate Base and waits to be recovered. */
async function destroyShip(sortie: Sortie): Promise<void> {
  await sortie.data('ship.undock');
  await sortie.data('navigation.warp', { destinationSiteId: BASE_SITE, arrivalDistanceKm: 10 });
  await sortie.data('time.set', { paused: false, rate: 1 });
  const recovered = await sortie.until(async () => {
    const site = await sortie.data<SiteData>('navigation.site');
    return site.location.kind === 'station';
  }, 600);
  if (!recovered) throw new Error('The ship was never destroyed.');
  await sortie.data('time.set', { paused: true, rate: 1 });
}

/** The starter ship lost as a new campaign has it; the recovery service replaces it. */
async function lostWithStarterFit(): Promise<Sortie> {
  const sortie = await startSortie();
  await destroyShip(sortie);
  return sortie;
}

/**
 * A loss that leaves the pilot able to buy the starter ship back, so shipless:
 * the autocannon is sold before the ship flies, and the sale and the payout
 * together reach the starter ship's reference value.
 */
async function lostWithoutShip(): Promise<Sortie> {
  const sortie = await startSortie();
  const assets = await sortie.data<AssetsData>('assets.list');
  await sortie.data('fitting.begin', { shipId: assets.activeShipId });
  await sortie.data('fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
  await sortie.data('fitting.commit');
  const hangar = (await sortie.data<AssetsData>('assets.list')).inventories.find((inventory) =>
    inventory.location.kind === 'hangar' && inventory.location.stationId === STATION);
  const gun = hangar?.stacks.find((stack) => stack.item.definitionId === AUTOCANNON);
  if (gun === undefined) throw new Error('The autocannon did not reach the hangar.');
  const sale = await sortie.data<{ token: string }>('market.previewSell', { stationId: STATION, stackId: gun.id, quantity: 1 });
  await sortie.data('market.confirmSell', { token: sale.token });
  await destroyShip(sortie);
  return sortie;
}

/** A loss the recovery service answers with a replacement ship. */
async function lostWithGrant(): Promise<Sortie> {
  const sortie = await startSortie();
  const preview = await sortie.data<{ token: string }>('market.previewBuy', {
    stationId: STATION,
    itemId: AUTOCANNON,
    quantity: 1,
  });
  await sortie.data('market.confirmBuy', { token: preview.token });
  await destroyShip(sortie);
  return sortie;
}

async function resume(sortie: Sortie, heading: string, gateway?: ClientGateway): Promise<Harness> {
  await closeSortie(sortie);
  const issues: LocalizationIssue[] = [];
  const direct = gateway ?? createDirectGateway({ host: sortie.host, defaultTimeoutMs: 5_000 });
  render(
    <LocalizationProvider onIssue={(issue) => issues.push(issue)}>
      <GameRoot gateway={direct} />
    </LocalizationProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Resume campaign' }));
  await screen.findByRole('heading', { level: 2, name: heading });
  return { sortie, gateway: direct, user, issues };
}

async function ask<TData>(harness: Harness, type: string, payload: unknown = EMPTY_PAYLOAD): Promise<TData> {
  const response = await harness.gateway.request(type as 'assets.list', payload as never);
  if (!response.ok) throw new Error(`${type} was refused: ${response.error.messageKey}`);
  return response.data as TData;
}

async function lossReport(harness: Harness): Promise<LossData> {
  const report = (await ask<{ report: LossData | null }>(harness, 'loss.report')).report;
  if (report === null) throw new Error('No loss was reported.');
  return report;
}

function region(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function panel(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const section = heading.closest('section');
  if (section === null) throw new Error(`No panel is headed ${name}.`);
  return section;
}

const count = (value: number): string => new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(Math.round(value));

describe('the loss report', () => {
  it('explains where, who hit the ship, through which layers and the final damage [FUNC-9.12, FUNC-20, MVP-AC-08, MVP-AC-10]', async () => {
    const harness = await resume(await lostWithStarterFit(), 'Borrell Harbour');
    const report = await lossReport(harness);
    const loss = region('Ship lost');

    expect(loss).toHaveAttribute('data-recovery', 'granted');
    expect(
      within(loss).getByText(
        `Your Wayfarer was destroyed at Outpost Cradle fighting Pirate Base, at simulation time ${formatSimulationDuration(report.destroyedAtMs)}. You were recovered at Borrell Harbour.`,
      ),
    ).toBeInTheDocument();

    // Every attacker, in the order they first hit, with what it did.
    const table = within(loss).getByRole('table', { name: /^Damage taken, by attacker/ });
    expect(within(table).getAllByRole('row')).toHaveLength(report.incoming.length + 1);
    expect(report.incoming.length).toBeGreaterThan(1);
    for (const source of report.incoming) {
      const row = table.querySelector(`[data-attacker="${source.sourceId}"]`);
      if (!(row instanceof HTMLElement)) throw new Error(`No row for ${source.sourceId}.`);
      expect(within(row).getByRole('rowheader').textContent).toMatch(/^Pirate (Gunner|Warden|Marksman)$/);
      expect(within(row).getByText(count(source.appliedTotal))).toBeInTheDocument();
      const layers = row.querySelector('[data-layers]')?.textContent ?? '';
      // The layers are named in words, shield before armour before hull.
      expect(layers).toMatch(/^Shield \d+(, Armour \d+)?(, Hull \d+)?$/);
    }
    expect(
      within(loss).getByText(`Total damage taken after resistances: ${count(report.totalAppliedDamage)}.`),
    ).toBeInTheDocument();

    const final = loss.querySelector('[data-final-damage]');
    expect(final?.textContent).toMatch(new RegExp(
      String.raw`^Final damage came from Pirate (Gunner|Warden|Marksman) \(Weapon \d\) at simulation time ${formatSimulationDuration(report.destroyedAtMs)}: \d+ x hit for \d+ damage after resistances, \d+ before \(.+\)\.$`,
    ));
    expect(report.finalDamage?.appliedTotal ?? 0).toBeGreaterThan(0);

    expect(report.disablingEffects).toEqual([]);
    expect(
      within(loss).getByText('Nothing had stopped working: no module was out of capacitor or ammunition.'),
    ).toBeInTheDocument();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  }, 60_000);

  it('lists what was lost and what survived into the wreck, and when it expires [FUNC-9.12, FUNC-5.4, MVP-AC-08]', async () => {
    const harness = await resume(await lostWithStarterFit(), 'Borrell Harbour');
    const loss = region('Ship lost');

    const lost = within(loss).getByRole('list', { name: 'Lost items' });
    expect(within(lost).getByText('1 x 200mm Autocannon (fitted)')).toBeInTheDocument();
    expect(within(lost).getByText('20 x Fusion S (loaded ammunition)')).toBeInTheDocument();
    const survived = within(loss).getByRole('list', { name: 'Surviving items' });
    expect(within(survived).getByText('1 x Small Shield Booster (fitted)')).toBeInTheDocument();

    expect(
      within(loss).getByText(
        /^What survived lies in your wreck at Outpost Cradle\. Stacks left: 1\. It expires in 1h 59m\.$/,
      ),
    ).toBeInTheDocument();

    harness.gateway.dispose();
  }, 60_000);

  it('explains the insurance payout with its formula and the recovery outcome [FUNC-9.12, FUNC-19.6, MVP-AC-08, MVP-AC-10]', async () => {
    const harness = await resume(await lostWithoutShip(), 'Borrell Harbour');
    const loss = region('Ship lost');

    expect(
      within(loss).getByText("Basic insurance paid 3,600 ISK: 30% of the hull's 12,000 ISK reference value."),
    ).toBeInTheDocument();
    expect(within(loss).getByText('Insurance covers the hull only, never modules or cargo.')).toBeInTheDocument();

    await harness.user.click(within(loss).getByText('Show the payout calculation'));
    expect(within(loss).getByText(/^payout = hull reference value × payout fraction/)).toBeInTheDocument();
    expect(within(loss).getByText('Hull reference value')).toBeInTheDocument();
    expect(within(loss).getByText('Payout fraction')).toBeInTheDocument();
    expect(within(loss).getByText('Unrounded 3,600, shown as 3,600.')).toBeInTheDocument();

    expect(
      within(loss).getByText(
        'You have no ship. With 33,822 ISK you can buy back a starter ship with its original fit, worth 32,680 ISK, so the recovery service does not supply one.',
      ),
    ).toBeInTheDocument();
    expect(
      within(loss).getByText('Next: buy a hull at the market. It becomes your active ship as soon as you buy it.'),
    ).toBeInTheDocument();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  }, 60_000);

  it('chooses the wreck as the destination from the report [FUNC-5.4, FUNC-9.12, MVP-AC-08]', async () => {
    const harness = await resume(await lostWithStarterFit(), 'Borrell Harbour');
    const loss = region('Ship lost');
    const report = await lossReport(harness);

    expect(
      within(loss).getByText('The wreck lies in Outpost Cradle, where Pirate Base (tier 3) still waits.'),
    ).toBeInTheDocument();
    await harness.user.click(within(loss).getByRole('button', { name: 'Choose your wreck as the destination' }));

    await waitFor(async () => {
      expect((await ask<DestinationsData>(harness, 'navigation.destinations')).selectedBookmarkId).toBe(
        report.wreck.wreckId,
      );
    });
    expect(
      await within(region('Ship lost')).findByRole('button', { name: 'Your wreck is the destination' }),
    ).toBeDisabled();

    harness.gateway.dispose();
  }, 60_000);

  it('collapses once a later sortie has resolved, and stays reachable [FUNC-9.12, FUNC-20]', async () => {
    const sortie = await lostWithGrant();
    // Another attempt after the loss: leave the easiest site again at once.
    await sortie.data('ship.undock');
    await sortie.data('navigation.warp', { destinationSiteId: 'site.borrell.verge', arrivalDistanceKm: 10 });
    await sortie.data('time.set', { paused: false, rate: 1 });
    await sortie.until(async () => {
      const site = await sortie.data<SiteData>('navigation.site');
      return site.location.kind === 'site' && site.location.siteId === 'site.borrell.verge';
    }, 120);
    await sortie.data('navigation.retreat');
    await sortie.until(async () => {
      const site = await sortie.data<SiteData>('navigation.site');
      return site.site?.objects.some((object) => object.kind === 'station') === true;
    }, 300);
    const station = (await sortie.data<SiteData>('navigation.site')).site?.objects.find(
      (object) => object.kind === 'station',
    );
    await sortie.data('navigation.dock', { stationId: station?.id ?? '' });
    await sortie.until(
      async () => (await sortie.data<SiteData>('navigation.site')).location.kind === 'station',
      60,
    );
    const harness = await resume(sortie, 'Borrell Harbour');

    expect(screen.queryByRole('region', { name: 'Ship lost' })).not.toBeInTheDocument();
    const previous = region('Last ship lost');
    expect(previous).toHaveAttribute('data-loss-recent', 'false');
    await harness.user.click(within(previous).getByText('Show the report on your last lost ship'));
    expect(within(previous).getByText(/^Your Wayfarer was destroyed at Outpost Cradle/)).toBeVisible();

    harness.gateway.dispose();
  }, 60_000);
});

describe('a pilot with no ship', () => {
  it('is told why they cannot undock and where the next ship comes from [FUNC-9.12, FUNC-10, FUNC-22.10, MVP-AC-08]', async () => {
    const harness = await resume(await lostWithoutShip(), 'Borrell Harbour');
    const listings = await ask<MarketListingsData>(harness, 'market.listings', { stationId: STATION });
    const hull = listings.listings.find((listing) => listing.item.kind === 'hull');
    if (hull === undefined) throw new Error('The station sells no hull.');

    const notice = region('No ship');
    expect(
      within(notice).getByText(
        'You have no ship at this station, so you cannot undock. Buy a hull at the market: it becomes your active ship as soon as you buy it.',
      ),
    ).toBeInTheDocument();
    const hulls = within(notice).getByRole('list', { name: 'Hulls for sale here' });
    expect(within(hulls).getByText(`Wayfarer: ${count(hull.stationSellPriceCredits)} ISK`)).toBeInTheDocument();
    expect(within(notice).getByText('You have 33,822 ISK.')).toBeInTheDocument();

    // The sortie ended in a loss, and there is no hold to describe.
    const summary = panel('Last sortie');
    expect(summary).toHaveAttribute('data-sortie', 'lost');
    expect(
      within(summary).getByText('Pirate Base: your ship was destroyed after 0 of 4 opponents, 0 ISK in bounties.'),
    ).toBeInTheDocument();
    expect(within(summary).getByText('You have no ship, so there is no hold.')).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Departure' }));
    expect(screen.getByRole('button', { name: /^Undock/ })).toBeDisabled();
    expect(
      screen.getByText('You have no ship. Buy a hull at the market before undocking.'),
    ).toBeInTheDocument();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  }, 60_000);

  it('keeps every docked surface usable and says there is no ship [FUNC-9.12, FUNC-19.5, FUNC-22.10]', async () => {
    const harness = await resume(await lostWithoutShip(), 'Borrell Harbour');

    await harness.user.click(screen.getByRole('button', { name: 'Ship' }));
    expect(
      await screen.findByText('You have no ship. Buy a hull at the market; it becomes your active ship.'),
    ).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Fitting' }));
    expect(screen.getByText('You have no ship to fit. Buy a hull at the market first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Change fit/ })).toBeDisabled();

    await harness.user.click(screen.getByRole('button', { name: 'Services' }));
    for (const name of ['Repair the ship', 'Resupply ammunition', 'Improve insurance']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(
      screen.getAllByText('You have no ship to service. Buy a hull at the market first.').length,
    ).toBe(3);

    await harness.user.click(screen.getByRole('button', { name: 'Hangar' }));
    expect(screen.getByRole('heading', { name: 'Station hangar' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'You have no ship, so there is no hold to load. Buy a hull at the market; it becomes your active ship.',
      ),
    ).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Market' }));
    expect(
      screen.getByText('You have no ship. A hull you buy here becomes your active ship.'),
    ).toBeInTheDocument();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  }, 60_000);

  it('buys the starter hull, which becomes the active ship and may undock [FUNC-9.12, MVP-AC-08]', async () => {
    const harness = await resume(await lostWithoutShip(), 'Borrell Harbour');

    await harness.user.click(within(region('No ship')).getByRole('button', { name: /^Open the market/ }));
    await harness.user.click(await screen.findByRole('button', { name: 'Buy Wayfarer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });
    await harness.user.click(confirm);

    await waitFor(async () => {
      expect((await ask<AssetsData>(harness, 'assets.list')).activeShipId).not.toBeNull();
    });
    await harness.user.click(screen.getByRole('button', { name: 'Overview' }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'No ship' })).not.toBeInTheDocument();
    });

    await harness.user.click(screen.getByRole('button', { name: 'Departure' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Undock/ })).toBeEnabled();
    });
    await harness.user.click(screen.getByRole('button', { name: 'Ship' }));
    expect(await screen.findByText('Wayfarer')).toBeInTheDocument();

    harness.gateway.dispose();
  }, 60_000);
});

describe('recovery-grant equipment', () => {
  it('is labelled in words, and the market says why it cannot be sold [FUNC-9.12, MVP-AC-08, TECH-10.9]', async () => {
    const sortie = await lostWithGrant();
    // Strip the granted autocannon off the replacement, into the hangar.
    const assets = await sortie.data<AssetsData>('assets.list');
    await sortie.data('fitting.begin', { shipId: assets.activeShipId });
    await sortie.data('fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
    await sortie.data('fitting.commit');
    const harness = await resume(sortie, 'Borrell Harbour');

    const loss = region('Ship lost');
    expect(loss).toHaveAttribute('data-recovery', 'granted');
    expect(within(loss).getByText(/the recovery service supplied a replacement Wayfarer with its original fit\./)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'No ship' })).not.toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Ship' }));
    const ship = panel('Active ship');
    expect(await within(ship).findByText('Recovery grant')).toBeInTheDocument();
    expect(
      within(ship).getByText('Supplied by the recovery service: this hull and its equipment cannot be sold or insured.'),
    ).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Hangar' }));
    const hangarGrants = panel('Hangar and hold').querySelectorAll('tr[data-recovery-grant="true"]');
    expect(hangarGrants.length).toBe(2);
    for (const row of hangarGrants) {
      expect(within(row as HTMLElement).getByText('Recovery grant')).toBeInTheDocument();
    }

    await harness.user.click(screen.getByRole('button', { name: 'Market' }));
    const granted = panel('Local market').querySelector('tr[data-recovery-grant="true"]');
    if (!(granted instanceof HTMLElement)) throw new Error('No recovery-grant row is offered for sale.');
    expect(within(granted).getByText('Recovery grant')).toBeInTheDocument();
    await harness.user.click(within(granted).getByRole('button', { name: /^Sell / }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm sale' });
    expect(await within(dialog).findByText('Recovery-grant items cannot be sold.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  }, 60_000);
});

describe('going back for the wreck', () => {
  it('lists the wreck in the departure panel and chooses it [FUNC-5.4, FUNC-9.12, MVP-AC-08]', async () => {
    const harness = await resume(await lostWithGrant(), 'Borrell Harbour');
    const report = await lossReport(harness);

    await harness.user.click(screen.getByRole('button', { name: 'Departure' }));
    const table = screen.getByRole('table', { name: 'Your wrecks in this system' });
    const row = table.querySelector(`[data-bookmark="${report.wreck.wreckId}"]`);
    if (!(row instanceof HTMLElement)) throw new Error('The wreck is not offered as a destination.');
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Your Wayfarer wreck at Outpost Cradle');
    expect(within(row).getByText('Pirate Base, tier 3')).toBeInTheDocument();
    expect(within(row).getByText(/^Stacks left: 1\. Expires in 1h 59m\.$/)).toBeInTheDocument();

    await harness.user.click(within(row).getByRole('button', { name: 'Choose your wreck at Outpost Cradle' }));
    await waitFor(async () => {
      const destinations = await ask<DestinationsData>(harness, 'navigation.destinations');
      expect(destinations.selectedBookmarkId).toBe(report.wreck.wreckId);
      expect(destinations.selectedEncounterId).toBeNull();
    });
    expect(await screen.findByText('Destination: your wreck at Outpost Cradle')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Chosen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Undock/ })).toBeEnabled();

    harness.gateway.dispose();
  }, 60_000);

  it('offers the wreck chosen at the station in the warp chooser and warps beside it [FUNC-7.3, FUNC-9.12, MVP-AC-08, TECH-12.3]', async () => {
    const sortie = await lostWithGrant();
    const wreckId = (await sortie.data<{ report: LossData }>('loss.report')).report.wreck.wreckId;
    await sortie.data('navigation.selectBookmark', { bookmarkId: wreckId });
    await sortie.data('ship.undock');
    const harness = await resume(sortie, 'Borrell Harbour');
    await screen.findByRole('heading', { name: 'Commands' });

    const chooser = screen.getByLabelText('Destination');
    expect(chooser).toHaveValue(`bookmark:${wreckId}`);
    expect(within(chooser).getByRole('option', { name: 'Your wreck at Outpost Cradle' })).toBeInTheDocument();
    // The encounter sites are still offered beside it.
    expect(within(chooser).getByRole('option', { name: 'Pirate Scout' })).toBeInTheDocument();

    await harness.user.selectOptions(screen.getByLabelText('Arrive at'), '0');
    await harness.user.click(screen.getByRole('button', { name: /^Warp/ }));

    await waitFor(async () => {
      const site = await ask<SiteData>(harness, 'navigation.site');
      expect(site.travelStatus).toMatchObject({
        kind: 'warp',
        destinationSiteId: BASE_SITE,
        bookmarkId: wreckId,
        arrivalDistanceKm: 0,
      });
    });
    expect(await screen.findByText(/^Aligning for warp to your wreck at Outpost Cradle/)).toBeInTheDocument();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  }, 60_000);
});

describe('autosave', () => {
  /**
   * The engine's gateway, with one change: the next `time.advance` answers
   * with an autosave trigger, as a dock, an arrival, a completion or a
   * destruction would. Every save request is counted.
   */
  function triggeringGateway(sortie: Sortie): {
    gateway: ClientGateway;
    trigger(): void;
    saves: string[];
  } {
    const inner = createDirectGateway({ host: sortie.host, defaultTimeoutMs: 5_000 });
    const saves: string[] = [];
    let armed = false;
    const gateway: ClientGateway = {
      transport: inner.transport,
      request: (async (type: string, payload: unknown, options?: unknown) => {
        if (type === 'campaign.save') saves.push((payload as { kind: string }).kind);
        const response = await inner.request(type as 'time.advance', payload as never, options as never);
        if (type === 'time.advance' && armed && response.ok) {
          armed = false;
          return { ...response, data: { ...response.data, autosaveRequested: true } };
        }
        return response;
      }) as ClientGateway['request'],
      sendEnvelope: (message, options) => inner.sendEnvelope(message, options),
      dispose: () => {
        inner.dispose();
      },
    };
    return {
      gateway,
      trigger: () => {
        armed = true;
      },
      saves,
    };
  }

  it('answers an autosave an elapsed quantum asks for, exactly once [FUNC-3.4, FUNC-9.12, TECH-11.3]', async () => {
    const sortie = await startSortie();
    const { gateway, trigger, saves } = triggeringGateway(sortie);
    const harness = await resume(sortie, 'Borrell Harbour', gateway);
    // Whatever resuming saved has settled before the trigger is armed.
    await waitFor(() => {
      expect(screen.getByLabelText('Campaign save status').textContent).not.toMatch(/Saving/);
    });
    const before = saves.length;

    trigger();
    await waitFor(() => {
      expect(saves.length).toBe(before + 1);
    });
    // Frames keep advancing; nothing asks again, so nothing saves again.
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(saves.slice(before)).toEqual(['auto']);
    await waitFor(async () => {
      const slot = await ask<{ status: { lastSaveKind: string | null } }>(harness, 'campaign.saves');
      expect(slot.status.lastSaveKind).toBe('auto');
    });

    harness.gateway.dispose();
  }, 30_000);
});
