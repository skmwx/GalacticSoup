import type { JSX } from 'react';

import type { CommandAvailabilityData } from '@protocol';
import type { MessageKey } from '@shared';

import { ActionButton, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import styles from './Station.module.css';

/**
 * Choosing an encounter and leaving the station
 * (MVP Scope 3; Functional Specification 19.5).
 *
 * Choosing a site marks it as the current destination; it does not move the
 * ship. The player undocks at the station site and warps from there, which is
 * the path the scope requires and the one that makes retreat and return mean
 * something.
 *
 * Tier and the reward summary are guidance shown before entry, not a gate:
 * every site stays visible, and whether it can be chosen comes from the
 * engine's projected availability.
 *
 * @implements FUNC-19.5, MVP-AC-02, MVP-AC-03, MVP-AC-07
 */

export interface DeparturePanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

export function DeparturePanel({ data, runner }: DeparturePanelProps): JSX.Element {
  const translate = useTranslate();
  const destinations = data.destinations?.destinations ?? [];
  const undock = availability(data.site?.commands ?? [], 'ship.undock');
  const selected = destinations.find((entry) => entry.selected) ?? null;

  return (
    <section className={styles['panel']} aria-labelledby="departure-heading">
      <h3 id="departure-heading" className={styles['panelHeading']}>
        {translate('departure.heading')}
      </h3>
      <p className={styles['muted']}>{translate('departure.detail')}</p>

      <div className={styles['tableWrapper']}>
        <table className={styles['table']} aria-label={translate('departure.table')}>
          <thead>
            <tr>
              <th scope="col">{translate('departure.site')}</th>
              <th scope="col">{translate('departure.tier')}</th>
              <th scope="col">{translate('departure.rewards')}</th>
              <th scope="col">{translate('departure.choose')}</th>
            </tr>
          </thead>
          <tbody>
            {destinations.map((entry) => {
              const choose = availability(entry.commands, 'navigation.selectDestination');
              return (
                <tr key={entry.encounterId} data-destination={entry.encounterId}>
                  <th scope="row">
                    {translate(entry.nameKey)}
                    <span className={styles['muted']}> {translate(entry.descriptionKey)}</span>
                  </th>
                  <td>{translate('departure.tierValue', { tier: entry.tier })}</td>
                  <td>{translate(entry.rewardSummaryKey)}</td>
                  <td>
                    <ActionButton
                      actionId="navigation.selectDestination"
                      runner={runner}
                      available={choose.available && !entry.selected}
                      unavailableReason={
                        entry.selected ? 'departure.alreadySelected' : choose.unavailableReason
                      }
                      label={
                        entry.selected
                          ? translate('departure.selected')
                          : translate('departure.select', { site: translate(entry.nameKey) })
                      }
                      onRun={async () => {
                        await data.send('navigation.selectDestination', {
                          encounterId: entry.encounterId,
                        });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={styles['muted']} role="status">
        {selected === null
          ? translate('departure.noneSelected')
          : translate('departure.currentSelection', { site: translate(selected.nameKey) })}
      </p>

      <div className={styles['toolbar']}>
        <ActionButton
          actionId="ship.undock"
          runner={runner}
          variant="primary"
          available={undock.available}
          unavailableReason={undock.unavailableReason}
          onRun={async () => {
            await data.send('ship.undock', {});
          }}
        />
      </div>
    </section>
  );
}

function availability(
  commands: readonly CommandAvailabilityData[],
  command: string,
): { available: boolean; unavailableReason: MessageKey | null } {
  const entry = commands.find((candidate) => candidate.command === command);
  return entry === undefined
    ? { available: false, unavailableReason: null }
    : { available: entry.available, unavailableReason: entry.unavailableReason };
}
