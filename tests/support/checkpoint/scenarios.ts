import { createMemorySaveStore, planWrite } from '@adapters/persistence';
import {
  createEngineHost,
  DEFAULT_SAVE_RETENTION,
  DEFAULT_SLOT_ID,
  isSealed,
  SAVE_FORMAT_VERSION,
  type ContentRepository,
  type EngineHost,
  type SaveEnvelope,
  type SlotManifest,
} from '@engine';
import {
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  type CombatData,
  type EncounterData,
  type EngineResponse,
  type FrameData,
  type SiteData,
  type StateHashData,
} from '@protocol';

/**
 * Saved campaign checkpoints for browser tests (Test Suite Optimization Plan
 * phase 3; Technical Specification 11.2, 11.4, 15.1).
 *
 * A browser case that is about one moment of play - a command in a fight, an
 * audit of the combat surfaces - should not spend minutes of real time
 * flying there. A checkpoint reaches that moment headlessly, over the same
 * engine host and protocol requests the worker serves, the way the scenario
 * sessions and the golden campaign do, and keeps the save the engine wrote
 * when it closed the campaign. The browser test then seeds that save into a
 * fresh origin's IndexedDB and opens it through the real campaign interface
 * and worker.
 *
 * Nothing here depends on Playwright or on how the content arrives: the
 * caller passes the content repository. In the browser tests that is the
 * content compiled into the served build (`servedContent.ts`), so the save
 * names exactly the content the worker will load it with.
 *
 * Every checkpoint is deterministic: a fixed campaign seed, fixed wall-clock
 * stamps and whole quarter-second steps. The same content therefore always
 * produces the same envelope, byte for byte.
 */

/** The sixteen bytes every checkpoint campaign is created from. */
export const CHECKPOINT_SEED = 'bb22cc33dd44ee55ff6677889900aa11';
export const CHECKPOINT_PILOT = 'Checkpoint Pilot';
const CREATED_AT_REAL_MS = 1_700_000_000_000;
const CLOSED_AT_REAL_MS = 1_700_000_100_000;

const SCOUT_ENCOUNTER = 'encounter.borrell.pirate-scout';
const SCOUT_SITE = 'site.borrell.verge';
const STEP_MS = 250;

export const CHECKPOINT_NAMES = ['scout-in-range', 'scout-fight'] as const;
export type CheckpointName = (typeof CHECKPOINT_NAMES)[number];

export const CHECKPOINT_DESCRIPTIONS: Readonly<Record<CheckpointName, string>> = {
  'scout-in-range':
    'Paused at the Pirate Scout site with the starter ship orbiting the scout inside lock and weapon range; nothing locked, no weapon running.',
  'scout-fight':
    'Paused in a fight with the Pirate Scout: the scout locked, the autocannon firing at it, the shield booster running and hits recorded.',
};

/**
 * What the campaign shows once resumed, read through its projections. The
 * browser test checks the interface against these, and the helper checks that
 * a save resumed headlessly answers with exactly these.
 */
export interface CheckpointFacts {
  readonly stateHash: string;
  readonly simulationTimeMs: number;
  readonly paused: boolean;
  readonly siteId: string;
  readonly opponentId: string;
  readonly opponentWithinLockRange: boolean;
  readonly opponentRangeKm: number;
  readonly locks: readonly { readonly targetId: string; readonly status: string }[];
  /** The first weapon's target while it repeats, else `null`. */
  readonly firingAt: string | null;
  readonly boosterActive: boolean;
}

export interface Checkpoint {
  readonly name: CheckpointName;
  readonly contentVersion: string;
  readonly contentHash: string;
  /** The manifest the IndexedDB store would hold with this save alone in the slot. */
  readonly manifest: SlotManifest;
  readonly envelope: SaveEnvelope;
  readonly facts: CheckpointFacts;
}

/** A mismatch between a checkpoint and what it is about to be used with. */
export class CheckpointMismatch extends Error {
  override readonly name = 'CheckpointMismatch';
}

interface Driver {
  ask<TData>(type: string, payload?: unknown): Promise<EngineResponse<TData>>;
  data<TData>(type: string, payload?: unknown): Promise<TData>;
  until(done: () => Promise<boolean>, budgetSeconds: number): Promise<boolean>;
}

