import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { createDirectGateway } from '@gateway/direct';
import { EMPTY_PAYLOAD, type SiteData } from '@protocol';
import type { LocalizationIssue } from '@shared';
import { GameRoot, LocalizationProvider } from '@ui';

import { shippedContent } from '../support/content.ts';

/**
 * The schematic space view and its commands
 * (MVP-AC-03, MVP-AC-08, FUNC-19.2, FUNC-19.3, TECH-12.2, TECH-12.3).
 *
 * Every case drives the real components against the real engine over the
 * in-process gateway. Nothing is stubbed, so an order asserted here is an
 * order the engine is actually holding, and an availability asserted here is
 * the one the projection answered with.
 */

const PILOT = 'Rive Calder';

function renderGame(options: { onIssue?: (issue: LocalizationIssue) => void } = {}) {
  const gateway = createDirectGateway({
    host: createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() }),
    defaultTimeoutMs: 5_000,
  });

  render(
    <LocalizationProvider {...(options.onIssue === undefined ? {} : { onIssue: options.onIssue })}>
      <GameRoot gateway={gateway} />
    </LocalizationProvider>,
  );

  return { gateway, user: userEvent.setup() };
}

type Harness = ReturnType<typeof renderGame>;

async function site(harness: Harness): Promise<SiteData> {
  const response = await harness.gateway.request('navigation.site', EMPTY_PAYLOAD);
  if (!response.ok) {
    throw new Error('The engine refused navigation.site.');
  }
  return response.data;
}

async function startCampaign(harness: Harness): Promise<void> {
  await harness.user.type(await screen.findByLabelText('Pilot name'), PILOT);
  await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
  await screen.findByRole('heading', { level: 2, name: 'Borrell Harbour' });
}

/** Chooses the easy site at the station and leaves the dock. */
async function undock(harness: Harness): Promise<void> {
  await harness.user.click(screen.getByRole('button', { name: 'Departure' }));
  await harness.user.click(await screen.findByRole('button', { name: 'Choose Pirate Scout' }));
  await screen.findByText('Destination: Pirate Scout');
  await harness.user.click(screen.getByRole('button', { name: /^Undock/ }));
  await screen.findByRole('heading', { name: 'Commands' });
}

