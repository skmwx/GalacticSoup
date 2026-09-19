import { describe, expect, it, vi } from 'vitest';

import { createLocalizer, formatMessage, type LocalizationIssue } from '@shared';

describe('message formatting', () => {
  it('substitutes named parameters [TECH-12.5]', () => {
    const result = formatMessage('Engine ready over {transport}.', { transport: 'a worker' });

    expect(result.text).toBe('Engine ready over a worker.');
    expect(result.missingParameters).toEqual([]);
  });

  it('formats numbers for the locale [TECH-12.5]', () => {
    const result = formatMessage('{count} request types', { count: 12345 }, 'en');

    expect(result.text).toBe('12,345 request types');
  });

  it('treats doubled braces as literal braces [TECH-12.5]', () => {
    const result = formatMessage('{{literal}} and {value}', { value: 'substituted' });

    expect(result.text).toBe('{literal} and substituted');
  });

  it('reports a placeholder that has no parameter and leaves it visible [TECH-12.5]', () => {
    const result = formatMessage('Missing {one} and {two}', { one: 'here' });

    expect(result.text).toBe('Missing here and {two}');
    expect(result.missingParameters).toEqual(['two']);
  });

  it('reports parameters the template never used [TECH-12.5]', () => {
    const result = formatMessage('No placeholders', { stage: 'handle', type: 'system.health' });

    expect(result.unusedParameters).toEqual(['stage', 'type']);
  });
});

describe('localizer', () => {
  const catalog = {
    'shell.engine.ready': 'Engine ready over {transport}.',
    'shell.note': 'A note.',
  };

  it('resolves a key against the catalog [TECH-12.5]', () => {
    const localizer = createLocalizer({ locale: 'en', catalog });

    expect(localizer.translate('shell.engine.ready', { transport: 'a worker' })).toBe(
      'Engine ready over a worker.',
    );
    expect(localizer.has('shell.note')).toBe(true);
  });

  it('returns the key and reports the gap when a message is missing [TECH-12.5]', () => {
    const issues: LocalizationIssue[] = [];
    const localizer = createLocalizer({
      locale: 'en',
      catalog,
      onIssue: (issue) => issues.push(issue),
    });

    expect(localizer.translate('shell.absent')).toBe('shell.absent');
    expect(issues).toEqual([{ kind: 'missing-key', locale: 'en', key: 'shell.absent' }]);
  });

  it('reports a missing parameter without throwing [TECH-12.5]', () => {
    const onIssue = vi.fn();
    const localizer = createLocalizer({ locale: 'en', catalog, onIssue });

    expect(localizer.translate('shell.engine.ready')).toBe('Engine ready over {transport}.');
    expect(onIssue).toHaveBeenCalledWith({
      kind: 'missing-parameter',
      locale: 'en',
      key: 'shell.engine.ready',
      parameter: 'transport',
    });
  });

  it('only reports unused parameters when asked to [TECH-12.5]', () => {
    const quiet = vi.fn();
    createLocalizer({ locale: 'en', catalog, onIssue: quiet }).translate('shell.note', {
      diagnostic: 'value',
    });
    expect(quiet).not.toHaveBeenCalled();

    const strict = vi.fn();
    createLocalizer({
      locale: 'en',
      catalog,
      onIssue: strict,
      reportUnusedParameters: true,
    }).translate('shell.note', { diagnostic: 'value' });
    expect(strict).toHaveBeenCalledWith({
      kind: 'unused-parameter',
      locale: 'en',
      key: 'shell.note',
      parameter: 'diagnostic',
    });
  });
});