function driverFor(host: EngineHost, prefix: string): Driver {
  let ordinal = 0;
  const ask = async <TData>(type: string, payload: unknown = EMPTY_PAYLOAD): Promise<EngineResponse<TData>> => {
    ordinal += 1;
    return (await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `${prefix}-${String(ordinal)}`,
      type,
      payload,
    })) as EngineResponse<TData>;
  };
  const data = async <TData>(type: string, payload?: unknown): Promise<TData> => {
    const response = await ask<TData>(type, payload ?? EMPTY_PAYLOAD);
    if (!response.ok) {
      const params = response.error.params === undefined ? '' : ` ${JSON.stringify(response.error.params)}`;
      throw new Error(`${type} failed: ${response.error.messageKey}${params}`);
    }
    return response.data;
  };
  const until = async (done: () => Promise<boolean>, budgetSeconds: number): Promise<boolean> => {
    for (let step = 0; step < Math.ceil((budgetSeconds * 1000) / STEP_MS); step += 1) {
      await data('time.advance', { elapsedRealMs: STEP_MS });
      if (await done()) return true;
    }
    return false;
  };
  return { ask, data, until };
}

/** Reads the facts a checkpoint promises from an open campaign. */
async function observe(driver: Driver): Promise<CheckpointFacts> {
  const hash = await driver.data<StateHashData>('diagnostics.stateHash');
  const frame = await driver.data<FrameData>('campaign.frame');
  const site = await driver.data<SiteData>('navigation.site');
  const encounter = await driver.data<EncounterData>('encounter.state');
  const combat = await driver.data<CombatData>('combat.state');
  const opponentId = encounter.instance?.npcs[0]?.shipId;
  if (site.location.kind !== 'site' || opponentId === undefined || hash.stateHash === null) {
    throw new CheckpointMismatch('The checkpoint campaign is not in a site with an opponent.');
  }
  const motion = combat.motion.find((entry) => entry.targetId === opponentId);
  const weapon = combat.weapons[0];
  return {
    stateHash: hash.stateHash,
    simulationTimeMs: frame.simulationTimeMs,
    paused: frame.paused,
    siteId: site.location.siteId,
    opponentId,
    opponentWithinLockRange: motion?.withinLockRange ?? false,
    opponentRangeKm: Math.round((motion?.rangeKm ?? Number.NaN) * 1000) / 1000,
    locks: combat.locks.map((lock) => ({ targetId: lock.targetId, status: lock.status })),
    firingAt: weapon !== undefined && weapon.repeating ? weapon.targetId : null,
    boosterActive: combat.modules.some((module) => module.slot.kind === 'system' && module.status === 'active'),
  };
}

/** Undocks, warps to the scout site at 10 km and waits for arrival; returns the scout's id. */
async function arriveAtScout(driver: Driver): Promise<string> {
  await driver.data('ship.undock');
  await driver.data('navigation.selectDestination', { encounterId: SCOUT_ENCOUNTER });
  await driver.data('navigation.warp', { destinationSiteId: SCOUT_SITE, arrivalDistanceKm: 10 });
  await driver.data('time.set', { paused: false, rate: 1 });
  const arrived = await driver.until(async () => {
    const site = await driver.data<SiteData>('navigation.site');
    return site.location.kind === 'site' && site.location.siteId === SCOUT_SITE;
  }, 120);
  if (!arrived) throw new Error('The checkpoint ship never arrived at the scout site.');
  const encounter = await driver.data<EncounterData>('encounter.state');
  const opponent = encounter.instance?.npcs[0]?.shipId;
  if (opponent === undefined) throw new Error('The scout site spawned no opponent.');
  return opponent;
}

/**
 * Orbits the scout at 1 km until it may be locked and the first weapon
 * reaches it, the moment a player would lock. The orbit order is kept.
 */
async function closeToRange(driver: Driver, opponentId: string): Promise<void> {
  await driver.data('movement.orbit', { targetId: opponentId, distanceKm: 1 });
  const inRange = await driver.until(async () => {
    const combat = await driver.data<CombatData>('combat.state');
    const motion = combat.motion.find((entry) => entry.targetId === opponentId);
    const lockable = combat.lockCommands
      .find((entry) => entry.objectId === opponentId)
      ?.commands.some((command) => command.command === 'targeting.lock' && command.available) === true;
    const weapon = combat.weapons[0];
    return motion !== undefined && motion.withinLockRange && lockable &&
      weapon !== undefined && motion.rangeKm <= weapon.optimalRangeKm;
  }, 120);
  if (!inRange) throw new Error('The scout never came inside lock and weapon range.');
}

