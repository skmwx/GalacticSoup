import { useId, type JSX } from 'react';

import type {
  FittingCandidateData,
  OpenFittingDraftData,
  PlannedSlotData,
  ShipData,
  SlotCandidatesData,
} from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { formatQuantity, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { ShipSummary } from './ShipPanel';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';

/**
 * The fitting screen (Functional Specification 8.4-8.5, 19.5).
 *
 * Fitting is a draft: opening it copies the fit the ship wears, each change
 * replaces one slot, reverting discards it and committing performs every move
 * at once. Nothing shown here is decided by the interface - the slots a hull
 * offers, the modules that may occupy them, whether the draft can be committed
 * and what the resulting ship looks like all arrive from the engine, and the
 * preview is the commit run against a copy.
 *
 * @implements FUNC-8.4, FUNC-8.5, FUNC-19.5, MVP-AC-02
 */

export interface FittingPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

export function FittingPanel({ data, runner }: FittingPanelProps): JSX.Element {
  const translate = useTranslate();
  const draft = data.fitting?.draft ?? null;
  const ship = data.ship;
  const fittingService = data.services?.services.find((entry) => entry.service === 'fitting');

  return (
    <section className={styles['panel']} aria-labelledby="fitting-heading">
      <h3 id="fitting-heading" className={styles['panelHeading']}>
        {translate('fitting.heading')}
      </h3>

      {draft === null ? (
        <>
          <p className={styles['muted']}>{translate('fitting.closed')}</p>
          {ship === null ? null : <FittedSlots ship={ship} />}
          <ActionButton
            actionId="fitting.begin"
            runner={runner}
            variant="primary"
            available={fittingService?.available ?? false}
            unavailableReason={fittingService?.unavailableReason ?? null}
            onRun={async () => {
              if (ship !== null) {
                await data.send('fitting.begin', { shipId: ship.id });
              }
            }}
          />
        </>
      ) : (
        <OpenDraft draft={draft} data={data} runner={runner} />
      )}
    </section>
  );
}

function OpenDraft({
  draft,
  data,
  runner,
}: {
  readonly draft: OpenFittingDraftData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}): JSX.Element {
  const translate = useTranslate();
  const planned = new Map(draft.slots.map((slot) => [slotKey(slot.slot), slot]));

  return (
    <>
      <p className={styles['muted']}>
        {draft.changed ? translate('fitting.changed') : translate('fitting.unchanged')}
      </p>

      <div className={styles['slots']}>
        {draft.options.map((option) => (
          <SlotEditor
            key={slotKey(option.slot)}
            option={option}
            planned={planned.get(slotKey(option.slot)) ?? null}
            data={data}
            runner={runner}
          />
        ))}
      </div>

      {draft.missing.length === 0 ? null : (
        <ul className={styles['issues']}>
          {draft.missing.map((missing) => (
            <li key={missing.definitionId} className={styles['warning']}>
              {translate('fitting.missing', {
                item: translate(missing.nameKey),
                required: missing.required,
                available: missing.available,
              })}
            </li>
          ))}
        </ul>
      )}

      {draft.blockedReason === null ? null : (
        <p className={styles['warning']}>{translate(draft.blockedReason)}</p>
      )}

      <div className={styles['toolbar']}>
        <ActionButton
          actionId="fitting.commit"
          runner={runner}
          variant="primary"
          available={draft.committable && draft.changed}
          unavailableReason={
            draft.committable ? 'fitting.unavailable.unchanged' : 'fitting.unavailable.blocked'
          }
          onRun={async () => {
            await data.send('fitting.commit', {});
          }}
        />
        <ActionButton
          actionId="fitting.revert"
          runner={runner}
          onRun={async () => {
            await data.send('fitting.revert', {});
          }}
        />
      </div>

      {draft.preview === null ? null : (
        <>
          <h4 className={styles['panelHeading']}>{translate('fitting.previewHeading')}</h4>
          <ShipSummary ship={draft.preview} />
        </>
      )}
    </>
  );
}

function SlotEditor({
  option,
  planned,
  data,
  runner,
}: {
  readonly option: SlotCandidatesData;
  readonly planned: PlannedSlotData | null;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const moduleId = useId();
  const chargeId = useId();
  const onlineId = useId();
  const selected = planned?.module?.definitionId ?? '';
  const candidate = option.candidates.find(
    (entry) => entry.module.definitionId === selected,
  );
  const name = `${translate(`slot.${option.slot.kind}`)} ${String(option.slot.index + 1)}`;

  const change = async (next: {
    readonly moduleId: string;
    readonly online: boolean;
    readonly ammunitionId: string | null;
  }): Promise<void> => {
    await data.send('fitting.set', {
      slotKind: option.slot.kind,
      slotIndex: option.slot.index,
      moduleId: next.moduleId,
      online: next.online,
      ...(next.ammunitionId === null ? {} : { ammunitionId: next.ammunitionId }),
    });
  };

  return (
    <div className={styles['slot']}>
      <p className={styles['slotName']}>{name}</p>

      <label className={styles['field']} htmlFor={moduleId}>
        {translate('fitting.moduleFor', { slot: name })}
        <select
          id={moduleId}
          className={styles['select']}
          value={selected}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '') {
              void data.send('fitting.clear', {
                slotKind: option.slot.kind,
                slotIndex: option.slot.index,
              });
              return;
            }
            const chosen = option.candidates.find(
              (entry) => entry.module.definitionId === value,
            );
            void change({
              moduleId: value,
              online: planned?.online ?? true,
              ammunitionId: chosen?.charges[0]?.definitionId ?? null,
            });
          }}
        >
          <option value="">{translate('fitting.empty')}</option>
          {option.candidates.map((entry) => (
            <option key={entry.module.definitionId} value={entry.module.definitionId}>
              {describeCandidate(entry, translate, locale)}
            </option>
          ))}
        </select>
      </label>

      {candidate === undefined || candidate.charges.length === 0 ? null : (
        <label className={styles['field']} htmlFor={chargeId}>
          {translate('fitting.chargeFor', { slot: name })}
          <select
            id={chargeId}
            className={styles['select']}
            value={planned?.charge?.definitionId ?? ''}
            onChange={(event) => {
              void change({
                moduleId: candidate.module.definitionId,
                online: planned?.online ?? true,
                ammunitionId: event.target.value === '' ? null : event.target.value,
              });
            }}
          >
            <option value="">{translate('fitting.noCharge')}</option>
            {candidate.charges.map((charge) => (
              <option key={charge.definitionId} value={charge.definitionId}>
                {translate(charge.nameKey)}
              </option>
            ))}
          </select>
        </label>
      )}

      {planned === null ? null : (
        <label className={styles['check']} htmlFor={onlineId}>
          <input
            id={onlineId}
            type="checkbox"
            checked={planned.online}
            onChange={(event) => {
              void change({
                moduleId: planned.module?.definitionId ?? '',
                online: event.target.checked,
                ammunitionId: planned.charge?.definitionId ?? null,
              });
            }}
          />
          {translate('fitting.onlineFor', { slot: name })}
        </label>
      )}

      {planned === null ? null : (
        <ActionButton
          actionId="fitting.clear"
          runner={runner}
          label={translate('fitting.clearSlot', { slot: name })}
          onRun={async () => {
            await data.send('fitting.clear', {
              slotKind: option.slot.kind,
              slotIndex: option.slot.index,
            });
          }}
        />
      )}
    </div>
  );
}

