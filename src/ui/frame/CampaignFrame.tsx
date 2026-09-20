import { useState, type JSX } from 'react';

import type { CampaignSession, CampaignSessionState } from '@gateway';
import type { SaveSlotData } from '@protocol';

import { ActionButton, useActionShortcuts, type ActionRunner } from '../actions';
import { formatSimulationDuration } from '../format/duration';
import { formatCredits } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './CampaignFrame.module.css';
import type { StationData } from '../station/useStationData';

/**
 * The persistent campaign frame (Functional Specification 19.1;
 * Technical Specification 12.1).
 *
 * It carries the values that are true wherever the player is: where they are,
 * what the clock is doing, what they can spend and whether the campaign is
 * durable. Nothing in it is authoritative - the station name comes from a
 * projection, the clock from the engine's answer to an advance, the balance
 * from the wallet.
 *
 * The frame shows the subset of Functional Specification 19.1 the completed
 * phases make available. Notifications arrive with the notification phase, and
 * undocked readouts with the space view.
 *
 * @implements FUNC-19.1, FUNC-3.3, TECH-12.1
 */

export interface CampaignFrameProps {
  readonly session: CampaignSession;
  readonly sessionState: CampaignSessionState;
  readonly station: StationData;
  readonly runner: ActionRunner;
  readonly simulationTimeMs: number;
}

export function CampaignFrame({
  session,
  sessionState,
  station,
  runner,
  simulationTimeMs,
}: CampaignFrameProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const campaign = sessionState.session?.campaign ?? null;
  const time = sessionState.session?.time ?? null;
  const paused = time?.paused ?? true;

  const toggleTime = async (): Promise<void> => {
    if (time === null) {
      return;
    }
    await station.send('time.set', { paused: !paused, rate: time.rate });
    await session.refresh();
  };

  useActionShortcuts({
    'time.toggle': () => {
      runner.run('time.toggle', toggleTime);
    },
  });

  return (
    <header className={styles['frame']}>
      <div className={styles['identity']}>
        <p className={styles['pilot']}>{campaign?.displayName ?? ''}</p>
        <p className={styles['location']}>
          {station.services === null
            ? translate('frame.locationUnknown')
            : translate('frame.location', { station: translate(station.services.nameKey) })}
        </p>
      </div>

      <dl className={styles['readouts']}>
        <div className={styles['readout']}>
          <dt>{translate('frame.credits')}</dt>
          <dd>
            {translate('credits.amount', {
              credits: formatCredits(station.assets?.credits ?? 0, locale),
            })}
          </dd>
        </div>
        <div className={styles['readout']}>
          <dt>{translate('frame.simulationTime')}</dt>
          <dd>{formatSimulationDuration(simulationTimeMs)}</dd>
        </div>
        <div className={styles['readout']}>
          <dt>{translate('frame.clock')}</dt>
          <dd>
            {paused
              ? translate('frame.paused')
              : translate('frame.running', { rate: time?.rate ?? 1 })}
          </dd>
        </div>
      </dl>

      <div className={styles['controls']}>
        <ActionButton
          actionId="time.toggle"
          runner={runner}
          pressed={!paused}
          label={paused ? translate('frame.resume') : translate('frame.pause')}
          onRun={toggleTime}
        />
        <ActionButton
          actionId="campaign.save"
          runner={runner}
          onRun={async () => {
            await session.save('manual');
          }}
        />
        <ActionButton
          actionId="campaign.close"
          runner={runner}
          onRun={async () => {
            await session.close();
          }}
        />
        {confirmingReset ? (
          <>
            <ActionButton
              actionId="campaign.reset"
              runner={runner}
              variant="danger"
              label={translate('campaign.resetConfirm')}
              onRun={async () => {
                setConfirmingReset(false);
                await session.reset();
              }}
            />
            <button
              type="button"
              onClick={() => {
                setConfirmingReset(false);
              }}
            >
              {translate('campaign.resetCancel')}
            </button>
          </>
        ) : (
          <ActionButton
            actionId="campaign.reset"
            runner={runner}
            onRun={() => {
              setConfirmingReset(true);
            }}
          />
        )}
      </div>

      {confirmingReset ? (
        <p className={styles['warning']}>{translate('campaign.resetDetail')}</p>
      ) : null}

      <details className={styles['details']}>
        <summary>{translate('frame.campaignDetails')}</summary>
        <dl className={styles['readouts']}>
          <div className={styles['readout']}>
            <dt>{translate('campaign.identity')}</dt>
            <dd>{campaign?.campaignId ?? ''}</dd>
          </div>
          <div className={styles['readout']}>
            <dt>{translate('frame.stateVersion')}</dt>
            <dd>{campaign?.stateVersion ?? ''}</dd>
          </div>
        </dl>
      </details>

      <p
        className={styles['saveStatus']}
        role="status"
        aria-live="polite"
        aria-label={translate('campaign.save.label')}
      >
        {describeSave(sessionState.slot, translate)}
      </p>

      {sessionState.error === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(sessionState.error.messageKey, sessionState.error.params)}
        </p>
      )}
    </header>
  );
}

type Translate = ReturnType<typeof useTranslate>;

function describeSave(slot: SaveSlotData | null, translate: Translate): string {
  if (slot === null) {
    return translate('campaign.save.idle');
  }
  switch (slot.status.state) {
    case 'pending':
      return translate('campaign.save.pending');
    case 'saved':
      return translate('campaign.save.saved', { revision: slot.status.lastSavedRevision ?? 0 });
    case 'failed':
      return translate('campaign.save.failed');
    default:
      return translate('campaign.save.idle');
  }
}
