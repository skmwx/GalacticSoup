import path from 'node:path';

import { createContentRepository, parseContentBundle } from '@adapters/content';
import type { ContentRepository } from '@engine';

import { compileContent } from '../../scripts/lib/content/compile.mjs';
import { readContentFiles } from '../../scripts/lib/content/read.mjs';

/**
 * Authored fixture packs for the content tests.
 *
 * `tests/fixtures/content/minimal` is the smallest set that satisfies every
 * required kind. A negative test starts from it and changes one thing, so the
 * reported issue is unambiguously caused by that change and no test depends on
 * the shipped balance data.
 */

export interface ContentFile {
  readonly path: string;
  readonly text: string;
}

export interface ContentIssue {
  readonly reason: string;
  readonly file: string;
  readonly path: string;
  readonly detail: string;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly bundle: Record<string, unknown> | null;
  readonly issues: readonly ContentIssue[];
  readonly stats: { readonly files: number; readonly definitions: number; readonly messages: number };
}

const MINIMAL_ROOT = path.resolve('tests/fixtures/content/minimal');

export function minimalPack(): ContentFile[] {
  return readContentFiles(MINIMAL_ROOT) as ContentFile[];
}

export function compilePack(files: readonly ContentFile[]): CompileResult {
  return compileContent(files as ContentFile[]) as CompileResult;
}

/** Replaces the text of the one fixture file whose path ends with `suffix`. */
export function editFile(
  files: readonly ContentFile[],
  suffix: string,
  edit: (text: string) => string,
): ContentFile[] {
  let edited = false;
  const result = files.map((file) => {
    if (!file.path.endsWith(suffix)) {
      return file;
    }
    edited = true;
    return { path: file.path, text: edit(file.text) };
  });
  if (!edited) {
    throw new Error(`No fixture file ends with "${suffix}".`);
  }
  return result;
}

/** Rewrites one fixture document through a parsed-object transform. */
export function editDocument(
  files: readonly ContentFile[],
  suffix: string,
  edit: (document: Record<string, unknown>) => void,
): ContentFile[] {
  return editFile(files, suffix, (text) => {
    const document = JSON.parse(text) as Record<string, unknown>;
    edit(document);
    return JSON.stringify(document, null, 2);
  });
}

export function removeFile(files: readonly ContentFile[], suffix: string): ContentFile[] {
  return files.filter((file) => !file.path.endsWith(suffix));
}

/** Compiles the minimal pack and returns it as a content repository. */
export function fixtureRepository(files: readonly ContentFile[] = minimalPack()): ContentRepository {
  const result = compilePack(files);
  if (!result.ok || result.bundle === null) {
    throw new Error(
      `Fixture pack did not compile: ${result.issues.map((issue) => issue.detail).join('; ')}`,
    );
  }
  return createContentRepository(parseContentBundle(result.bundle), { freeze: true });
}
