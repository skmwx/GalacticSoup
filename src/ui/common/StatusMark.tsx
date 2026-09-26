import type { JSX } from 'react';

import styles from './StatusMark.module.css';

/**
 * The shape that goes with a coloured state (Technical Specification 12.2;
 * Functional Specification 20).
 *
 * A tick for "fine", an exclamation mark for a warning and a cross for an
 * error or a refusal, each in a frame of its own shape, so two lines that
 * differ in colour also differ in form. The mark is decorative for assistive
 * technology: the words beside it, or the label of the list it heads, carry
 * the meaning.
 *
 * @implements TECH-12.2, FUNC-20
 */
export type StatusMarkKind = 'ok' | 'warning' | 'error';

const GLYPHS: Readonly<Record<StatusMarkKind, string>> = {
  ok: '✓',
  warning: '!',
  error: '✕',
};

export function StatusMark({ kind }: { readonly kind: StatusMarkKind }): JSX.Element {
  return (
    <span className={`${styles['mark']} ${styles[kind] ?? ''}`} aria-hidden="true" data-status-mark={kind}>
      {GLYPHS[kind]}
    </span>
  );
}