/** The fit the ship is wearing, for the screen before a draft is opened. */
function FittedSlots({ ship }: { readonly ship: ShipData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <div className={styles['tableWrapper']}>
      <table className={styles['table']}>
        <caption className={styles['caption']}>{translate('fitting.currentCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{translate('fitting.slot')}</th>
            <th scope="col">{translate('fitting.module')}</th>
            <th scope="col">{translate('fitting.charge')}</th>
            <th scope="col">{translate('fitting.state')}</th>
          </tr>
        </thead>
        <tbody>
          {ship.slots.map((slot) => (
            <tr key={slotKey(slot.slot)}>
              <th scope="row">
                {translate(`slot.${slot.slot.kind}`)} {slot.slot.index + 1}
              </th>
              <td>
                {slot.module === null
                  ? translate('fitting.empty')
                  : translate(slot.module.nameKey)}
              </td>
              <td>
                {slot.charge === null
                  ? translate('fitting.noCharge')
                  : translate('fitting.chargeDetail', {
                      charge: translate(slot.charge.item.nameKey),
                      rounds: formatQuantity(slot.charge.quantity, locale),
                    })}
              </td>
              <td>
                {slot.module === null
                  ? '-'
                  : slot.online
                    ? translate('fitting.stateOnline')
                    : translate('fitting.stateOffline')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function describeCandidate(
  candidate: FittingCandidateData,
  translate: (key: string, params?: Record<string, string | number | boolean>) => string,
  locale: string,
): string {
  return translate('fitting.candidate', {
    module: translate(candidate.module.nameKey),
    available: formatQuantity(candidate.available, locale),
    power: formatStat(candidate.powerUse, locale),
    processing: formatStat(candidate.processingUse, locale),
  });
}

function slotKey(slot: { readonly kind: string; readonly index: number }): string {
  return `${slot.kind}:${String(slot.index)}`;
}
