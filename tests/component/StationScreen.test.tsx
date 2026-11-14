import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import {
  captureSnapshot,
  createEngineHost,
  DEFAULT_SAVE_RETENTION,
  DEFAULT_SLOT_ID,
  ENGINE_VERSION,
  type CampaignState,
  type ContentRepository,
} from '@engine';
import { createDirectGateway } from '@gateway/direct';
import { EMPTY_PAYLOAD, PROTOCOL_VERSION, type AssetsData, type RepairPreviewData } from '@protocol';
import { cubicDecimetres, type LocalizationIssue } from '@shared';
import { GameRoot, LocalizationProvider } from '@ui';

import { shippedContent } from '../support/content.ts';
import { testCampaign } from '../support/campaign.ts';

/**
 * The station interface (MVP-AC-01, MVP-AC-02, MVP-AC-04, MVP-AC-06).
 *
 * Every case drives the real components against the real engine over the
 * in-process gateway, so what is asserted is what a player would see and what
 * the engine actually holds afterwards. Nothing is stubbed: a price shown here
 * came out of the quote service, and a purchase asserted here moved credits.
 */

const PILOT = 'Vela Trask';
const FUSION = 'ammo.projectile.small.fusion';
const RAILGUN = 'module.turret.railgun.small';
const IRON_NAME = 'Iron Charge S';

/** Rounds the grant leaves in the hold once the starting fit is loaded. */
const spareRounds = (() => {
  const content = shippedContent();
  const granted = content.rules.economy.startingItems.find(
    (item) => item.definitionId === FUSION,
  )?.quantity ?? 0;
  const turret = content.module('module.turret.autocannon.small');
  return granted - (turret?.category === 'turret' ? turret.turret.magazineSize : 0);
})();

function renderGame(options: {
  onIssue?: (issue: LocalizationIssue) => void;
  strict?: boolean;
  content?: ContentRepository;
} = {}) {
  const store = createMemorySaveStore();
  const gateway = createDirectGateway({
    host: createEngineHost({ content: options.content ?? shippedContent(), saves: store }),
    defaultTimeoutMs: 5_000,
  });

  const game = (
    <LocalizationProvider {...(options.onIssue === undefined ? {} : { onIssue: options.onIssue })}>
      <GameRoot gateway={gateway} />
    </LocalizationProvider>
  );
  render(options.strict === true ? <StrictMode>{game}</StrictMode> : game);

  return { gateway, store, user: userEvent.setup() };
}

type Harness = ReturnType<typeof renderGame>;

async function startCampaign(harness: Harness): Promise<void> {
  const field = await screen.findByLabelText('Pilot name');
  await harness.user.type(field, PILOT);
  await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
  await screen.findByText(PILOT);
  // The hub is ready once the station projection has named the station.
  await screen.findByRole('heading', { level: 2, name: 'Borrell Harbour' });
}

async function openPanel(harness: Harness, name: string): Promise<void> {
  await harness.user.click(screen.getByRole('button', { name }));
}

async function assets(harness: Harness): Promise<AssetsData> {
  const response = await harness.gateway.request('assets.list', EMPTY_PAYLOAD);
  if (!response.ok) {
    throw new Error('The engine refused assets.list.');
  }
  return response.data;
}

