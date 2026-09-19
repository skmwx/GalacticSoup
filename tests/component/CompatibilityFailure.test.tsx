import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CompatibilityFailure, LocalizationProvider } from '@ui';

/**
 * When the engine cannot be hosted the game stops with an explanation and no
 * way to continue (Technical Specification 4.2, 12.3).
 */
function renderFailure(messageKey: string) {
  return render(
    <LocalizationProvider>
      <CompatibilityFailure messageKey={messageKey} />
    </LocalizationProvider>,
  );
}

describe('compatibility failure', () => {
  it('explains why the game cannot start [TECH-4.2]', () => {
    renderFailure('error.compatibility.workerUnsupported');

    expect(
      screen.getByText('This browser does not provide the dedicated worker the engine needs.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Galactic Soup cannot start',
    );
  });

  it('is a modal alert that takes focus [TECH-4.2, TECH-12.1]', () => {
    renderFailure('error.compatibility.workerFailed');

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
  });

  it('offers no way to dismiss or bypass the engine [TECH-4.2]', async () => {
    renderFailure('error.compatibility.workerFailed');

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('renders an engine error message key it is given [TECH-5.4]', () => {
    renderFailure('error.internalError');

    expect(
      screen.getByText('The engine stopped an action to protect the campaign.'),
    ).toBeInTheDocument();
  });
});
