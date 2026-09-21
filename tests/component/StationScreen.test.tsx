import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { createDirectGateway } from '@gateway/direct';
import { EMPTY_PAYLOAD, type AssetsData } from '@protocol';
import type { LocalizationIssue } from '@shared';
import { GameRoot, LocalizationProvider } from '@ui';

import { shippedContent } from '../support/content.ts';

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

function renderGame(options: {
  onIssue?: (issue: LocalizationIssue) => void;
  strict?: boolean;
} = {}) {
  const store = createMemorySaveStore();
  const gateway = createDirectGateway({
    host: createEngineHost({ content: shippedContent(), saves: store }),
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
    for (const service of ['Market', 'Hangar', 'Fitting', 'Services', 'Ship']) {
      expect(screen.getByRole('button', { name: service })).toBeEnabled();
    }

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
    await openPanel(harness, 'Ship');

    // The hull's name is authored beside the content, not in the interface
    // catalogue, so seeing it proves the content catalogue reached the UI.
    expect(await screen.findByText('Wayfarer')).toBeInTheDocument();

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

describe('market', () => {
  it('shows both quote sides and the stock the engine holds [FUNC-11.1, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    const quotes = await screen.findByRole('table', { name: /items quoted here/ });
    const row = within(quotes).getByRole('rowheader', { name: 'Fusion S' }).closest('tr');
    expect(row).not.toBeNull();
    // Base price 9, spread 8%: the station sells at 10 and buys at 8.
    expect(within(row as HTMLElement).getByText('10 ISK')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('8 ISK')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Always stocked')).toBeInTheDocument();

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
    // 10 rounds at 10 ISK each leaves 19,900 of the starting 20,000.
    await waitFor(() => {
      expect(within(dialog).getByText('19,900 ISK')).toBeInTheDocument();
    });

    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm purchase' })).not.toBeInTheDocument();
    });

    const after = await assets(harness);
    expect(after.credits).toBe(19_900);
    const fusion = after.inventories
      .flatMap((inventory) => inventory.stacks)
      .filter((stack) => stack.item.definitionId === FUSION)
      .reduce((total, stack) => total + stack.quantity, 0);
    // 40 in the hangar, 20 loaded in the magazine, 10 just bought.
    expect(fusion).toBe(70);

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
    expect((await assets(harness)).credits).toBe(20_000 - 50);

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
      expect(within(dialog).getByRole('button', { name: /Confirm/ })).toBeDisabled();
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

  it('sells what the hangar holds and credits the wallet [MVP-AC-06]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Market');

    await harness.user.click(screen.getByRole('button', { name: 'Sell Fusion S' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm sale' });
    // 40 spare rounds at the station's buy price of 8.
    await waitFor(() => {
      expect(within(dialog).getByText('20,320 ISK')).toBeInTheDocument();
    });

    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm sale' })).not.toBeInTheDocument();
    });
    expect((await assets(harness)).credits).toBe(20_320);

    harness.gateway.dispose();
  });
});

describe('hangar', () => {
  it('moves a stack between the hangar and the hold [FUNC-6.2, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Hangar');

    const before = await assets(harness);
    const cargoId = before.inventories.find(
      (inventory) =>
        inventory.location.kind === 'cargo' && inventory.location.shipId === before.activeShipId,
    )?.id;

    await harness.user.click((await screen.findAllByRole('button', { name: 'Move to hold' }))[0] as HTMLElement);

    await waitFor(async () => {
      const after = await assets(harness);
      const inCargo = after.inventories
        .filter((inventory) => inventory.id === cargoId)
        .flatMap((inventory) => inventory.stacks);
      expect(inCargo).toHaveLength(1);
      expect(inCargo[0]?.quantity).toBe(40);
    });

    harness.gateway.dispose();
  });
});

describe('fitting', () => {
  it('opens a draft, changes a slot and applies it [FUNC-8.4, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    // A second module has to be owned before a slot has anything to offer.
    await openPanel(harness, 'Market');
    await harness.user.click(screen.getByRole('button', { name: 'Buy Small Armour Plating' }));
    const purchase = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    await harness.user.click(within(purchase).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm purchase' })).not.toBeInTheDocument();
    });

    await openPanel(harness, 'Fitting');
    await harness.user.click(screen.getByRole('button', { name: 'Change fit' }));

    const slot = await screen.findByLabelText('Module in Engineering 1');
    await harness.user.selectOptions(
      slot,
      within(slot).getByRole('option', { name: /Small Armour Plating/ }),
    );

    const apply = await screen.findByRole('button', { name: 'Apply fit' });
    await waitFor(() => {
      expect(apply).toBeEnabled();
    });
    await harness.user.click(apply);

    await waitFor(async () => {
      const response = await harness.gateway.request('ship.get', {
        shipId: (await assets(harness)).activeShipId,
      });
      expect(response.ok).toBe(true);
      if (response.ok) {
        const fitted = response.data.slots
          .filter((entry) => entry.module !== null)
          .map((entry) => entry.module?.definitionId);
        expect(fitted).toContain('module.plating.armor.small');
      }
    });

    harness.gateway.dispose();
  });
});

describe('services', () => {
  it('previews insurance and commits it [FUNC-10, MVP-AC-02]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Services');

    await harness.user.click(screen.getByRole('button', { name: 'Improve insurance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm insurance' });

    await within(dialog).findByText('Basic');
    await harness.user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm insurance' })).not.toBeInTheDocument();
    });
    expect((await assets(harness)).credits).toBeLessThan(20_000);

    harness.gateway.dispose();
  });

  it('refuses a repair there is no damage for, and says so [FUNC-22.10]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Services');

    await harness.user.click(screen.getByRole('button', { name: 'Repair the ship' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm repair' });

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Confirm/ })).toBeDisabled();
    });
    expect(within(dialog).getAllByText(/already fully repaired/)[0]).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

describe('ship', () => {
  it('explains a derived statistic instead of asserting it [FUNC-19.6, MVP-AC-04]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await openPanel(harness, 'Ship');

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
    await openPanel(harness, 'Ship');

    expect(
      await screen.findByRole('status', { name: 'Undock readiness' }),
    ).toHaveTextContent('This fit is valid; the ship may undock.');

    harness.gateway.dispose();
  });

  it('renders every string from the catalogue [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const harness = renderGame({ onIssue });
    await startCampaign(harness);

    for (const panel of ['Market', 'Hangar', 'Fitting', 'Services', 'Ship']) {
      await openPanel(harness, panel);
    }

    expect(onIssue.mock.calls.map(([issue]) => issue)).toEqual([]);

    harness.gateway.dispose();
  });
});
