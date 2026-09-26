import type { JSX } from 'react';

import type { GuidanceChainData, GuidanceStepData, OnboardingData } from '@protocol';

import { ActionButton, ActionIcon, actionById, commandAvailability, type ActionRunner } from '../actions';
import type { PlayData } from '../frame/usePlayData';
import { useTranslate } from '../localization';
import styles from './Guidance.module.css';

/**
 * Contextual guidance (Functional Specification 3.2 as MVP Scope 3 selects
 * it; Technical Specification 10.6; MVP-AC-10).
 *
 * The engine decides which step the player is on and whether it can be
 * skipped; this shows it where the player is, says where it is carried out,
 * and can take the player to that station surface. The full list of steps
 * with their state is one disclosure away. Hiding the guidance and showing it
 * again are commands, because guidance progress is campaign state.
 *
 * A step's state is written as a word and drawn as a distinct mark, never
 * conveyed by colour alone.
 *
 * @implements FUNC-3.2, FUNC-19.6, FUNC-22.10, TECH-10.6, MVP-AC-10
 */

export interface GuidancePanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** Opens a station surface, or `null` when the player is not docked. */
  readonly onGoTo: ((surface: string) => void) | null;
  /** The station surface already open, so "Show me" is not offered twice. */
  readonly openSurface: string | null;
}

const STATUS_MARKS: Readonly<Record<GuidanceStepData['status'], string>> = {
  completed: '✓',
  skipped: '↷',
  current: '▶',
  open: '○',
  waiting: '…',
};

export function GuidancePanel({ data, runner, onGoTo, openSurface }: GuidancePanelProps): JSX.Element | null {
  const translate = useTranslate();
  const onboarding = data.onboarding;
  if (onboarding === null || onboarding.hidden) return null;
  const found = currentOf(onboarding);
  const chain = found?.chain ?? onboarding.chains[0] ?? null;
  if (chain === null) return null;
  const step = found?.step ?? null;
  const done = chain.completedCount + chain.skippedCount;
  const skip = commandAvailability(step?.commands, 'onboarding.skipStep');
  const surfaceLabel = step === null ? null : translate(surfaceLabelKey(step.surface));
  const canGo = step !== null && step.surface !== 'space' && onGoTo !== null && openSurface !== step.surface;

  return (
    <section
      className={styles['guidance']}
      aria-labelledby="guidance-heading"
      data-guidance
      data-guidance-step={step?.id ?? 'finished'}
    >
      <div className={styles['header']}>
        <h2 id="guidance-heading" className={styles['title']}>
          <ActionIcon icon="guide" className={styles['icon']} />
          {translate(chain.titleKey)}
        </h2>
        <p className={styles['progress']}>
          {translate('guidance.progress', { done, total: chain.steps.length })}
        </p>
      </div>

      {step === null ? (
        <p className={styles['body']}>{translate(chain.completedKey)}</p>
      ) : (
        <div className={styles['current']}>
          <h3 className={styles['stepTitle']}>{translate(step.titleKey)}</h3>
          <p className={styles['body']}>{translate(step.bodyKey)}</p>
          <p className={styles['where']}>
            {translate('guidance.where', { surface: surfaceLabel ?? '' })}
          </p>
        </div>
      )}

      <div className={styles['toolbar']}>
        {step !== null && step.surface !== 'space' && onGoTo !== null ? (
          <ActionButton
            actionId="guidance.goTo"
            runner={runner}
            available={canGo}
            unavailableReason={canGo ? null : 'guidance.alreadyThere'}
            onRun={() => {
              onGoTo(step.surface);
            }}
          />
        ) : null}
        {step === null ? null : (
          <ActionButton
            actionId="guidance.skip"
            runner={runner}
            available={skip.available}
            unavailableReason={skip.unavailableReason}
            onRun={async () => {
              await data.send('onboarding.skipStep', { stepId: step.id });
            }}
          />
        )}
        <ActionButton
          actionId="guidance.toggle"
          runner={runner}
          label={translate('guidance.hide')}
          onRun={async () => {
            await data.send('onboarding.hide', {});
          }}
        />
      </div>

      <details className={styles['details']}>
        <summary>{translate('guidance.allSteps')}</summary>
        <p className={styles['body']}>{translate(chain.introKey)}</p>
        <ol className={styles['steps']}>
          {chain.steps.map((entry) => (
            <li key={entry.id} className={styles[entry.status]} data-step={entry.id} data-status={entry.status}>
              <span className={styles['mark']} aria-hidden="true">{STATUS_MARKS[entry.status]}</span>
              <span className={styles['stepName']}>{translate(entry.titleKey)}</span>
              <span className={styles['status']}>{translate(`guidance.status.${entry.status}`)}</span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

/** The message key naming where a step is carried out. */
export function surfaceLabelKey(surface: string): string {
  return surface === 'space' ? 'guidance.surface.space' : actionById(surface).labelKey;
}

/** The chain and step the engine points the player at. */
export function currentOf(
  onboarding: OnboardingData,
): { readonly chain: GuidanceChainData; readonly step: GuidanceStepData } | null {
  for (const chain of onboarding.chains) {
    const step = chain.steps.find((candidate) => candidate.id === onboarding.currentStepId);
    if (step !== undefined) return { chain, step };
  }
  return null;
}

/** The station surface the current step is carried out on, while the guidance shows. */
export function guidedSurface(onboarding: OnboardingData | null): string | null {
  if (onboarding === null || onboarding.hidden) return null;
  return currentOf(onboarding)?.step.surface ?? null;
}
