import { describe, expect, it } from 'vitest';

import { GATEWAY_MESSAGE_KEYS } from '@gateway';
import { PROTOCOL_MESSAGE_KEYS } from '@protocol';
import { createLocalizer, formatMessage } from '@shared';
import { catalogFor, CATALOGS, DEFAULT_LOCALE } from '@ui';

/**
 * Rules and contracts carry message keys; only the catalogue carries text
 * (Technical Specification 12.5). Every key the engine or gateway can produce
 * must therefore exist in the shipped catalogue.
 */
const catalog = catalogFor(DEFAULT_LOCALE);

describe('message catalogue', () => {
  it.each(PROTOCOL_MESSAGE_KEYS)('covers the protocol key %s [TECH-5.4, TECH-12.5]', (key) => {
    expect(Object.prototype.hasOwnProperty.call(catalog, key)).toBe(true);
  });

  it.each(GATEWAY_MESSAGE_KEYS)('covers the gateway key %s [TECH-12.5]', (key) => {
    expect(Object.prototype.hasOwnProperty.call(catalog, key)).toBe(true);
  });

  it('covers the shell and compatibility surfaces [TECH-12.1, TECH-12.5]', () => {
    const required = [
      'app.title',
      'app.tagline',
      'shell.engine.sectionLabel',
      'shell.engine.connecting',
      'shell.engine.ready',
      'shell.engine.transport',
      'shell.engine.version',
      'shell.engine.protocolVersion',
      'shell.engine.requestTypes',
      'shell.engine.requestTypeCount',
      'shell.transport.worker',
      'shell.transport.port',
      'shell.transport.direct',
      'shell.note.noCampaign',
      'compatibility.heading',
      'compatibility.detail',
      'compatibility.advice',
    ];

    const missing = required.filter((key) => !createLocalizer({ locale: 'en', catalog }).has(key));
    expect(missing).toEqual([]);
  });

  it('has no empty or whitespace-only message [TECH-12.5]', () => {
    const empty = Object.entries(catalog)
      .filter(([, template]) => template.trim().length === 0)
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it('uses only well-formed placeholders [TECH-12.5]', () => {
    const malformed = Object.entries(catalog)
      .filter(([, template]) => {
        const rendered = formatMessage(template, {}).text;
        const braces = rendered.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '');
        return braces.includes('{') || braces.includes('}');
      })
      .map(([key]) => key);

    expect(malformed).toEqual([]);
  });

  it('ships exactly the locales it declares [TECH-12.5]', () => {
    expect(Object.keys(CATALOGS)).toEqual([DEFAULT_LOCALE]);
  });
});
