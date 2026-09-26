import type { JSX } from 'react';

import { ActionIcon } from '../actions';
import { useTranslate } from '../localization';
import styles from './Guidance.module.css';

/**
 * Marks the control where the guidance's current step is carried out, with a
 * word and a shape rather than a colour alone (Functional Specification 3.2,
 * 20).
 *
 * The visible badge is decorative for assistive technology, so the control
 * keeps its own name; the control points at a `GuidedHint` through
 * `aria-describedby` instead, which is read as its description.
 */
export function GuidedBadge(): JSX.Element {
  const translate = useTranslate();
  return (
    <span className={styles['badge']} aria-hidden="true" data-guided-badge>
      <ActionIcon icon="guide" />
      {translate('guidance.badge')}
    </span>
  );
}

/** The description a guided control carries, rendered once and referenced by id. */
export function GuidedHint({ id }: { readonly id: string }): JSX.Element {
  const translate = useTranslate();
  return (
    <span id={id} className={styles['visuallyHidden']}>
      {translate('guidance.badge.description')}
    </span>
  );
}
