import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';

import type { CampaignSession, CampaignSessionState } from '@gateway';
import type { ResumableSaveData, SaveSlotData, SaveStatusData } from '@protocol';

import { TooltipButton } from '../common/TooltipButton';
import { formatSimulationDuration } from '../format/duration';
import { useTranslate } from '../localization';
import styles from './CampaignPanel.module.css';

/**
 * The surface shown when no campaign is open
 * (Functional Specification 3.1, 3.4; MVP Scope 5).
 *
 * It offers the two things the MVP's one slot supports before play begins -
 * start and resume - plus the save status and the storage warnings the player
 * must be able to act on. Closing, saving and resetting an open campaign live
 * in the persistent frame, because that is where they are needed while
 * playing. The deferred save-management controls are absent rather than
 * disabled.
 *
 * Nothing here is authoritative. Every value shown arrived from the engine,
 * and every action is a command.
 *
 * A save this build cannot open - one written by v0.1, which v0.2
 * deliberately does not migrate, a newer build's, or content with no declared
 * transition - is described rather than offered for resume, and it stays in
 * storage untouched. Starting a new campaign over any saved one asks first,
 * because the first save of the new campaign replaces the old one
 * (ADR-V02-01; Technical Specification 11.4).
 *
 * @implements FUNC-3.1, FUNC-3.4, MVP-AC-01, V02-AC-13
 */

export interface CampaignPanelProps {
  readonly session: CampaignSession;
  readonly state: CampaignSessionState;
}

export function CampaignPanel({ session, state }: CampaignPanelProps): JSX.Element {
  const translate = useTranslate();
  const [name, setName] = useState('');
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const replaceButton = useRef<HTMLButtonElement | null>(null);
  const nameId = useId();
  // The confirmation takes focus when it appears, so a keyboard player answers
  // it next (Technical Specification 12.3).
  useEffect(() => {
    if (confirmingReplace) replaceButton.current?.focus();
  }, [confirmingReplace]);

  const resumable = state.slot?.resumable ?? null;
  const busy = state.busy;

  const start = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    // The start button is `aria-disabled` rather than disabled, so implicit
    // submission is refused here too.
    if (busy || name.trim().length === 0) {
      return;
    }
    if (resumable !== null && !confirmingReplace) {
      setConfirmingReplace(true);
      return;
    }
    setConfirmingReplace(false);
    void session.create(name);
  };
  const openable = resumable !== null && resumable.compatibility === 'supported';

  return (
    <section className={styles['panel']} aria-labelledby="campaign-heading">
      <h2 id="campaign-heading" className={styles['heading']}>
        {translate('campaign.sectionLabel')}
      </h2>

      {state.loading ? (
        <p className={styles['status']}>{translate('campaign.loading')}</p>
      ) : (
        <div className={styles['choices']}>
          {resumable === null ? null : (
            <div className={styles['resumable']}>
              <p className={styles['summary']}>{describeResumable(resumable, translate)}</p>
              {openable ? (
                <>
                  {resumable.contentMatches ? null : (
                    <p className={styles['warning']}>{translate('campaign.contentChanged')}</p>
                  )}
                  <TooltipButton
                    unavailable={busy}
                    reason={translate('campaign.busy')}
                    onClick={() => void session.resume()}
                  >
                    {translate('campaign.resume')}
                  </TooltipButton>
                </>
              ) : (
                <p className={styles['warning']} role="note">
                  {translate(`campaign.compatibility.${resumable.compatibility}`, {
                    formatVersion: resumable.formatVersion,
                    contentVersion: resumable.contentVersion,
                  })}
                </p>
              )}
            </div>
          )}

          <form className={styles['start']} onSubmit={start}>
            <label className={styles['field']} htmlFor={nameId}>
              {translate('campaign.nameLabel')}
            </label>
            <input
              id={nameId}
              className={styles['input']}
              value={name}
              maxLength={48}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <TooltipButton
              type="submit"
              unavailable={busy || name.trim().length === 0}
              reason={translate(busy ? 'campaign.busy' : 'campaign.start.needsName')}
            >
              {translate('campaign.start')}
            </TooltipButton>
            {resumable === null ? null : (
              <p className={styles['warning']}>{translate('campaign.startReplaces')}</p>
            )}
            {confirmingReplace && resumable !== null ? (
              <div className={styles['confirm']} role="group" aria-label={translate('campaign.replace.label')}>
                <p className={styles['warning']}>
                  {translate('campaign.replace.detail', { name: resumable.displayName })}
                </p>
                <button type="submit" className={styles['danger']} ref={replaceButton}>
                  {translate('campaign.replace.confirm')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingReplace(false);
                  }}
                >
                  {translate('campaign.replace.cancel')}
                </button>
              </div>
            ) : null}
          </form>
        </div>
      )}

      <p
        className={styles['saveStatus']}
        role="status"
        aria-live="polite"
        aria-label={translate('campaign.save.label')}
      >
        {describeSave(state.slot, translate)}
      </p>

      {state.slot === null ? null : <StorageWarnings status={state.slot.status} />}

      {state.error === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(state.error.messageKey, state.error.params)}
        </p>
      )}
      {state.transportMessageKey === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(state.transportMessageKey)}
        </p>
      )}
    </section>
  );
}

export function StorageWarnings({
  status,
}: {
  readonly status: SaveStatusData;
}): JSX.Element | null {
  const translate = useTranslate();
  const warnings: string[] = [];

  if (status.storage.lowSpace) {
    warnings.push(translate('campaign.storage.lowSpace'));
  }
  if (status.storage.persistent === false) {
    warnings.push(translate('campaign.storage.notPersistent'));
  }

  if (warnings.length === 0) {
    return null;
  }

  return (
    <ul className={styles['warnings']}>
      {warnings.map((warning) => (
        <li key={warning} className={styles['warning']}>
          {warning}
        </li>
      ))}
    </ul>
  );
}

type Translate = ReturnType<typeof useTranslate>;

function describeResumable(save: ResumableSaveData, translate: Translate): string {
  return translate('campaign.resumable', {
    name: save.displayName,
    simulationTime: formatSimulationDuration(save.simulationTimeMs),
    revision: save.revision,
  });
}

function describeSave(slot: SaveSlotData | null, translate: Translate): string {
  if (slot === null) {
    return translate('campaign.save.idle');
  }
  const { status } = slot;
  switch (status.state) {
    case 'pending':
      return translate('campaign.save.pending');
    case 'saved':
      return translate('campaign.save.saved', { revision: status.lastSavedRevision ?? 0 });
    case 'failed':
      return translate('campaign.save.failed');
    default:
      return translate('campaign.save.idle');
  }
}
