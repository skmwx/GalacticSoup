import { fixtureRepository } from '../../support/contentFixtures.ts';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import {
  captureSnapshot,
  createCampaign,
  createEngineHost,
  readCampaignState,
  type CampaignState,
} from '@engine';
import {
  CONTENT_ERROR_REASONS,
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  REQUEST_TYPES,
  validateClientRequest,
  type AssetsData,
  type CombatData,
  type DestinationsData,
  type EncounterData,
  type LossReportData,
  type MarketTransactionPreviewData,
  type ShipData,
  type SiteData,
} from '@protocol';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import { shippedContent } from '../../support/content.ts';
import { GOLDEN_CAPTURE } from '../../support/goldenSave.ts';
import {
  arriveAtScout,
  destroyOpponent,
  lockOpponent,
  SORTIE_SEED,
  startSortie,
  type Sortie,
} from '../../support/sortie.ts';

/**
 * The runtime validator is hand-written so the engine carries no library
 * dependency. The published JSON Schemas must describe exactly the same
 * contract, because a future Java engine validates against them
 * (Technical Specification 7.1, 17, 18).
 */

type Validator = (value: unknown) => boolean;

const AjvConstructor = (
  Ajv2020 as unknown as { default?: typeof Ajv2020 }
).default as unknown as typeof Ajv2020;

let validateRequest: Validator;
let validateResponse: Validator;
let validateHealthData: Validator;
let validateCapabilitiesData: Validator;
let validateContentSummaryData: Validator;
let validateContentMessagesData: Validator;
let validateFittingDraftData: Validator;
let validateCommandResultData: Validator;
let validateSessionData: Validator;
let validateFrameData: Validator;
let validateStateHashData: Validator;
let validateSaveStatusData: Validator;
let validateSaveSlotData: Validator;
let validateSaveEnvelope: Validator;
let validateStationServicesData: Validator;
let validateMarketListingsData: Validator;
let validateTransactionPreviewData: Validator;
let validateNavigationSiteData: Validator;
let validateNavigationDestinationsData: Validator;
let validateCombatData: Validator;
let validateEncounterData: Validator;
let validateAssetsData: Validator;
let validateShipData: Validator;
let validateLossReportData: Validator;
let validateCampaignState: Validator;

const content = shippedContent();

/** Asserts a schema accepts a value, naming what it objected to when it does not. */
function expectValid(validate: Validator, value: unknown): void {
  const valid = validate(value);
  expect(valid, JSON.stringify((validate as { errors?: unknown }).errors ?? null)).toBe(true);
}

function loadSchema(name: string): object {
  const file = path.join(REPO_ROOT, 'schemas', 'protocol', name);
  return JSON.parse(readFileSync(file, 'utf8')) as object;
}

beforeAll(() => {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  ajv.addSchema(loadSchema('engine-error.schema.json'));
  ajv.addSchema(loadSchema('domain-event.schema.json'));
  ajv.addSchema(loadSchema('economy.common.schema.json'));
  validateRequest = ajv.compile(loadSchema('client-request.schema.json')) as Validator;
  validateResponse = ajv.compile(loadSchema('engine-response.schema.json')) as Validator;
  validateHealthData = ajv.compile(loadSchema('system.health.data.schema.json')) as Validator;
  validateCapabilitiesData = ajv.compile(
    loadSchema('system.capabilities.data.schema.json'),
  ) as Validator;
  validateContentSummaryData = ajv.compile(
    loadSchema('content.summary.data.schema.json'),
  ) as Validator;
  validateContentMessagesData = ajv.compile(
    loadSchema('content.messages.data.schema.json'),
  ) as Validator;
  ajv.addSchema(loadSchema('assets.common.schema.json'));
  ajv.addSchema(loadSchema('fitting.common.schema.json'));
  validateFittingDraftData = ajv.compile(
    loadSchema('fitting.draft.data.schema.json'),
  ) as Validator;
  validateCommandResultData = ajv.compile(
    loadSchema('command-result.data.schema.json'),
  ) as Validator;
  validateSessionData = ajv.compile(loadSchema('campaign.session.data.schema.json')) as Validator;
  validateFrameData = ajv.compile(loadSchema('campaign.frame.data.schema.json')) as Validator;
  validateStateHashData = ajv.compile(
    loadSchema('diagnostics.stateHash.data.schema.json'),
  ) as Validator;
  ajv.addSchema(loadSchema('save-status.data.schema.json'));
  validateSaveStatusData = ajv.getSchema(
    'https://galacticsoup.invalid/schemas/protocol/save-status.data.schema.json',
  ) as unknown as Validator;
  validateSaveSlotData = ajv.compile(
    loadSchema('campaign.saves.data.schema.json'),
  ) as Validator;
  validateStationServicesData = ajv.compile(
    loadSchema('station.services.data.schema.json'),
  ) as Validator;
  validateMarketListingsData = ajv.compile(
    loadSchema('market.listings.data.schema.json'),
  ) as Validator;
  validateTransactionPreviewData = ajv.compile(
    loadSchema('transaction-preview.data.schema.json'),
  ) as Validator;
  validateNavigationSiteData = ajv.compile(
    loadSchema('navigation.site.data.schema.json'),
  ) as Validator;
  validateNavigationDestinationsData = ajv.compile(
    loadSchema('navigation.destinations.data.schema.json'),
  ) as Validator;
  validateCombatData = ajv.compile(loadSchema('combat.state.data.schema.json')) as Validator;
  validateEncounterData = ajv.compile(
    loadSchema('encounter.state.data.schema.json'),
  ) as Validator;
  validateAssetsData = ajv.compile(loadSchema('assets.list.data.schema.json')) as Validator;
  validateShipData = ajv.compile(loadSchema('ship.get.data.schema.json')) as Validator;
  validateLossReportData = ajv.compile(loadSchema('loss.report.data.schema.json')) as Validator;

  const saves = new AjvConstructor({ allErrors: true, strict: true });
  saves.addSchema(loadSaveSchema('campaign-state.schema.json'));
  validateSaveEnvelope = saves.compile(loadSaveSchema('save-envelope.schema.json')) as Validator;
  validateCampaignState = saves.getSchema(
    'https://galacticsoup.invalid/schemas/save/campaign-state.schema.json',
  ) as unknown as Validator;
});