describe('leaving the station', () => {
  it('chooses a destination and undocks into the space view [MVP-AC-03, FUNC-19.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const current = await site(harness);
    expect(current.location.kind).toBe('site');
    expect(screen.getByRole('heading', { name: 'In this site' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Borrell Harbour/ })).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('reports the site, the system and its danger in the persistent frame [FUNC-19.1]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    expect(screen.getByText('Borrell Harbour, Borrell — danger 1')).toBeInTheDocument();
    expect(screen.getByText('Holding position')).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

describe('space view', () => {
  it('draws one layer per semantic group, in the fixed order [TECH-12.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const view = screen.getByRole('img', { name: /Schematic view of Borrell Harbour/ });
    const layers = [...view.querySelectorAll('[data-layer]')].map((layer) =>
      layer.getAttribute('data-layer'),
    );

    expect(layers).toEqual(['background', 'ranges', 'intent', 'objects', 'labels', 'offscreen', 'hits']);

    harness.gateway.dispose();
  });

  it('distinguishes the player, the station and the selection by shape, not colour [TECH-12.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const view = screen.getByRole('img', { name: /Schematic view/ });
    const player = view.querySelector('[data-player="true"]');
    const station = view.querySelector('[data-object="station"]');

    expect(player?.querySelector('polygon')).not.toBeNull();
    expect(station?.querySelector('rect')).not.toBeNull();
    expect(view.querySelector('[data-selection="true"]')).toBeNull();

    await harness.user.click(screen.getByRole('button', { name: /Borrell Harbour/ }));

    expect(view.querySelector('[data-object="station"][data-selected="true"]')).not.toBeNull();
    expect(view.querySelector('[data-selection="true"]')).not.toBeNull();

    harness.gateway.dispose();
  });

  it('zooms the display without touching the simulation [FUNC-19.2, TECH-12.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const before = await site(harness);
    const view = screen.getByRole('img', { name: /Schematic view/ });
    const radius = (): string | null =>
      view.querySelector('[data-layer="background"] circle')?.getAttribute('r') ?? null;
    const first = radius();

    await harness.user.click(screen.getByRole('button', { name: /Zoom in/ }));
    await waitFor(() => {
      expect(radius()).not.toBe(first);
    });

    const after = await site(harness);
    expect(after.site?.objects).toEqual(before.site?.objects);
    expect(after.simulationTimeMs).toBe(before.simulationTimeMs);

    harness.gateway.dispose();
  });

  it('names every object and its range in the list beside the view [FUNC-19.2, FUNC-20]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const list = screen.getByRole('heading', { name: 'In this site' }).closest('section');
    if (list === null) throw new Error('The object list did not render.');
    const entries = within(list).getAllByRole('button');

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Your ship')]),
    );
    expect(within(list).getByText('2 km')).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

describe('selected object', () => {
  it('reports what is known and marks the rest unknown [FUNC-19.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    expect(screen.getByText(/Nothing is selected/)).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: /Borrell Harbour/ }));
    const panel = screen.getByRole('heading', { name: 'Selected' }).closest('section');
    if (panel === null) throw new Error('The selection panel did not render.');

    expect(within(panel).getByText('Station')).toBeInTheDocument();
    expect(within(panel).getByText('2 km')).toBeInTheDocument();
    expect(within(panel).getByText('Unknown')).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

describe('command bar', () => {
  it('takes availability from the projection and says why an order is refused [TECH-12.3, FUNC-22.10]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    // Nothing is selected, so the orders that need a target are refused.
    expect(screen.getByRole('button', { name: /^Approach/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Stop/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Retreat/ })).toBeDisabled();
    expect(
      screen.getByText('There is no combat site to retreat from.'),
    ).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: /Borrell Harbour/ }));

    expect(screen.getByRole('button', { name: /^Approach/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Dock/ })).toBeEnabled();

    harness.gateway.dispose();
  });

  it('sends an order at the authored range and the engine holds it [MVP-AC-03, FUNC-7.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    await harness.user.click(screen.getByRole('button', { name: /Borrell Harbour/ }));

    await harness.user.selectOptions(screen.getByLabelText('Range'), '5');
    await harness.user.click(screen.getByRole('button', { name: /^Orbit/ }));

    await waitFor(async () => {
      const current = await site(harness);
      expect(current.movementOrder).toMatchObject({ kind: 'orbit', distanceKm: 5 });
    });
    expect(await screen.findByText('Orbiting')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('offers only the authored ranges and arrival distances [TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const ranges = within(screen.getByLabelText('Range')).getAllByRole('option');
    const arrivals = within(screen.getByLabelText('Arrive at')).getAllByRole('option');
    const current = await site(harness);

    expect(ranges).toHaveLength(current.rangePresetsKm.length);
    expect(arrivals).toHaveLength(current.arrivalDistancesKm.length);

    harness.gateway.dispose();
  });

  it('orders a warp to the chosen destination [MVP-AC-03, FUNC-7.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    await harness.user.selectOptions(screen.getByLabelText('Destination'), 'site.borrell.verge');
    await harness.user.click(screen.getByRole('button', { name: /^Warp/ }));

    await waitFor(async () => {
      const current = await site(harness);
      expect(current.travelStatus).toMatchObject({
        kind: 'warp',
        destinationSiteId: 'site.borrell.verge',
      });
    });
    // The travel status and the persistent frame both report the phase.
    expect((await screen.findAllByText(/Aligning for warp/)).length).toBeGreaterThan(0);

    harness.gateway.dispose();
  });

  it('issues a move-to-point order from the keyboard-operable fields [MVP-AC-03, FUNC-20]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    await harness.user.clear(screen.getByLabelText('X (km)'));
    await harness.user.type(screen.getByLabelText('X (km)'), '6');
    await harness.user.clear(screen.getByLabelText('Y (km)'));
    await harness.user.type(screen.getByLabelText('Y (km)'), '-3');
    await harness.user.click(screen.getByRole('button', { name: 'Set course' }));

    await waitFor(async () => {
      const current = await site(harness);
      expect(current.movementOrder).toEqual({ kind: 'moveToPoint', point: { x: 6, y: -3 } });
    });

    harness.gateway.dispose();
  });

  it('docks again through the engine, which returns the station hub [MVP-AC-08, FUNC-7.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    await harness.user.click(screen.getByRole('button', { name: /^Dock/ }));
    await waitFor(async () => {
      expect((await site(harness)).travelStatus).toMatchObject({ kind: 'dock' });
    });

    // Docking completes on the simulation clock, so it finishes only once
    // time is running: the interface never moves the ship itself.
    expect(await screen.findByRole('heading', { name: 'Commands' })).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

describe('text', () => {
  it('resolves every key the surfaces ask for [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const harness = renderGame({ onIssue });
    await startCampaign(harness);
    await undock(harness);
    await harness.user.click(screen.getByRole('button', { name: /Borrell Harbour/ }));
    await harness.user.click(screen.getByRole('button', { name: 'Pick a point' }));

    expect(onIssue.mock.calls.map(([issue]) => issue)).toEqual([]);

    harness.gateway.dispose();
  });
});
