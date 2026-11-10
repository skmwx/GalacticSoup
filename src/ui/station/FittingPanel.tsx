import { useId, useRef, type JSX } from 'react';

import type {
  FittedSlotData,
  FittingCandidateData,
  OpenFittingDraftData,
  PlannedSlotData,
  ShipData,
  SlotCandidatesData,
} from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { StatusMark } from '../common/StatusMark';
import { formatQuantity, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { ChoicePicker, type PickerChoice } from './ChoicePicker';
import { FitIssues, ShipAttributes, ShipOverview, WeaponStats } from './ShipPanel';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';

/**
 * The fitting screen (Functional Specification 8.4-8.5, 19.5; UIR1-05).
 *
 * One compact surface is both the view and the editor. The ship's general
 * figures come first, then one row per slot the hull offers - empty slots
 * included - and the weapons' statistics last. Every row has a small Change
 * module control, every weapon row a Change ammunition control, and every
 * fitted module an online switch.
 *
 * Fitting is a draft held by the engine. The first edit opens it, later
 * edits reuse it, and nothing reaches the ship until Apply. While the draft
 * differs from the ship, the figures above and below the slots are the
 * engine's preview of the ship the draft would produce, and the rows say
 * which slots changed. Discard drops the draft without moving anything.
 *
 * Nothing shown here is decided by the interface: the slots, the modules and
 * charges that may occupy them, what is available locally, whether the draft
 * can be applied and the previewed ship all arrive from the engine.
 *
 * Leaving the screen with an open draft is handled by `useStationNavigation`:
 * an unchanged draft is closed quietly, a changed one asks to apply, discard
 * or stay, so a draft never lingers unseen and blocks undocking.
 *
 * A pilot who lost their only ship has nothing to fit (Functional
 * Specification 9.12) and is told so.
 *
 * @implements FUNC-8.4, FUNC-8.5, FUNC-19.5, FUNC-9.12, MVP-AC-02
 */

export interface FittingPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

export function FittingPanel({ data, runner }: FittingPanelProps): JSX.Element {
  const translate = useTranslate();
  const draft = data.fitting?.draft ?? null;
  const ship = data.ship;
  const shipless = data.assets !== null && data.assets.activeShipId === null;

  return (
    <section className={styles['panel']} aria-labelledby="fitting-heading">
      <h3 id="fitting-heading" className={styles['panelHeading']}>
        {translate('fitting.heading')}
      </h3>

      {shipless ? (
        <p className={styles['muted']} data-no-ship>
          {translate('fitting.noShip')}
        </p>
      ) : ship === null ? (
        <p className={styles['muted']}>{translate('ship.loading')}</p>
      ) : (
        <FittingSurface ship={ship} draft={draft} data={data} runner={runner} />
      )}
    </section>
  );
}

function FittingSurface({
  ship,
  draft,
  data,
  runner,
}: {
  readonly ship: ShipData;
  readonly draft: OpenFittingDraftData | null;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}): JSX.Element {
  const translate = useTranslate();
  const fittingService = data.services?.services.find((entry) => entry.service === 'fitting');
  const editable = fittingService?.available ?? false;
  const unavailableReason = fittingService?.unavailableReason ?? 'fitting.unavailable.service';
  const previewing = draft !== null && draft.changed;
  // The preview is the draft committed against a copy; while nothing changed
  // it describes the ship as it is.
  const shown = previewing ? (draft.preview ?? ship) : ship;
  const draftOpen = draft !== null;

  /** Opens the engine draft on first use and reuses it afterwards. */
  const ensureDraft = async (): Promise<boolean> => {
    if (data.fitting?.draft !== null && data.fitting?.draft !== undefined) {
      return true;
    }
    const answer = await data.send('fitting.begin', { shipId: ship.id });
    return answer.ok;
  };

  // Edits run one after another, in the order the player made them, so a
  // quick second choice neither races the first nor is dropped.
  const edits = useRef<Promise<void>>(Promise.resolve());
  const edit = (work: () => Promise<void>): void => {
    edits.current = edits.current.then(async () => {
      if (await ensureDraft()) {
        await work();
      }
    }).catch(() => undefined);
  };

  const planned = new Map((draft?.slots ?? []).map((slot) => [slotKey(slot.slot), slot]));
  const options = new Map((draft?.options ?? []).map((option) => [slotKey(option.slot), option]));

  return (
    <>
      <p className={previewing ? styles['notice'] : styles['muted']} role="status" data-fitting-state>
        {previewing
          ? translate('fitting.previewing')
          : draftOpen
            ? translate('fitting.unchanged')
            : translate('fitting.closed')}
      </p>

      <section aria-labelledby="fitting-ship-heading" className={styles['detail']}>
        <h4 id="fitting-ship-heading" className={styles['subHeading']}>
          {previewing ? translate('fitting.previewHeading') : translate('fitting.shipHeading')}
        </h4>
        <ShipOverview ship={shown} />
      </section>

      <section aria-labelledby="fitting-slots-heading" className={styles['detail']}>
        <h4 id="fitting-slots-heading" className={styles['subHeading']}>
          {translate('fitting.slotsHeading')}
        </h4>
        <ul className={styles['slotList']} aria-labelledby="fitting-slots-heading">
          {ship.slots.map((committed) => {
            const key = slotKey(committed.slot);
            return (
              <SlotRow
                key={key}
                committed={committed}
                planned={draftOpen ? (planned.get(key) ?? null) : undefined}
                option={options.get(key) ?? null}
                draftOpen={draftOpen}
                editable={editable}
                unavailableReason={unavailableReason}
                data={data}
                runner={runner}
                edit={edit}
                ensureDraft={ensureDraft}
              />
            );
          })}
        </ul>
      </section>

      {draft === null || draft.missing.length === 0 ? null : (
        <ul className={styles['issues']} data-fitting-missing>
          {draft.missing.map((missing) => (
            <li key={missing.definitionId} className={styles['warning']}>
              <StatusMark kind="warning" />
              {translate('fitting.missing', {
                item: translate(missing.nameKey),
                required: missing.required,
                available: missing.available,
              })}
            </li>
          ))}
        </ul>
      )}

      {draft?.blockedReason === null || draft === null ? null : (
        <p className={styles['warning']}>
          <StatusMark kind="error" />
          {translate(draft.blockedReason)}
        </p>
      )}

      <FitIssues ship={shown} />

      {draft === null ? null : (
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
      )}

      <section aria-labelledby="fitting-weapons-heading" className={styles['detail']}>
        <h4 id="fitting-weapons-heading" className={styles['subHeading']}>
          {translate('fitting.weaponsHeading')}
        </h4>
        <WeaponStats ship={shown} />
      </section>

      <details className={styles['breakdown']}>
        <summary>{translate('fitting.breakdown')}</summary>
        <ShipAttributes ship={shown} />
      </details>
    </>
  );
}

/**
 * One slot: what occupies it, its ammunition and online state, and the
 * controls that change them. `planned` is `undefined` while no draft is open
 * and `null` for a slot the draft leaves empty.
 */
function SlotRow({
  committed,
  planned,
  option,
  draftOpen,
  editable,
  unavailableReason,
  data,
  runner,
  edit,
  ensureDraft,
}: {
  readonly committed: FittedSlotData;
  readonly planned: PlannedSlotData | null | undefined;
  readonly option: SlotCandidatesData | null;
  readonly draftOpen: boolean;
  readonly editable: boolean;
  readonly unavailableReason: string;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly edit: (work: () => Promise<void>) => void;
  readonly ensureDraft: () => Promise<boolean>;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const onlineId = useId();
  const name = `${translate(`slot.${committed.slot.kind}`)} ${String(committed.slot.index + 1)}`;
  const slot = { slotKind: committed.slot.kind, slotIndex: committed.slot.index };

  // What the row describes: the draft's plan while one is open, the fitted
  // module otherwise.
  const current = draftOpen
    ? {
        module: planned?.module ?? null,
        online: planned?.online ?? false,
        charge: planned?.charge ?? null,
      }
    : {
        module: committed.module,
        online: committed.online,
        charge: committed.charge?.item ?? null,
      };
  const moduleId = current.module?.definitionId ?? null;
  const chargeId = current.charge?.definitionId ?? null;
  const candidate = moduleId === null ? undefined : option?.candidates.find((entry) => entry.module.definitionId === moduleId);
  const category =
    candidate?.category ?? (moduleId !== null && moduleId === committed.module?.definitionId ? committed.category : null);
  const isWeapon = category === 'turret';
  const changed =
    draftOpen &&
    (moduleId !== (committed.module?.definitionId ?? null) ||
      (moduleId !== null && current.online !== committed.online) ||
      chargeId !== (committed.charge?.item.definitionId ?? null));
  // The committed magazine's rounds are worth showing only while the row
  // still describes the charge that is loaded.
  const loadedRounds =
    committed.charge !== null && chargeId === committed.charge.item.definitionId && moduleId === committed.module?.definitionId
      ? committed.charge.quantity
      : null;

  const set = (next: { moduleId: string; online: boolean; ammunitionId: string | null }): Promise<unknown> =>
    data.send('fitting.set', {
      ...slot,
      moduleId: next.moduleId,
      online: next.online,
      ...(next.ammunitionId === null ? {} : { ammunitionId: next.ammunitionId }),
    });

  const openPicker = async (): Promise<void> => {
    await ensureDraft();
  };

  const moduleChoices: readonly PickerChoice[] | null =
    option === null
      ? null
      : [
          ...option.candidates.map((entry) => ({
            value: entry.module.definitionId,
            label: translate(entry.module.nameKey),
            detail: describeCandidate(entry, translate, locale),
            current: entry.module.definitionId === moduleId,
          })),
          ...(moduleId === null
            ? []
            : [{ value: '', label: translate('fitting.emptySlot'), detail: null, current: false }]),
        ];

  const chargeChoices: readonly PickerChoice[] | null =
    option === null
      ? null
      : [
          ...(candidate?.charges ?? []).map((charge) => ({
            value: charge.definitionId,
            label: translate(charge.nameKey),
            detail: null,
            current: charge.definitionId === chargeId,
          })),
          { value: '', label: translate('fitting.noCharge'), detail: null, current: chargeId === null },
        ];

  return (
    <li
      className={styles['slotRow']}
      data-slot={`${committed.slot.kind}:${String(committed.slot.index)}`}
      data-slot-name={name}
      data-module={moduleId ?? ''}
      data-charge={chargeId ?? ''}
    >
      <span className={styles['slotName']}>
        {name}
        {changed ? (
          <span className={styles['changedMark']} data-slot-changed>
            {' '}
            {translate('fitting.slotChanged')}
          </span>
        ) : null}
      </span>

      <span className={styles['slotModule']}>
        <span>
          {current.module === null ? (
            <span className={styles['muted']}>{translate('fitting.empty')}</span>
          ) : (
            translate(current.module.nameKey)
          )}
        </span>
        <ChoicePicker
          actionId="fitting.changeModule"
          runner={runner}
          label={translate('fitting.changeModuleFor', { slot: name })}
          listLabel={translate('fitting.modulesFor', { slot: name })}
          available={editable}
          unavailableReason={unavailableReason}
          choices={moduleChoices}
          onOpen={openPicker}
          onChoose={(value) => {
            edit(async () => {
              if (value === '') {
                await data.send('fitting.clear', slot);
                return;
              }
              const chosen = option?.candidates.find((entry) => entry.module.definitionId === value);
              // A charge the new module still accepts stays; otherwise the
              // first one it accepts is loaded, or none.
              const keeps = chosen?.charges.some((charge) => charge.definitionId === chargeId) ?? false;
              await set({
                moduleId: value,
                online: current.module === null ? true : current.online,
                ammunitionId: keeps ? chargeId : (chosen?.charges[0]?.definitionId ?? null),
              });
            });
          }}
        />
      </span>

      {isWeapon && moduleId !== null ? (
        <span className={styles['slotCharge']}>
          <span>
            {current.charge === null ? (
              <span className={styles['muted']}>{translate('fitting.noCharge')}</span>
            ) : loadedRounds === null ? (
              translate(current.charge.nameKey)
            ) : (
              translate('fitting.chargeDetail', {
                charge: translate(current.charge.nameKey),
                rounds: formatQuantity(loadedRounds, locale),
              })
            )}
          </span>
          <ChoicePicker
            actionId="fitting.changeAmmunition"
            runner={runner}
            label={translate('fitting.changeChargeFor', { slot: name })}
            listLabel={translate('fitting.chargesFor', { slot: name })}
            available={editable}
            unavailableReason={unavailableReason}
            choices={chargeChoices}
            onOpen={openPicker}
            onChoose={(value) => {
              edit(async () => {
                await set({ moduleId, online: current.online, ammunitionId: value === '' ? null : value });
              });
            }}
          />
        </span>
      ) : (
        <span className={styles['slotCharge']} aria-hidden="true" />
      )}

      {moduleId === null ? (
        <span className={styles['slotOnline']} aria-hidden="true" />
      ) : (
        <label className={`${styles['check']} ${styles['slotOnline']}`} htmlFor={onlineId}>
          <input
            id={onlineId}
            type="checkbox"
            checked={current.online}
            disabled={!editable}
            onChange={(event) => {
              const online = event.target.checked;
              edit(async () => {
                await set({ moduleId, online, ammunitionId: chargeId });
              });
            }}
          />
          {translate('fitting.onlineFor', { slot: name })}
        </label>
      )}
    </li>
  );
}

function describeCandidate(
  candidate: FittingCandidateData,
  translate: (key: string, params?: Record<string, string | number | boolean>) => string,
  locale: string,
): string {
  return translate('fitting.candidateDetail', {
    available: formatQuantity(candidate.available, locale),
    power: formatStat(candidate.powerUse, locale),
    processing: formatStat(candidate.processingUse, locale),
  });
}

function slotKey(slot: { readonly kind: string; readonly index: number }): string {
  return `${slot.kind}:${String(slot.index)}`;
}
