import { expect } from 'vitest';

import {
  campaignStateHash,
  captureSnapshot,
  ENGINE_VERSION,
  loadSave,
  validateCampaign,
  type CampaignState,
} from '@engine';
import { runCommand } from '@engine/application';
import {
  COMBAT_EVENT_LIMIT,
  NOTIFICATION_HISTORY_LIMIT,
  NOTIFICATION_SITE_MEMORY_LIMIT,
} from '@engine/domain';
import { PROTOCOL_VERSION, validateClientRequest, type CommandType } from '@protocol';
import { canonicalJson } from '@shared';

import { shippedContent } from '../content.ts';
import { GOLDEN_STATES, type GoldenState } from '../golden/campaign.ts';
import { readGoldenSave } from '../golden/fixtures.ts';
import { generatorOf, randomPilot, type PilotAction } from '../randomPilot.ts';
import { saveSchemas } from '../schemas.ts';

/**
 * Full-campaign property runs (MVP Implementation Plan phase 20; Technical
 * Specification 7.2, 9.4, 9.5, 11.4, 13, 15.1, 15.3), shared by the
 * `tests/integration/campaignProperties*.test.ts` files. Each file flies some
 * of the runs, so that the runs proceed side by side (Test Suite Optimization
 * Plan phase 1).
 *
 * A random pilot plays the whole loop for thousands of steps: station
 * services, travel, combat, looting, retreat, and whatever losses that
 * brings. Nothing about a single run is asserted. What is asserted holds at
 * every step of every run, whatever the pilot asked for.
 */

export const content = shippedContent();
const schemas = saveSchemas();

/**
 * Where each run starts. A new campaign covers the station and the first
 * sorties; the golden saves put a random pilot where a new one rarely gets -
 * beside wrecks that hold loot, in the middle of a fight, and in a ship that
 * can win one.
 */
