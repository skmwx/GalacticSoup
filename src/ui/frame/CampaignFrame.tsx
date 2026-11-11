import { useCallback, useState, type JSX, type RefObject } from 'react';

import type { CampaignSession, CampaignSessionState } from '@gateway';
import type { SaveSlotData } from '@protocol';

import { ActionButton, useActionShortcuts, type ActionRunner } from '../actions';
import { formatSimulationDuration } from '../format/duration';
import { formatCredits } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { EngineMark } from '../shell/EngineMark';
import styles from './CampaignFrame.module.css';
import { GameMenu } from './GameMenu';
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
 * It is the one header of the play layout: the game's mark, the pilot and
 * where they are - station or site, system and danger, docked or not - then
 * the wallet, the clock with its pause control, the save status and the game
 * menu. It wraps rather than overflowing at narrow widths and larger text.
 *
 * Flight instruments live in the ship rail. Guidance and save controls are in
 * the game menu behind the settings icon, with Close, Reset and campaign
 * metadata behind a separate disclosure, and Settings last. Reset always asks
 * for confirmation before deleting the campaign.
 *
 * @implements FUNC-19.1, FUNC-3.3, FUNC-3.2, TECH-12.1, MVP-AC-03, MVP-AC-10
 */

export interface CampaignFrameProps {
  readonly session: CampaignSession;
  readonly sessionState: CampaignSessionState;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly simulationTimeMs: number;
  readonly settingsOpen: boolean;
  readonly onToggleSettings: () => void;
  /** The game-menu trigger, which focus returns to when Settings closes. */
  readonly menuTrigger: RefObject<HTMLButtonElement | null>;
}

export function CampaignFrame({
  session,
  sessionState,
  data,
  runner,
  simulationTimeMs,
  settingsOpen,
  onToggleSettings,
  menuTrigger,
}: CampaignFrameProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const dropReset = useCallback(() => {
    setConfirmingReset(false);
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
      <EngineMark className={styles['mark']} />
      <div className={styles['identity']}>
        <p className={styles['pilot']}>{campaign?.displayName ?? ''}</p>
        <Location data={data} translate={translate} />
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
          icon={paused ? 'play' : 'pause'}
          label={paused ? translate('frame.resume') : translate('frame.pause')}
          onRun={toggleTime}
        />
      </div>

      <p
        className={styles['saveStatus']}
        role="status"
        aria-live="polite"
        aria-label={translate('campaign.save.label')}
      >
        {describeSave(sessionState.slot, translate)}
      </p>

      <GameMenu
        runner={runner}
        triggerRef={menuTrigger}
        settingsOpen={settingsOpen}
        onToggleSettings={onToggleSettings}
        onClose={dropReset}
      >
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
              <p className={styles['warning']}>{translate('campaign.resetDetail')}</p>
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

          <details className={styles['details']}>
            <summary>{translate('frame.campaignDetails')}</summary>
            <dl className={styles['detailFacts']}>
              <div>
                <dt>{translate('campaign.identity')}</dt>
                <dd>{campaign?.campaignId ?? ''}</dd>
              </div>
              <div>
                <dt>{translate('frame.stateVersion')}</dt>
                <dd>{campaign?.stateVersion ?? ''}</dd>
              </div>
            </dl>
          </details>
        </details>
      </GameMenu>

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
 * Where the player is. Docked, that is the station and the system it is in;
 * undocked, the site and the system's danger rating, which is what tells them
 * what they have flown into. Both come from projections.
 */
function Location({ data, translate }: { readonly data: PlayData; readonly translate: Translate }): JSX.Element {
  const services = data.docked ? data.services : null;
  return (
    <p className={styles['location']}>
      <span>{describeLocation(data, translate)}</span>
      {services === null ? null : (
        <span className={styles['system']}>
          {translate('frame.locationSystem', {
            system: translate(services.systemNameKey),
            danger: services.dangerRating,
          })}
        </span>
      )}
    </p>
  );
}

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
