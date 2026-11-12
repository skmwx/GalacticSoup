import type { JSX } from 'react';
import type { PlayData } from './usePlayData';
import { formatSpeedKmPerSecond } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './CampaignFrame.module.css';

/**
 * Live movement, locks and module state beside the defensive instruments.
 * Who has locked the ship is marked in the Navigation panel's target list
 * (MVP review 02), so it is not repeated here.
 */
export function FlightReadouts({ data }: { readonly data: PlayData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const combat = data.combat;
  const rows: [string, string][] = [
    ['speed', translate('space.speed', { speed: formatSpeedKmPerSecond(playerSpeedKmPerSecond(data), locale) })],
    ['order', describeOrder(data, translate)],
  ];
  if (combat !== null) {
    rows.push(
      ['locks', translate('frame.locksValue', { held: combat.locks.filter((lock) => lock.status === 'locked').length, maximum: combat.maxLockedTargets })],
      ['modules', translate('frame.modulesValue', { active: combat.modules.filter((module) => module.cycle !== null).length, weapons: combat.weapons.filter((weapon) => weapon.repeating).length })],
    );
  }
  return (
    <dl className={styles['flightReadouts']}>
      {rows.map(([key, value]) => (
        <div key={key} className={styles['readout']}>
          <dt>{translate(`frame.${key}`)}</dt>
          <dd data-readout={key}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Translate = ReturnType<typeof useTranslate>;
/** The order the ship is carrying out, which is authoritative state. */
function describeOrder(data: PlayData, translate: Translate): string {
  const travel = data.site?.travelStatus ?? null;
  if (travel !== null) {
    return translate(`space.travel.${travel.kind}.${travel.phase}`);
  }
  const order = data.site?.movementOrder ?? null;
  return order === null ? translate('frame.orderNone') : translate(`space.order.${order.kind}`);
}

function playerSpeedKmPerSecond(data: PlayData): number {
  const player = data.site?.site?.objects.find((object) => object.player) ?? null;
  return player === null ? 0 : Math.hypot(player.velocity.x, player.velocity.y);
}

