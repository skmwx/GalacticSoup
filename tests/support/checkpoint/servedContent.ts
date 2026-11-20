import vm from 'node:vm';

import type { ContentRepository } from '@engine';

// The content adapter's index also exports the bundled loader, which imports
// the build's virtual module; a Playwright worker has no Vite to resolve it,
// so the parser and the repository are imported from their own files.
import { parseContentBundle } from '../../../src/adapters/content/parseBundle.ts';
import { createContentRepository } from '../../../src/adapters/content/repository.ts';

/**
 * The content compiled into the build the browser tests are served
 * (Test Suite Optimization Plan phase 3; Technical Specification 6.3).
 *
 * A checkpoint must name exactly the content the served worker loads it with.
 * Rather than compiling `content/` again - which could differ from a build
 * made earlier - this reads the bundle out of the served engine worker: the
 * build inlines the compiled bundle there as one object literal that begins
 * with its `contentHash`. The literal is evaluated in an empty context and
 * then parsed by the shipped parser, which recomputes the digest and refuses
 * a bundle that does not match its own hash, so a bundle that was cut short
 * or misread cannot pass.
 */

const cache = new Map<string, Promise<ContentRepository>>();

/** The served build's content, read once per worker process and base URL. */
export function servedContent(baseURL: string): Promise<ContentRepository> {
  let found = cache.get(baseURL);
  if (found === undefined) {
    found = readServedContent(baseURL);
    cache.set(baseURL, found);
  }
  return found;
}

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The served build answered ${String(response.status)} for ${url}.`);
  return response.text();
}

async function readServedContent(baseURL: string): Promise<ContentRepository> {
  const html = await text(new URL('/', baseURL).href);
  const entry = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
  if (entry === undefined) throw new Error('The served page names no entry script.');
  const app = await text(new URL(entry, baseURL).href);
  const workerPath = /\/assets\/engineWorker-[\w-]+\.js/.exec(app)?.[0];
  if (workerPath === undefined) throw new Error('The served entry script names no engine worker.');
  const worker = await text(new URL(workerPath, baseURL).href);

  const literal = bundleLiteral(worker);
  if (literal === null) {
    throw new Error(
      `The served worker ${workerPath} holds no content bundle literal; the checkpoint helper cannot read the served content.`,
    );
  }
  // Serialised inside the empty context and parsed here, so the bundle is
  // plain data with this realm's prototypes, as the parser requires.
  const serialised = vm.runInNewContext(`JSON.stringify(${literal})`, Object.create(null), { timeout: 5_000 }) as string;
  const bundle: unknown = JSON.parse(serialised);
  return createContentRepository(parseContentBundle(bundle), { freeze: false });
}

/**
 * The source text of the object literal that starts `{contentHash:` in the
 * worker, found by matching braces outside strings, or `null`.
 */
function bundleLiteral(source: string): string | null {
  const start = source.search(/\{contentHash:[`"']/);
  if (start < 0) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      else if (quote === '`' && char === '$' && source[index + 1] === '{') {
        // The compiled bundle is data: a substitution means this is not it.
        return null;
      }
      continue;
    }
    if (char === '`' || char === '"' || char === "'") quote = char;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}
