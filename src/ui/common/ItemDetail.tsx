import { useEffect, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { ComparisonData, ComparisonEntryData, MarketItemData } from '@protocol';

import { formatCredits, formatDifference, formatStat, formatVolume } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './ItemDetail.module.css';

/**
 * Consistent item inspection and side-by-side comparison
 * (Functional Specification 19.5, 19.6).
 *
 * Every station screen shows an item the same way, because it is the same
 * component: the market row, the hangar stack and the fitting candidate all
 * open this. The comparison is an engine projection - which rows mean the same
 * thing for two definitions is a content rule - so this only groups and
 * formats what the engine decided.
 *
 * @implements FUNC-19.5, FUNC-19.6
 */

export interface ItemSummaryProps {
  readonly item: MarketItemData;
  /** Extra facts the surface knows, such as a price or a stock count. */
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
}

export function ItemSummary({ item, facts = [] }: ItemSummaryProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <div className={styles['summary']}>
      <p className={styles['name']}>{translate(item.nameKey)}</p>
      <p className={styles['kind']}>{translate(`item.kind.${item.kind}`)}</p>
      <p className={styles['description']}>{translate(item.descriptionKey)}</p>
      <dl className={styles['facts']}>
        <Fact
          label={translate('item.referenceValue')}
          value={translate('credits.amount', {
            credits: formatCredits(item.referenceValueCredits, locale),
          })}
        />
        <Fact
          label={translate('item.unitVolume')}
          value={translate('volume.cubicMetres', {
            volume: formatVolume(item.unitVolumeCubicDecimetres, locale),
          })}
        />
        {facts.map((fact) => (
          <Fact key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </dl>
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className={styles['fact']}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export interface ItemComparisonProps {
  readonly gateway: ClientGateway;
  readonly definitionId: string;
  readonly againstDefinitionId: string;
}

/**
 * Two definitions side by side, grouped by purpose and marked by direction.
 *
 * Direction is never colour alone: each row carries a word and an arrow, so
 * "better" survives a monochrome display and a screen reader.
 */
export function ItemComparison({
  gateway,
  definitionId,
  againstDefinitionId,
}: ItemComparisonProps): JSX.Element {
  const translate = useTranslate();
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setComparison(null);
    setFailed(false);
    void gateway
      .request('item.compare', { definitionId, againstDefinitionId })
      .then((response) => {
        if (!active) {
          return;
        }
        if (response.ok) {
          setComparison(response.data);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [gateway, definitionId, againstDefinitionId]);

  if (failed) {
    return <p className={styles['empty']}>{translate('compare.unavailable')}</p>;
  }
  if (comparison === null) {
    return <p className={styles['empty']}>{translate('compare.loading')}</p>;
  }
  if (!comparison.comparable) {
    return <p className={styles['empty']}>{translate('compare.notComparable')}</p>;
  }

  const groups = [...new Set(comparison.entries.map((entry) => entry.group))];

  return (
    <div className={styles['comparison']}>
      <table className={styles['table']}>
        <caption className={styles['caption']}>
          {translate('compare.caption', {
            left: translate(comparison.left.nameKey),
            right: translate(comparison.right.nameKey),
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{translate('compare.attribute')}</th>
            <th scope="col">{translate(comparison.left.nameKey)}</th>
            <th scope="col">{translate(comparison.right.nameKey)}</th>
            <th scope="col">{translate('compare.difference')}</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group}>
            <tr>
              <th scope="rowgroup" colSpan={4} className={styles['group']}>
                {translate(`comparison.group.${group}`)}
              </th>
            </tr>
            {comparison.entries
              .filter((entry) => entry.group === group)
              .map((entry) => (
                <ComparisonRow key={entry.key} entry={entry} />
              ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const DIRECTION_MARKS: Readonly<Record<string, string>> = {
  better: '▲',
  worse: '▼',
  equal: '=',
  neutral: '•',
};

function ComparisonRow({ entry }: { readonly entry: ComparisonEntryData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <tr>
      <th scope="row">{translate(entry.labelKey)}</th>
      <td>{entry.left === null ? '-' : formatStat(entry.left, locale)}</td>
      <td>{entry.right === null ? '-' : formatStat(entry.right, locale)}</td>
      <td className={styles[entry.direction] ?? ''}>
        <span aria-hidden="true">{DIRECTION_MARKS[entry.direction] ?? ''}</span>{' '}
        {entry.difference === null ? '-' : formatDifference(entry.difference, locale)}{' '}
        <span className={styles['directionWord']}>
          {translate(`compare.direction.${entry.direction}`)}
        </span>
      </td>
    </tr>
  );
}
