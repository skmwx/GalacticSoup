import { describe, expect, it } from 'vitest';

import {
  compilePack,
  editDocument,
  minimalPack,
  shippedPack,
  type ContentFile,
  type ContentIssue,
} from '../../support/contentFixtures.ts';

/**
 * Guidance, notification and audible-cue content (Technical Specification
 * 6.2, 10.6, 12.4; Functional Specification 3.2, 19.7).
 *
 * The objective chain is checked statically for unreachable or circular
 * steps and for dead ends; notifications for unresolved or silent danger and
 * for a hideable ship loss; cues for the severities they speak for. The
 * shipped bundle is also held to the MVP selection: every immediate danger the
 * included systems produce is reported, and the guidance covers the loop.
 */

const GUIDANCE = 'guidance/test.json';
const NOTIFICATIONS = 'notifications/test.json';
const CUES = 'audio/test.json';

function issuesFor(pack: readonly ContentFile[], floor = false): readonly ContentIssue[] {
  const result = compilePack(pack, { floor });
  expect(result.ok).toBe(false);
  return result.issues;
}

function steps(document: Record<string, unknown>): Record<string, unknown>[] {
  const chains = document['definitions'] as Record<string, unknown>[];
  return chains[0]?.['steps'] as Record<string, unknown>[];
}

function definitions(document: Record<string, unknown>): Record<string, unknown>[] {
  return document['definitions'] as Record<string, unknown>[];
}

describe('guidance chains', () => {
  it('accepts the minimal chain and the shipped one [TECH-6.2, TECH-10.6]', () => {
    expect(compilePack(minimalPack()).issues).toEqual([]);
    expect(compilePack(shippedPack(), { floor: true }).issues).toEqual([]);
  });

  it('rejects a step that requires a later step, which could loop [TECH-10.6]', () => {
    const issues = issuesFor(editDocument(minimalPack(), GUIDANCE, (document) => {
      const [first] = steps(document);
      first!['requires'] = ['guide.test.undock'];
    }));
    expect(issues.find((issue) => issue.path.endsWith('requires[0]'))?.detail).toContain('later in the chain');
  });

  it('rejects a prerequisite that is not a step of the chain [TECH-10.6]', () => {
    const issues = issuesFor(editDocument(minimalPack(), GUIDANCE, (document) => {
      steps(document)[1]!['requires'] = ['guide.test.nowhere'];
    }));
    expect(issues.some((issue) => issue.reason === 'unresolvedReference' && issue.detail.includes('guide.test.nowhere'))).toBe(true);
  });

  it('rejects a mandatory step the player might be unable to complete [FUNC-3.2, TECH-10.6]', () => {
    const issues = issuesFor(editDocument(minimalPack(), GUIDANCE, (document) => {
      const step = steps(document)[1]!;
      step['predicate'] = { kind: 'encounterCompleted' };
      step['skippable'] = false;
    }));
    expect(issues.find((issue) => issue.path.endsWith('skippable'))?.detail).toContain('dead end');
  });

  it('rejects a step that asks for a tier no encounter reaches [TECH-10.6]', () => {
    const issues = issuesFor(editDocument(minimalPack(), GUIDANCE, (document) => {
      steps(document)[0]!['predicate'] = { kind: 'encounterEntered', minimumTier: 5 };
    }));
    expect(issues.some((issue) => issue.path.endsWith('predicate.minimumTier'))).toBe(true);
  });

  it('rejects a step id another definition already uses [TECH-6.2]', () => {
    const issues = issuesFor(editDocument(minimalPack(), GUIDANCE, (document) => {
      steps(document)[1]!['id'] = 'guide.test.choose';
    }));
    expect(issues.some((issue) => issue.reason === 'duplicateId')).toBe(true);
  });

  it('rejects a predicate that is not a registered operation [TECH-10.6, TECH-14]', () => {
    const issues = issuesFor(editDocument(minimalPack(), GUIDANCE, (document) => {
      steps(document)[0]!['predicate'] = { kind: 'runScript', source: 'alert(1)' };
    }));
    expect(issues.some((issue) => issue.file.endsWith(GUIDANCE))).toBe(true);
  });
});

describe('notifications and cues', () => {
  it('rejects a cue that does not exist [TECH-6.2, TECH-12.4]', () => {
    const issues = issuesFor(editDocument(minimalPack(), NOTIFICATIONS, (document) => {
      definitions(document)[1]!['cueId'] = 'cue.test.missing';
    }));
    expect(issues.find((issue) => issue.path.endsWith('cueId'))?.reason).toBe('unresolvedReference');
  });

  it('rejects immediate danger without a sound [FUNC-19.7]', () => {
    const issues = issuesFor(editDocument(minimalPack(), NOTIFICATIONS, (document) => {
      definitions(document)[0]!['cueId'] = null;
    }));
    expect(issues.find((issue) => issue.path.endsWith('cueId'))?.detail).toContain('audible');
  });

  it('rejects a ship loss the player could hide [FUNC-19.7]', () => {
    const issues = issuesFor(editDocument(minimalPack(), NOTIFICATIONS, (document) => {
      definitions(document)[0]!['hideable'] = true;
    }));
    expect(issues.find((issue) => issue.path.endsWith('hideable'))?.detail).toContain('cannot be hidden');
  });

  it('rejects a trigger that is not a registered operation [TECH-12.4, TECH-14]', () => {
    const issues = issuesFor(editDocument(minimalPack(), NOTIFICATIONS, (document) => {
      definitions(document)[1]!['trigger'] = { kind: 'whenever', condition: 'credits > 0' };
    }));
    expect(issues.some((issue) => issue.file.endsWith(NOTIFICATIONS))).toBe(true);
  });

  it('requires one cue for danger, which a failed save is heard by [FUNC-19.7, TECH-12.4]', () => {
    const silent = issuesFor(editDocument(minimalPack(), CUES, (document) => {
      delete definitions(document)[0]!['defaultFor'];
    }));
    expect(silent.some((issue) => issue.detail.includes('save-integrity'))).toBe(true);

    const twice = issuesFor(editDocument(minimalPack(), CUES, (document) => {
      const [cue] = definitions(document);
      definitions(document).push({ ...cue, id: 'cue.test.second' });
    }));
    expect(twice.some((issue) => issue.path.endsWith('defaultFor'))).toBe(true);
  });
});

describe('the MVP selection of guidance and notifications', () => {
  it('reports every immediate danger the included systems produce [FUNC-19.7, MVP-AC-10]', () => {
    const issues = issuesFor(editDocument(shippedPack(), 'notifications/rules.json', (document) => {
      document['definitions'] = definitions(document)
        .filter((entry) => (entry['trigger'] as { kind: string }).kind !== 'hostileLock');
    }), true);
    expect(issues.some((issue) => issue.detail.includes('first hostile lock'))).toBe(true);
  });

  it('keeps guidance for every part of the loop [MVP-AC-10]', () => {
    const issues = issuesFor(editDocument(shippedPack(), 'guidance/loop.json', (document) => {
      const chain = definitions(document)[0]!;
      chain['steps'] = (chain['steps'] as { predicate: { kind: string } }[])
        .filter((step) => step.predicate.kind !== 'lootTaken');
    }), true);
    expect(issues.some((issue) => issue.detail.includes('"lootTaken"'))).toBe(true);
  });
});
