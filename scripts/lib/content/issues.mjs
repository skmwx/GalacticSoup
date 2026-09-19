/**
 * Content issue reporting (Technical Specification 5.4, 6.2).
 *
 * An issue names a stable reason, the authored file and the JSON path inside
 * it, so a development diagnostic points at the exact value that broke a rule.
 * The reason vocabulary is the protocol's, imported rather than repeated, so a
 * build failure and a load failure speak the same language.
 */
import { CONTENT_ERROR_REASONS } from '../../../src/protocol/errors.ts';

const REASONS = new Set(CONTENT_ERROR_REASONS);

/**
 * @typedef {object} ContentIssue
 * @property {string} reason  One of the protocol's content error reasons.
 * @property {string} file    Repository-relative authored file, or ''.
 * @property {string} path    JSON path inside that file, or ''.
 * @property {string} detail  Developer-facing explanation.
 */

/**
 * @param {string} reason
 * @param {string} file
 * @param {string} path
 * @param {string} detail
 * @returns {ContentIssue}
 */
export function issue(reason, file, path, detail) {
  if (!REASONS.has(reason)) {
    throw new Error(`"${reason}" is not a declared content error reason.`);
  }
  return { reason, file, path, detail };
}

/** @param {ContentIssue} value */
export function formatIssue(value) {
  const where = [value.file || '(bundle)', value.path].filter(Boolean).join(' ');
  return `${where}: [${value.reason}] ${value.detail}`;
}

/**
 * Orders issues so a run reports them the same way every time.
 * @param {ContentIssue[]} issues
 */
export function sortIssues(issues) {
  return [...issues].sort(
    (a, b) =>
      compare(a.file, b.file) || compare(a.path, b.path) || compare(a.reason, b.reason) ||
      compare(a.detail, b.detail),
  );
}

function compare(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
