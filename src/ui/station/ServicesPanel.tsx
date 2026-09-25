import { useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';

import { ActionButton, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import styles from './Station.module.css';
import { TransactionDialog } from './TransactionDialog';
import type { PlayData } from '../frame/usePlayData';
import { useTransactionPreview } from './useTransactionPreview';

/**
 * Repair, resupply and insurance (Functional Specification 10, 19.5).
 *
 * Each is an economic action with a price, so each goes through the same
 * preview and confirmation as a market transaction. Repair never begins
 * without confirming the total, which is what the functional specification
 * requires.
 *
 * All three apply to the active ship, so a pilot who lost their only ship
 * has nothing to repair, resupply or insure until they buy one (Functional
 * Specification 9.12); the controls stay visible and say so.
 *
 * @implements FUNC-10, FUNC-19.5, FUNC-9.12, MVP-AC-02
 */

export interface ServicesPanelProps {
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

type OpenService = 'repair' | 'resupply' | 'insurance' | null;

export function ServicesPanel({ gateway, data, runner }: ServicesPanelProps): JSX.Element {
  const translate = useTranslate();
  const [open, setOpen] = useState<OpenService>(null);
  const shipId = data.assets?.activeShipId ?? null;
  const services = data.services?.services ?? [];

  const repair = useTransactionPreview({
    gateway,
    data,
    type: 'repair.preview',
    confirmType: 'repair.confirm',
    payload: open === 'repair' && shipId !== null ? { shipId } : null,
  });
  const resupply = useTransactionPreview({
    gateway,
    data,
    type: 'resupply.preview',
    confirmType: 'resupply.confirm',
    payload: open === 'resupply' && shipId !== null ? { shipId } : null,
  });
  const insurance = useTransactionPreview({
    gateway,
    data,
    type: 'insurance.preview',
    confirmType: 'insurance.confirm',
    payload: open === 'insurance' && shipId !== null ? { shipId } : null,
  });

  const shipless = data.assets !== null && shipId === null;
  const serviceState = (name: string): { available: boolean; reason: string | null } => {
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

  const wallet = data.assets?.credits ?? 0;

  return (
    <section className={styles['panel']} aria-labelledby="services-heading">
      <h3 id="services-heading" className={styles['panelHeading']}>
        {translate('services.heading')}
      </h3>
      <p className={styles['muted']}>{translate('services.detail')}</p>

      <div className={styles['toolbar']}>
        <ActionButton
          actionId="repair.confirm"
          runner={runner}
          available={serviceState('repair').available}
          unavailableReason={serviceState('repair').reason}
          label={translate('services.openRepair')}
          onRun={() => {
            setOpen('repair');
          }}
        />
        <ActionButton
          actionId="resupply.confirm"
          runner={runner}
          available={serviceState('resupply').available}
          unavailableReason={serviceState('resupply').reason}
          label={translate('services.openResupply')}
          onRun={() => {
            setOpen('resupply');
          }}
        />
        <ActionButton
          actionId="insurance.confirm"
          runner={runner}
          available={serviceState('insurance').available}
          unavailableReason={serviceState('insurance').reason}
          label={translate('services.openInsurance')}
          onRun={() => {
            setOpen('insurance');
          }}
        />
      </div>

      {open !== 'repair' ? null : (
        <TransactionDialog
          open
          title={translate('services.repairDialog')}
          actionId="repair.confirm"
          transaction={repair}
          runner={runner}
          walletCredits={wallet}
          onClose={() => {
            setOpen(null);
          }}
          onCommitted={() => {
            setOpen(null);
          }}
        />
      )}

      {open !== 'resupply' ? null : (
        <TransactionDialog
          open
          title={translate('services.resupplyDialog')}
          actionId="resupply.confirm"
          transaction={resupply}
          runner={runner}
          walletCredits={wallet}
          onClose={() => {
            setOpen(null);
          }}
          onCommitted={() => {
            setOpen(null);
          }}
        />
      )}

      {open !== 'insurance' ? null : (
        <TransactionDialog
          open
          title={translate('services.insuranceDialog')}
          actionId="insurance.confirm"
          transaction={insurance}
          runner={runner}
          walletCredits={wallet}
          onClose={() => {
            setOpen(null);
          }}
          onCommitted={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}
