import { readFileSync } from 'node:fs';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost, DEFAULT_SAVE_RETENTION, type SaveEnvelope } from '@engine';
import { createDirectGateway } from '@gateway/direct';
import { EMPTY_PAYLOAD } from '@protocol';
import { canonicalJson } from '@shared';
import { GameRoot, LocalizationProvider } from '@ui';

import { shippedContent } from '../support/content.ts';

/**
 * Several ships at the station (Functional Specification 6.3, 19.5-19.6;
 * FeatureSpec02 4.2; v0.2 phase 1), and the start screen's handling of a v0.1
 * save (ADR-V02-01).
 *
 * Each case acts the way a player would: buy a hull through the market, look
 * at the Ships surface, fly the other ship, fit the one not flown, and load a
 * hold that is not the active ship's. What the engine then holds is asserted
 * through the gateway.
 */

const PILOT = 'Vela Trask';

function renderGame(store: MemorySaveStore = createMemorySaveStore()) {
  const gateway = createDirectGateway({
    host: createEngineHost({ content: shippedContent(), saves: store }),
    defaultTimeoutMs: 5_000,
  });
  render(
    <LocalizationProvider>
      <GameRoot gateway={gateway} />
    </LocalizationProvider>,
  );
  return { gateway, store, user: userEvent.setup() };
}

type Harness = ReturnType<typeof renderGame>;

async function startCampaign(harness: Harness): Promise<void> {
  await harness.user.type(await screen.findByLabelText('Pilot name'), PILOT);
  await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
  await screen.findByRole('heading', { level: 2, name: 'Borrell Harbour' });
}

/** Buys a second starter hull, which the starting wallet can afford. */
async function buySecondHull(harness: Harness): Promise<void> {
  await harness.user.click(screen.getByRole('button', { name: 'Market' }));
  await harness.user.click(screen.getByRole('radio', { name: 'Buy' }));
  await harness.user.click(screen.getByRole('button', { name: 'Buy Wayfarer' }));
  const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
  // A hull is a ship of its own: it arrives empty and is not cargo.
  expect(await within(dialog).findByText(/A hull arrives empty at this station/)).toBeVisible();
  expect(within(dialog).getByLabelText('Deliver to')).not.toBeVisible();
  const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
  await waitFor(() => {
    expect(confirm).not.toBeUnavailable();
  });
  await harness.user.click(confirm);
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Confirm purchase' })).not.toBeInTheDocument();
  });
}

async function activeShipId(harness: Harness): Promise<string | null> {
  const response = await harness.gateway.request('ships.list', EMPTY_PAYLOAD);
  if (!response.ok) throw new Error('ships.list was refused');
  return response.data.activeShipId;
}