/** Locks the scout, opens fire, runs the booster and waits for the first exchanges. */
async function engage(driver: Driver, opponentId: string): Promise<void> {
  await driver.data('targeting.lock', { targetId: opponentId });
  const locked = await driver.until(
    async () => (await driver.data<CombatData>('combat.state')).locks.some((lock) => lock.status === 'locked'),
    60,
  );
  if (!locked) throw new Error('The scout was never locked.');
  await driver.data('weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponentId });
  await driver.data('module.activate', { slotKind: 'system', slotIndex: 0 });
  const fighting = await driver.until(async () => {
    const combat = await driver.data<CombatData>('combat.state');
    return combat.events.length >= 2 && combat.hostileLocks.length > 0 &&
      combat.weapons.some((weapon) => weapon.repeating && weapon.cycle !== null);
  }, 60);
  if (!fighting) throw new Error('The fight never started both ways.');
}

const SCRIPTS: Readonly<Record<CheckpointName, (driver: Driver) => Promise<void>>> = {
  async 'scout-in-range'(driver) {
    const opponent = await arriveAtScout(driver);
    await closeToRange(driver, opponent);
  },
  async 'scout-fight'(driver) {
    const opponent = await arriveAtScout(driver);
    await closeToRange(driver, opponent);
    await engage(driver, opponent);
  },
};

/**
 * Plays a checkpoint's script on a new campaign, pauses, closes the campaign
 * and returns the save the engine wrote, with the facts it promises.
 */
export async function prepareCheckpoint(name: CheckpointName, content: ContentRepository): Promise<Checkpoint> {
  const saves = createMemorySaveStore();
  const driver = driverFor(createEngineHost({ content, saves }), `checkpoint-${name}`);
  await driver.data('campaign.create', {
    displayName: CHECKPOINT_PILOT,
    seed: CHECKPOINT_SEED,
    createdAtRealMs: CREATED_AT_REAL_MS,
  });
  await SCRIPTS[name](driver);
  await driver.data('time.set', { paused: true, rate: 1 });
  const facts = await observe(driver);
  await driver.data('campaign.close', { savedAtRealMs: CLOSED_AT_REAL_MS });

  const written = await saves.readManifest(DEFAULT_SLOT_ID);
  const latest = written?.saves[0];
  if (latest === undefined) throw new Error(`Checkpoint "${name}" closed without a save.`);
  const envelope = (await saves.readSave(DEFAULT_SLOT_ID, latest.saveId)) as SaveEnvelope | null;
  if (envelope === null) throw new Error(`Checkpoint "${name}" lost its save.`);
  // The slot holds this save alone, as the store writes a first save.
  const manifest = planWrite(null, envelope, DEFAULT_SAVE_RETENTION).manifest;
  const checkpoint: Checkpoint = {
    name,
    contentVersion: content.contentVersion,
    contentHash: content.contentHash,
    manifest,
    envelope,
    facts,
  };
  await verifyCheckpoint(checkpoint, content);
  return checkpoint;
}

/**
 * Checks a checkpoint before it is seeded: the current save format, the
 * content it is about to run against, an intact checksum, a manifest naming
 * the save, and - by resuming it in a fresh host from a store holding only
 * that manifest and save - exactly the promised projection. Throws a
 * `CheckpointMismatch` naming the first difference.
 */
export async function verifyCheckpoint(checkpoint: Checkpoint, content: ContentRepository): Promise<void> {
  const { envelope, manifest, name } = checkpoint;
  const fail = (what: string): never => {
    throw new CheckpointMismatch(`Checkpoint "${name}": ${what}`);
  };
  if (envelope.format !== 'galactic-soup/save') fail(`the save format is "${String(envelope.format)}"`);
  if (envelope.formatVersion !== SAVE_FORMAT_VERSION) {
    fail(`the save is format ${String(envelope.formatVersion)}, the engine writes ${String(SAVE_FORMAT_VERSION)}`);
  }
  if (envelope.contentHash !== content.contentHash || envelope.contentVersion !== content.contentVersion) {
    fail(
      `the save names content ${envelope.contentVersion} (${envelope.contentHash.slice(0, 12)}), ` +
        `but it is used with ${content.contentVersion} (${content.contentHash.slice(0, 12)})`,
    );
  }
  if (!isSealed(envelope)) fail('the save checksum does not match its contents');
  if (manifest.slotId !== DEFAULT_SLOT_ID || manifest.saves.length !== 1 || manifest.saves[0]?.saveId !== envelope.saveId) {
    fail('the manifest does not name the save alone in the default slot');
  }

  const store = createMemorySaveStore();
  await store.write({ envelope, retention: DEFAULT_SAVE_RETENTION });
  const driver = driverFor(createEngineHost({ content, saves: store }), `checkpoint-verify-${name}`);
  const resumed = await driver.ask('campaign.resume');
  if (!resumed.ok) fail(`the save does not resume: ${resumed.error.messageKey}`);
  const facts = await observe(driver);
  const expected = JSON.stringify(checkpoint.facts);
  const actual = JSON.stringify(facts);
  if (actual !== expected) fail(`the resumed projection differs.\n  expected ${expected}\n  resumed  ${actual}`);
}