export const RUNS: readonly { readonly name: string; readonly from: string; readonly pilot: number }[] = [
  { name: 'a new campaign', from: '11111111222222223333333344444444', pilot: 1 },
  { name: 'another new campaign', from: 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5', pilot: 2 },
  { name: 'the golden wreck save', from: 'wreck', pilot: 3 },
  { name: 'the golden combat save', from: 'combat', pilot: 4 },
  { name: 'the golden completed-progression save', from: 'completed-progression', pilot: 5 },
  // The run that loses a ship, so destruction and recovery run under every
  // check. Before v0.2 phase 6 that rested on one late loss in the wreck run
  // (step 2,895 of 4,000), which the faster fast-frigate orbit removed; this
  // pilot loses the combat save's ship within the first 500 steps.
  { name: 'the golden combat save, fought to a loss', from: 'combat', pilot: 6 },
];
export const STEPS = 4_000;
/** A snapshot is taken, loaded and checked this often. */
const SNAPSHOT_EVERY = 125;

/** Commands that move or reshape physical items without creating or destroying any. */
const CONSERVING = new Set([
  'inventory.transfer', 'inventory.split', 'inventory.merge',
  'fitting.begin', 'fitting.set', 'fitting.clear', 'fitting.revert', 'fitting.commit',
  'loot.take',
]);
/** The commands that may change the wallet, each by exactly what its preview said. */
const ECONOMIC = new Set([
  'market.confirmBuy', 'market.confirmSell', 'repair.confirm', 'resupply.confirm', 'insurance.confirm',
]);

export interface RunSummary {
  readonly final: CampaignState;
  readonly committed: number;
  readonly refused: number;
  readonly types: ReadonlySet<string>;
  readonly refusals: ReadonlySet<string>;
  readonly visited: ReadonlySet<string>;
  readonly largestSnapshotBytes: number;
}

function unitsByDefinition(state: CampaignState): Record<string, number> {
  const units: Record<string, number> = {};
  for (const stack of Object.values(state.assets.stacks)) {
    units[stack.definitionId] = (units[stack.definitionId] ?? 0) + stack.quantity;
  }
  return units;
}

function roundTrip(state: CampaignState): { loaded: CampaignState; bytes: number } {
  const envelope = captureSnapshot({
    campaign: state,
    content,
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    slotId: 'slot-1',
    kind: 'auto',
    sequence: 1,
    savedAtRealMs: 1,
  });
  const text = JSON.stringify(envelope);
  const loaded = loadSave(JSON.parse(text) as unknown, { content });
  if (!loaded.ok) {
    throw new Error(`A snapshot did not load: ${JSON.stringify(loaded.error)} ${JSON.stringify(loaded.issues[0])}`);
  }
  return { loaded: loaded.state, bytes: text.length };
}

type Sent = ReturnType<typeof runCommand> | { readonly kind: 'invalid' };

/** A command the way the host handles one: validated by the protocol, then run. */
function send(campaign: CampaignState | null, action: PilotAction): Sent {
  const validated = validateClientRequest({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'property-run',
    type: action.type,
    payload: action.payload,
  });
  if (!validated.ok) return { kind: 'invalid' };
  return runCommand({ campaign, content, type: action.type as CommandType, payload: validated.request.payload });
}

export function startOf(from: string): CampaignState {
  if ((GOLDEN_STATES as readonly string[]).includes(from)) {
    const loaded = loadSave(readGoldenSave(from as GoldenState), { content });
    if (!loaded.ok) throw new Error(`The golden ${from} save did not load.`);
    return loaded.state;
  }
  const created = send(null, {
    type: 'campaign.create',
    payload: { displayName: 'Property Pilot', seed: from, createdAtRealMs: 1_700_000_000_000 },
  });
  if (created.kind !== 'committed' || created.campaign === null) throw new Error('The campaign was not created.');
  const running = send(created.campaign, { type: 'time.set', payload: { paused: false, rate: 1 } });
  if (running.kind !== 'committed' || running.campaign === null) throw new Error('The clock did not start.');
  return running.campaign;
}

/**
 * Flies one seeded run. With `reload`, the campaign is replaced by its own
 * loaded snapshot at every snapshot point, as if the game had been closed and
 * reopened there.
 */
export function fly(from: string, pilotSeed: number, reload: boolean): RunSummary {
  let state = startOf(from);
  const pilot = randomPilot(
    content,
    generatorOf(pilotSeed),
    state.assets.location.kind === 'station' ? undefined : { intent: 'fight', budget: 400 },
  );
  const types = new Set<string>();
  const refusals = new Set<string>();
  const visited = new Set<string>();
  let committed = 0;
  let refused = 0;
  let largestSnapshotBytes = 0;

  for (let step = 1; step <= STEPS; step += 1) {
    const action = pilot.next(state);
    const where = `step ${String(step)} ${action.type} ${JSON.stringify(action.payload).slice(0, 160)}`;
    const before = state;
    const result = send(state, action);

    if (result.kind === 'invalid') {
      // The pilot only builds well-formed requests.
      throw new Error(`${where}: the protocol refused the request as malformed.`);
    }
    if (result.kind === 'failed') {
      // A refusal is a rule the player can be told about, never a defect.
      expect(['RULE_VIOLATION', 'NOT_FOUND', 'STALE_PREVIEW'], `${where} -> ${JSON.stringify(result.error)}`)
        .toContain(result.error.code);
      refusals.add(result.error.messageKey);
      refused += 1;
      continue;
    }
    if (result.kind === 'unchanged') continue;
    if (result.campaign === null) throw new Error(`${where}: the campaign closed.`);
    state = result.campaign;
    committed += 1;
    types.add(action.type);
    visited.add(state.assets.location.kind === 'site' ? state.assets.location.siteId : state.assets.location.kind);

    // One commit, one revision; nothing that counts ever runs backwards.
    expect(state.revision, where).toBe(before.revision + 1);
    expect(state.time.simulationTimeMs, where).toBeGreaterThanOrEqual(before.time.simulationTimeMs);
    expect(state.nextEntityOrdinal, where).toBeGreaterThanOrEqual(before.nextEntityOrdinal);
    expect(state.nextEventOrdinal, where).toBeGreaterThanOrEqual(before.nextEventOrdinal);
    expect(state.notifications.sequence, where).toBeGreaterThanOrEqual(before.notifications.sequence);
    expect(state.recovery.losses, where).toBeGreaterThanOrEqual(before.recovery.losses);
    for (const [name, stream] of Object.entries(state.random)) {
      expect(stream.drawIndex, `${where} ${name}`).toBeGreaterThanOrEqual(
        before.random[name as keyof typeof before.random].drawIndex,
      );
    }
    // Only time draws: a command the player gives decides nothing by chance
    // and moves no clock (Technical Specification 9.1, 9.4).
    if (action.type !== 'time.advance') {
      expect(canonicalJson(state.random as unknown as Record<string, unknown>), where).toBe(
        canonicalJson(before.random as unknown as Record<string, unknown>),
      );
      expect(state.time.simulationTimeMs, where).toBe(before.time.simulationTimeMs);
    }

    // Credits (Functional Specification 6.1, 22.2, 22.4). Time may only add
    // to the wallet: bounties and insurance.
    expect(Number.isSafeInteger(state.assets.credits) && state.assets.credits >= 0, where).toBe(true);
    if (ECONOMIC.has(action.type)) {
      expect(action.walletDeltaCredits, where).toBeDefined();
      expect(state.assets.credits - before.assets.credits, where).toBe(action.walletDeltaCredits);
    } else if (action.type === 'time.advance') {
      expect(state.assets.credits, where).toBeGreaterThanOrEqual(before.assets.credits);
    } else {
      expect(state.assets.credits, where).toBe(before.assets.credits);
    }

    // Physical items (Functional Specification 6.1, 22.2, 22.3).
    if (CONSERVING.has(action.type)) {
      expect(unitsByDefinition(state), where).toEqual(unitsByDefinition(before));
    }

    // Histories stay inside their bounds (Technical Specification 13).
    expect(state.notifications.entries.length, where).toBeLessThanOrEqual(NOTIFICATION_HISTORY_LIMIT);
    expect(state.notifications.raisedThisSite.length, where).toBeLessThanOrEqual(NOTIFICATION_SITE_MEMORY_LIMIT);
    expect(state.combat.events.length, where).toBeLessThanOrEqual(COMBAT_EVENT_LIMIT);

    if (step % SNAPSHOT_EVERY === 0) {
      expect(validateCampaign(state, content), where).toEqual([]);
      expect(schemas.state(state), where).toBeNull();
      const { loaded, bytes } = roundTrip(state);
      expect(campaignStateHash(loaded), where).toBe(campaignStateHash(state));
      largestSnapshotBytes = Math.max(largestSnapshotBytes, bytes);
      if (reload) state = loaded;
    }
  }

  return { final: state, committed, refused, types, refusals, visited, largestSnapshotBytes };
}

/** The run of `RUNS` with this name. */
export function runNamed(name: string): (typeof RUNS)[number] {
  const run = RUNS.find((entry) => entry.name === name);
  if (run === undefined) throw new Error(`There is no property run named ${name}.`);
  return run;
}

/** The command families the runs must commit between them: the whole loop, not a corner of it. */
export const WHOLE_LOOP_COMMANDS = [
  'market.confirmBuy', 'market.confirmSell', 'inventory.transfer', 'fitting.commit',
  'repair.confirm', 'resupply.confirm', 'ship.undock', 'navigation.warp', 'navigation.dock',
  'movement.orbit', 'targeting.lock', 'weapon.activate', 'module.activate', 'loot.take', 'time.advance',
] as const;

/**
 * Flies one run straight through and checks what every run must show: it did
 * mostly commit, it was refused often enough to test the refusals, it ends
 * valid, and no snapshot along the way came near the size a save may be
 * (Technical Specification 13, 14).
 */
export function flyRun(run: (typeof RUNS)[number]): RunSummary {
  const summary = fly(run.from, run.pilot, false);
  expect(summary.committed).toBeGreaterThan(STEPS / 2);
  expect(summary.refused).toBeGreaterThan(20);
  expect(validateCampaign(summary.final, content)).toEqual([]);
  expect(summary.largestSnapshotBytes).toBeLessThan(1_048_576);
  return summary;
}