describe('the Ships surface', () => {
  it('lists both ships, explains a bare hull, compares them and flies the other one [V02-AC-03, FUNC-6.3, FUNC-19.6]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    const first = await activeShipId(harness);
    await buySecondHull(harness);
    // Buying a hull leaves the ship the player flies active.
    expect(await activeShipId(harness)).toBe(first);

    await harness.user.click(screen.getByRole('button', { name: 'Ships' }));
    const list = await screen.findByRole('list', { name: 'Your ships' });
    const entries = within(list).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    const active = entries.find((entry) => entry.getAttribute('data-active') === 'true')!;
    const stored = entries.find((entry) => entry.getAttribute('data-active') !== 'true')!;
    // The active ship is marked in words, not by the border alone.
    expect(within(active).getByText('Active')).toBeVisible();
    expect(within(stored).getByText(/Nothing is fitted yet\. A bare hull is not ready to fight/)).toBeVisible();
    expect(within(active).getByRole('button', { name: /^Fly Wayfarer/ })).toBeUnavailable();
    expect(screen.getByRole('table', { name: /Your ships docked here, compared/ })).toBeVisible();

    const storedName = stored.getAttribute('aria-label')!;
    await harness.user.click(within(stored).getByRole('button', { name: `Fly ${storedName}` }));
    await waitFor(async () => {
      expect(await activeShipId(harness)).not.toBe(first);
    });
    await waitFor(() => {
      const now = within(screen.getByRole('list', { name: 'Your ships' })).getAllByRole('listitem')
        .find((entry) => entry.getAttribute('data-active') === 'true')!;
      expect(now.getAttribute('aria-label')).toBe(storedName);
    });

    harness.gateway.dispose();
  });

  it('fits the ship the player does not fly, and says so [V02-AC-03, FUNC-8.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    const first = await activeShipId(harness);
    await buySecondHull(harness);

    await harness.user.click(screen.getByRole('button', { name: 'Ships' }));
    const list = await screen.findByRole('list', { name: 'Your ships' });
    const stored = within(list).getAllByRole('listitem').find((entry) => entry.getAttribute('data-active') !== 'true')!;
    const storedName = stored.getAttribute('aria-label')!;
    await harness.user.click(within(stored).getByRole('button', { name: `Fit ${storedName}` }));

    expect(await screen.findByText(new RegExp(`You are fitting ${storedName}, which is not the ship you fly`))).toBeVisible();
    expect(screen.getByLabelText('Ship being fitted')).toHaveValue(stored.getAttribute('data-ship'));
    // The engine's draft belongs to the stored ship; the active one is untouched.
    const draft = await harness.gateway.request('fitting.draft', EMPTY_PAYLOAD);
    expect(draft.ok && draft.data.draft?.shipId).toBe(stored.getAttribute('data-ship'));
    expect(await activeShipId(harness)).toBe(first);

    harness.gateway.dispose();
  });

  it('loads the hold of a ship the player does not fly [V02-AC-03, FUNC-6.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await buySecondHull(harness);

    await harness.user.click(screen.getByRole('button', { name: 'Hangar' }));
    const choice = await screen.findByLabelText('Hold to load');
    const options = within(choice).getAllByRole('option');
    expect(options).toHaveLength(2);
    const other = options.find((option) => !/Active/.test(option.textContent ?? ''))!;
    await harness.user.selectOptions(choice, other);
    expect(await screen.findByText(/which is not the ship you fly\. It stays with that ship\./)).toBeVisible();

    harness.gateway.dispose();
  });
});

describe('the start screen and a v0.1 save', () => {
  /** A slot holding the representative v0.1 save, exactly as v0.1 wrote it. */
  async function v01Store(): Promise<{ store: MemorySaveStore; stored: string }> {
    const store = createMemorySaveStore();
    const envelope = JSON.parse(readFileSync('tests/fixtures/saves/format-10.json', 'utf8')) as SaveEnvelope;
    await store.write({ envelope, retention: DEFAULT_SAVE_RETENTION });
    return { store, stored: canonicalJson(envelope as unknown as Record<string, unknown>) };
  }

  it('explains that a v0.1 campaign cannot be continued and keeps it unchanged [V02-AC-13, TECH-11.4]', async () => {
    const { store, stored } = await v01Store();
    const harness = renderGame(store);

    expect(await screen.findByText(/This saved campaign is from Galactic Soup 0\.1/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Resume campaign' })).not.toBeInTheDocument();
    const [saveId] = store.saveIds();
    const kept = await store.readSave('slot-1', saveId!);
    expect(canonicalJson(kept as Record<string, unknown>)).toBe(stored);

    harness.gateway.dispose();
  });

  it('asks before a new campaign replaces the saved one [V02-AC-13, FUNC-3.4]', async () => {
    const { store } = await v01Store();
    const harness = renderGame(store);

    await harness.user.type(await screen.findByLabelText('Pilot name'), PILOT);
    await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
    // Nothing started yet: the player is asked first.
    const confirm = await screen.findByRole('button', { name: 'Replace it and start' });
    expect(screen.getByText(/replaces the saved campaign "Golden Pilot"/)).toBeVisible();
    await harness.user.click(screen.getByRole('button', { name: 'Keep the saved campaign' }));
    expect(screen.queryByRole('button', { name: 'Replace it and start' })).not.toBeInTheDocument();
    expect(store.saveIds()).toHaveLength(1);

    await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
    await harness.user.click(await screen.findByRole('button', { name: 'Replace it and start' }));
    await screen.findByRole('heading', { level: 2, name: 'Borrell Harbour' });
    void confirm;

    harness.gateway.dispose();
  });
});
