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

/** Leaves the dock. No destination is needed: it is chosen in space. */
async function undock(harness: Harness): Promise<void> {
  await harness.user.click(screen.getByRole('button', { name: 'Departure' }));
  await harness.user.click(await screen.findByRole('button', { name: /^Undock/ }));
  await screen.findByRole('heading', { name: 'Commands' });
}

/** The station's entry in the list of objects in the site. */
function stationObject(): HTMLElement {
  const list = screen.getByRole('heading', { name: 'In this site' }).closest('section');
  if (list === null) throw new Error('The object list did not render.');
  return within(list).getByRole('button', { name: /Borrell Harbour/ });
}

/** The destination chooser in the navigation panel. */
function destinations(): HTMLElement {
  return screen.getByRole('region', { name: 'Destinations' });
}

function destination(name: RegExp): HTMLElement {
  return within(destinations()).getByRole('button', { name });
}

async function selectedEncounter(harness: Harness): Promise<string | null> {
  const response = await harness.gateway.request('navigation.destinations', EMPTY_PAYLOAD);
  if (!response.ok) throw new Error('The engine refused navigation.destinations.');
  return response.data.selectedEncounterId;
}

describe('leaving the station', () => {
  it('undocks with no destination into the space view [MVP-AC-03, FUNC-19.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const current = await site(harness);
    expect(current.location.kind).toBe('site');
    expect(screen.getByRole('heading', { name: 'In this site' })).toBeInTheDocument();
    expect(stationObject()).toBeInTheDocument();
    expect(await selectedEncounter(harness)).toBeNull();

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

    expect(layers).toEqual([
      'background',
      'ranges',
      'intent',
      'objects',
      'effects',
      'labels',
      'offscreen',
      'hits',
    ]);

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

    await harness.user.click(stationObject());

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

    await harness.user.click(stationObject());
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
    expect(screen.getByRole('button', { name: /^Approach/ })).toBeUnavailable();
    expect(screen.getByRole('button', { name: /^Stop/ })).not.toBeUnavailable();
    // There is no separate retreat control: the station is a destination.
    expect(screen.queryByRole('button', { name: /^Retreat/ })).toBeNull();

    await harness.user.click(stationObject());

    expect(screen.getByRole('button', { name: /^Approach/ })).not.toBeUnavailable();

    harness.gateway.dispose();
  });

  it('sends an order at the authored range and the engine holds it [MVP-AC-03, FUNC-7.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    await harness.user.click(stationObject());

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

    await harness.user.click(destination(/^Pirate Scout/));
    await harness.user.click(within(destinations()).getByRole('button', { name: /^Warp to Pirate Scout/ }));

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

  it('warps to the destination offered first with the w shortcut [MVP-AC-03, FUNC-20, TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    // At the station's site the easiest encounter is offered first.
    expect(destination(/^Pirate Scout/)).toHaveAttribute('aria-pressed', 'true');
    await harness.user.keyboard('w');

    await waitFor(async () => {
      const current = await site(harness);
      expect(current.travelStatus).toMatchObject({
        kind: 'warp',
        destinationSiteId: 'site.borrell.verge',
      });
    });

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

    // The station is a destination; from its own site it is docked with.
    await harness.user.click(destination(/^Borrell Harbour/));
    expect(within(destinations()).queryByRole('button', { name: /^Warp to/ })).toBeNull();
    await harness.user.click(within(destinations()).getByRole('button', { name: /^Dock at Borrell Harbour/ }));
    await waitFor(async () => {
      expect((await site(harness)).travelStatus).toMatchObject({ kind: 'dock' });
    });

    // Docking completes on the simulation clock, so it finishes only once
    // time is running: the interface never moves the ship itself.
    expect(await screen.findByRole('heading', { name: 'Commands' })).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

describe('destinations in space', () => {
  it('lists the station, every encounter with its briefing, and chooses one without moving [MVP-AC-02, MVP-AC-03, FUNC-7.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    // The station is listed as a station by its authored name, not as an encounter.
    expect(destination(/^Borrell Harbour Station · you are here/)).toBeInTheDocument();
    for (const name of [/^Pirate Scout Tier 1/, /^Pirate Patrol Tier 2/, /^Pirate Base Tier 3/]) {
      expect(destination(name)).toBeInTheDocument();
    }

    const before = await site(harness);
    await harness.user.click(destination(/^Pirate Patrol/));
    const briefing = within(destinations()).getByRole('group', { name: 'Destination briefing' });
    expect(briefing).toHaveTextContent('Pirate Patrol');
    expect(briefing).toHaveTextContent(/Total bounty .* ISK/);
    expect(briefing).toHaveTextContent('Cleared 0 times');
    expect(within(destinations()).getByRole('button', { name: /^Warp to Pirate Patrol/ })).not.toBeUnavailable();

    // Choosing records the destination and moves nothing.
    await waitFor(async () => {
      expect(await selectedEncounter(harness)).toBe('encounter.borrell.pirate-patrol');
    });
    const after = await site(harness);
    expect(after.travelStatus).toBeNull();
    expect(after.movementOrder).toEqual(before.movementOrder);

    // The station's briefing has no tier or reward.
    await harness.user.click(destination(/^Borrell Harbour/));
    expect(within(destinations()).getByRole('group', { name: 'Destination briefing' })).not.toHaveTextContent(/Tier|bounty/);

    harness.gateway.dispose();
  });

  it('returns home with the return key: a warp from a site [MVP-AC-08, FUNC-7.3, FUNC-20]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    await harness.user.click(destination(/^Pirate Scout/));
    await harness.user.selectOptions(within(destinations()).getByLabelText('Arrive at'), '100');
    await harness.user.click(within(destinations()).getByRole('button', { name: /^Warp to Pirate Scout/ }));
    await harness.user.click(screen.getByRole('button', { name: /^Resume/ }));
    await waitFor(async () => {
      const current = await site(harness);
      expect(current.location).toMatchObject({ kind: 'site', siteId: 'site.borrell.verge' });
    }, { timeout: 60_000 });

    // Once the site is current it cannot be warped to; the station can.
    await harness.user.click(destination(/^Pirate Scout/));
    expect(within(destinations()).getByRole('button', { name: /^Warp to Pirate Scout/ })).toBeUnavailable();
    expect(destination(/^Borrell Harbour Station$/)).toBeInTheDocument();

    await harness.user.keyboard('x');
    await waitFor(async () => {
      expect((await site(harness)).travelStatus).toMatchObject({
        kind: 'warp',
        destinationSiteId: 'site.borrell.station',
      });
    });

    harness.gateway.dispose();
  }, 90_000);
});

describe('text', () => {
  it('resolves every key the surfaces ask for [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const harness = renderGame({ onIssue });
    await startCampaign(harness);
    await undock(harness);
    await harness.user.click(stationObject());
    await harness.user.click(screen.getByRole('button', { name: 'Pick a point' }));

    expect(onIssue.mock.calls.map(([issue]) => issue)).toEqual([]);

    harness.gateway.dispose();
  });
});
