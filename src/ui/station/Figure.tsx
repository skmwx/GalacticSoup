import type { JSX } from 'react';

import styles from './Station.module.css';

/**
 * One labelled figure in a station readout.
 *
 * A cost, a capacity and a derived statistic are all read the same way, so
 * they are laid out the same way wherever a station surface shows one.
 */
export interface FigureProps {
  readonly label: string;
  readonly value: string;
}

export function Figure({ label, value }: FigureProps): JSX.Element {
  return (
    <div className={styles['figure']}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