function loadSaveSchema(name: string): object {
  const file = path.join(REPO_ROOT, 'schemas', 'save', name);
  return JSON.parse(readFileSync(file, 'utf8')) as object;
}

const JSON_FIXTURES: readonly { readonly label: string; readonly message: unknown }[] = [
  {
    label: 'a valid health request',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-1',
      type: 'system.health',
      payload: EMPTY_PAYLOAD,
    },
  },
  {
    label: 'a valid capabilities request with campaign and revision',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-2',
      campaignId: 'campaign-1',
      expectedRevision: 3,
      type: 'system.capabilities',
      payload: {},
    },
  },
  {
    label: 'a foreign protocol version',
    message: { protocolVersion: 99, requestId: 'r', type: 'system.health', payload: {} },
  },
  {
    label: 'an unknown request type',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.summon',
      payload: {},
    },
  },
  {
    label: 'a well-formed campaign.create',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.create',
      payload: {
        displayName: 'Vela',
        seed: '0123456789abcdef0123456789abcdef',
        createdAtRealMs: 1,
      },
    },
  },
  {
    label: 'a campaign.create with a malformed seed',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.create',
      payload: { displayName: 'Vela', seed: 'nope', createdAtRealMs: 1 },
    },
  },
  {
    label: 'a campaign.create with a blank display name',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.create',
      payload: {
        displayName: '  ',
        seed: '0123456789abcdef0123456789abcdef',
        createdAtRealMs: 1,
      },
    },
  },
  {
    label: 'a well-formed time.set',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.set',
      payload: { paused: false, rate: 1 },
    },
  },
  {
    label: 'a time.set with a zero rate',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.set',
      payload: { paused: false, rate: 0 },
    },
  },
  {
    label: 'a well-formed time.advance',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.advance',
      payload: { elapsedRealMs: 16 },
    },
  },
  {
    label: 'a time.advance with a fractional delta',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.advance',
      payload: { elapsedRealMs: 16.5 },
    },
  },
  {
    label: 'a query carrying payload fields',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.session',
      payload: { verbose: true },
    },
  },
  {
    label: 'an empty request id',
    message: { protocolVersion: PROTOCOL_VERSION, requestId: '', type: 'system.health', payload: {} },
  },
  {
    label: 'an unexpected envelope field',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'system.health',
      payload: {},
      extra: true,
    },
  },
  {
    label: 'a payload with fields',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'system.health',
      payload: { verbose: true },
    },
  },
  {
    label: 'a negative expected revision',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'system.health',
      payload: {},
      expectedRevision: -1,
    },
  },
  {
    label: 'a well-formed campaign.save',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.save',
      payload: { kind: 'manual', savedAtRealMs: 1 },
    },
  },
  {
    label: 'a campaign.save with an unknown kind',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.save',
      payload: { kind: 'quicksave', savedAtRealMs: 1 },
    },
  },
  {
    label: 'a campaign.save with a fractional timestamp',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.save',
      payload: { kind: 'auto', savedAtRealMs: 1.5 },
    },
  },
  {
    label: 'a well-formed campaign.close',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.close',
      payload: { savedAtRealMs: 1 },
    },
  },
  {
    label: 'a campaign.close with no timestamp',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.close',
      payload: {},
    },
  },
  {
    label: 'a well-formed campaign.resume',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.resume',
      payload: {},
    },
  },
  {
    label: 'a campaign.resume carrying payload fields',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.resume',
      payload: { force: true },
    },
  },
  {
    label: 'a well-formed campaign.saves',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.saves',
      payload: {},
    },
  },
  {
    label: 'a well-formed content.messages',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'content.messages',
      payload: { locale: 'en' },
    },
  },
  {
    label: 'a content.messages with no locale',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'content.messages',
      payload: {},
    },
  },
  {
    label: 'a content.messages with a malformed locale',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'content.messages',
      payload: { locale: 'not a locale' },
    },
  },
  {
    label: 'a well-formed loss.report',
    message: { protocolVersion: PROTOCOL_VERSION, requestId: 'r', type: 'loss.report', payload: {} },
  },
  {
    label: 'a loss.report carrying payload fields',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'loss.report',
      payload: { lossId: 'c0123456789abcdef01234567-e1' },
    },
  },
  {
    label: 'a well-formed navigation.selectBookmark',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'navigation.selectBookmark',
      payload: { bookmarkId: 'c0123456789abcdef01234567-e12' },
    },
  },
  {
    label: 'a navigation.selectBookmark naming a site instead of a bookmark',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'navigation.selectBookmark',
      payload: { bookmarkId: 'site.borrell.outpost-cradle' },
    },
  },
  {
    label: 'a navigation.selectBookmark with no bookmark',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'navigation.selectBookmark',
      payload: {},
    },
  },
  {
    label: 'a well-formed navigation.warpToBookmark',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'navigation.warpToBookmark',
      payload: { bookmarkId: 'c0123456789abcdef01234567-e12', arrivalDistanceKm: 10 },
    },
  },
  {
    label: 'a navigation.warpToBookmark with a negative arrival distance',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'navigation.warpToBookmark',
      payload: { bookmarkId: 'c0123456789abcdef01234567-e12', arrivalDistanceKm: -1 },
    },
  },
  {
    label: 'a navigation.warpToBookmark carrying a destination site',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'navigation.warpToBookmark',
      payload: {
        bookmarkId: 'c0123456789abcdef01234567-e12',
        arrivalDistanceKm: 10,
        destinationSiteId: 'site.borrell.outpost-cradle',
      },
    },
  },
  { label: 'a message that is not an object', message: 'nonsense' },
];

