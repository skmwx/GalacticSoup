import type { JSX } from 'react';

import type { CombatData, EncounterData, SiteData } from '@protocol';

import type { ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { ModulesPanel } from './ModulesPanel';
import styles from './Space.module.css';
import type { FireAvailability } from './tactical';
import { WeaponsPanel } from './WeaponsPanel';

/**
 * The ship's weapons and active equipment as one panel beside Navigation
 * (Functional Specification 9.4-9.8, 19.1, 19.3).
 *
 * It composes the weapons and modules subsections rather than redrawing them,
 * so target choice, fire and cease, reload and charge choice, module toggles
 * and their shortcuts keep exactly the logic they had as separate panels. The
 * panel scrolls on its own when a fit is longer than the space beneath the
 * radar, and it is focusable, so that scrolling also works from the keyboard.
 *
 * @implements FUNC-9.4, FUNC-9.5, FUNC-9.7, FUNC-9.8, FUNC-19.1, FUNC-19.3, TECH-12.3, MVP-AC-03, MVP-AC-04
 */

export interface EquipmentPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly combat: CombatData | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
  /** The locked target the weapon controls aim at, or `null`. */
  readonly targetId: string | null;
  /** Whether firing at that target can do anything, and why not. */
  readonly fire: FireAvailability;
  /** Opens fire with every weapon that can, at the aimed target. */
  onFire(): Promise<void>;
}

export function EquipmentPanel({
  data,
  runner,
  combat,
  site,
  encounter,
  targetId,
  fire,
  onFire,
}: EquipmentPanelProps): JSX.Element {
  const translate = useTranslate();
  return (
    <section
      className={styles['equipment']}
      aria-labelledby="equipment-heading"
      data-panel="equipment"
      tabIndex={0}
    >
      <h3 id="equipment-heading" className={styles['visuallyHidden']}>
        {translate('tactical.equipment.heading')}
      </h3>
      <WeaponsPanel
        data={data}
        runner={runner}
        combat={combat}
        site={site}
        encounter={encounter}
        targetId={targetId}
        fire={fire}
        onFire={onFire}
      />
      <ModulesPanel data={data} runner={runner} modules={combat?.modules ?? []} />
    </section>
  );
}
