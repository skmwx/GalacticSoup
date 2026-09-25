import type { JSX } from 'react';

import type { AssetsData, EncounterData } from '@protocol';

import { formatCredits, formatQuantity } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Station.module.css';

/**
 * What the last sortie brought home (Functional Specification 9.11;
 * MVP Scope 2, 4.3).
 *
 * Back at the station the next decision is what to do with the result: sell
 * the loot, repair, resupply or refit. This shows the attempt's outcome and
 * bounty from the engine's record, and what is sitting in the hold, so the
 * player sees the rewards the moment they dock rather than having to go
 * looking for them.
 *
 * An attempt can also end with the ship destroyed (Functional Specification
 * 9.12). The summary then says so, and points at the loss report rather than
 * at a hold the pilot may no longer have: a pilot with no ship has no hold to
 * describe.
 *
 * @implements FUNC-9.11, FUNC-9.12, MVP-AC-06, MVP-AC-08, MVP-AC-09
 */

export interface SortieSummaryProps {
  readonly encounter: EncounterData | null;
  readonly assets: AssetsData | null;
}

export function SortieSummary({ encounter, assets }: SortieSummaryProps): JSX.Element | null {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const outcome = encounter?.lastOutcome ?? null;
  const shipless = assets !== null && assets.activeShipId === null;
  const hold =
    assets?.inventories.find(
      (inventory) =>
        inventory.location.kind === 'cargo' && inventory.location.shipId === assets.activeShipId,
    ) ?? null;
  const cargo = hold?.stacks.filter((stack) => stack.state.kind === 'plain') ?? [];

  if (outcome === null && cargo.length === 0) {
    return null;
  }

  return (
    <section className={styles['summary']} aria-labelledby="sortie-heading" data-sortie={outcome?.status ?? 'none'}>
      <h3 id="sortie-heading" className={styles['panelHeading']}>
        {translate('sortie.heading')}
      </h3>
      {outcome === null ? null : (
        <p role="status">
          {translate(`sortie.${outcome.status}`, {
            site: translate(outcome.nameKey),
            destroyed: outcome.npcsDestroyed,
            total: outcome.npcsTotal,
            bounty: formatCredits(outcome.bountyCreditsPaid, locale),
          })}
        </p>
      )}
      {shipless ? (
        <p className={styles['muted']}>{translate('sortie.noShip')}</p>
      ) : cargo.length === 0 ? (
        <p className={styles['muted']}>{translate('sortie.holdEmpty')}</p>
      ) : (
        <>
          <p className={styles['muted']}>{translate('sortie.hold')}</p>
          <ul className={styles['issues']}>
            {cargo.map((stack) => (
              <li key={stack.id} data-hold-item={stack.item.definitionId}>
                {translate('sortie.holdItem', {
                  quantity: formatQuantity(stack.quantity, locale),
                  name: translate(stack.item.nameKey),
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={styles['muted']}>
        {outcome?.status === 'lost' ? translate('sortie.nextLost') : translate('sortie.next')}
      </p>
    </section>
  );
}