/**
 * Payloads of the requests protocol version 12 added, each with every
 * malformed variant a field can take (Functional Specification 5.4, 9.12).
 */
const BOOKMARK_ID = 'c0123456789abcdef01234567-e12';
const PHASE_15_PAYLOADS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['loss.report', {}],
  ['navigation.selectBookmark', { bookmarkId: BOOKMARK_ID }],
  ['navigation.warpToBookmark', { bookmarkId: BOOKMARK_ID, arrivalDistanceKm: 10 }],
];
const MALFORMED_VALUES: readonly unknown[] = [
  null, true, '', 'x', 0, -1, 1.5, 1_000_000_001, Number.MAX_SAFE_INTEGER + 1, [], {},
  'c0123456789abcdef01234567-e0', 'C0123456789ABCDEF01234567-E1', `c0123456789abcdef01234567-e${'1'.repeat(110)}`,
  'site.borrell.outpost-cradle',
];

describe('protocol schema parity', () => {
  it.each(JSON_FIXTURES)(
    'agrees with the runtime validator on $label [TECH-7.1]',
    ({ message }) => {
      expect(validateRequest(message)).toBe(validateClientRequest(message).ok);
    },
  );

  it.each(PHASE_15_PAYLOADS)(
    'agrees with the runtime validator on %s and its malformed variants [TECH-7.1, TECH-17, FUNC-9.12]',
    (type, payload) => {
      const variants: Record<string, unknown>[] = [payload, { ...payload, unexpected: 1 }];
      for (const key of Object.keys(payload)) {
        const missing = { ...payload };
        delete missing[key];
        variants.push(missing);
        for (const bad of MALFORMED_VALUES) variants.push({ ...payload, [key]: bad });
      }
      for (const variant of variants) {
        const request = { protocolVersion: PROTOCOL_VERSION, requestId: 'r', type, payload: variant };
        expect(validateRequest(request), JSON.stringify(request)).toBe(validateClientRequest(request).ok);
      }
      const valid = { protocolVersion: PROTOCOL_VERSION, requestId: 'r', type, payload };
      expect(validateRequest(valid)).toBe(true);
      expect(validateClientRequest(valid).ok).toBe(true);
    },
  );

  it('validates every engine response against the response schema [TECH-7.1]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });

    const health = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-health',
      type: 'system.health',
      payload: EMPTY_PAYLOAD,
    });
    const capabilities = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-capabilities',
      type: 'system.capabilities',
      payload: EMPTY_PAYLOAD,
    });

    const summary = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-content',
      type: 'content.summary',
      payload: EMPTY_PAYLOAD,
    });

    expect(validateResponse(health)).toBe(true);
    expect(validateResponse(capabilities)).toBe(true);
    expect(validateResponse(summary)).toBe(true);
    expect(health.ok && validateHealthData(health.data)).toBe(true);
    expect(capabilities.ok && validateCapabilitiesData(capabilities.data)).toBe(true);
    expect(summary.ok && validateContentSummaryData(summary.data)).toBe(true);
  });

  it('validates the authored message catalogue against its schema [TECH-7.1, TECH-12.5]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });

    const messages = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-messages',
      type: 'content.messages',
      payload: {},
    });

    expect(validateResponse(messages)).toBe(true);
    expect(messages.ok && validateContentMessagesData(messages.data)).toBe(true);
  });

  it('publishes a compilable schema for every protocol contract [TECH-7.1, TECH-17]', () => {
    const ajv = new AjvConstructor({ allErrors: true, strict: true });
    const directory = path.join(REPO_ROOT, 'schemas', 'protocol');
    const files = readdirSync(directory).filter((file) => file.endsWith('.schema.json'));

    expect(files.length).toBeGreaterThan(0);

    const ids = files.map((file) => {
      const schema = loadSchema(file) as { $id?: string };
      ajv.addSchema(schema);
      expect(schema.$id, file).toBeTypeOf('string');
      return schema.$id as string;
    });

    // getSchema compiles the schema and its references, so an unresolvable
    // reference or an illegal keyword fails here rather than in production.
    for (const id of ids) {
      expect(ajv.getSchema(id), id).toBeTypeOf('function');
    }
  });

  it('lists the same request types as the runtime catalogue [TECH-7.1, TECH-17]', () => {
    const schema = loadSchema('client-request.schema.json') as {
      properties: { type: { enum: string[] } };
    };

    expect(schema.properties.type.enum).toEqual([...REQUEST_TYPES]);
  });

  it('lists the same content error reasons as the runtime catalogue [TECH-5.4, TECH-6.2]', () => {
    const schema = loadSchema('content-issue.schema.json') as {
      properties: { reason: { enum: string[] } };
    };

    expect(schema.properties.reason.enum).toEqual([...CONTENT_ERROR_REASONS]);
  });

  it('validates a failure response against the response schema [TECH-5.4, TECH-7.1]', async () => {
    const failure = await createEngineHost({ content, saves: createMemorySaveStore() }).handle({ nonsense: true });

    expect(failure.ok).toBe(false);
    expect(validateResponse(failure)).toBe(true);
  });
});

