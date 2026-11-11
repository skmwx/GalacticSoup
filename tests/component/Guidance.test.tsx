import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { createDirectGateway } from '@gateway/direct';
import type { ShipData } from '@protocol';
import { DeparturePanel, GameRoot, LocalizationProvider, presentedSurface, surfaceLabelKey, useActionRunner, type PlayData } from '@ui';

import { shippedContent } from '../support/content.ts';
import { openGameMenu } from '../support/gameMenu.ts';

/**
 * Contextual guidance in the real interface (Functional Specification 3.2,
 * 19.6; MVP-AC-10).
 *
 * The guidance is driven by the engine over the in-process gateway: it points
 * at a station surface, takes the player there, advances when the player does
 * the thing it asks, can be skipped, hidden and shown again, and marks the
 * surface it points at with a word as well as a shape.
 */

const PILOT = 'Iris Vale';

function renderGame() {
  const gateway = createDirectGateway({
    host: createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() }),
    defaultTimeoutMs: 5_000,
  });
  render(
    <LocalizationProvider>
      <GameRoot gateway={gateway} />
    </LocalizationProvider>,
  );
  return { gateway, user: userEvent.setup() };
}

type Harness = ReturnType<typeof renderGame>;

async function startCampaign(harness: Harness): Promise<HTMLElement> {
  await harness.user.type(await screen.findByLabelText('Pilot name'), PILOT);
  await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
  await screen.findByRole('heading', { level: 2, name: 'Borrell Harbour' });
  return screen.findByRole('region', { name: 'Flight school' });
}

afterEach(() => {
  window.localStorage.clear();
});