describe('station hub', () => {
  it('loads the station projections under development StrictMode [TECH-12.1]', async () => {
    const harness = renderGame({ strict: true });

    await startCampaign(harness);

    expect(screen.getByText('Docked at Borrell Harbour')).toBeInTheDocument();
    expect(screen.queryByText("Reading the ship’s position…")).not.toBeInTheDocument();
    harness.gateway.dispose();
  });

  it('names the station and its services from projections [MVP-AC-02, FUNC-19.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    expect(screen.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeInTheDocument();
    for (const service of ['Market', 'Hangar', 'Fitting', 'Ships']) {
      expect(screen.getByRole('button', { name: service })).not.toBeUnavailable();
    }
    expect(screen.getByRole('region', { name: 'Services' })).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('shows the wallet and the clock in the persistent frame [FUNC-19.1]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    expect(screen.getByText('20,000 ISK')).toBeInTheDocument();
    expect(screen.getByText('Docked at Borrell Harbour')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('resolves authored content names through the engine [TECH-12.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Ships');

    // The hull's name is authored beside the content, not in the interface
    // catalogue, so seeing it proves the content catalogue reached the UI.
    expect((await screen.findAllByText('Wayfarer'))[0]).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('switches surfaces with the registered keyboard shortcut [TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await harness.user.keyboard('m');

    expect(await screen.findByRole('heading', { name: 'Local market' })).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

/** Buys from the market's Buy mode into the station hangar, confirming the total. */
async function buyThroughMarket(harness: Harness, item: string, quantity: number): Promise<void> {
  await openPanel(harness, 'Market');
  await harness.user.click(screen.getByRole('radio', { name: 'Buy' }));
  await harness.user.click(screen.getByRole('button', { name: `Buy ${item}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
  await harness.user.clear(within(dialog).getByLabelText('Quantity'));
  await harness.user.type(within(dialog).getByLabelText('Quantity'), String(quantity));
  await within(dialog).findByText(`${String(quantity)} × ${item}`);
  const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
  await waitFor(() => {
    expect(confirm).not.toBeUnavailable();
  });
  await harness.user.click(confirm);
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Confirm purchase' })).not.toBeInTheDocument();
  });
}

describe('market', () => {
  it('buys at one price, and sells what the player owns here at the other [FUNC-11.1, FUNC-11.3, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    // Buy is the default: the player's purchase price and the stock, only.
    expect(screen.getByRole('radio', { name: 'Buy' })).toBeChecked();
    const quotes = await screen.findByRole('table', { name: /items quoted here/ });
    const row = within(quotes).getByRole('rowheader', { name: 'Fusion S' }).closest('tr') as HTMLElement;
    // Base price 8, spread 8%: the station sells at 9 and buys at 7.
    expect(within(row).getByText('9 ISK')).toBeInTheDocument();
    expect(within(row).queryByText('7 ISK')).not.toBeInTheDocument();
    expect(within(row).getByText('Always stocked')).toBeInTheDocument();
    expect(within(quotes).queryByRole('columnheader', { name: 'You receive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sell / })).not.toBeInTheDocument();

    // Sell lists what is held locally, where it is, and what the station pays.
    await harness.user.click(screen.getByRole('radio', { name: 'Sell' }));
    const owned = await screen.findByRole('table', { name: /Stacks you own here/ });
    expect(within(owned).queryByRole('columnheader', { name: 'You pay' })).not.toBeInTheDocument();
    const rounds = within(owned).getByRole('rowheader', { name: 'Fusion S' }).closest('tr') as HTMLElement;
    expect(within(rounds).getByText('Hold')).toBeInTheDocument();
    expect(within(rounds).getByText('7 ISK')).toBeInTheDocument();
    expect(within(rounds).getByText(String(spareRounds))).toBeInTheDocument();
    // The fitted autocannon and its loaded magazine are not offered.
    expect(within(owned).queryByRole('rowheader', { name: '200mm Autocannon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Buy / })).not.toBeInTheDocument();

    // The search applies to the active mode, and the choice survives it.
    await harness.user.type(screen.getByLabelText('Find an item'), 'zzz');
    expect(within(owned).queryByRole('rowheader', { name: 'Fusion S' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sell' })).toBeChecked();

    harness.gateway.dispose();
  });

  it('shows the slot a module fits and which charges suit the current fit [FUNC-8.3, FUNC-8.4, FUNC-19.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    await screen.findByRole('table', { name: /items quoted here/ });
    const rowOf = (name: string): HTMLElement =>
      within(screen.getByRole('table', { name: /items quoted here/ }))
        .getByRole('rowheader', { name }).closest('tr') as HTMLElement;
    expect(within(rowOf('200mm Autocannon')).getByText('Weapon slot, turret hardpoint')).toBeInTheDocument();
    expect(within(rowOf('Small Armour Plating')).getByText('Engineering slot')).toBeInTheDocument();
    expect(within(rowOf('Fusion S')).getByText('For 200mm Autocannon')).toBeInTheDocument();
    expect(within(rowOf('Fusion S')).getByText('Fits a weapon you have fitted')).toBeInTheDocument();
    expect(within(rowOf(IRON_NAME)).getByText('For 75mm Railgun')).toBeInTheDocument();
    expect(within(rowOf(IRON_NAME)).getByText('No fitted weapon uses it')).toBeInTheDocument();

    // Refit the weapon slot with a railgun: the marks follow the applied fit.
    await buyThroughMarket(harness, '75mm Railgun', 1);
    await openPanel(harness, 'Fitting');
    await chooseModule(harness, 'Weapon 1', /75mm Railgun/);
    const apply = await screen.findByRole('button', { name: 'Apply fit' });
    await waitFor(() => {
      expect(apply).not.toBeUnavailable();
    });
    await harness.user.click(apply);
    await waitFor(async () => {
      const ship = await harness.gateway.request('ship.get', { shipId: (await assets(harness)).activeShipId! });
      expect(ship.ok && ship.data.slots.some((entry) => entry.module?.definitionId === RAILGUN)).toBe(true);
    });
    await openPanel(harness, 'Market');

    await waitFor(() => {
      expect(within(rowOf(IRON_NAME)).getByText('Fits a weapon you have fitted')).toBeInTheDocument();
    });
    expect(within(rowOf('Fusion S')).getByText('No fitted weapon uses it')).toBeInTheDocument();

    // Inspection repeats it, with the one price of the mode it was opened from.
    await harness.user.click(screen.getByRole('button', { name: `Inspect ${IRON_NAME}` }));
    const detail = await screen.findByRole('dialog', { name: 'Item details' });
    expect(within(detail).getByText('You pay')).toBeInTheDocument();
    expect(within(detail).queryByText('You receive')).not.toBeInTheDocument();
    expect(within(detail).getByText('For 75mm Railgun')).toBeInTheDocument();
    expect(within(detail).getByText('Fits a weapon you have fitted')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('buys through preview and confirmation, and moves credits [MVP-AC-02, MVP-AC-06, TECH-7.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    await harness.user.click(screen.getByRole('button', { name: 'Buy Fusion S' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    await harness.user.clear(within(dialog).getByLabelText('Quantity'));
    await harness.user.type(within(dialog).getByLabelText('Quantity'), '10');

    await within(dialog).findByText('10 × Fusion S');
    // 10 rounds at 9 ISK each leaves 19,910 of the starting 20,000.
    await waitFor(() => {
      expect(within(dialog).getByText('19,910 ISK')).toBeInTheDocument();
    });

    const fusionBefore = (await assets(harness)).inventories
      .flatMap((inventory) => inventory.stacks)
      .filter((stack) => stack.item.definitionId === FUSION)
      .reduce((total, stack) => total + stack.quantity, 0);

    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm purchase' })).not.toBeInTheDocument();
    });

    const after = await assets(harness);
    expect(after.credits).toBe(19_910);
    const fusionAfter = after.inventories
      .flatMap((inventory) => inventory.stacks)
      .filter((stack) => stack.item.definitionId === FUSION)
      .reduce((total, stack) => total + stack.quantity, 0);
    // Exactly the ten rounds bought were added to what the campaign granted.
    expect(fusionAfter).toBe(fusionBefore + 10);

    harness.gateway.dispose();
  });

  it('explains the price it is about to charge [FUNC-19.6, MVP-AC-04]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    await harness.user.click(screen.getByRole('button', { name: 'Buy Fusion S' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });

    await harness.user.click(within(dialog).getAllByText('Show the calculation')[0] as HTMLElement);

    expect(
      within(dialog).getAllByText(/station sell price = mid price/)[0],
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText('Base price')[0]).toBeInTheDocument();
    expect(within(dialog).getAllByText('Effective spread')[0]).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('replaces a preview the campaign moved past and asks again [TECH-7.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    await harness.user.click(screen.getByRole('button', { name: 'Buy Fusion S' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    await within(dialog).findByText('1 × Fusion S');

    // Something else spends credits while the player is deciding. The screen
    // has not been told, so the token it holds is now bound to stale state.
    const station = 'station.borrell.harbour';
    const elsewhere = await harness.gateway.request('market.previewBuy', {
      stationId: station,
      itemId: FUSION,
      quantity: 5,
    });
    expect(elsewhere.ok && elsewhere.data.token).not.toBeNull();
    if (elsewhere.ok && elsewhere.data.token !== null) {
      await harness.gateway.request('market.confirmBuy', { token: elsewhere.data.token });
    }

    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(
      await within(dialog).findByText(/Something changed while you were deciding/),
    ).toBeInTheDocument();
    // The purchase did not go through on the stale token: only the five bought
    // elsewhere left the wallet.
    expect((await assets(harness)).credits).toBe(20_000 - 45);

    harness.gateway.dispose();
  });

  it('says why an unaffordable purchase is refused rather than hiding it [FUNC-22.10]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    // The starter hull costs more than twice the starting wallet allows once
    // a large enough quantity is asked for.
    await harness.user.click(screen.getByRole('button', { name: 'Buy Wayfarer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    await harness.user.clear(within(dialog).getByLabelText('Quantity'));
    await harness.user.type(within(dialog).getByLabelText('Quantity'), '5');

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Confirm/ })).toBeUnavailable();
    });
    expect(
      within(dialog).getAllByText(/wallet does not have enough credits/)[0],
    ).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('returns focus to the control that opened a dialog [TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    const opener = screen.getByRole('button', { name: 'Buy Fusion S' });
    await harness.user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });

    await harness.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(opener).toHaveFocus();
    });

    harness.gateway.dispose();
  });

  it('closes a dialog on Escape [TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    await harness.user.click(screen.getByRole('button', { name: 'Buy Fusion S' }));
    await screen.findByRole('dialog', { name: 'Confirm purchase' });

    await harness.user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm purchase' })).not.toBeInTheDocument();
    });

    harness.gateway.dispose();
  });

  it('sells from the hangar and from the hold, and credits the wallet [MVP-AC-06, FUNC-11.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    // Rounds in the hangar as well as the spares in the hold.
    await openPanel(harness, 'Market');
    await buyThroughMarket(harness, 'Fusion S', 5);
    await harness.user.click(screen.getByRole('radio', { name: 'Sell' }));

    for (const source of ['Hangar', 'Hold']) {
      const before = (await assets(harness)).credits;
      await harness.user.click(await screen.findByRole('button', { name: `Sell Fusion S (${source})` }));
      const dialog = await screen.findByRole('dialog', { name: 'Confirm sale' });
      // Sell one unit rather than the whole stack.
      await harness.user.clear(within(dialog).getByLabelText('Quantity'));
      await harness.user.type(within(dialog).getByLabelText('Quantity'), '1');
      await within(dialog).findByText('1 × Fusion S');

      // The dialog names the total it is about to pay; the committed sale must
      // move the wallet by exactly that (Functional Specification 22.4).
      const total = await waitFor(() => {
        const label = [...dialog.querySelectorAll('dt')].find((node) => node.textContent === 'Total');
        const parsed = Number((label?.nextElementSibling?.textContent ?? '').replace(/[^0-9]/g, ''));
        expect(parsed).toBe(7);
        return parsed;
      });

      await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Confirm sale' })).not.toBeInTheDocument();
      });
      expect((await assets(harness)).credits).toBe(before + total);
    }

    await waitFor(() => {
      const owned = screen.getByRole('table', { name: /Stacks you own here/ });
      const quantities = [...owned.querySelectorAll('tbody tr')]
        .filter((row) => within(row as HTMLElement).queryByRole('rowheader', { name: 'Fusion S' }) !== null)
        .map((row) => [row.getAttribute('data-source'), row.querySelectorAll('td')[2]?.textContent]);
      expect(quantities).toEqual([['hangar', '4'], ['cargo', String(spareRounds - 1)]]);
    });

    harness.gateway.dispose();
  });
});

describe('hangar', () => {
  /** The quantities of the plain stacks in the hangar or the active hold. */
  async function quantitiesIn(harness: Harness, kind: 'cargo' | 'hangar'): Promise<number[]> {
    const snapshot = await assets(harness);
    return snapshot.inventories
      .filter((inventory) =>
        kind === 'cargo'
          ? inventory.location.kind === 'cargo' && inventory.location.shipId === snapshot.activeShipId
          : inventory.location.kind === 'hangar')
      .flatMap((inventory) => inventory.stacks)
      .filter((stack) => stack.state.kind === 'plain')
      .map((stack) => stack.quantity);
  }

  const table = (name: 'Station hangar' | 'Ship cargo hold') => screen.getByRole('table', { name });

  /**
   * The shipped content with a starter hold of 250 dm³ (0.25 m³): room for the
   * 100 spare rounds and 25 more. The compiled bundle is digest-checked, so the
   * one hull is replaced on the repository rather than in the bundle.
   */
  function smallHold(): ContentRepository {
    const base = shippedContent();
    const starter = base.hulls().find((hull) => hull.id === base.rules.economy.starterHullId);
    if (starter === undefined) throw new Error('No starter hull.');
    const small = { ...starter, cargoCapacityCubicDecimetres: cubicDecimetres(250) };
    const swap = <T extends { readonly id: string }>(hull: T): T =>
      (hull.id === starter.id ? (small as unknown as T) : hull);
    return {
      ...base,
      hull: (id) => (id === starter.id ? small : base.hull(id)),
      requireHull: (id) => (id === starter.id ? small : base.requireHull(id)),
      hulls: () => base.hulls().map(swap),
    };
  }

  it('moves one, all and a typed quantity in both directions [FUNC-6.2, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Hangar');

    // Two columns, each with its own stacks: the spare rounds start in the hold.
    expect(screen.getByRole('heading', { name: 'Station hangar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ship cargo hold' })).toBeInTheDocument();
    expect(within(table('Ship cargo hold')).getByRole('rowheader', { name: 'Fusion S' })).toBeInTheDocument();
    expect(screen.getByText(/m³ free/)).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Move one Fusion S to the hangar' }));
    await waitFor(async () => {
      expect(await quantitiesIn(harness, 'hangar')).toEqual([1]);
      expect(await quantitiesIn(harness, 'cargo')).toEqual([spareRounds - 1]);
    });

    const typed = await within(table('Ship cargo hold')).findByLabelText('Units of Fusion S to move');
    await harness.user.type(typed, '30');
    await harness.user.click(screen.getByRole('button', { name: 'Move the typed number of Fusion S to the hangar' }));
    await waitFor(async () => {
      expect(await quantitiesIn(harness, 'hangar')).toEqual([31]);
      expect(await quantitiesIn(harness, 'cargo')).toEqual([spareRounds - 31]);
    });
    // The typed number belonged to the old stack; it is not offered again.
    await waitFor(() => {
      expect(within(table('Ship cargo hold')).getByLabelText('Units of Fusion S to move')).toHaveValue(null);
    });

    await harness.user.click(screen.getByRole('button', { name: 'Move all Fusion S to the hold' }));
    await waitFor(async () => {
      expect(await quantitiesIn(harness, 'hangar')).toEqual([]);
      expect(await quantitiesIn(harness, 'cargo')).toEqual([spareRounds]);
    });

    await harness.user.click(screen.getByRole('button', { name: 'Move all Fusion S to the hangar' }));
    await waitFor(async () => {
      expect(await quantitiesIn(harness, 'hangar')).toEqual([spareRounds]);
      expect(await quantitiesIn(harness, 'cargo')).toEqual([]);
    });
    expect(await screen.findByText('Nothing stored here.')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('refuses a typed quantity that is blank, not whole or too many, and moves nothing [FUNC-6.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Hangar');

    const field = within(table('Ship cargo hold')).getByLabelText('Units of Fusion S to move');
    const move = screen.getByRole('button', { name: 'Move the typed number of Fusion S to the hangar' });
    expect(move).toBeUnavailable();
    expect(move).toHaveAccessibleDescription('Type how many units to move.');

    const cases: readonly (readonly [string, string])[] = [
      ['2.5', 'Type a whole number of units, 1 or more.'],
      ['-3', 'Type a whole number of units, 1 or more.'],
      ['0', 'Type a whole number of units, 1 or more.'],
      [String(spareRounds + 1), 'The stack does not have that many units.'],
    ];
    for (const [text, reason] of cases) {
      await harness.user.clear(field);
      await harness.user.type(field, text);
      expect(move).toBeUnavailable();
      expect(move).toHaveAccessibleDescription(reason);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      await harness.user.click(move);
    }

    expect(await quantitiesIn(harness, 'cargo')).toEqual([spareRounds]);
    expect(await quantitiesIn(harness, 'hangar')).toEqual([]);

    harness.gateway.dispose();
  });

  it('never shrinks All to fit, and Max moves what the engine says fits [FUNC-6.2]', async () => {
    const harness = renderGame({ content: smallHold() });
    await startCampaign(harness);
    // 100 spare rounds fill 0.2 of the 0.25 m³ hold; 25 more fit, 40 do not.
    await buyThroughMarket(harness, 'Fusion S', 40);
    await openPanel(harness, 'Hangar');

    const all = screen.getByRole('button', { name: 'Move all Fusion S to the hold' });
    await waitFor(() => {
      expect(all).toBeUnavailable();
    });
    expect(all).toHaveAccessibleDescription(
      'The hold cannot take the whole stack. Max moves as many as fit.',
    );
    await harness.user.click(all);

    const field = within(table('Station hangar')).getByLabelText('Units of Fusion S to move');
    const typed = screen.getByRole('button', { name: 'Move the typed number of Fusion S to the hold' });
    await harness.user.type(field, '30');
    expect(typed).toBeUnavailable();
    expect(typed).toHaveAccessibleDescription('The hold cannot take that many. Max moves as many as fit.');
    await harness.user.clear(field);
    await harness.user.type(field, '20');
    expect(typed).not.toBeUnavailable();

    // Nothing moved: not the refused All, not a partial version of it.
    expect(await quantitiesIn(harness, 'hangar')).toEqual([40]);
    expect(await quantitiesIn(harness, 'cargo')).toEqual([spareRounds]);

    // The engine refuses the whole stack too, atomically.
    const snapshot = await assets(harness);
    const stack = snapshot.inventories
      .find((inventory) => inventory.location.kind === 'hangar')
      ?.stacks[0];
    const hold = snapshot.inventories.find((inventory) =>
      inventory.location.kind === 'cargo' && inventory.location.shipId === snapshot.activeShipId);
    const refused = await harness.gateway.request('inventory.transfer', {
      stackId: stack?.id ?? '', destinationInventoryId: hold?.id ?? '', quantity: 40,
    });
    expect(refused.ok).toBe(false);
    expect(await quantitiesIn(harness, 'hangar')).toEqual([40]);

    await harness.user.click(screen.getByRole('button', { name: 'Move the max of Fusion S that fits to the hold' }));
    await waitFor(async () => {
      expect(await quantitiesIn(harness, 'hangar')).toEqual([15]);
      expect(await quantitiesIn(harness, 'cargo')).toEqual([spareRounds + 25]);
    });

    // A full hold: nothing more fits, and each control says so.
    const one = screen.getByRole('button', { name: 'Move one Fusion S to the hold' });
    await waitFor(() => {
      expect(one).toBeUnavailable();
    });
    expect(one).toHaveAccessibleDescription('The hold has no room for even one unit.');
    expect(screen.getByRole('button', { name: 'Move the max of Fusion S that fits to the hold' })).toBeUnavailable();
    expect(screen.getByText('0 m³ free')).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

/** Opens a slot's module list, starting the draft, and picks one choice. */
async function chooseModule(harness: Harness, slot: string, choice: string | RegExp): Promise<void> {
  await harness.user.click(screen.getByRole('button', { name: `Change module in ${slot}` }));
  const list = await screen.findByRole('group', { name: `Modules for ${slot}` });
  await harness.user.click(await within(list).findByRole('button', { name: choice }));
}

async function draftOf(harness: Harness) {
  const response = await harness.gateway.request('fitting.draft', EMPTY_PAYLOAD);
  if (!response.ok) throw new Error('The engine refused fitting.draft.');
  return response.data.draft;
}

async function shipOf(harness: Harness) {
  const response = await harness.gateway.request('ship.get', { shipId: (await assets(harness)).activeShipId! });
  if (!response.ok) throw new Error('The engine refused ship.get.');
  return response.data;
}

const slotRow = (slot: string): HTMLElement =>
  screen.getByRole('list', { name: 'Modules' }).querySelector(`[data-slot-name="${slot}"]`) as HTMLElement;

const weaponOneOnline = async (harness: Harness): Promise<boolean | undefined> =>
  (await shipOf(harness)).slots.find((entry) => entry.slot.kind === 'weapon' && entry.slot.index === 0)?.online;

describe('fitting', () => {
  it('edits the fit in place, previews it and applies it [FUNC-8.4, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await buyThroughMarket(harness, 'Small Armour Plating', 1);

    // One compact surface: the ship, every slot (empty ones too) and the
    // weapons, with no draft open and nothing to apply yet.
    await openPanel(harness, 'Fitting');
    expect(screen.getByText(/^This is the fit your ship is wearing\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ship' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weapons' })).toBeInTheDocument();
    expect(within(slotRow('Engineering 1')).getByText('Empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply fit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change fit' })).not.toBeInTheDocument();
    expect(await draftOf(harness)).toBeNull();

    // The empty slot's picker opens the draft and lists what may go there,
    // with local availability and fitting cost.
    await harness.user.click(screen.getByRole('button', { name: 'Change module in Engineering 1' }));
    const list = await screen.findByRole('group', { name: 'Modules for Engineering 1' });
    const plating = await within(list).findByRole('button', { name: /Small Armour Plating/ });
    expect(plating).toHaveTextContent(/1 available · .* power · .* processing/);
    expect(within(list).queryByRole('button', { name: 'Empty the slot' })).not.toBeInTheDocument();
    expect(await draftOf(harness)).not.toBeNull();
    await harness.user.click(plating);

    // The figures become the preview, the row says it changed, the ship has not.
    await screen.findByRole('heading', { name: 'The ship this draft would produce' });
    expect(within(slotRow('Engineering 1')).getByText('Small Armour Plating')).toBeInTheDocument();
    expect(within(slotRow('Engineering 1')).getByText('(changed)')).toBeInTheDocument();
    expect((await shipOf(harness)).slots.some((entry) => entry.module?.definitionId === 'module.plating.armor.small')).toBe(false);

    const apply = screen.getByRole('button', { name: 'Apply fit' });
    await waitFor(() => {
      expect(apply).not.toBeUnavailable();
    });
    await harness.user.click(apply);

    await waitFor(async () => {
      expect((await shipOf(harness)).slots.some((entry) => entry.module?.definitionId === 'module.plating.armor.small')).toBe(true);
    });
    expect(await draftOf(harness)).toBeNull();
    await screen.findByText(/^This is the fit your ship is wearing\./);

    harness.gateway.dispose();
  }, 30_000);

  it('unloads a weapon, takes it offline and empties its slot, then reverts without moving anything [FUNC-8.4, FUNC-8.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    const before = await assets(harness);
    await openPanel(harness, 'Fitting');

    // Weapon 1 carries the autocannon and its rounds; its ammunition is a drop-down.
    expect(within(slotRow('Weapon 1')).getByText('200mm Autocannon')).toBeInTheDocument();
    expect(within(slotRow('Weapon 1')).getByText(/Fusion S \(\d+ loaded\)/)).toBeInTheDocument();
    await harness.user.click(screen.getByRole('button', { name: 'Change ammunition in Weapon 1' }));
    const charges = await screen.findByRole('group', { name: 'Ammunition for Weapon 1' });
    expect(await within(charges).findByRole('button', { name: /Fusion S/ })).toHaveAttribute('aria-pressed', 'true');
    await harness.user.click(within(charges).getByRole('button', { name: 'No ammunition' }));
    await waitFor(() => {
      expect(slotRow('Weapon 1')).toHaveAttribute('data-charge', '');
    });
    expect(await screen.findByText('This weapon has no ammunition loaded.')).toBeInTheDocument();

    // Offline: the preview warns that the module does nothing.
    await harness.user.click(screen.getByLabelText('Weapon 1 online'));
    await waitFor(() => {
      expect(screen.getByLabelText('Weapon 1 online')).not.toBeChecked();
    });
    expect(await screen.findByText('This module is offline and does nothing.')).toBeInTheDocument();

    // Empty the slot: the preview has nothing that can shoot.
    await chooseModule(harness, 'Weapon 1', 'Empty the slot');
    await waitFor(() => {
      expect(within(slotRow('Weapon 1')).getByText('Empty')).toBeInTheDocument();
    });
    expect(await screen.findByText('Nothing on this ship can shoot.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change ammunition in Weapon 1' })).not.toBeInTheDocument();

    // Discard: the committed ship and every store are exactly as they were.
    await harness.user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByText(/^This is the fit your ship is wearing\./);
    expect(await draftOf(harness)).toBeNull();
    expect(within(slotRow('Weapon 1')).getByText('200mm Autocannon')).toBeInTheDocument();
    expect(screen.getByLabelText('Weapon 1 online')).toBeChecked();
    const after = await assets(harness);
    const contents = (data: AssetsData) => data.inventories.map(({ revision: _revision, ...inventory }) => inventory);
    expect(contents(after)).toEqual(contents(before));
    expect(after.credits).toBe(before.credits);

    harness.gateway.dispose();
  }, 30_000);

  it('loads a new weapon with a charge it accepts, and reports a fit it cannot supply [FUNC-8.4, FUNC-22.10]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Fitting');

    // One autocannon is owned and it is already fitted: a second one in
    // Weapon 2 is offered, but the draft cannot be applied.
    await chooseModule(harness, 'Weapon 2', /200mm Autocannon/);
    await waitFor(() => {
      expect(slotRow('Weapon 2')).toHaveAttribute('data-module', 'module.turret.autocannon.small');
    });
    expect(slotRow('Weapon 2')).toHaveAttribute('data-charge', FUSION);
    expect(await screen.findByText('200mm Autocannon: 1 needed, 0 available.')).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: 'Apply fit' });
    expect(apply).toBeUnavailable();
    expect(apply).toHaveAccessibleDescription('Something this draft needs is missing, or the result would not fit.');

    harness.gateway.dispose();
  }, 30_000);

  it('asks to apply, discard or stay before leaving with unapplied changes [FUNC-8.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Fitting');

    // An opened but unchanged draft closes quietly on leaving, so it never
    // blocks undocking unseen.
    await harness.user.click(screen.getByRole('button', { name: 'Change module in Weapon 2' }));
    await screen.findByRole('group', { name: 'Modules for Weapon 2' });
    await harness.user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Modules for Weapon 2' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change module in Weapon 2' })).toHaveFocus();
    expect(await draftOf(harness)).not.toBeNull();
    await openPanel(harness, 'Hangar');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(async () => {
      expect(await draftOf(harness)).toBeNull();
    });

    // A changed draft asks first. Stay keeps the screen and the draft.
    await openPanel(harness, 'Fitting');
    await harness.user.click(screen.getByLabelText('Weapon 1 online'));
    await waitFor(() => {
      expect(screen.getByLabelText('Weapon 1 online')).not.toBeChecked();
    });
    await openPanel(harness, 'Market');
    let dialog = await screen.findByRole('dialog', { name: 'Apply fitting changes?' });
    await harness.user.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fitting' })).toBeInTheDocument();
    expect((await draftOf(harness))?.changed).toBe(true);

    // Discard leaves for the chosen surface with the ship untouched.
    await openPanel(harness, 'Market');
    dialog = await screen.findByRole('dialog', { name: 'Apply fitting changes?' });
    await harness.user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('heading', { name: 'Local market' });
    expect(await draftOf(harness)).toBeNull();
    expect(await weaponOneOnline(harness)).toBe(true);

    // Apply commits and then leaves.
    await openPanel(harness, 'Fitting');
    await harness.user.click(screen.getByLabelText('Weapon 1 online'));
    await waitFor(() => {
      expect(screen.getByLabelText('Weapon 1 online')).not.toBeChecked();
    });
    await openPanel(harness, 'Hangar');
    dialog = await screen.findByRole('dialog', { name: 'Apply fitting changes?' });
    await harness.user.click(within(dialog).getByRole('button', { name: 'Apply fit' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Fitting' })).not.toBeInTheDocument();
    expect(await draftOf(harness)).toBeNull();
    expect(await weaponOneOnline(harness)).toBe(false);

    harness.gateway.dispose();
  }, 30_000);
});

describe('services', () => {
  /**
   * Resumes a new docked campaign whose active ship is damaged as given, so
   * the priced repairs have something to price. The clock is paused, so
   * nothing regenerates while the test looks.
   */
  async function resumeDamaged(condition: {
    readonly damage: { readonly shield: number; readonly armor: number; readonly hull: number };
    readonly capacitorCharge?: number;
  }): Promise<Harness> {
    const content = shippedContent();
    const state = structuredClone(testCampaign()) as CampaignState;
    const shipId = state.assets.activeShipId!;
    const ship = state.assets.ships[shipId]!;
    (state.assets.ships as Record<string, unknown>)[shipId] = {
      ...ship,
      condition: {
        damage: condition.damage,
        capacitorCharge: condition.capacitorCharge ?? ship.condition.capacitorCharge,
      },
    };
    const store = createMemorySaveStore();
    const envelope = captureSnapshot({
      campaign: state, content, engineVersion: ENGINE_VERSION, protocolVersion: PROTOCOL_VERSION,
      slotId: DEFAULT_SLOT_ID, kind: 'auto', sequence: 1, savedAtRealMs: 1_700_000_600_000,
    });
    await store.write({ envelope, retention: DEFAULT_SAVE_RETENTION });
    const gateway = createDirectGateway({
      host: createEngineHost({ content, saves: store }),
      defaultTimeoutMs: 5_000,
    });
    render(
      <LocalizationProvider>
        <GameRoot gateway={gateway} />
      </LocalizationProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Resume campaign' }));
    await screen.findByRole('heading', { level: 2, name: 'Borrell Harbour' });
    return { gateway, store, user };
  }

  function services(): HTMLElement {
    return screen.getByRole('region', { name: 'Services' });
  }

  /** Waits for a service button to be priced, and returns it. */
  async function priced(name: RegExp): Promise<HTMLElement> {
    return waitFor(() => {
      const button = within(services()).getByRole('button', { name });
      expect(button).not.toHaveAccessibleName(/pricing/);
      return button;
    });
  }

  async function preview(harness: Harness, scope: 'armor' | 'hull' | 'all'): Promise<RepairPreviewData> {
    const shipId = (await assets(harness)).activeShipId!;
    const response = await harness.gateway.request('repair.preview', { shipId, scope });
    if (!response.ok) throw new Error('The engine refused repair.preview.');
    return response.data;
  }

  const isk = (credits: number): string => `${credits.toLocaleString('en')} ISK`;

  it('offers every service on the Overview with its price, and no Services surface [FUNC-10, FUNC-19.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    // The rail is the only way between surfaces; the Overview does not repeat it.
    expect(screen.queryByRole('button', { name: 'Services' })).not.toBeInTheDocument();
    for (const surface of ['Market', 'Hangar', 'Fitting', 'Ships', 'Departure']) {
      expect(screen.getAllByRole('button', { name: surface })).toHaveLength(1);
    }

    // A whole, charged ship has nothing to repair; each choice says why.
    const armor = await priced(/^Repair armour/);
    expect(armor).toBeUnavailable();
    expect(armor).toHaveAccessibleDescription(/The armour is not damaged/);
    const hull = within(services()).getByRole('button', { name: /^Repair hull/ });
    expect(hull).toBeUnavailable();
    expect(hull).toHaveAccessibleDescription(/The hull is not damaged/);
    const all = within(services()).getByRole('button', { name: /^Repair all/ });
    expect(all).toBeUnavailable();
    expect(all).toHaveAccessibleDescription(/already fully repaired and its capacitor is full/);
    // An operation with nothing to do names no price.
    expect(all).toHaveAccessibleName('Repair all');

    // Insurance can be bought; its button names the premium the engine quoted.
    const shipId = (await assets(harness)).activeShipId!;
    const quote = await harness.gateway.request('insurance.preview', { shipId });
    if (!quote.ok) throw new Error('The engine refused insurance.preview.');
    const insurance = await priced(/^Improve insurance/);
    expect(insurance).toHaveAccessibleName(`Improve insurance · ${isk(quote.data.totalCredits)}`);
    expect(insurance).not.toBeUnavailable();
    // The Services shortcut still works: it brings focus to the services here.
    await openPanel(harness, 'Market');
    await harness.user.keyboard('r');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Services' })).toHaveFocus();
    });

    harness.gateway.dispose();
  });

  it('previews insurance from the Overview and commits it [FUNC-10, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await harness.user.click(await priced(/^Improve insurance/));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm insurance' });

    await within(dialog).findByText('Basic');
    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm insurance' })).not.toBeInTheDocument();
    });
    expect((await assets(harness)).credits).toBeLessThan(20_000);
    await waitFor(() => {
      expect(within(services()).getByRole('button', { name: /^Improve insurance/ })).toBeUnavailable();
    });

    harness.gateway.dispose();
  });

  it('repairs armour only for the price on its button, leaving the hull [FUNC-10, TECH-7.4]', async () => {
    const harness = await resumeDamaged({ damage: { shield: 12, armor: 40, hull: 30 } });
    const armorQuote = await preview(harness, 'armor');
    const hullQuote = await preview(harness, 'hull');
    const allQuote = await preview(harness, 'all');
    expect(armorQuote.totalCredits).toBeGreaterThan(0);
    expect(hullQuote.totalCredits).toBeGreaterThan(0);

    expect(await priced(/^Repair armour/)).toHaveAccessibleName(`Repair armour · ${isk(armorQuote.totalCredits)}`);
    expect(await priced(/^Repair hull/)).toHaveAccessibleName(`Repair hull · ${isk(hullQuote.totalCredits)}`);
    expect(await priced(/^Repair all/)).toHaveAccessibleName(`Repair all · ${isk(allQuote.totalCredits)}`);

    const before = await assets(harness);
    await harness.user.click(within(services()).getByRole('button', { name: /^Repair armour/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm armour repair' });
    // The confirmation names the scope, the layer left alone and the exact total.
    expect(within(dialog).getByText(/Repair the armour only/)).toBeInTheDocument();
    expect(within(dialog).getByText(/not repaired by this choice/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(isk(armorQuote.totalCredits)).length).toBeGreaterThan(0);
    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const after = await assets(harness);
    expect(after.credits).toBe(before.credits - armorQuote.totalCredits);
    const ship = await harness.gateway.request('ship.get', { shipId: after.activeShipId! });
    if (!ship.ok) throw new Error('The engine refused ship.get.');
    const missing = Object.fromEntries(
      ship.data.layers.map((layer) => [layer.layer, layer.maximumHitPoints - layer.hitPoints]),
    );
    expect(missing).toEqual({ shield: 0, armor: 0, hull: 30 });
    // Armour has nothing left; hull keeps its price.
    await waitFor(() => {
      expect(within(services()).getByRole('button', { name: /^Repair armour/ })).toBeUnavailable();
    });
    expect(await priced(/^Repair hull/)).toHaveAccessibleName(`Repair hull · ${isk(hullQuote.totalCredits)}`);

    harness.gateway.dispose();
  }, 30_000);

  it('confirms a free whole repair for a shield and a capacitor alone [FUNC-10, FUNC-22.10]', async () => {
    const harness = await resumeDamaged({ damage: { shield: 25, armor: 0, hull: 0 }, capacitorCharge: 10 });

    expect(await priced(/^Repair armour/)).toBeUnavailable();
    expect(within(services()).getByRole('button', { name: /^Repair hull/ })).toBeUnavailable();
    const all = await priced(/^Repair all/);
    expect(all).toHaveAccessibleName(`Repair all · ${isk(0)}`);

    const before = await assets(harness);
    await harness.user.click(all);
    // Free is still confirmed, with its zero total.
    const dialog = await screen.findByRole('dialog', { name: 'Confirm full repair' });
    expect(within(dialog).getByText('25 points, restored for free')).toBeInTheDocument();
    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect((await assets(harness)).credits).toBe(before.credits);
    await waitFor(() => {
      expect(within(services()).getByRole('button', { name: /^Repair all/ })).toBeUnavailable();
    });

    harness.gateway.dispose();
  }, 30_000);
});

describe('ship', () => {
  it('explains a derived statistic instead of asserting it [FUNC-19.6, MVP-AC-04]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Ships');

    const row = (await screen.findByRole('rowheader', { name: 'Shield hit points' })).closest('tr');
    expect(row).not.toBeNull();
    await harness.user.click(
      within(row as HTMLElement).getByText('Show the calculation'),
    );

    expect(within(row as HTMLElement).getByText(/Hull base value/)).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(/Final value/)).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('reports whether the fit may undock [MVP-AC-02, FUNC-8.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Ships');

    expect(
      await screen.findByRole('status', { name: 'Undock readiness' }),
    ).toHaveTextContent('This fit is valid; the ship may undock.');

    harness.gateway.dispose();
  });

  it('renders every string from the catalogue [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const harness = renderGame({ onIssue });
    await startCampaign(harness);

    for (const panel of ['Market', 'Hangar', 'Fitting', 'Ships', 'Overview']) {
      await openPanel(harness, panel);
    }
    await screen.findByRole('button', { name: /^Improve insurance ·/ });

    expect(onIssue.mock.calls.map(([issue]) => issue)).toEqual([]);

    harness.gateway.dispose();
  });
});