describe('campaign protocol schema parity', () => {
  const seed = 'aa11bb22cc33dd44ee55ff6677889900';

  async function ask(
    host: ReturnType<typeof createEngineHost>,
    type: string,
    payload: unknown,
    requestId: string,
  ): Promise<unknown> {
    return host.handle({ protocolVersion: PROTOCOL_VERSION, requestId, type, payload });
  }

  it('publishes a schema for every campaign response shape [TECH-7.1, TECH-17]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });

    const created = await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create',
    );
    const running = await ask(host, 'time.set', { paused: false, rate: 1 }, 'req-run');
    const advanced = await ask(host, 'time.advance', { elapsedRealMs: 120 }, 'req-advance');
    const session = await ask(host, 'campaign.session', EMPTY_PAYLOAD, 'req-session');
    const frame = await ask(host, 'campaign.frame', EMPTY_PAYLOAD, 'req-frame');
    const hash = await ask(host, 'diagnostics.stateHash', EMPTY_PAYLOAD, 'req-hash');

    for (const response of [created, running, advanced, session, frame, hash]) {
      expect(validateResponse(response)).toBe(true);
    }

    const dataOf = (response: unknown): unknown => (response as { data: unknown }).data;

    expect(validateCommandResultData(dataOf(created))).toBe(true);
    expect(validateCommandResultData(dataOf(running))).toBe(true);
    expect(validateCommandResultData(dataOf(advanced))).toBe(true);
    expect(validateSessionData(dataOf(session))).toBe(true);
    expect(validateFrameData(dataOf(frame))).toBe(true);
    expect(validateStateHashData(dataOf(hash))).toBe(true);
  });

  it('publishes schemas for station economy projections and previews [TECH-7.1, TECH-7.4]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });
    await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create-economy',
    );
    const stationId = content.rules.economy.startingStationId;
    const services = await ask(host, 'station.services', { stationId }, 'req-services');
    const listings = await ask(host, 'market.listings', { stationId }, 'req-listings');
    const preview = await ask(host, 'market.previewBuy', {
      stationId,
      itemId: 'ammo.projectile.small.fusion',
      quantity: 2,
    }, 'req-market-preview');

    const dataOf = (response: unknown): unknown => (response as { data: unknown }).data;
    expect(validateStationServicesData(dataOf(services))).toBe(true);
    expect(validateMarketListingsData(dataOf(listings))).toBe(true);
    expect(validateTransactionPreviewData(dataOf(preview))).toBe(true);
  });

  it('publishes a schema for the fitting draft and its slot candidates [TECH-7.1, TECH-17]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });
    await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create-fitting',
    );
    const assets = (await ask(host, 'assets.list', EMPTY_PAYLOAD, 'req-assets')) as {
      data: { activeShipId: string };
    };
    await ask(host, 'fitting.begin', { shipId: assets.data.activeShipId }, 'req-begin');
    const draft = await ask(host, 'fitting.draft', EMPTY_PAYLOAD, 'req-draft');

    const data = (draft as { data: { draft: { options: unknown[] } } }).data;
    expect(data.draft.options.length).toBeGreaterThan(0);
    expect(validateResponse(draft)).toBe(true);
    expect(validateFittingDraftData(data)).toBe(true);
  });

  it('publishes schemas for destination and loaded-site navigation projections [TECH-7.1, TECH-10.1, FUNC-5.2, FUNC-7.1]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });
    await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create-navigation',
    );
    const destinations = await ask(host, 'navigation.destinations', EMPTY_PAYLOAD, 'req-destinations');
    const dockedSite = await ask(host, 'navigation.site', EMPTY_PAYLOAD, 'req-docked-site');
    const undock = await ask(host, 'ship.undock', EMPTY_PAYLOAD, 'req-undock');
    const loadedSite = await ask(host, 'navigation.site', EMPTY_PAYLOAD, 'req-loaded-site');
    const dataOf = (response: unknown): unknown => (response as { data: unknown }).data;

    for (const response of [destinations, dockedSite, undock, loadedSite]) {
      expect(validateResponse(response)).toBe(true);
    }
    expect(validateNavigationDestinationsData(dataOf(destinations))).toBe(true);
    expect(validateNavigationSiteData(dataOf(dockedSite))).toBe(true);
    expect(validateNavigationSiteData(dataOf(loadedSite))).toBe(true);
  });

  it('publishes a schema for the tactical combat projection [TECH-7.1, TECH-10.3, FUNC-19.3]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });
    await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create-combat',
    );
    const docked = await ask(host, 'combat.state', EMPTY_PAYLOAD, 'req-combat-docked');
    await ask(host, 'ship.undock', EMPTY_PAYLOAD, 'req-undock-combat');
    const flying = await ask(host, 'combat.state', EMPTY_PAYLOAD, 'req-combat-flying');
    const dataOf = (response: unknown): unknown => (response as { data: unknown }).data;

    for (const response of [docked, flying]) {
      expect(validateResponse(response)).toBe(true);
    }
    expect(validateCombatData(dataOf(docked))).toBe(true);
    expect(validateCombatData(dataOf(flying))).toBe(true);
  });

  it('publishes schemas for the encounter and wreck projections [TECH-7.1, TECH-10.6, FUNC-9.11]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });
    await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create-encounter',
    );
    const dataOf = (response: unknown): unknown => (response as { data: unknown }).data;
    const docked = await ask(host, 'encounter.state', EMPTY_PAYLOAD, 'req-encounter-docked');
    expect(validateResponse(docked)).toBe(true);
    expect(validateEncounterData(dataOf(docked))).toBe(true);

    // In a site, with a running instance and a wreck to read.
    await ask(host, 'ship.undock', EMPTY_PAYLOAD, 'req-undock-encounter');
    const site = content.requireEncounter('encounter.borrell.pirate-scout' as never).siteId;
    await ask(host, 'navigation.warp', { destinationSiteId: site, arrivalDistanceKm: 0 }, 'req-warp-encounter');
    await ask(host, 'time.set', { paused: false, rate: 1 }, 'req-time-encounter');
    for (let step = 0; step < 400; step += 1) {
      await ask(host, 'time.advance', { elapsedRealMs: 250 }, `req-advance-${String(step)}`);
      const current = await ask(host, 'encounter.state', EMPTY_PAYLOAD, `req-encounter-${String(step)}`);
      if ((dataOf(current) as { instance: unknown }).instance !== null) {
        expect(validateResponse(current)).toBe(true);
        expect(validateEncounterData(dataOf(current))).toBe(true);
        break;
      }
    }
  }, 30_000);

  it('holds the tactical projections to their schemas through a whole fight [TECH-7.1, TECH-10.3, FUNC-19.3, MVP-AC-04]', async () => {
    const sortie = await startSortie();
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await sortie.data('weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponent });
    await sortie.data('module.activate', { slotKind: 'system', slotIndex: 0 });
    await sortie.until(async () => false, 10);

    // Every optional part of the contract is populated mid-fight.
    const fighting = await sortie.data<CombatData>('combat.state');
    expect(fighting.locks.length).toBeGreaterThan(0);
    expect(fighting.weapons[0]?.effects.length).toBeGreaterThan(0);
    expect(fighting.weapons[0]?.ammunitionOptions.length).toBeGreaterThan(0);
    expect(fighting.hostileLocks.length).toBeGreaterThan(0);
    expect(fighting.defenses?.activeEffects.length).toBeGreaterThan(0);
    expect(fighting.events.length).toBeGreaterThan(0);
    expect(validateCombatData(fighting)).toBe(true);
    expect(validateNavigationSiteData(await sortie.data('navigation.site'))).toBe(true);
    expect(validateEncounterData(await sortie.data('encounter.state'))).toBe(true);

    await destroyOpponent(sortie, opponent);
    const cleared = await sortie.data<EncounterData>('encounter.state');
    expect(cleared.wrecks.length).toBeGreaterThan(0);
    expect(validateEncounterData(cleared)).toBe(true);
    expect(validateCombatData(await sortie.data('combat.state'))).toBe(true);
    expect(validateNavigationDestinationsData(await sortie.data('navigation.destinations'))).toBe(true);
  }, 60_000);

  it('publishes a schema for every save response shape [TECH-7.1, TECH-11.3]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });

    await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create',
    );
    const saved = await ask(
      host,
      'campaign.save',
      { kind: 'manual', savedAtRealMs: 1_700_000_001_000 },
      'req-save',
    );
    const slot = await ask(host, 'campaign.saves', EMPTY_PAYLOAD, 'req-slot');
    const closed = await ask(
      host,
      'campaign.close',
      { savedAtRealMs: 1_700_000_002_000 },
      'req-close',
    );
    const resumed = await ask(host, 'campaign.resume', EMPTY_PAYLOAD, 'req-resume');

    const dataOf = (response: unknown): unknown => (response as { data: unknown }).data;

    for (const response of [saved, slot, closed, resumed]) {
      expect(validateResponse(response)).toBe(true);
    }
    expect(validateSaveStatusData(dataOf(saved))).toBe(true);
    expect(validateSaveSlotData(dataOf(slot))).toBe(true);
    expect(validateCommandResultData(dataOf(closed))).toBe(true);
    expect(validateCommandResultData(dataOf(resumed))).toBe(true);
  });

  it('validates a captured save against the published save schema [TECH-11.2, TECH-17]', () => {
    const campaign = { ...createCampaign(GOLDEN_CAPTURE.campaign, fixtureRepository()), revision: 1 };
    const envelope = captureSnapshot({ ...GOLDEN_CAPTURE.envelope, campaign });

    expect(validateSaveEnvelope(envelope)).toBe(true);
    expect(validateSaveEnvelope({ ...envelope, kind: 'quicksave' })).toBe(false);
    expect(validateSaveEnvelope({ ...envelope, formatVersion: 99 })).toBe(false);
  });

  it('validates the golden save against the published save schema [TECH-11.2, TECH-17]', () => {
    const file = path.join(REPO_ROOT, 'tests', 'fixtures', 'saves', 'format-10.json');

    expect(validateSaveEnvelope(JSON.parse(readFileSync(file, 'utf8')))).toBe(true);
  });

  it('validates the no-campaign projections against their schemas [TECH-7.1, TECH-7.3]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });

    const session = await ask(host, 'campaign.session', EMPTY_PAYLOAD, 'req-session');
    const frame = await ask(host, 'campaign.frame', EMPTY_PAYLOAD, 'req-frame');
    const hash = await ask(host, 'diagnostics.stateHash', EMPTY_PAYLOAD, 'req-hash');

    expect(validateSessionData((session as { data: unknown }).data)).toBe(true);
    expect(validateFrameData((frame as { data: unknown }).data)).toBe(true);
    expect(validateStateHashData((hash as { data: unknown }).data)).toBe(true);
  });
});

