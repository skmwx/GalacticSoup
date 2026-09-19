import { useEffect, useRef, type JSX } from 'react';

import type { ErrorParams } from '@protocol';
import type { MessageKey } from '@shared';

import { useTranslate } from '../localization';
import styles from './CompatibilityFailure.module.css';

/**
 * Blocking compatibility failure (Technical Specification 4.2).
 *
 * When the engine cannot be hosted, the game stops here. It offers no way to
 * continue, because the alternative would be running authoritative rules on the
 * interface thread. The surface takes focus so a keyboard or screen-reader user
 * reaches the explanation immediately.
 *
 * @implements TECH-4.2
 */

export interface CompatibilityFailureProps {
  readonly messageKey: MessageKey;
  readonly params?: ErrorParams;
}

export function CompatibilityFailure({
  messageKey,
  params,
}: CompatibilityFailureProps): JSX.Element {
  const translate = useTranslate();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className={styles['backdrop']}>
      <div
        ref={dialogRef}
        className={styles['dialog']}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="compatibility-heading"
        aria-describedby="compatibility-reason"
        tabIndex={-1}
      >
        <h1 id="compatibility-heading" className={styles['heading']}>
          {translate('compatibility.heading')}
        </h1>
        <p id="compatibility-reason" className={styles['reason']}>
          {translate(messageKey, params)}
        </p>
        <p className={styles['detail']}>{translate('compatibility.detail')}</p>
        <p className={styles['detail']}>{translate('compatibility.advice')}</p>
      </div>
    </div>
  );
}
