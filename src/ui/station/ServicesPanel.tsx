import { forwardRef, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { RepairScope } from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { formatCredits } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Station.module.css';
import { TransactionDialog } from './TransactionDialog';
import type { PlayData } from '../frame/usePlayData';
import { useTransactionPreview, type TransactionPreview } from './useTransactionPreview';

/**
 * Repair, resupply and insurance on the station Overview
 * (Functional Specification 10, 19.5).
 *
 * Each operation is one button that names its price: Repair armour, Repair
 * hull and Repair all, Resupply ammunition and Improve insurance. The prices
 * are the engine's previews, asked for while the buttons are on screen and
 * asked again whenever the ship or the wallet changes, so the figure on a
 * button is the figure the confirmation will show.
 *
 * Showing a price does not skip the confirmation: every one of these spends
 * credits, so each still opens the shared transaction confirmation with the
 * exact total, the resulting balance and the formula behind it - including a
 * repair that costs nothing, as the shield and the capacitor recharge do.
 * The confirmation reuses the preview the button priced, so opening it costs
 * no second request and cannot show a different figure.
 *
 * All of them apply to the active ship, so a pilot who lost their only ship
 * has nothing to repair, resupply or insure until they buy one (Functional
 * Specification 9.12); the controls stay visible and say so in their tooltip.
 *
 * @implements FUNC-10, FUNC-19.5, FUNC-9.12, MVP-AC-02
 */

export interface ServicesPanelProps {
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

type ServiceName = 'repair' | 'resupply' | 'insurance';
type Operation = RepairScope | 'resupply' | 'insurance';

const REPAIR_SCOPES: readonly RepairScope[] = ['armor', 'hull', 'all'];

const REPAIR_ACTION: Readonly<Record<RepairScope, string>> = {
  armor: 'repair.armor',
  hull: 'repair.hull',
  all: 'repair.all',
};

export const ServicesPanel = forwardRef<HTMLHeadingElement, ServicesPanelProps>(function ServicesPanel(
  { gateway, data, runner },
  headingRef,
): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const [open, setOpen] = useState<Operation | null>(null);
  const shipId = data.assets?.activeShipId ?? null;
  const services = data.services?.services ?? [];
  const shipless = data.assets !== null && shipId === null;

  const serviceState = (name: ServiceName): { available: boolean; reason: string | null } => {
    // Each service needs a ship to preview; without one there is no subject
    // to ask the engine about.
    if (shipless) {
      return { available: false, reason: 'services.unavailable.noShip' };
    }
    const entry = services.find((service) => service.service === name);
    return {
      available: entry?.available ?? false,
      reason: entry?.unavailableReason ?? null,
    };
  };

  // A service this station does not provide is not previewed: its button
  // already says why, and there is no price to show.
  const previewable = (name: ServiceName): string | null =>
    shipId !== null && serviceState(name).available ? shipId : null;
  const repairShip = previewable('repair');
  const resupplyShip = previewable('resupply');
  const insuranceShip = previewable('insurance');

  const armor = useTransactionPreview({
    gateway, data, type: 'repair.preview', confirmType: 'repair.confirm',
    payload: repairShip === null ? null : { shipId: repairShip, scope: 'armor' },
  });
  const hull = useTransactionPreview({
    gateway, data, type: 'repair.preview', confirmType: 'repair.confirm',
    payload: repairShip === null ? null : { shipId: repairShip, scope: 'hull' },
  });
  const all = useTransactionPreview({
    gateway, data, type: 'repair.preview', confirmType: 'repair.confirm',
    payload: repairShip === null ? null : { shipId: repairShip, scope: 'all' },
  });
  const resupply = useTransactionPreview({
    gateway, data, type: 'resupply.preview', confirmType: 'resupply.confirm',
    payload: resupplyShip === null ? null : { shipId: resupplyShip },
  });
  const insurance = useTransactionPreview({
    gateway, data, type: 'insurance.preview', confirmType: 'insurance.confirm',
    payload: insuranceShip === null ? null : { shipId: insuranceShip },
  });

  const repairs: Readonly<Record<RepairScope, TransactionPreview>> = { armor, hull, all };
  const transactionOf = (operation: Operation): TransactionPreview =>
    operation === 'resupply' ? resupply : operation === 'insurance' ? insurance : repairs[operation];

  /**
   * The button's name with its price. A price is named whenever there is
   * something to pay for, including one the wallet cannot meet; an operation
   * with nothing to do names no price, because its tooltip says why.
   */
  const pricedLabel = (labelKey: string, transaction: TransactionPreview, service: ServiceName): string => {
    const label = translate(labelKey);
    if (!serviceState(service).available) return label;
    const { preview } = transaction;
    if (preview === null) {
      return transaction.loading || transaction.error === null
        ? translate('services.priceLoading', { operation: label })
        : label;
    }
    if (!preview.available && preview.totalCredits === 0) return label;
    return translate('services.priced', {
      operation: label,
      price: translate('credits.amount', { credits: formatCredits(Math.abs(preview.totalCredits), locale) }),
    });
  };

  /** Available only once the engine has priced it and said it can be done. */
  const operationState = (
    transaction: TransactionPreview,
    service: ServiceName,
  ): { available: boolean; reason: string | null } => {
    const state = serviceState(service);
    if (!state.available) return state;
    const { preview } = transaction;
    if (preview === null) {
      return { available: false, reason: transaction.error?.messageKey ?? 'services.pricing' };
    }
    return { available: preview.available, reason: preview.unavailableReason };
  };

  const wallet = data.assets?.credits ?? 0;
  const close = (): void => {
    setOpen(null);
  };

  return (
    <section className={styles['panel']} aria-labelledby="services-heading" data-services>
      <h3 id="services-heading" ref={headingRef} tabIndex={-1} className={styles['panelHeading']}>
        {translate('services.heading')}
      </h3>
      <div className={styles['serviceRows']}>
        <div className={styles['serviceRow']} role="group" aria-labelledby="services-repair">
          <span id="services-repair" className={styles['serviceLabel']}>{translate('services.repair')}</span>
          <div className={styles['serviceActions']}>
            {REPAIR_SCOPES.map((scope) => {
              const state = operationState(repairs[scope], 'repair');
              return (
                <ActionButton
                  key={scope}
                  actionId={REPAIR_ACTION[scope]}
                  runner={runner}
                  available={state.available}
                  unavailableReason={state.reason}
                  label={pricedLabel(`services.repair.${scope}`, repairs[scope], 'repair')}
                  onRun={() => {
                    setOpen(scope);
                  }}
                />
              );
            })}
          </div>
        </div>
        <div className={styles['serviceRow']} role="group" aria-labelledby="services-ammunition">
          <span id="services-ammunition" className={styles['serviceLabel']}>
            {translate('services.ammunition')}
          </span>
          <div className={styles['serviceActions']}>
            <ActionButton
              actionId="resupply.confirm"
              runner={runner}
              available={operationState(resupply, 'resupply').available}
              unavailableReason={operationState(resupply, 'resupply').reason}
              label={pricedLabel('services.openResupply', resupply, 'resupply')}
              onRun={() => {
                setOpen('resupply');
              }}
            />
          </div>
        </div>
        <div className={styles['serviceRow']} role="group" aria-labelledby="services-insurance">
          <span id="services-insurance" className={styles['serviceLabel']}>
            {translate('services.insurance')}
          </span>
          <div className={styles['serviceActions']}>
            <ActionButton
              actionId="insurance.confirm"
              runner={runner}
              available={operationState(insurance, 'insurance').available}
              unavailableReason={operationState(insurance, 'insurance').reason}
              label={pricedLabel('services.openInsurance', insurance, 'insurance')}
              onRun={() => {
                setOpen('insurance');
              }}
            />
          </div>
        </div>
      </div>

      {open === null ? null : (
        <TransactionDialog
          open
          title={translate(DIALOG_TITLE[open])}
          actionId={open === 'resupply' ? 'resupply.confirm' : open === 'insurance' ? 'insurance.confirm' : 'repair.confirm'}
          transaction={transactionOf(open)}
          runner={runner}
          walletCredits={wallet}
          onClose={close}
          onCommitted={close}
        />
      )}
    </section>
  );
});

const DIALOG_TITLE: Readonly<Record<Operation, string>> = {
  armor: 'services.repairDialog.armor',
  hull: 'services.repairDialog.hull',
  all: 'services.repairDialog.all',
  resupply: 'services.resupplyDialog',
  insurance: 'services.insuranceDialog',
};
