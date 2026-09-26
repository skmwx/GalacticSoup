import { readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  validateClientRequest,
  type AudioCuesData,
  type NotificationsData,
  type OnboardingData,
} from '@protocol';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import {
  arriveAtScout,
  destroyOpponent,
  lockOpponent,
  startSortie,
} from '../../support/sortie.ts';

/**
 * The guidance, notification and audible-cue contracts of protocol version 13
 * (Technical Specification 7.1, 7.3, 12.4, 17).
 *
 * The JSON Schemas are the contract a second implementation reads, so each
 * published view model is validated against its schema with every part
 * populated, and the new payloads are held to the runtime validator.
 */

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
  addSchema(schema: object): void;
  compile(schema: object): Validator;
};

let validateRequest: Validator;
let validateResponse: Validator;
let validateOnboarding: Validator;
let validateNotifications: Validator;
let validateCues: Validator;

function loadSchema(name: string): object {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'schemas', 'protocol', name), 'utf8')) as object;
}

function expectValid(validate: Validator, value: unknown): void {
  expect(validate(value), JSON.stringify(validate.errors ?? null)).toBe(true);
}

beforeAll(() => {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  ajv.addSchema(loadSchema('engine-error.schema.json'));
  ajv.addSchema(loadSchema('domain-event.schema.json'));
  validateRequest = ajv.compile(loadSchema('client-request.schema.json'));
  validateResponse = ajv.compile(loadSchema('engine-response.schema.json'));
  validateOnboarding = ajv.compile(loadSchema('onboarding.state.data.schema.json'));
  validateNotifications = ajv.compile(loadSchema('notifications.list.data.schema.json'));
  validateCues = ajv.compile(loadSchema('audio.cues.data.schema.json'));
});

const MALFORMED: readonly unknown[] = [
  null, true, '', 0, [], {}, 'guide', 'guide.', 'Guide.loop.undock', 'encounter.borrell.pirate-scout',
  `guide.${'x'.repeat(120)}`,
];

describe('guidance and notification contracts', () => {
  it.each(['onboarding.state', 'onboarding.hide', 'onboarding.show', 'notifications.list', 'audio.cues'])(
    'agrees with the runtime validator on %s with and without stray fields [TECH-7.1, TECH-17]',
    (type) => {
      for (const payload of [{}, { unexpected: 1 }]) {
        const message = { protocolVersion: PROTOCOL_VERSION, requestId: 'r', type, payload };
        expect(validateRequest(message)).toBe(validateClientRequest(message).ok);
      }
    },
  );

  it('agrees with the runtime validator on onboarding.skipStep and its malformed variants [TECH-7.1, TECH-17, FUNC-3.2]', () => {
    const variants: unknown[] = [
      { stepId: 'guide.loop.undock' },
      {},
      { stepId: 'guide.loop.undock', unexpected: 1 },
      ...MALFORMED.map((stepId) => ({ stepId })),
    ];
    for (const payload of variants) {
      const message = { protocolVersion: PROTOCOL_VERSION, requestId: 'r', type: 'onboarding.skipStep', payload };
      expect(validateRequest(message), JSON.stringify(payload)).toBe(validateClientRequest(message).ok);
    }
    expect(validateClientRequest({
      protocolVersion: PROTOCOL_VERSION, requestId: 'r', type: 'onboarding.skipStep',
      payload: { stepId: 'guide.loop.undock' },
    }).ok).toBe(true);
  });

  it('publishes schemas for guidance, history and cues with every part populated [TECH-7.1, TECH-7.3, FUNC-3.2, FUNC-19.7, TECH-12.4]', async () => {
    const sortie = await startSortie();
    const cues = await sortie.ask<AudioCuesData>('audio.cues');
    expect(validateResponse(cues)).toBe(true);
    expectValid(validateCues, (cues as { data: AudioCuesData }).data);

    await sortie.data('onboarding.skipStep', { stepId: 'guide.loop.upgrade' });
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await destroyOpponent(sortie, opponent);
    await sortie.data('onboarding.hide');

    const onboarding = await sortie.ask<OnboardingData>('onboarding.state');
    expect(validateResponse(onboarding)).toBe(true);
    const guidance = (onboarding as { data: OnboardingData }).data;
    expectValid(validateOnboarding, guidance);
    const seen = new Set(guidance.chains.flatMap((chain) => chain.steps.map((step) => step.status)));
    expect([...seen].sort()).toEqual(['completed', 'current', 'open', 'skipped', 'waiting']);

    const history = await sortie.ask<NotificationsData>('notifications.list');
    expect(validateResponse(history)).toBe(true);
    const entries = (history as { data: NotificationsData }).data;
    expectValid(validateNotifications, entries);
    expect(new Set(entries.entries.map((entry) => entry.severity)))
      .toEqual(new Set(['danger', 'opportunity', 'informational']));
  }, 120_000);

  it('rejects a history whose entry omits its level [TECH-7.1]', () => {
    expect(validateNotifications({
      sequence: 1,
      entries: [{
        id: 1, sequence: 1, definitionId: 'notify.x.y', category: 'combat', messageKey: 'k', params: {},
        subjectIds: [], firstAtMs: 0, lastAtMs: 0, count: 1, hideable: true, cueId: null,
      }],
    })).toBe(false);
  });
});
