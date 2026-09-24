import type { JSX } from 'react';

import type { AttributeStepData, FormulaTraceData } from '@protocol';

import { formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Explanation.module.css';

/**
 * Expanded formula explanations (Functional Specification 19.6;
 * Technical Specification 7.3).
 *
 * The engine publishes the operands it substituted, the unrounded result and
 * the result it displayed. This lays them out; it never recomputes a formula
 * or invents a step, so the explanation and the number it explains cannot
 * disagree. Every explanation is collapsed by default and opened on demand.
 *
 * @implements FUNC-19.6, TECH-7.3
 */

export interface FormulaExplanationProps {
  readonly traces: readonly FormulaTraceData[];
  /** Overrides the summary text on the disclosure. */
  readonly label?: string;
}

export function FormulaExplanation({ traces, label }: FormulaExplanationProps): JSX.Element | null {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  if (traces.length === 0) {
    return null;
  }

  return (
    <details className={styles['explanation']}>
      <summary className={styles['summary']}>{label ?? translate('explain.show')}</summary>
      {traces.map((trace) => (
        <div key={`${trace.formulaKey}:${String(trace.displayResult)}`} className={styles['trace']}>
          <p className={styles['formula']}>{translate(`formula.${trace.formulaKey}`)}</p>
          <dl className={styles['operands']}>
            {trace.operands.map((operand) => (
              <div key={operand.key} className={styles['operand']}>
                <dt>{translate(`operand.${operand.key}`)}</dt>
                <dd>{formatStat(operand.value, locale)}</dd>
              </div>
            ))}
          </dl>
          <p className={styles['result']}>
            {translate('explain.result', {
              unrounded: formatStat(trace.unroundedResult, locale),
              displayed: formatStat(trace.displayResult, locale),
            })}
          </p>
        </div>
      ))}
    </details>
  );
}

export interface SubstitutedExplanationProps {
  readonly trace: FormulaTraceData;
  /** The summary text on the disclosure. */
  readonly label: string;
  /** The result as the surface displays it, with its unit. */
  readonly result: string;
}

/**
 * A formula with the current values written into it
 * (Functional Specification 19.6).
 *
 * The formula's message names its operands as placeholders, so the sentence
 * the player reads is the formula with the engine's operands substituted. The
 * operands are listed beneath it by name, and the result is the one the
 * surface shows - the explanation cannot drift from the number it explains.
 *
 * @implements FUNC-19.6, TECH-7.3
 */
export function SubstitutedExplanation({
  trace,
  label,
  result,
}: SubstitutedExplanationProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const params = Object.fromEntries(
    trace.operands.map((operand) => [operand.key, formatStat(operand.value, locale)]),
  );

  return (
    <details className={styles['explanation']} data-explains={trace.formulaKey}>
      <summary className={styles['summary']}>{label}</summary>
      <p className={styles['formula']}>{translate(trace.formulaKey, params)}</p>
      <dl className={styles['operands']}>
        {trace.operands.map((operand) => (
          <div key={operand.key} className={styles['operand']}>
            <dt>{translate(`operand.${operand.key}`)}</dt>
            <dd>{formatStat(operand.value, locale)}</dd>
          </div>
        ))}
      </dl>
      <p className={styles['result']}>{translate('explain.shown', { result })}</p>
    </details>
  );
}

export interface AttributeExplanationProps {
  readonly steps: readonly AttributeStepData[];
  readonly base: number;
  readonly value: number;
  readonly clamped: boolean;
}

/**
 * Why a derived ship statistic is what it is
 * (Functional Specification 4.4, 19.6).
 *
 * The steps arrive in the order the engine applied them, each with the
 * stacking multiplier it was diminished by and the running result, so the
 * player can see which module actually moved the number.
 */
export function AttributeExplanation({
  steps,
  base,
  value,
  clamped,
}: AttributeExplanationProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <details className={styles['explanation']}>
      <summary className={styles['summary']}>{translate('explain.show')}</summary>
      <p className={styles['formula']}>
        {translate('explain.base', { base: formatStat(base, locale) })}
      </p>
      {steps.length === 0 ? (
        <p className={styles['result']}>{translate('explain.noModifiers')}</p>
      ) : (
        <ol className={styles['steps']}>
          {steps.map((step, index) => (
            <li key={`${step.sourceId}:${step.stage}:${String(index)}`}>
              {translate('explain.step', {
                source: translate(step.sourceKey),
                operation: translate(`operation.${step.operation}`),
                value: formatStat(step.effectiveValue, locale),
                stacking: formatStat(step.stackingMultiplier, locale),
                result: formatStat(step.result, locale),
              })}
            </li>
          ))}
        </ol>
      )}
      <p className={styles['result']}>
        {translate('explain.finalValue', { value: formatStat(value, locale) })}
        {clamped ? ` ${translate('explain.clamped')}` : ''}
      </p>
    </details>
  );
}
