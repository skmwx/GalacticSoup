import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  await screen.findByRole('heading', { name: 'Navigation' });
}

/**
 * Shows one of the Navigation panel's two views. The panel opens on Warp at
 * the station's site and on Local in any other site; the other view is hidden.
 */
async function showView(harness: Harness, name: 'Warp' | 'Local'): Promise<void> {
  const tab = screen.getByRole('tab', { name });
  if (tab.getAttribute('aria-selected') !== 'true') await harness.user.click(tab);
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

/** The world point a point menu's announcement carries, in kilometres. */
function coursePoint(status: HTMLElement): { x: number; y: number } {
  const [x, y] = (status.getAttribute('data-course-point') ?? '').split(',').map(Number);
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('The point menu announced no point.');
  }
  return { x, y };
}

describe('leaving the station', () => {
  it('undocks with no destination into the space view [MVP-AC-03, FUNC-19.5]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    await showView(harness, 'Local');

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
    await showView(harness, 'Local');

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

  it('names every other object and its range in the list beside the view [FUNC-19.2, FUNC-20]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    await showView(harness, 'Local');

    const list = screen.getByRole('heading', { name: 'In this site' }).closest('section');
    if (list === null) throw new Error('The object list did not render.');
    const entries = within(list).getAllByRole('button');

    // The player's own ship is not listed, but it is still in the site and drawn on the radar.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toContain('Borrell Harbour');
    expect(entries.map((entry) => entry.textContent)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Your ship')]),
    );
    expect(within(list).getByText('2 km')).toBeInTheDocument();
    const state = await site(harness);
    expect(state.site?.objects.some((object) => object.player)).toBe(true);
    expect(document.querySelectorAll('[data-layer="objects"] [data-player="true"]')).toHaveLength(1);

    harness.gateway.dispose();
  });
});

describe('selected object', () => {
  it('reports what is known and marks the rest unknown [FUNC-19.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    await showView(harness, 'Local');

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
    await showView(harness, 'Local');

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
    await showView(harness, 'Local');
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

    const arrivals = within(screen.getByLabelText('Arrive at')).getAllByRole('option');
    await showView(harness, 'Local');
    const ranges = within(screen.getByLabelText('Range')).getAllByRole('option');
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

  it('sets a course from the keyboard through the point menu, sending nothing until Set course [MVP-AC-03, FUNC-7.1, FUNC-20]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    const before = (await site(harness)).movementOrder;

    // The set-course key (.) opens the point menu on the view's centre.
    await harness.user.keyboard('.');
    const menu = await screen.findByRole('group', { name: 'Commands for empty space' });
    const announced = within(menu).getByRole('status');
    expect(announced).toHaveTextContent(/^Course point: x .+ km, y .+ km, .+ km from your ship\.$/);
    expect(within(menu).getByRole('button', { name: /^Set course/ })).toHaveFocus();
    const view = screen.getByRole('img', { name: /Schematic view/ });
    expect(view).toHaveAttribute('data-course', 'true');
    expect(view).toHaveAccessibleDescription('Right-click empty space to set a course.');

    // The arrow keys move the point: one step is 24 px, which is 2 km at the
    // opening zoom; Shift moves five steps.
    const start = coursePoint(announced);
    await harness.user.keyboard('{ArrowRight}{Shift>}{ArrowUp}{/Shift}');
    const moved = coursePoint(announced);
    expect(moved.x).toBeCloseTo(start.x + 2, 5);
    expect(moved.y).toBeCloseTo(start.y + 10, 5);
    // Opening and moving the point gave no order.
    expect((await site(harness)).movementOrder).toEqual(before);

    await harness.user.click(within(menu).getByRole('button', { name: /^Set course/ }));

    await waitFor(async () => {
      expect((await site(harness)).movementOrder).toEqual({ kind: 'moveToPoint', point: moved });
    });
    expect(screen.queryByRole('group', { name: 'Commands for empty space' })).toBeNull();
    expect(view).toHaveAttribute('data-course', 'false');
    // There are no coordinate fields any more.
    expect(screen.queryByLabelText('X (km)')).toBeNull();
    expect(screen.queryByText('Coordinates & point navigation')).toBeNull();

    harness.gateway.dispose();
  });

  it('opens the point menu on a secondary click on empty space, at the world point under it [FUNC-19.2, TECH-12.2]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    const before = (await site(harness)).movementOrder;
    const view = screen.getByRole('img', { name: /Schematic view/ });

    // Two clicks 48 px apart on each axis are 4 km apart at the opening zoom,
    // with the world's y axis pointing up.
    fireEvent.contextMenu(view, { clientX: 300, clientY: 200 });
    const first = coursePoint(within(await screen.findByRole('group', { name: 'Commands for empty space' })).getByRole('status'));
    await harness.user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Commands for empty space' })).toBeNull();

    fireEvent.contextMenu(view, { clientX: 348, clientY: 152 });
    const menu = await screen.findByRole('group', { name: 'Commands for empty space' });
    const second = coursePoint(within(menu).getByRole('status'));
    expect(second.x - first.x).toBeCloseTo(4, 5);
    expect(second.y - first.y).toBeCloseTo(4, 5);

    // Closing it sends nothing.
    await harness.user.click(within(menu).getByRole('button', { name: 'Close menu' }));
    expect((await site(harness)).movementOrder).toEqual(before);

    fireEvent.contextMenu(view, { clientX: 348, clientY: 152 });
    await harness.user.click(
      within(await screen.findByRole('group', { name: 'Commands for empty space' })).getByRole('button', { name: /^Set course/ }),
    );
    await waitFor(async () => {
      expect((await site(harness)).movementOrder).toEqual({ kind: 'moveToPoint', point: second });
    });

    harness.gateway.dispose();
  });

  it('opens an object menu, not the point menu, on a secondary click on an object [FUNC-19.2, TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);
    const view = screen.getByRole('img', { name: /Schematic view/ });
    const stationId = (await site(harness)).site?.objects.find((object) => object.kind === 'station')?.id;
    const hit = view.querySelector(`[data-object-id="${String(stationId)}"]`);
    if (hit === null) throw new Error('The station has no hit target.');

    fireEvent.contextMenu(hit, { clientX: 10, clientY: 10 });

    expect(await screen.findByRole('group', { name: 'Commands for Borrell Harbour' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Commands for empty space' })).toBeNull();
    expect(view).toHaveAttribute('data-course', 'false');

    harness.gateway.dispose();
  });

  it('opens the point menu from the radar button, and gives focus back when it closes [FUNC-20, TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    await undock(harness);

    const button = screen.getByRole('button', { name: /^Set course on the radar/ });
    await harness.user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = await screen.findByRole('group', { name: 'Commands for empty space' });
    await harness.user.keyboard('{Escape}');

    expect(menu).not.toBeInTheDocument();
    expect(button).toHaveFocus();

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
    expect(await screen.findByRole('heading', { name: 'Navigation' })).toBeInTheDocument();

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

    // Arriving at the encounter opens the local view; the destinations are a tab away.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Local' })).toHaveAttribute('aria-selected', 'true');
    });
    await showView(harness, 'Warp');
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
    await showView(harness, 'Local');
    // The point menu's own text resolves too.
    await harness.user.keyboard('.');
    await screen.findByRole('group', { name: 'Commands for empty space' });
    await harness.user.click(stationObject());

    expect(onIssue.mock.calls.map(([issue]) => issue)).toEqual([]);

    harness.gateway.dispose();
  });
});
