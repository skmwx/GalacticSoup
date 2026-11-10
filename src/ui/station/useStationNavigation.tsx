import { useCallback, useState, type JSX } from 'react';

import { ActionButton, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { useTranslate } from '../localization';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';
import type { StationPanelId } from './panels';

/**
 * Moving between station surfaces without stranding a fitting draft
 * (UIR1-05; Functional Specification 8.4).
 *
 * The fitting screen opens its engine draft on the first edit, and an open
 * draft blocks undocking. So leaving the fitting screen - by the station
 * rail, the hub tiles, the readiness panel or the guidance - never leaves one
 * behind unseen:
 *
 * - no draft: the surface changes at once;
 * - a draft that still matches the ship: it is closed quietly (nothing moves)
 *   and the surface changes;
 * - a changed draft: a dialog offers Apply, Discard or Stay. Apply and Discard
 *   change the surface only once the engine accepted them; a refused Apply
 *   keeps the dialog open with the engine's reason on the station.
 *
 * @implements FUNC-8.4
 */

export interface StationNavigation {
  /** Asks to open a surface; it may first ask about unapplied fitting changes. */
  readonly request: (panel: StationPanelId) => void;
  /** The unapplied-changes dialog, or `null`. Render it once. */
  readonly dialog: JSX.Element | null;
}

export function useStationNavigation({
  data,
  runner,
  panel,
  setPanel,
}: {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly panel: StationPanelId;
  readonly setPanel: (panel: StationPanelId) => void;
}): StationNavigation {
  const translate = useTranslate();
  const [pending, setPending] = useState<StationPanelId | null>(null);
  const draft = data.fitting?.draft ?? null;
  const { send } = data;

  const request = useCallback(
    (next: StationPanelId): void => {
      if (panel !== 'station.fitting' || next === panel || draft === null) {
        setPanel(next);
        return;
      }
      if (!draft.changed) {
        // Nothing to lose: closing the draft only lifts its undock block.
        void send('fitting.revert', {});
        setPanel(next);
        return;
      }
      setPending(next);
    },
    [panel, draft, send, setPanel],
  );

  const stay = (): void => {
    setPending(null);
  };

  const leave = (target: StationPanelId): void => {
    setPending(null);
    setPanel(target);
  };

  const dialog =
    pending === null ? null : (
      <Dialog
        open
        title={translate('fitting.leave.title')}
        onClose={stay}
        footer={
          <>
            <ActionButton
              actionId="fitting.commit"
              runner={runner}
              variant="primary"
              available={draft !== null && draft.committable && draft.changed}
              unavailableReason={
                draft === null || draft.committable
                  ? 'fitting.unavailable.unchanged'
                  : 'fitting.unavailable.blocked'
              }
              onRun={async () => {
                const answer = await send('fitting.commit', {});
                if (answer.ok) leave(pending);
              }}
            />
            <ActionButton
              actionId="fitting.revert"
              runner={runner}
              variant="danger"
              onRun={async () => {
                const answer = await send('fitting.revert', {});
                if (answer.ok) leave(pending);
              }}
            />
            <button type="button" onClick={stay}>
              {translate('fitting.leave.stay')}
            </button>
          </>
        }
      >
        <p>{translate('fitting.leave.body')}</p>
        {draft !== null && !draft.committable ? (
          <p className={styles['warning']}>{translate('fitting.leave.blocked')}</p>
        ) : null}
      </Dialog>
    );

  return { request, dialog };
}
