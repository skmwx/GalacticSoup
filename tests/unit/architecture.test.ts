import { describe, expect, it } from 'vitest';

import { checkArchitecture, extractImports, scanSource } from '../../scripts/lib/architecture.mjs';

/**
 * The boundary rules are enforced in the unit suite as well as by
 * `npm run check:architecture`, so a layering mistake fails the ordinary test
 * run (Technical Specification 4.1, 4.3, 18).
 */
describe('architecture boundaries', () => {
  it('has no boundary, direction, platform or cycle violations [TECH-4.1, TECH-4.3, TECH-18]', () => {
    const { violations, fileCount } = checkArchitecture();

    const report = violations
      .map((violation) => `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`)
      .join('\n');

    expect(report).toBe('');
    expect(fileCount).toBeGreaterThan(0);
  });
});

describe('source scanning', () => {
  it('keeps import specifiers while removing comments [TECH-4.3]', () => {
    const source = [
      '// import { Hidden } from "@engine";',
      '/* import { AlsoHidden } from "@engine"; */',
      "import { Real } from '@protocol';",
    ].join('\n');

    const specifiers = extractImports(scanSource(source).codeWithStrings).map(
      (reference) => reference.specifier,
    );

    expect(specifiers).toEqual(['@protocol']);
  });

  it('blanks string contents before identifier scanning [TECH-4.3]', () => {
    const { codeOnly } = scanSource("const note = 'document and window';");

    expect(codeOnly).not.toContain('document');
    expect(codeOnly).toContain('const note');
  });

  it('finds dynamic and re-exported imports [TECH-4.3]', () => {
    const source = ["export { a } from '@shared';", "const m = await import('@protocol');"].join(
      '\n',
    );

    const specifiers = extractImports(scanSource(source).codeWithStrings).map(
      (reference) => reference.specifier,
    );

    expect(specifiers).toEqual(['@shared', '@protocol']);
  });
});
