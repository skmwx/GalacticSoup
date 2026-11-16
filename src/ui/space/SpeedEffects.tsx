import type { JSX } from 'react';

import type { DefenseStateData } from '@protocol';

import { SubstitutedExplanation } from '../common/Explanation';
import { formatSpeedKmPerSecond, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * The speed effects on one ship and what they leave of its speed
 * (Functional Specification 9.9, 19.3, 19.6; FeatureSpec02 6.3).
 *
 * Each effect is named by its source and module, with how much it removes and
 * how long it has left; the resulting speed limit sits beside the unaffected
 * one, with the calculation on demand. The text says in words that a web
 * slows and never stops warp, so nothing about it is conveyed by colour or a
 * tether alone. Nothing is shown while no effect holds the ship.
 *
 * @implements FUNC-9.9, FUNC-19.3, FUNC-19.6, V02-AC-07
 */

export interface SpeedEffectsProps {
  readonly defenses: DefenseStateData;
  /** Turns a ship id into the name the player knows it by. */
  readonly nameOf: (shipId: string) => string;
  /** True for the player's own ship, which is told it can still warp. */
  readonly own: boolean;
}

export function SpeedEffects({ defenses, nameOf, own }: SpeedEffectsProps): JSX.Element | null {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  if (defenses.speedEffects.length === 0) return null;
  const speed = defenses.speed;

  return (
    <div className={styles['speedEffects']} data-readout="speedEffects" data-ship={defenses.shipId}>
      <p className={own ? styles['warning'] : styles['strong']} data-speed-limit>
        {translate(speed.atFloor ? 'tactical.speed.limitFloor' : 'tactical.speed.limit', {
          speed: formatSpeedKmPerSecond(speed.maximumKmPerSecond, locale),
          unaffected: formatSpeedKmPerSecond(speed.unaffectedMaximumKmPerSecond, locale),
          floor: formatSpeedKmPerSecond(speed.floorKmPerSecond, locale),
        })}
      </p>
      <ul className={styles['entryList']}>
        {defenses.speedEffects.map((effect) => (
          <li key={effect.effectId} data-speed-effect={effect.effectId} data-source-present={effect.sourcePresent}>
            {translate(effect.fromPlayer
              ? 'tactical.speed.effectOwn'
              : effect.sourcePresent ? 'tactical.speed.effect' : 'tactical.speed.effectSourceGone', {
              source: nameOf(effect.sourceId),
              module: translate(effect.nameKey),
              percent: Math.round((1 - effect.speedFactor) * 100),
              seconds: formatStat(Math.round(effect.remainingSeconds * 10) / 10, locale),
            })}
          </li>
        ))}
      </ul>
      {own ? <p className={styles['muted']}>{translate('tactical.speed.counter')}</p> : null}
      <SubstitutedExplanation
        trace={speed.trace}
        label={translate('explain.show')}
        result={formatSpeedKmPerSecond(speed.trace.displayResult, locale)}
      />
    </div>
  );
}
