import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { createDirectGateway } from '@gateway/direct';
import type { LocalizationIssue } from '@shared';
import { GameRoot, LocalizationProvider } from '@ui';

import { shippedContent } from '../support/content.ts';

/**
 * The campaign surface (Functional Specification 3.1, 3.4; MVP-AC-01).
 *
 * Before a campaign is open the screen offers start and resume; once one is
 * open the persistent frame owns saving, closing and resetting. Each case acts
 * on the surface the way a player would and then asserts what the engine holds.
 */

function renderGame(
  options: { store?: MemorySaveStore; onIssue?: (issue: LocalizationIssue) => void } = {},
) {
  const store = options.store ?? createMemorySaveStore();
  const gateway = createDirectGateway({
    host: createEngineHost({ content: shippedContent(), saves: store }),
    defaultTimeoutMs: 5_000,
  });

  const result = render(
    <LocalizationProvider {...(options.onIssue === undefined ? {} : { onIssue: options.onIssue })}>
      <GameRoot gateway={gateway} />
    </LocalizationProvider>,
  );

  return { ...result, gateway, store, user: userEvent.setup() };
}

async function startCampaign(
  harness: ReturnType<typeof renderGame>,
  name = 'Vela Trask',
): Promise<void> {
  const field = await screen.findByLabelText('Pilot name');
  await harness.user.type(field, name);
  await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
  await screen.findByText(name);
}

describe('campaign surface', () => {
  it('offers a new campaign when nothing is saved [MVP-AC-01, FUNC-3.1]', async () => {
    const harness = renderGame();

    expect(await screen.findByLabelText('Pilot name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start campaign' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Resume campaign' })).not.toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('starts a campaign and reports it saved [MVP-AC-01, FUNC-3.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    expect(screen.getByText('Vela Trask')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Campaign save status' })).toHaveTextContent(
        'Saved at revision 1.',
      );
    });
    expect(harness.store.saveIds()).toHaveLength(1);

    harness.gateway.dispose();
  });

  it('shows the saved campaign after it is closed, and resumes it [MVP-AC-01]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await harness.user.click(screen.getByRole('button', { name: /Close campaign/ }));

    const resume = await screen.findByRole('button', { name: 'Resume campaign' });
    expect(screen.getByText(/Saved campaign: Vela Trask/)).toBeInTheDocument();
    expect(screen.getByText('Starting a new campaign replaces the saved one.')).toBeVisible();

    await harness.user.click(resume);

    expect(await screen.findByText('Vela Trask')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('asks before discarding a campaign [FUNC-3.4, TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await harness.user.click(screen.getByRole('button', { name: /Reset campaign/ }));
    expect(
      screen.getByText(/Resetting deletes this campaign and every save of it/),
    ).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByText('Vela Trask')).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: /Reset campaign/ }));
    await harness.user.click(screen.getByRole('button', { name: /Delete this campaign/ }));

    expect(await screen.findByLabelText('Pilot name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume campaign' })).not.toBeInTheDocument();
    expect(harness.store.saveIds()).toEqual([]);

    harness.gateway.dispose();
  });

  it('saves on request and says so [FUNC-3.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await harness.user.click(screen.getByRole('button', { name: /Save now/ }));

    await waitFor(() => {
      expect(harness.store.saveIds().some((id) => id.includes(':manual:'))).toBe(true);
    });
    // The write is asynchronous, so the status settles a moment after the
    // command answered.
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Campaign save status' })).toHaveTextContent(
        'Saved at revision',
      );
    });

    harness.gateway.dispose();
  });

  it('warns when storage is nearly full or impermanent [TECH-11.1]', async () => {
    const harness = renderGame({
      store: createMemorySaveStore({
        persistence: false,
        storage: { persistent: false, usageBytes: 99, quotaBytes: 100 },
      }),
    });
    await startCampaign(harness);

    expect(await screen.findByText(/Local storage is nearly full/)).toBeInTheDocument();
    expect(screen.getByText(/has not promised to keep the campaign/)).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('explains why an action was refused [FUNC-22.10]', async () => {
    const store = createMemorySaveStore();
    const gateway = createDirectGateway({
      host: createEngineHost({ content: shippedContent(), saves: store }),
      defaultTimeoutMs: 5_000,
    });
    render(
      <LocalizationProvider>
        <GameRoot gateway={gateway} />
      </LocalizationProvider>,
    );
    await screen.findByLabelText('Pilot name');

    // Someone else opened a campaign on this engine; the panel's next action
    // is refused and must say why.
    await gateway.request('campaign.create', {
      displayName: 'Another Pilot',
      seed: '0123456789abcdef0123456789abcdef',
      createdAtRealMs: 1_700_000_000_000,
    });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Pilot name'), 'Vela');
    await user.click(screen.getByRole('button', { name: 'Start campaign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/A campaign is already open/);

    gateway.dispose();
  });

  it('announces the save state in a live region [TECH-12.3]', async () => {
    const harness = renderGame();
    const status = await screen.findByRole('status', { name: 'Campaign save status' });

    expect(status).toHaveAttribute('aria-live', 'polite');

    harness.gateway.dispose();
  });

  it('renders every string from the catalogue [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const harness = renderGame({ onIssue });
    await startCampaign(harness);
    await harness.user.click(screen.getByRole('button', { name: /Reset campaign/ }));

    expect(onIssue).not.toHaveBeenCalled();

    harness.gateway.dispose();
  });

  it('is operable with the keyboard alone [TECH-12.3]', async () => {
    const harness = renderGame();
    const field = await screen.findByLabelText('Pilot name');

    field.focus();
    await harness.user.keyboard('Keyboard Pilot');
    // Submitting the form from the field is how a keyboard user starts.
    await harness.user.keyboard('{Enter}');

    expect(await screen.findByText('Keyboard Pilot')).toBeInTheDocument();

    harness.gateway.dispose();
  });
});
