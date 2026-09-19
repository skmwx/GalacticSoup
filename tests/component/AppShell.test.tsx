import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createEngineHost } from '@engine';
import { createDirectGateway } from '@gateway/direct';
import type { LocalizationIssue } from '@shared';
import { AppShell, LocalizationProvider } from '@ui';

/**
 * The shell shows what the engine reported and nothing else: no authoritative
 * value is computed or stored in the interface (Technical Specification 12.1).
 */

function renderShell(options: { onIssue?: (issue: LocalizationIssue) => void } = {}) {
  const gateway = createDirectGateway({
    host: createEngineHost({ engineVersion: '4.5.6' }),
    defaultTimeoutMs: 2_000,
  });

  const result = render(
    <LocalizationProvider {...(options.onIssue === undefined ? {} : { onIssue: options.onIssue })}>
      <AppShell gateway={gateway} />
    </LocalizationProvider>,
  );

  return { ...result, gateway };
}

describe('application shell', () => {
  it('reports the engine handshake once it completes [TECH-12.1]', async () => {
    const { gateway } = renderShell();

    expect(await screen.findByText(/Engine ready over the in-process host\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Galactic Soup' })).toBeInTheDocument();

    gateway.dispose();
  });

  it('shows the engine and protocol versions the engine published [TECH-12.1]', async () => {
    const { gateway } = renderShell();

    expect(await screen.findByText('4.5.6')).toBeInTheDocument();
    expect(screen.getByText('direct')).toBeInTheDocument();
    expect(screen.getByText('2 request types')).toBeInTheDocument();

    gateway.dispose();
  });

  it('announces the status in a live region [TECH-12.1]', async () => {
    const { gateway } = renderShell();

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');

    gateway.dispose();
  });

  it('renders every string from the catalogue [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const { gateway } = renderShell({ onIssue });

    await screen.findByText(/Engine ready/);
    expect(onIssue).not.toHaveBeenCalled();

    gateway.dispose();
  });

  it('shows the blocking failure when the engine cannot answer [TECH-4.2, TECH-12.1]', async () => {
    const gateway = createDirectGateway({
      host: {
        engineVersion: '0.0.0',
        protocolVersion: 1,
        handle: () => Promise.reject(new Error('worker gone')),
      },
      defaultTimeoutMs: 50,
    });

    render(
      <LocalizationProvider>
        <AppShell gateway={gateway} />
      </LocalizationProvider>,
    );

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Galactic Soup cannot start')).toBeInTheDocument();

    gateway.dispose();
  });
});
