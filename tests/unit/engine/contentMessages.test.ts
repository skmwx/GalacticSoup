import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { PROTOCOL_VERSION, validatePayload, type ContentMessagesData } from '@protocol';

import { shippedContent } from '../../support/content.ts';

/**
 * The authored message catalogue the interface resolves projection keys
 * against (Technical Specification 6.1, 12.5).
 *
 * Projections carry keys, never rendered text, and the keys for an item's name
 * or a station's title are authored beside the content. The interface cannot
 * read the content bundle, so the engine answers for it.
 */

const content = shippedContent();

async function ask(payload: unknown): Promise<unknown> {
  return createEngineHost({ content, saves: createMemorySaveStore() }).handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-messages',
    type: 'content.messages',
    payload,
  });
}

function dataOf(response: unknown): ContentMessagesData {
  const answer = response as { ok: boolean; data: ContentMessagesData };
  expect(answer.ok).toBe(true);
  return answer.data;
}

describe('content messages', () => {
  it('answers with the default locale when none is asked for [TECH-12.5]', async () => {
    const data = dataOf(await ask({}));

    expect(data.locale).toBe(content.defaultLocale);
    expect(data.resolvedLocale).toBe(content.defaultLocale);
    expect(data.contentVersion).toBe(content.contentVersion);
  });

  it('resolves every message key a projection can carry [TECH-12.5]', async () => {
    const data = dataOf(await ask({ locale: 'en' }));

    const required = [
      ...content.hulls().flatMap((hull) => [hull.nameKey, hull.descriptionKey, ...hull.traitKeys]),
      ...content.modules().flatMap((module) => [module.nameKey, module.descriptionKey]),
      ...content.ammunitions().flatMap((ammunition) => [
        ammunition.nameKey,
        ammunition.descriptionKey,
      ]),
      ...content.items().flatMap((item) => [item.nameKey, item.descriptionKey]),
      ...content.stations().flatMap((station) => [station.nameKey, station.descriptionKey]),
    ];

    const missing = required.filter(
      (key) => !Object.prototype.hasOwnProperty.call(data.messages, key),
    );
    expect(missing).toEqual([]);
  });

  it('answers an unknown locale with the default one, and says so [TECH-12.5]', async () => {
    const data = dataOf(await ask({ locale: 'zz' }));

    expect(data.locale).toBe('zz');
    expect(data.resolvedLocale).toBe(content.defaultLocale);
    expect(Object.keys(data.messages).length).toBeGreaterThan(0);
  });

  it('returns the keys in stable order [TECH-5.3, TECH-12.5]', async () => {
    const keys = Object.keys(dataOf(await ask({})).messages);

    expect(keys).toEqual([...keys].sort());
  });

  it('rejects a malformed locale before any engine code runs [TECH-7.1]', () => {
    expect(validatePayload('content.messages', {})).toBeNull();
    expect(validatePayload('content.messages', { locale: 'en' })).toBeNull();
    expect(validatePayload('content.messages', { locale: 'en-GB' })).toBeNull();
    expect(validatePayload('content.messages', { locale: 'not a locale' })).not.toBeNull();
    expect(validatePayload('content.messages', { locale: 7 })).not.toBeNull();
    expect(validatePayload('content.messages', { extra: true })).not.toBeNull();
  });

  it('needs no open campaign, because content is not campaign state [TECH-6.3]', async () => {
    const data = dataOf(await ask({}));

    expect(Object.keys(data.messages).length).toBeGreaterThan(0);
  });
});