describe('contextual guidance', () => {
  it('points a new pilot at the first step and takes them there [FUNC-3.2, MVP-AC-10]', async () => {
    const harness = renderGame();
    const guidance = await startCampaign(harness);

    // The ship undocks first; the site is chosen in space.
    expect(within(guidance).getByRole('heading', { name: 'Undock' })).toBeInTheDocument();
    expect(guidance).toHaveTextContent('0 of 15 steps done');
    expect(guidance).toHaveTextContent('Where: Departure');
    // The surface it points at is marked in words, and keeps its own name.
    const tab = screen.getByRole('button', { name: 'Departure' });
    expect(tab).toHaveAccessibleDescription('The guidance says your next step is here.');
    expect(within(tab).getByText('Next step')).toBeInTheDocument();

    await harness.user.click(within(guidance).getByRole('button', { name: 'Show me' }));
    expect(await screen.findByRole('heading', { name: 'Departure', level: 3 })).toBeInTheDocument();
    expect(within(guidance).getByRole('button', { name: 'Show me' })).toBeUnavailable();
    expect(guidance).toHaveTextContent('You are already there.');
  });

  it('advances when the player does what it asks, and says so [FUNC-3.2, FUNC-19.7]', async () => {
    const harness = renderGame();
    const guidance = await startCampaign(harness);
    await harness.user.click(within(guidance).getByRole('button', { name: 'Show me' }));
    await harness.user.click(await screen.findByRole('button', { name: /^Undock/ }));

    // The guidance column follows the pilot into space.
    const flight = await screen.findByRole('region', { name: 'Flight school' });
    await waitFor(() => {
      expect(within(flight).getByRole('heading', { level: 3 })).toHaveTextContent('Choose a site');
    });
    expect(flight).toHaveTextContent('1 of 15 steps done');
    expect(flight).toHaveTextContent('Where: in space');
    const notices = screen.getByRole('region', { name: 'Notifications' });
    expect(await within(notices).findByText('Done: Undock.')).toBeInTheDocument();

    // Choosing the site in space completes the next step, and moves nothing.
    const destinations = screen.getByRole('region', { name: 'Destinations' });
    await harness.user.click(within(destinations).getByRole('button', { name: /^Pirate Patrol/ }));
    await waitFor(() => {
      expect(within(flight).getByRole('heading', { level: 3 })).toHaveTextContent('Warp to the site');
    });
    expect(await within(notices).findByText('Done: Choose a site.')).toBeInTheDocument();
  });

  it('counts warping to the destination offered first as choosing it [FUNC-3.2, FUNC-7.3]', async () => {
    const harness = renderGame();
    const guidance = await startCampaign(harness);
    await harness.user.click(within(guidance).getByRole('button', { name: 'Show me' }));
    await harness.user.click(await screen.findByRole('button', { name: /^Undock/ }));
    const flight = await screen.findByRole('region', { name: 'Flight school' });
    await waitFor(() => {
      expect(within(flight).getByRole('heading', { level: 3 })).toHaveTextContent('Choose a site');
    });

    // The list opens on the Pirate Scout; the player warps without clicking it.
    const destinations = screen.getByRole('region', { name: 'Destinations' });
    await harness.user.click(within(destinations).getByRole('button', { name: /^Warp to Pirate Scout/ }));
    const notices = screen.getByRole('region', { name: 'Notifications' });
    expect(await within(notices).findByText('Done: Choose a site.')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(flight).getByRole('heading', { level: 3 })).not.toHaveTextContent('Choose a site');
    });
  });

  it('skips a step on request and lists every step with its state in words [FUNC-3.2, FUNC-20]', async () => {
    const harness = renderGame();
    const guidance = await startCampaign(harness);
    await harness.user.click(within(guidance).getByRole('button', { name: 'Skip step' }));

    await waitFor(() => {
      expect(within(guidance).getByRole('heading', { level: 3 })).toHaveTextContent('Choose a site');
    });
    await harness.user.click(within(guidance).getByText('All steps'));
    const skipped = guidance.querySelector('[data-step="guide.loop.undock"]');
    expect(skipped).toHaveTextContent('Undock');
    expect(skipped).toHaveTextContent('skipped');
    expect(guidance.querySelector('[data-step="guide.loop.ready"]')).toHaveTextContent('after an earlier step');
  });

  it('hides and shows again, from the frame and with J [FUNC-3.2, TECH-12.3]', async () => {
    const harness = renderGame();
    const guidance = await startCampaign(harness);
    await harness.user.click(within(guidance).getByRole('button', { name: /^Hide guidance/ }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Flight school' })).toBeNull();
    });
    // The frame offers it again from the game menu.
    await openGameMenu(harness.user);
    expect(screen.getByRole('button', { name: /^Show guidance/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Departure' })).not.toHaveAccessibleDescription();

    await harness.user.keyboard('j');
    expect(await screen.findByRole('region', { name: 'Flight school' })).toBeInTheDocument();
  });

  it('sends a step written for the old Services surface to the Overview [FUNC-3.2, FUNC-19.5]', () => {
    // Repair, resupply and insurance moved onto the Overview; authored steps
    // and saved progress still name the Services surface.
    expect(presentedSurface('station.services')).toBe('station.hub');
    expect(surfaceLabelKey('station.services')).toBe('action.station.hub');
    expect(presentedSurface('station.market')).toBe('station.market');
    expect(surfaceLabelKey('space')).toBe('guidance.surface.space');
  });
});

describe('the capacitor before undocking', () => {
  function ship(charge: number): ShipData {
    return {
      layers: [],
      warnings: [],
      capacitor: {
        charge, capacity: 60, rechargeSeconds: 300, rechargePerSecond: 0.2, drainPerSecond: 0,
        stable: true, enduranceSeconds: null, secondsToFull: (60 - charge) / 0.2,
        rechargeTrace: {
          formulaKey: 'combat.formula.capacitorRecharge',
          operands: [
            { key: 'capacity', value: 60 },
            { key: 'charge', value: charge },
            { key: 'rechargeSeconds', value: 300 },
          ],
          unroundedResult: (60 - charge) / 0.2,
          displayResult: (60 - charge) / 0.2,
        },
      },
    } as unknown as ShipData;
  }

  function Departure({ charge }: { readonly charge: number }) {
    const runner = useActionRunner();
    const data = { destinations: null, site: null, ship: ship(charge), send: () => Promise.resolve() } as unknown as PlayData;
    return <DeparturePanel data={data} runner={runner} />;
  }

  it('explains how long an empty capacitor takes to fill, with the values substituted [FUNC-9.8, FUNC-19.6, MVP-AC-04]', async () => {
    const user = userEvent.setup();
    render(<LocalizationProvider><Departure charge={15} /></LocalizationProvider>);

    const readiness = document.querySelector('[data-capacitor-readiness]');
    expect(readiness).toHaveAttribute('data-capacitor-readiness', 'charging');
    expect(readiness).toHaveTextContent(
      'Capacitor 25%. Repair on the Overview recharges it for free; left alone it fills in 3m 45s of running time',
    );
    await user.click(screen.getByText('How long until it is full'));
    expect(readiness).toHaveTextContent(
      'Time to full = (capacity 60 - charge 15) / (capacity 60 / recharge time 300 s)',
    );
    expect(readiness).toHaveTextContent('225 s');
  });

  it('says a full capacitor is ready and offers no calculation [FUNC-9.8]', () => {
    render(<LocalizationProvider><Departure charge={60} /></LocalizationProvider>);
    expect(document.querySelector('[data-capacitor-readiness]')).toHaveTextContent('Capacitor 100%: ready.');
    expect(screen.queryByText('How long until it is full')).toBeNull();
  });
});
