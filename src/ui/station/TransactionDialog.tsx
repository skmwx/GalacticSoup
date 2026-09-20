import type { JSX, ReactNode } from 'react';

import type {
  InsurancePreviewData,
  MarketTransactionPreviewData,
  RepairPreviewData,
  ResupplyPreviewData,
  TransactionPreviewData,
} from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { FormulaExplanation } from '../common/Explanation';
import { formatCredits, formatPercent, formatQuantity, formatVolume } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { Figure } from './Figure';
import styles from './Station.module.css';
import type { TransactionPreview } from './useTransactionPreview';

/**
 * The confirmation every economic action goes through
 * (Functional Specification 19.5, 19.6; Technical Specification 7.4).
 *
 * It shows the total cost, the balance the player would be left with, the
 * effect on stock and cargo, and an expandable explanation of the formula that
 * produced the price. Nothing is calculated here: each figure is a field of
 * the engine's preview.
 *
 * @implements FUNC-19.5, FUNC-19.6, TECH-7.4
 */

export interface TransactionDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly actionId: string;
  readonly transaction: TransactionPreview;
  readonly runner: ActionRunner;
  readonly walletCredits: number;
  readonly onClose: () => void;
  /** Called after the engine committed the transaction. */
  readonly onCommitted: () => void;
  /** Controls the action needs before it can be previewed, such as a quantity. */
  readonly children?: ReactNode;
}

export function TransactionDialog({
  open,
  title,
  actionId,
  transaction,
  runner,
  walletCredits,
  onClose,
  onCommitted,
  children,
}: TransactionDialogProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const { preview } = transaction;

  const confirm = async (): Promise<void> => {
    const committed = await transaction.confirm();
    if (committed) {
      onCommitted();
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <ActionButton
            actionId={actionId}
            runner={runner}
            variant="primary"
            onRun={confirm}
            available={preview?.available ?? false}
            unavailableReason={preview?.unavailableReason ?? 'transaction.unavailable'}
            label={translate('transaction.confirm')}
          />
          <button type="button" onClick={onClose}>
            {translate('transaction.cancel')}
          </button>
        </>
      }
    >
      {children}

      {transaction.loading && preview === null ? (
        <p className={styles['muted']}>{translate('transaction.loading')}</p>
      ) : null}

      {transaction.error === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(transaction.error.messageKey, transaction.error.params)}
        </p>
      )}

      {transaction.replaced ? (
        <p className={styles['warning']} role="alert">
          {translate('transaction.replaced')}
        </p>
      ) : null}

      {preview === null ? null : (
        <>
          <Details preview={preview} />

          <dl className={styles['figures']}>
            <Figure
              label={translate('transaction.total')}
              value={translate('credits.amount', {
                credits: formatCredits(Math.abs(preview.totalCredits), locale),
              })}
            />
            <Figure
              label={translate('transaction.walletChange')}
              value={translate('credits.signed', {
                credits: formatCredits(preview.walletDeltaCredits, locale),
              })}
            />
            <Figure
              label={translate('transaction.resultingBalance')}
              value={translate('credits.amount', {
                credits: formatCredits(walletCredits + preview.walletDeltaCredits, locale),
              })}
            />
          </dl>

          <FormulaExplanation traces={preview.traces} />
        </>
      )}
    </Dialog>
  );
}

function Details({ preview }: { readonly preview: TransactionPreviewData }): JSX.Element {
  switch (preview.action) {
    case 'market.buy':
    case 'market.sell':
      return <MarketDetails preview={preview} />;
    case 'repair':
      return <RepairDetails preview={preview} />;
    case 'resupply':
      return <ResupplyDetails preview={preview} />;
    default:
      return <InsuranceDetails preview={preview} />;
  }
}

