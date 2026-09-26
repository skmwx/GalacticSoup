/**
 * Guidance, notification and audible-cue rules (Technical Specification 6.2,
 * 10.6, 12.4; Functional Specification 3.2, 19.7).
 *
 * The schemas hold each definition to its shape. These are the rules across
 * definitions that a schema cannot state:
 *
 *  - a guidance chain has no unreachable step, no missing or circular
 *    prerequisite and no step the player could be stuck on: every step that
 *    cannot be skipped completes through an action the player can always take;
 *  - a notification names a cue that exists, every immediate-danger message is
 *    audible, and ship destruction can never be hidden completely;
 *  - no two cues speak for the same severity, and one speaks for danger, which
 *    is how a save-integrity failure the interface raises is heard.
 */
import { issue } from './issues.mjs';

/**
 * Predicates the player can satisfy from any state the campaign can reach, so
 * a step using one may be made mandatory. Anything that needs a fight to go
 * well, credits or a particular item could strand the player and must stay
 * skippable (Functional Specification 3.2; Technical Specification 10.6).
 */
export const ALWAYS_SATISFIABLE_PREDICATES = new Set([
  'destinationSelected',
  'undocked',
  'docked',
  'movementOrdered',
]);

/**
 * @param {import('./compile.mjs').Collected} collected
 * @param {Map<string, unknown>} ids every top-level definition id already registered
 * @returns {import('./issues.mjs').ContentIssue[]}
 */
export function checkGuidance(collected, ids) {
  const issues = [];
  const encounterTiers = collected.definitions.encounters.map((entry) => entry.value.tier);
  const highestTier = encounterTiers.length === 0 ? 0 : Math.max(...encounterTiers);
  const stepIds = new Map();

  for (const entry of collected.definitions.guidance) {
    const chain = entry.value;
    const seen = new Set();
    chain.steps.forEach((step, index) => {
      const path = `${entry.path}.steps[${String(index)}]`;
      const previous = stepIds.get(step.id);
      if (previous !== undefined || ids.has(step.id)) {
        issues.push(issue('duplicateId', entry.file, `${path}.id`,
          `"${step.id}" is already defined${previous === undefined ? '' : ` in ${previous.file} ${previous.path}`}`));
      } else {
        stepIds.set(step.id, { file: entry.file, path });
      }

      step.requires.forEach((required, requiredIndex) => {
        const requiredPath = `${path}.requires[${String(requiredIndex)}]`;
        if (required === step.id) {
          issues.push(issue('invalidValue', entry.file, requiredPath,
            `"${step.id}" cannot require itself`));
        } else if (!seen.has(required)) {
          const later = chain.steps.some((candidate) => candidate.id === required);
          issues.push(issue(later ? 'invalidValue' : 'unresolvedReference', entry.file, requiredPath,
            later
              ? `"${required}" comes later in the chain; a step may only require earlier steps, so the chain cannot loop`
              : `"${required}" is not a step of "${chain.id}"`));
        }
      });

      if (!step.skippable && !ALWAYS_SATISFIABLE_PREDICATES.has(step.predicate.kind)) {
        issues.push(issue('invalidValue', entry.file, `${path}.skippable`,
          `"${step.id}" completes by "${step.predicate.kind}", which the player cannot always satisfy, so it must be skippable (no guidance dead end)`));
      }

      if (step.predicate.kind === 'encounterEntered' && step.predicate.minimumTier > highestTier) {
        issues.push(issue('unresolvedReference', entry.file, `${path}.predicate.minimumTier`,
          `no encounter reaches tier ${String(step.predicate.minimumTier)}; the highest is ${String(highestTier)}`));
      }

      seen.add(step.id);
    });
  }

  return issues;
}

/**
 * @param {import('./compile.mjs').Collected} collected
 * @returns {import('./issues.mjs').ContentIssue[]}
 */
export function checkNotifications(collected) {
  const issues = [];
  const cues = new Map(collected.definitions['audio.cues'].map((entry) => [entry.value.id, entry]));

  for (const entry of collected.definitions.notifications) {
    const definition = entry.value;
    if (definition.cueId !== null && !cues.has(definition.cueId)) {
      issues.push(issue('unresolvedReference', entry.file, `${entry.path}.cueId`,
        `"${definition.cueId}" is not an audio cue`));
    }
    if (definition.severity === 'danger' && definition.cueId === null) {
      issues.push(issue('invalidValue', entry.file, `${entry.path}.cueId`,
        `"${definition.id}" is an immediate-danger notification, which must be audible (Functional Specification 19.7)`));
    }
    if (definition.trigger.kind === 'shipLost' && definition.hideable) {
      issues.push(issue('invalidValue', entry.file, `${entry.path}.hideable`,
        `"${definition.id}" reports ship destruction, which cannot be hidden (Functional Specification 19.7)`));
    }
  }

  const defaults = new Map();
  for (const entry of collected.definitions['audio.cues']) {
    const severity = entry.value.defaultFor;
    if (severity === undefined) continue;
    const previous = defaults.get(severity);
    if (previous !== undefined) {
      issues.push(issue('invalidValue', entry.file, `${entry.path}.defaultFor`,
        `"${previous.value.id}" already speaks for ${severity}`));
      continue;
    }
    defaults.set(severity, entry);
  }
  if (collected.definitions['audio.cues'].length > 0 && !defaults.has('danger')) {
    const first = collected.definitions['audio.cues'][0];
    issues.push(issue('invalidValue', first.file, 'definitions',
      'no cue speaks for danger, so a save-integrity failure would be silent (Functional Specification 19.7)'));
  }

  return issues;
}
