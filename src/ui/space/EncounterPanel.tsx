import type { JSX } from 'react';

import type { EncounterData, SiteData } from '@protocol';

import { formatCredits, formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * The encounter the ship is in, and its opponents
 * (Functional Specification 9.10-9.11, 19.3; MVP Scope 4.2).
 *
 * The objective, each opponent's role and bounty and the bounty already paid
 * are the engine's; this lists them so the player can choose a target by
 * what it does and what it is worth, and can see the site is cleared before
 * turning to the wrecks. Range is read from the site, which moves every step,
 * rather than from the slower encounter view.
 *
 * @implements FUNC-9.10, FUNC-9.11, FUNC-19.3, MVP-AC-05, MVP-AC-06, MVP-AC-09
 */

export interface EncounterPanelProps {
  readonly encounter: EncounterData | null;
  readonly site: SiteData | null;
  readonly selectedId: string | null;
  onSelect(objectId: string): void;
}

export function EncounterPanel({
  encounter,
  site,
  selectedId,
  onSelect,
}: EncounterPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const instance = encounter?.instance ?? null;

  return (
    <section className={styles['panel']} aria-labelledby="encounter-heading" data-panel="encounter">
      <h3 id="encounter-heading" className={styles['panelHeading']}>
        {translate('tactical.encounter.heading')}
      </h3>
      {instance === null ? (
        <p className={styles['muted']}>{translate('tactical.encounter.none')}</p>
      ) : (
        <>
          <p className={styles['objectKind']}>
            {translate('tactical.encounter.title', {
              name: translate(instance.nameKey),
              tier: instance.tier,
            })}
          </p>
          <p
            className={instance.objective.complete ? styles['ok'] : styles['muted']}
            role="status"
            data-objective={instance.objective.complete ? 'complete' : 'open'}
          >
            {instance.objective.complete
              ? translate('tactical.encounter.cleared', {
                  bounty: formatCredits(instance.bountyCreditsPaid, locale),
                })
              : translate('tactical.encounter.objective', {
                  destroyed: instance.objective.destroyed,
                  required: instance.objective.required,
                })}
          </p>
          <p className={styles['muted']}>
            {translate('tactical.encounter.bountyPaid', {
              bounty: formatCredits(instance.bountyCreditsPaid, locale),
            })}
          </p>
          <ul className={styles['plainList']}>
            {instance.npcs.map((npc) => {
              const object = site?.site?.objects.find((candidate) => candidate.id === npc.shipId);
              const range = object?.rangeFromPlayerKm ?? npc.rangeFromPlayerKm;
              return (
                <li key={npc.shipId} data-opponent={npc.shipId} data-destroyed={npc.destroyed ? 'true' : 'false'}>
                  {npc.destroyed || object === undefined ? (
                    <p className={styles['muted']}>
                      {translate('tactical.encounter.opponentDestroyed', {
                        name: translate(npc.nameKey),
                        bounty: formatCredits(npc.bountyCredits, locale),
                      })}
                    </p>
                  ) : (
                    <button
                      type="button"
                      className={styles['objectButton']}
                      aria-pressed={npc.shipId === selectedId}
                      onClick={() => {
                        onSelect(npc.shipId);
                      }}
                    >
                      <span>
                        {translate(npc.nameKey)}
                        <span className={styles['objectKind']}>
                          {' '}
                          {translate('tactical.encounter.role', {
                            role: translate(`role.${npc.role}`),
                            bounty: formatCredits(npc.bountyCredits, locale),
                          })}
                        </span>
                      </span>
                      <span className={styles['objectRange']}>
                        {range === null
                          ? ''
                          : translate('space.distance', { distance: formatDistanceKm(range, locale) })}
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
