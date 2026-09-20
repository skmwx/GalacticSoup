import { useId, useState, type FormEvent, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { ResumableSaveData, SaveSlotData, SaveStatusData } from '@protocol';

import { formatSimulationDuration } from '../format/duration';
import { useTranslate } from '../localization';
import styles from './CampaignPanel.module.css';
import { useCampaignSession } from './useCampaignSession';

/**
 * The campaign surface (Functional Specification 3.1, 3.4; MVP Scope 5).
 *
 * It offers exactly the four things the MVP's one slot supports - start,
 * resume, close and reset - plus the save status and the storage warnings the
 * player must be able to act on. The deferred save-management controls
 * (several slots, a rolling history, export and import) are absent rather than
 * disabled.
 *
 * Nothing here is authoritative. Every value shown arrived from the engine,
 * and every action is a command.
 *
 * @implements FUNC-3.1, FUNC-3.4, MVP-AC-01
 */

export interface CampaignPanelProps {
  readonly gateway: ClientGateway;
}

export function CampaignPanel({ gateway }: CampaignPanelProps): JSX.Element {
  const translate = useTranslate();
  const { state, session } = useCampaignSession(gateway);
  const [name, setName] = useState('');
  const [confirmingReset, setConfirmingReset] = useState(false);
  const nameId = useId();

  const open = state.session?.campaign ?? null;
  const resumable = state.slot?.resumable ?? null;
  const busy = state.busy;

  const start = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (name.trim().length === 0) {
      return;
    }
    void session.create(name);
  };

  return (
    <section className={styles['panel']} aria-labelledby="campaign-heading">
      <h2 id="campaign-heading" className={styles['heading']}>
        {translate('campaign.sectionLabel')}
      </h2>

      {state.loading ? (
        <p className={styles['status']}>{translate('campaign.loading')}</p>
      ) : open === null ? (
        <div className={styles['choices']}>
          {resumable === null ? null : (
            <div className={styles['resumable']}>
              <p className={styles['summary']}>{describeResumable(resumable, translate)}</p>
              {resumable.contentMatches ? null : (
                <p className={styles['warning']}>{translate('campaign.contentChanged')}</p>
              )}
              <button type="button" onClick={() => void session.resume()} disabled={busy}>
                {translate('campaign.resume')}
              </button>
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
            <button type="submit" disabled={busy || name.trim().length === 0}>
              {translate('campaign.start')}
            </button>
            {resumable === null ? null : (
              <p className={styles['warning']}>{translate('campaign.startReplaces')}</p>
            )}
          </form>
        </div>
      ) : (
        <div className={styles['open']}>
          <dl className={styles['facts']}>
            <div className={styles['fact']}>
              <dt>{translate('campaign.pilot')}</dt>
              <dd>{open.displayName}</dd>
            </div>
            <div className={styles['fact']}>
              <dt>{translate('campaign.simulationTime')}</dt>
              <dd>{formatSimulationDuration(state.frame?.simulationTimeMs ?? 0)}</dd>
            </div>
            <div className={styles['fact']}>
              <dt>{translate('campaign.identity')}</dt>
              <dd>{open.campaignId}</dd>
            </div>
          </dl>

          <div className={styles['actions']}>
            <button type="button" onClick={() => void session.save('manual')} disabled={busy}>
              {translate('campaign.saveNow')}
            </button>
            <button type="button" onClick={() => void session.close()} disabled={busy}>
              {translate('campaign.close')}
            </button>
            {confirmingReset ? (
              <>
                <button
                  type="button"
                  className={styles['danger']}
                  onClick={() => {
                    setConfirmingReset(false);
                    void session.reset();
                  }}
                  disabled={busy}
                >
                  {translate('campaign.resetConfirm')}
                </button>
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
              <button
                type="button"
                onClick={() => {
                  setConfirmingReset(true);
                }}
                disabled={busy}
              >
                {translate('campaign.reset')}
              </button>
            )}
          </div>

          {confirmingReset ? (
            <p className={styles['warning']}>{translate('campaign.resetDetail')}</p>
          ) : null}
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

function StorageWarnings({ status }: { readonly status: SaveStatusData }): JSX.Element | null {
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
