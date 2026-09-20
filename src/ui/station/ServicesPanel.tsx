import { useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';

import { ActionButton, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import styles from './Station.module.css';
import { TransactionDialog } from './TransactionDialog';
import type { StationData } from './useStationData';
import { useTransactionPreview } from './useTransactionPreview';

/**
 * Repair, resupply and insurance (Functional Specification 10, 19.5).
 *
 * Each is an economic action with a price, so each goes through the same
 * preview and confirmation as a market transaction. Repair never begins
 * without confirming the total, which is what the functional specification
 * requires.
 *
 * @implements FUNC-10, FUNC-19.5, MVP-AC-02
 */

export interface ServicesPanelProps {
  readonly gateway: ClientGateway;
  readonly station: StationData;
  readonly runner: ActionRunner;
}

type OpenService = 'repair' | 'resupply' | 'insurance' | null;

export function ServicesPanel({ gateway, station, runner }: ServicesPanelProps): JSX.Element {
  const translate = useTranslate();
  const [open, setOpen] = useState<OpenService>(null);
  const shipId = station.assets?.activeShipId ?? null;
  const services = station.services?.services ?? [];

  const repair = useTransactionPreview({
    gateway,
    station,
    type: 'repair.preview',
    confirmType: 'repair.confirm',
    payload: open === 'repair' && shipId !== null ? { shipId } : null,
  });
  const resupply = useTransactionPreview({
    gateway,
    station,
    type: 'resupply.preview',
    confirmType: 'resupply.confirm',
    payload: open === 'resupply' && shipId !== null ? { shipId } : null,
  });
  const insurance = useTransactionPreview({
    gateway,
    station,
    type: 'insurance.preview',
    confirmType: 'insurance.confirm',
    payload: open === 'insurance' && shipId !== null ? { shipId } : null,
  });

  const serviceState = (name: string): { available: boolean; reason: string | null } => {
    const entry = services.find((service) => service.service === name);
    return {
      available: entry?.available ?? false,
      reason: entry?.unavailableReason ?? null,
    };
  };

  const wallet = station.assets?.credits ?? 0;

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
