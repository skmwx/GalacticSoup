import { useEffect, useRef, useState, type JSX } from 'react';

import type { CampaignSession, CampaignSessionState } from '@gateway';
import type { SaveSlotData } from '@protocol';

import { ActionButton, useActionShortcuts, type ActionRunner } from '../actions';
import { formatSimulationDuration } from '../format/duration';
import { formatCredits } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './CampaignFrame.module.css';
import type { PlayData } from './usePlayData';

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
 * Flight instruments live in the ship rail; this compact header keeps the
 * clock and pause available. Guidance and save controls are in the game menu,
 * with Close, Reset and campaign metadata behind a separate disclosure.
 * Reset always asks for confirmation before deleting the campaign.
 *
 * @implements FUNC-19.1, FUNC-3.3, FUNC-3.2, TECH-12.1, MVP-AC-03, MVP-AC-10
 */

export interface CampaignFrameProps {
  readonly session: CampaignSession;
  readonly sessionState: CampaignSessionState;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly simulationTimeMs: number;
}

export function CampaignFrame({
  session,
  sessionState,
  data,
  runner,
  simulationTimeMs,
}: CampaignFrameProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        setConfirmingReset(false);
        menu.current.querySelector('summary')?.focus();
      }
    };
    const outside = (event: PointerEvent): void => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) {
        menu.current.open = false;
        setConfirmingReset(false);
      }
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);

  const campaign = sessionState.session?.campaign ?? null;
  const time = sessionState.session?.time ?? null;
  const paused = time?.paused ?? true;

  const toggleTime = async (): Promise<void> => {
    if (time === null) {
      return;
    }
    await data.send('time.set', { paused: !paused, rate: time.rate });
    await session.refresh();
  };

  const guidanceHidden = data.onboarding?.hidden ?? false;
  const toggleGuidance = async (): Promise<void> => {
    if (data.onboarding === null) {
      return;
    }
    await data.send(guidanceHidden ? 'onboarding.show' : 'onboarding.hide', {});
  };

  useActionShortcuts({
    'time.toggle': () => {
      runner.run('time.toggle', toggleTime);
    },
    'guidance.toggle': () => {
      runner.run('guidance.toggle', toggleGuidance);
    },
  });

  return (
    <header className={styles['frame']}>
      <div className={styles['identity']}>
        <p className={styles['pilot']}>{campaign?.displayName ?? ''}</p>
        <p className={styles['location']}>{describeLocation(data, translate)}</p>
      </div>

      <dl className={styles['readouts']}>
        <div className={styles['readout']}>
          <dt>{translate('frame.credits')}</dt>
          <dd>
            {translate('credits.amount', {
              credits: formatCredits(data.assets?.credits ?? 0, locale),
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
      </div>
      <details className={styles['menu']} ref={menu} onToggle={(event) => {
        if (!event.currentTarget.open) setConfirmingReset(false);
      }}>
        <summary>{translate('frame.menu')}</summary>
        <div className={styles['menuBody']}>
        <ActionButton
          actionId="guidance.toggle"
          runner={runner}
          pressed={!guidanceHidden}
          available={data.onboarding !== null}
          label={guidanceHidden ? translate('guidance.show') : translate('guidance.hide')}
          onRun={toggleGuidance}
        />
        <ActionButton
          actionId="campaign.save"
          runner={runner}
          onRun={async () => {
            await session.save('manual');
          }}
        />
        <details className={styles['management']}>
          <summary>{translate('frame.management')}</summary>
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

        </details>
        </div>
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

/**
 * Where the player is. Docked, that is the station; undocked, the site and the
 * system's danger rating, which is what tells them what they have flown into.
 */
function describeLocation(data: PlayData, translate: Translate): string {
  if (data.docked) {
    return data.services === null
      ? translate('frame.locationUnknown')
      : translate('frame.location', { station: translate(data.services.nameKey) });
  }
  const runtime = data.site?.site ?? null;
  if (runtime === null) {
    return data.location?.kind === 'warp'
      ? translate('frame.locationWarp')
      : translate('frame.locationUnknown');
  }
  return translate('frame.locationSite', {
    site: translate(runtime.siteNameKey),
    system: translate(runtime.systemNameKey),
    danger: runtime.dangerRating,
  });
}

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