function MarketDetails({
  preview,
}: {
  readonly preview: MarketTransactionPreviewData;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <>
      <p className={styles['dialogSubject']}>
        {translate('market.subject', {
          item: translate(preview.item.nameKey),
          quantity: formatQuantity(preview.quantity, locale),
        })}
      </p>
      <dl className={styles['figures']}>
        <Figure
          label={translate('market.averageUnitPrice')}
          value={translate('credits.amount', {
            credits: formatCredits(preview.averageUnitPriceCredits, locale),
          })}
        />
        <Figure
          label={translate('market.firstUnitPrice')}
          value={translate('credits.amount', {
            credits: formatCredits(preview.firstUnitPriceCredits, locale),
          })}
        />
        <Figure
          label={translate('market.lastUnitPrice')}
          value={translate('credits.amount', {
            credits: formatCredits(preview.lastUnitPriceCredits, locale),
          })}
        />
        <Figure
          label={translate('market.priceMovement')}
          value={translate('credits.signed', {
            credits: formatCredits(preview.priceMovementCredits, locale),
          })}
        />
        <Figure
          label={translate('market.remainingStock')}
          value={
            preview.remainingStock === null
              ? translate('market.stock.unlimited')
              : formatQuantity(preview.remainingStock, locale)
          }
        />
        <Figure
          label={translate('market.cargoEffect')}
          value={translate('volume.signedCubicMetres', {
            volume: formatVolume(preview.cargoVolumeDeltaCubicDecimetres, locale),
          })}
        />
      </dl>
    </>
  );
}

function RepairDetails({ preview }: { readonly preview: RepairPreviewData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <dl className={styles['figures']}>
      <Figure
        label={translate('repair.shieldDamage')}
        value={formatQuantity(preview.shieldDamage, locale)}
      />
      <Figure
        label={translate('repair.armorDamage')}
        value={translate('repair.damageDetail', {
          points: formatQuantity(preview.armorDamage, locale),
          fraction: formatPercent(preview.missingArmorFraction, locale),
        })}
      />
      <Figure
        label={translate('repair.hullDamage')}
        value={translate('repair.damageDetail', {
          points: formatQuantity(preview.hullDamage, locale),
          fraction: formatPercent(preview.missingHullFraction, locale),
        })}
      />
      <Figure
        label={translate('repair.serviceModifier')}
        value={formatPercent(preview.serviceModifier, locale)}
      />
    </dl>
  );
}

function ResupplyDetails({ preview }: { readonly preview: ResupplyPreviewData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <table className={styles['table']}>
      <caption className={styles['caption']}>{translate('resupply.caption')}</caption>
      <thead>
        <tr>
          <th scope="col">{translate('fitting.slot')}</th>
          <th scope="col">{translate('resupply.ammunition')}</th>
          <th scope="col">{translate('resupply.loaded')}</th>
          <th scope="col">{translate('resupply.fromHold')}</th>
          <th scope="col">{translate('resupply.purchased')}</th>
          <th scope="col">{translate('transaction.total')}</th>
        </tr>
      </thead>
      <tbody>
        {preview.lines.map((line) => (
          <tr key={`${line.slot.kind}:${String(line.slot.index)}`}>
            <th scope="row">
              {translate(`slot.${line.slot.kind}`)} {line.slot.index + 1}
            </th>
            <td>
              {line.ammunitionNameKey === null
                ? translate('resupply.noAmmunition')
                : translate(line.ammunitionNameKey)}
            </td>
            <td>
              {formatQuantity(line.loadedRounds, locale)} /{' '}
              {formatQuantity(line.magazineSize, locale)}
            </td>
            <td>{formatQuantity(line.roundsFromInventory, locale)}</td>
            <td>{formatQuantity(line.roundsPurchased, locale)}</td>
            <td>
              {translate('credits.amount', { credits: formatCredits(line.totalCredits, locale) })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InsuranceDetails({ preview }: { readonly preview: InsurancePreviewData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <dl className={styles['figures']}>
      <Figure
        label={translate('insurance.currentCoverage')}
        value={translate(`insurance.coverage.${preview.currentCoverage}`)}
      />
      <Figure
        label={translate('insurance.resultingCoverage')}
        value={translate(`insurance.coverage.${preview.resultingCoverage}`)}
      />
      <Figure
        label={translate('insurance.basicPayout')}
        value={translate('credits.amount', {
          credits: formatCredits(preview.basicPayoutCredits, locale),
        })}
      />
      <Figure
        label={translate('insurance.enhancedPayout')}
        value={translate('credits.amount', {
          credits: formatCredits(preview.enhancedPayoutCredits, locale),
        })}
      />
    </dl>
  );
}
