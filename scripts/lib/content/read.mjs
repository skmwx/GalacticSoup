/**
 * Reading authored content from disk.
 *
 * Kept apart from `compile.mjs` so compilation itself is a pure function of a
 * list of files: a test can compile a fixture pack, or the same pack in a
 * different order, without touching the file system.
 */
import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../../../config/aliases.mjs';

export const CONTENT_ROOT = path.join(REPO_ROOT, 'content');

/**
 * @param {string} [root] Absolute path of the content directory.
 * @returns {{ path: string, text: string }[]} sorted by path
 */
export function readContentFiles(root = CONTENT_ROOT) {
  if (!fs.existsSync(root)) {
    return [];
  }
  return listJsonFiles(root)
    .map((absolute) => ({
      path: path.relative(REPO_ROOT, absolute).split(path.sep).join('/'),
      text: fs.readFileSync(absolute, 'utf8'),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function listJsonFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listJsonFiles(absolute));
    } else if (entry.name.endsWith('.json')) {
      found.push(absolute);
    }
  }
  return found.sort();
}
