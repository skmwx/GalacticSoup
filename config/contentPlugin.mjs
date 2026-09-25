/**
 * The content bundle as a build input (Technical Specification 6.2, 6.3).
 *
 * The plugin compiles `content/` when the development server starts, when the
 * test run starts and when the production bundle is built, and fails that
 * start or build on any content error. The compiled bundle is then served as
 * the virtual module the content adapter imports, so nothing at runtime reads
 * a file or re-validates what the build already proved.
 *
 * In development it watches the authored files and the schemas, recompiles on
 * change and invalidates the module, so a content edit is visible without a
 * restart and a content mistake is reported immediately.
 */
import path from 'node:path';

import { compileContent } from '../scripts/lib/content/compile.mjs';
import { formatIssue } from '../scripts/lib/content/issues.mjs';
import { CONTENT_ROOT, readContentFiles } from '../scripts/lib/content/read.mjs';
import { REPO_ROOT } from './aliases.mjs';
import { CONTENT_BUNDLE_MODULE } from './packages.mjs';

const RESOLVED_ID = `\0${CONTENT_BUNDLE_MODULE}`;
const SCHEMA_ROOT = path.join(REPO_ROOT, 'schemas', 'content');

/**
 * Compiles the authored content, throwing an error that names every problem.
 * The shipped content is also held to the MVP content floor; another root -
 * a fixture pack - is held to the game's rules alone.
 * @param {string} [root]
 */
export function compileContentOrThrow(root = CONTENT_ROOT) {
  const result = compileContent(readContentFiles(root), { floor: root === CONTENT_ROOT });
  if (!result.ok) {
    throw new Error(
      [
        `Content validation failed (${String(result.issues.length)} problems):`,
        ...result.issues.map((entry) => `  ${formatIssue(entry)}`),
      ].join('\n'),
    );
  }
  return result;
}

/**
 * @param {{ root?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function contentPlugin(options = {}) {
  const root = options.root ?? CONTENT_ROOT;
  /** @type {object | null} */
  let bundle = null;

  const compile = () => {
    bundle = compileContentOrThrow(root).bundle;
    return bundle;
  };

  return {
    name: 'galactic-soup:content',
    enforce: 'pre',

    buildStart() {
      compile();
    },

    resolveId(id) {
      return id === CONTENT_BUNDLE_MODULE ? RESOLVED_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_ID) {
        return null;
      }
      const compiled = bundle ?? compile();
      return `export default ${JSON.stringify(compiled)};`;
    },

    configureServer(server) {
      server.watcher.add(root);
      server.watcher.add(SCHEMA_ROOT);

      const onChange = (changed) => {
        const inside = changed.startsWith(root) || changed.startsWith(SCHEMA_ROOT);
        if (!inside || !changed.endsWith('.json')) {
          return;
        }
        try {
          compile();
          const module = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (module !== undefined) {
            server.moduleGraph.invalidateModule(module);
          }
          server.ws.send({ type: 'full-reload' });
        } catch (error) {
          server.ws.send({
            type: 'error',
            err: {
              message: error instanceof Error ? error.message : String(error),
              stack: '',
            },
          });
        }
      };

      server.watcher.on('add', onChange);
      server.watcher.on('change', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}
