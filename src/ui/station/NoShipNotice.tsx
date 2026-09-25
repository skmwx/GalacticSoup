import type { JSX } from 'react';

import { ActionButton, type ActionRunner } from '../actions';
import { formatCredits } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import styles from './Station.module.css';

/**
 * A pilot with no ship (Functional Specification 9.12, 10).
 *
 * After a loss the recovery service supplies a ship only to a pilot who
 * cannot afford the starter hull; one who can is left to buy it. The hub says
 * so plainly - why there is no undocking, and where the next ship comes from
 * - and lists the hulls this market sells with the price the quote service
 * gave, so the way back into space is one step away rather than something to
 * discover. The purchase itself goes through the market's preview and
 * confirmation like any other, and the engine makes the hull the active ship.
 *
 * @implements FUNC-9.12, FUNC-10, FUNC-22.10, MVP-AC-08, MVP-AC-10
 */

export interface NoShipNoticeProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly onOpenMarket: () => void;
}

export function NoShipNotice({ data, runner, onOpenMarket }: NoShipNoticeProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const hulls = (data.market?.listings ?? []).filter((listing) => listing.item.kind === 'hull');
  const marketService = data.services?.services.find((entry) => entry.service === 'market');

  return (
    <section className={styles['notice']} aria-labelledby="no-ship-heading" data-no-ship>
      <h3 id="no-ship-heading" className={styles['panelHeading']}>
        {translate('noShip.heading')}
      </h3>
      <p>{translate('noShip.detail')}</p>
      {hulls.length === 0 ? (
        <p className={styles['muted']}>{translate('noShip.noHulls')}</p>
      ) : (
        <ul className={styles['issues']} aria-label={translate('noShip.hulls')}>
          {hulls.map((listing) => (
            <li key={listing.item.definitionId}>
              {translate('noShip.hull', {
                hull: translate(listing.item.nameKey),
                price: formatCredits(listing.stationSellPriceCredits, locale),
              })}
            </li>
          ))}
        </ul>
      )}
      <p className={styles['muted']}>
        {translate('noShip.wallet', { credits: formatCredits(data.assets?.credits ?? 0, locale) })}
      </p>
      <div className={styles['toolbar']}>
        <ActionButton
          actionId="station.market"
          runner={runner}
          variant="primary"
          available={marketService?.available ?? false}
          unavailableReason={marketService?.unavailableReason ?? null}
          label={translate('noShip.openMarket')}
          onRun={onOpenMarket}
        />
      </div>
    </section>
  );
}