/**
 * The destruction, loss-report and recovery contracts
 * (Functional Specification 5.4, 9.12; Technical Specification 7.1, 11.2).
 *
 * A real destruction, not a hand-built one, populates them: an idle ship left
 * at the Pirate Base is destroyed in under two simulated minutes and its pilot
 * is recovered docked at the station. With the sortie seed and the starting
 * wallet the settlement leaves enough credits for a starter hull, so the pilot
 * is left shipless; spending most of the wallet first leaves too little, so
 * the recovery service grants a ship instead.
 */
describe('loss and recovery schema parity', () => {
  const LOSS_SITE = 'site.borrell.outpost-cradle';
  const SAVED_AT_REAL_MS = 1_700_000_200_000;

  interface Lost {
    readonly sortie: Sortie;
    readonly store: MemorySaveStore;
    /** The envelope the client-stamped autosave after the loss wrote. */
    readonly envelope: Record<string, unknown>;
  }

  /** Waits for the next snapshot the store writes and returns it. */
  async function nextSave(store: MemorySaveStore, previous: readonly string[]): Promise<Record<string, unknown>> {
    let saveId: string | undefined;
    for (let attempt = 0; attempt < 100 && saveId === undefined; attempt += 1) {
      saveId = store.saveIds().find((id) => !previous.includes(id));
      if (saveId === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const envelope = saveId === undefined ? null : await store.readSave('slot-1', saveId);
    if (envelope === null) throw new Error('The snapshot was never written.');
    return envelope as Record<string, unknown>;
  }

  /** Flies the active ship into the Pirate Base and waits for the pilot to be recovered docked. */
  async function loseShip(sortie: Sortie, onArrival?: () => Promise<void>, arrivalDistanceKm = 10): Promise<void> {
    await sortie.data('ship.undock');
    await sortie.data('navigation.warp', { destinationSiteId: LOSS_SITE, arrivalDistanceKm });
    await sortie.data('time.set', { paused: false, rate: 1 });
    if (onArrival !== undefined) {
      const arrived = await sortie.until(async () => {
        const site = await sortie.data<SiteData>('navigation.site');
        return site.location.kind === 'site' && site.location.siteId === LOSS_SITE;
      }, 120);
      if (!arrived) throw new Error('The ship never arrived at the Pirate Base.');
      await onArrival();
    }
    const recovered = await sortie.until(
      async () => (await sortie.data<SiteData>('navigation.site')).location.kind === 'station',
      600,
    );
    if (!recovered) throw new Error('The pilot was never recovered to the station.');
    await sortie.data('time.set', { paused: true, rate: 1 });
  }

  /**
   * Loses the only ship with enough credits left to buy the starter ship back,
   * then stamps the autosave. Selling the autocannon first is what lifts the
   * pilot above the starter ship's reference value; its rounds ride in the hold
   * so the report has a cargo stack to lose or keep.
   */
  async function loseOnlyShip(): Promise<Lost> {
    const store = createMemorySaveStore();
    const sortie = await startSortie(SORTIE_SEED, 'Vela', store);
    const stationId = content.rules.economy.startingStationId;
    const shipId = (await sortie.data<AssetsData>('assets.list')).activeShipId;
    await sortie.data('fitting.begin', { shipId });
    await sortie.data('fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
    await sortie.data('fitting.commit');
    const assets = await sortie.data<AssetsData>('assets.list');
    const hangar = assets.inventories.find((inventory) =>
      inventory.location.kind === 'hangar' && inventory.location.stationId === stationId);
    const cargoId = assets.ships.find((ship) => ship.id === shipId)?.cargoInventoryId ?? '';
    for (const stack of hangar?.stacks ?? []) {
      if (stack.item.definitionId === 'module.turret.autocannon.small') {
        const sale = await sortie.data<{ token: unknown }>('market.previewSell', { stationId, stackId: stack.id, quantity: 1 });
        await sortie.data('market.confirmSell', { token: sale.token });
      } else if (stack.item.kind === 'ammunition') {
        await sortie.data('inventory.transfer', { stackId: stack.id, destinationInventoryId: cargoId, quantity: stack.quantity });
      }
    }
    // A shield booster left running until the capacitor gives out is what
    // puts a disabling effect in the report; arriving 30 km out gives it the
    // time to run dry before the brawlers close.
    await loseShip(sortie, async () => {
      await sortie.data('module.activate', { slotKind: 'system', slotIndex: 0 });
    }, 30);
    const previous = store.saveIds();
    await sortie.data('campaign.save', { kind: 'auto', savedAtRealMs: SAVED_AT_REAL_MS });
    return { sortie, store, envelope: await nextSave(store, previous) };
  }

  // One destruction shared by the checks below, made on first use so each
  // check still runs on its own.
  let shipless: Promise<Lost> | undefined;
  const lostOnlyShip = (): Promise<Lost> => (shipless ??= loseOnlyShip());

  it('publishes a schema for the loss report before any loss [TECH-7.1, FUNC-9.12]', async () => {
    const host = createEngineHost({ content, saves: createMemorySaveStore() });
    await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-create-loss',
      type: 'campaign.create',
      payload: { displayName: 'Vela', seed: SORTIE_SEED, createdAtRealMs: 1_700_000_000_000 },
    });
    const response = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-loss-report',
      type: 'loss.report',
      payload: EMPTY_PAYLOAD,
    });

    expect(validateResponse(response)).toBe(true);
    const report = (response as { data: LossReportData }).data;
    expect(report.losses).toBe(0);
    expect(report.report).toBeNull();
    expectValid(validateLossReportData, report);
  });

  it('publishes a schema for a loss report with every part populated [TECH-7.1, TECH-10.3, FUNC-9.12, FUNC-19.6, MVP-AC-08]', async () => {
    const { sortie } = await lostOnlyShip();
    const response = await sortie.ask<LossReportData>('loss.report');
    expect(validateResponse(response)).toBe(true);
    if (!response.ok) throw new Error(response.error.messageKey);

    const loss = response.data.report;
    expect(response.data.losses).toBe(1);
    expect(loss?.encounterId).not.toBeNull();
    expect(loss?.encounterNameKey).not.toBeNull();
    expect(loss?.incoming.length).toBeGreaterThan(0);
    expect(loss?.finalDamage).not.toBeNull();
    expect(loss?.disablingEffects.length).toBeGreaterThan(0);
    expect(loss?.items.some((item) => item.survived)).toBe(true);
    expect(loss?.items.some((item) => !item.survived)).toBe(true);
    expect(loss?.wreck.present).toBe(true);
    expect(loss?.recovery.outcome).toBe('noShip');
    expect(loss?.recovery.activeShipId).toBeNull();
    expectValid(validateLossReportData, response.data);
  }, 60_000);

  it('publishes schemas for a shipless pilot at the station [TECH-7.1, FUNC-9.12, FUNC-22.1]', async () => {
    const { sortie } = await lostOnlyShip();

    const assets = await sortie.data<AssetsData>('assets.list');
    expect(assets.activeShipId).toBeNull();
    expect(assets.ships).toEqual([]);
    expect(assets.lastDockedStationId).toBe(content.rules.economy.startingStationId);
    expectValid(validateAssetsData, assets);

    // The views the station still reads for a pilot who owns no ship.
    const encounter = await sortie.data<EncounterData>('encounter.state');
    expect(encounter.lastOutcome?.status).toBe('lost');
    expectValid(validateEncounterData, encounter);
    const combat = await sortie.data<CombatData>('combat.state');
    expect(combat.events.some((event) => event.kind === 'damage')).toBe(true);
    expectValid(validateCombatData, combat);
    expectValid(validateNavigationSiteData, await sortie.data('navigation.site'));
    expectValid(validateFrameData, await sortie.data('campaign.frame'));
    expectValid(validateSessionData, await sortie.data('campaign.session'));
  }, 60_000);

  it('publishes a schema for the player-wreck bookmark among the destinations [TECH-7.1, FUNC-5.4, FUNC-9.12]', async () => {
    const { sortie } = await lostOnlyShip();
    const lost = (await sortie.data<LossReportData>('loss.report')).report;

    const destinations = await sortie.data<DestinationsData>('navigation.destinations');
    const bookmark = destinations.bookmarks[0];
    expect(bookmark?.kind).toBe('playerWreck');
    expect(bookmark?.bookmarkId).toBe(lost?.wreck.wreckId);
    expect(bookmark?.encounterId).not.toBeNull();
    expect(bookmark?.itemCount).toBeGreaterThan(0);
    expectValid(validateNavigationDestinationsData, destinations);

    const selected = await sortie.ask('navigation.selectBookmark', { bookmarkId: bookmark?.bookmarkId });
    expect(validateResponse(selected)).toBe(true);
    expectValid(validateCommandResultData, (selected as { data: unknown }).data);

    const chosen = await sortie.data<DestinationsData>('navigation.destinations');
    expect(chosen.selectedBookmarkId).toBe(bookmark?.bookmarkId);
    expect(chosen.bookmarks[0]?.selected).toBe(true);
    expectValid(validateNavigationDestinationsData, chosen);
    const report = await sortie.data<LossReportData>('loss.report');
    expect(report.report?.wreck.selected).toBe(true);
    expectValid(validateLossReportData, report);
  }, 60_000);

  it('validates the saved post-loss campaign against the published save schemas [TECH-11.2, TECH-17, FUNC-9.12]', async () => {
    const { envelope } = await lostOnlyShip();
    const state = envelope['state'] as CampaignState;

    expect(state.recovery.losses).toBe(1);
    expect(state.recovery.lastLoss?.recovery.outcome).toBe('noShip');
    expect(state.assets.activeShipId).toBeNull();
    expect(Object.values(state.encounter.wrecks).some((wreck) => wreck.owner === 'player')).toBe(true);
    expect(state.encounter.lastOutcome?.status).toBe('lost');
    expect(state.combat.events.some((event) => event.kind === 'damage')).toBe(true);
    expectValid(validateSaveEnvelope, envelope);
    expectValid(validateCampaignState, state);
    expect(readCampaignState(state).ok).toBe(true);
  }, 60_000);

  it('agrees with the runtime reader on malformed loss and recovery state [TECH-11.2, TECH-11.4, TECH-15.3, FUNC-9.12]', async () => {
    const { envelope } = await lostOnlyShip();
    // The cases write values the state type forbids, so they reshape a plain
    // copy of the saved payload rather than assigning through the type.
    type Loss = NonNullable<CampaignState['recovery']['lastLoss']>;
    const lossOf = (draft: CampaignState): Loss => {
      if (draft.recovery.lastLoss === null) throw new Error('The saved state recorded no loss.');
      return draft.recovery.lastLoss;
    };
    const cases: readonly (readonly [string, boolean, (draft: CampaignState) => void])[] = [
      ['unchanged', true, () => undefined],
      ['a loss record cleared', true, (d) => { Object.assign(d.recovery, { lastLoss: null }); }],
      ['a loss outside any encounter', true, (d) => { Object.assign(lossOf(d), { encounterId: null }); }],
      ['no final burst', true, (d) => { Object.assign(lossOf(d), { finalDamage: null }); }],
      ['a zero recovery version', false, (d) => { Object.assign(d.recovery, { version: 0 }); }],
      ['an unknown recovery field', false, (d) => { Object.assign(d.recovery, { extra: 1 }); }],
      ['an unknown loss field', false, (d) => { Object.assign(lossOf(d), { extra: 1 }); }],
      ['surviving loaded ammunition', false, (d) => {
        Object.assign(lossOf(d).items[0]!, { origin: 'loaded', survived: true });
      }],
      ['a zero-quantity item', false, (d) => { Object.assign(lossOf(d).items[0]!, { quantity: 0 }); }],
      ['unconsumed enhanced cover', false, (d) => { Object.assign(lossOf(d).insurance, { coverage: 'enhanced' }); }],
      ['consumed basic cover', false, (d) => { Object.assign(lossOf(d).insurance, { enhancedConsumed: true }); }],
      ['a paying recovery-grant hull', false, (d) => {
        Object.assign(lossOf(d).insurance, { recoveryGrantHull: true });
      }],
      ['a payout fraction above one', false, (d) => { Object.assign(lossOf(d).insurance, { payoutFraction: 1.5 }); }],
      ['a granted ship that is not there', false, (d) => { Object.assign(lossOf(d).recovery, { outcome: 'granted' }); }],
      ['a shipless outcome naming a ship', false, (d) => {
        Object.assign(lossOf(d).recovery, { activeShipId: lossOf(d).shipId });
      }],
      ['an out-of-range final slot', false, (d) => { Object.assign(lossOf(d).finalDamage!, { slotKey: 'weapon:16' }); }],
      ['an out-of-range disabled slot', false, (d) => {
        Object.assign(lossOf(d).disablingEffects[0]!.slot, { index: 16 });
      }],
      ['an unknown disabling kind', false, (d) => { Object.assign(lossOf(d).disablingEffects[0]!, { kind: 'jammed' }); }],
      ['an attacker with no name', false, (d) => { Object.assign(lossOf(d).incoming[0]!, { nameKey: '' }); }],
      ['an attacker without hull damage', false, (d) => {
        Reflect.deleteProperty(lossOf(d).incoming[0]!.layerDamage, 'hull');
      }],
      ['a negative layer damage', false, (d) => { Object.assign(lossOf(d).incoming[0]!.layerDamage, { armor: -1 }); }],
      ['a hull in the wrong namespace', false, (d) => {
        Object.assign(lossOf(d), { hullId: 'module.turret.autocannon.small' });
      }],
      ['an unknown wreck owner', false, (d) => {
        Object.assign(Object.values(d.encounter.wrecks)[0]!, { owner: 'station' });
      }],
      ['an unknown sortie outcome', false, (d) => { Object.assign(d.encounter.lastOutcome!, { status: 'destroyed' }); }],
      ['a malformed recovery station', false, (d) => {
        Object.assign(d.assets, { lastDockedStationId: 'site.borrell.station' });
      }],
      ['an unmarked stack', false, (d) => {
        Reflect.deleteProperty(Object.values(d.assets.stacks)[0]!, 'recoveryGrant');
      }],
      ['a malformed bookmark selection', false, (d) => {
        Object.assign(d.navigation, { selectedBookmarkId: 'site.borrell.outpost-cradle' });
      }],
      ['damage history without layers', false, (d) => {
        const damage = d.combat.events.find((event) => event.kind === 'damage');
        if (damage !== undefined) Reflect.deleteProperty(damage, 'layerDamage');
      }],
    ];

    for (const [label, valid, mutate] of cases) {
      const draft = structuredClone(envelope['state']) as CampaignState;
      mutate(draft);
      expect(validateCampaignState(draft), label).toBe(valid);
      expect(readCampaignState(draft).ok, label).toBe(valid);
    }
  }, 60_000);

  it('publishes schemas for a recovery-grant ship and a warp to the player\'s own wreck [TECH-7.1, TECH-11.2, FUNC-5.4, FUNC-7.3, FUNC-9.12]', async () => {
    const store = createMemorySaveStore();
    const sortie = await startSortie(SORTIE_SEED, 'Vela', store);
    // Spending most of the wallet first leaves the settlement short of a
    // starter hull, so the recovery service grants one.
    const preview = await sortie.data<MarketTransactionPreviewData>('market.previewBuy', {
      stationId: content.rules.economy.startingStationId,
      itemId: 'module.turret.autocannon.small',
      quantity: 1,
    });
    await sortie.data('market.confirmBuy', { token: preview.token });
    await loseShip(sortie);

    const report = await sortie.data<LossReportData>('loss.report');
    expect(report.report?.recovery.outcome).toBe('granted');
    expectValid(validateLossReportData, report);

    const assets = await sortie.data<AssetsData>('assets.list');
    const granted = assets.ships.find((ship) => ship.active);
    expect(granted?.id).toBe(assets.activeShipId);
    expect(granted?.recoveryGrant).toBe(true);
    const stacks = assets.inventories.flatMap((inventory) => inventory.stacks);
    expect(stacks.some((stack) => stack.recoveryGrant)).toBe(true);
    expect(stacks.some((stack) => !stack.recoveryGrant)).toBe(true);
    expectValid(validateAssetsData, assets);

    const ship = await sortie.data<ShipData>('ship.get', { shipId: assets.activeShipId });
    expect(ship.recoveryGrant).toBe(true);
    expect(ship.insuranceCoverage).toBe('basic');
    expectValid(validateShipData, ship);

    // The granted ship flies back to the wreck through the station choice.
    const bookmarkId = (await sortie.data<DestinationsData>('navigation.destinations')).bookmarks[0]?.bookmarkId;
    await sortie.data('navigation.selectBookmark', { bookmarkId });
    await sortie.data('ship.undock');
    const warp = await sortie.ask('navigation.warpToBookmark', { bookmarkId, arrivalDistanceKm: 10 });
    expect(validateResponse(warp)).toBe(true);
    expectValid(validateCommandResultData, (warp as { data: unknown }).data);

    const site = await sortie.data<SiteData>('navigation.site');
    expect(site.travelStatus?.kind).toBe('warp');
    expect(site.travelStatus?.kind === 'warp' && site.travelStatus.bookmarkId).toBe(bookmarkId);
    expectValid(validateNavigationSiteData, site);
    expectValid(validateNavigationDestinationsData, await sortie.data('navigation.destinations'));

    const previous = store.saveIds();
    await sortie.data('campaign.save', { kind: 'manual', savedAtRealMs: SAVED_AT_REAL_MS });
    const envelope = await nextSave(store, previous);
    const state = envelope['state'] as CampaignState;
    expect(state.navigation.travel?.kind === 'warp' && state.navigation.travel.bookmarkId).toBe(bookmarkId);
    expect(Object.values(state.assets.ships).some((entry) => entry.recoveryGrant)).toBe(true);
    expectValid(validateSaveEnvelope, envelope);
    expectValid(validateCampaignState, state);
  }, 60_000);
});
