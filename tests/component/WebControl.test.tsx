import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDirectGateway } from '@gateway/direct';
import {
  EMPTY_PAYLOAD,
  type AssetsData,
  type CombatData,
  type MarketTransactionPreviewData,
} from '@protocol';
import type { LocalizationIssue } from '@shared';
import { GameRoot, LocalizationProvider } from '@ui';

import { shippedContent } from '../support/content.ts';
import { arriveAtScout, closeSortie, lockOpponent, startSortie, type Sortie } from '../support/sortie.ts';

/**
 * The web in the space interface over a real engine (Functional
 * Specification 9.9, 19.1, 19.3, 19.6; FeatureSpec02 6.3).
 *
 * The campaign buys a web, fits it in place of the shield booster, flies to
 * the Scout and locks it, all through the protocol; the shipped interface is
 * then opened on the same engine. The web's switch acts on the aimed target,
 * and the slowed opponent's panel names the source, the strength, the time
 * left and the resulting speed limit in words, with the calculation on
 * demand.
 *
 * @implements FUNC-9.9, FUNC-19.3, V02-AC-07
 */

const WEB = 'module.web.small';

async function fitWeb(sortie: Sortie): Promise<void> {
  const content = shippedContent();
  const station = content.rules.economy.startingStationId;
  const preview = await sortie.data<MarketTransactionPreviewData>('market.previewBuy', {
    stationId: station,
    itemId: WEB,
    quantity: 1,
  });
  if (preview.token === null) throw new Error('The web could not be bought.');
  await sortie.data('market.confirmBuy', { token: preview.token });
  const assets = await sortie.data<AssetsData>('assets.list');
  const shipId = assets.ships.find((ship) => ship.active)?.id ?? '';
  await sortie.data('fitting.begin', { shipId });
  await sortie.data('fitting.set', { slotKind: 'system', slotIndex: 0, moduleId: WEB, online: true });
  await sortie.data('fitting.commit', EMPTY_PAYLOAD);
}

function panel(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const section = heading.closest('section');
  if (section === null) throw new Error(`No panel is headed ${name}.`);
  return section;
}

describe('the web in space', () => {
  it('slows the aimed target from the module switch and explains the effect [FUNC-9.9, FUNC-19.3, FUNC-19.6, V02-AC-07]', async () => {
    const sortie = await startSortie();
    await fitWeb(sortie);
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await closeSortie(sortie);

    const issues: LocalizationIssue[] = [];
    const gateway = createDirectGateway({ host: sortie.host, defaultTimeoutMs: 5_000 });
    render(
      <LocalizationProvider onIssue={(issue) => issues.push(issue)}>
        <GameRoot gateway={gateway} />
      </LocalizationProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Resume campaign' }));
    await screen.findByRole('heading', { level: 2, name: 'Verge Belt' });

    // Aim at the locked opponent: the web's switch names it.
    await user.click(within(panel('In this site')).getByRole('button', { name: /Pirate Scout/ }));
    const modules = panel('Modules');
    const toggle = await within(modules).findByRole('button', { name: /^Activate Stasis Web/ });
    await user.click(toggle);
    await waitFor(async () => {
      const response = await gateway.request('combat.state', EMPTY_PAYLOAD);
      if (!response.ok) throw new Error('combat.state was refused.');
      const combat: CombatData = response.data;
      expect(combat.modules.find((module) => module.moduleId === WEB)?.targetId).toBe(opponent);
    });
    // The module's detail explains what it does, in words, without claiming damage.
    expect(within(modules).getByText(/never stops warp/)).toBeInTheDocument();

    // Run the clock past one cycle; the opponent's panel shows the effect.
    await gateway.request('time.set', { paused: false, rate: 1 });
    await waitFor(async () => {
      const response = await gateway.request('combat.state', EMPTY_PAYLOAD);
      if (!response.ok) throw new Error('combat.state was refused.');
      expect(response.data.targetDefenses.find((entry) => entry.shipId === opponent)?.speedEffects.length).toBe(1);
    }, { timeout: 15_000 });
    await gateway.request('time.set', { paused: true, rate: 1 });

    const readout = await screen.findByText(/^Speed limited to/, {}, { timeout: 5_000 });
    expect(readout.textContent).not.toMatch(/[{}]/);
    expect(screen.getByText(/^Your Stasis Web: -50% speed, [\d.]+ s left$/)).toBeInTheDocument();
    expect(issues).toEqual([]);
    gateway.dispose();
  }, 120_000);
});
