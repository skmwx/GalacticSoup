import {
  captureSnapshot,
  DEFAULT_SLOT_ID,
  ENGINE_VERSION,
  type ContentRepository,
  type SaveEnvelope,
} from '@engine';
import {
  PROTOCOL_VERSION,
  type AssetsData,
  type CombatData,
  type DestinationsData,
  type EncounterData,
  type FittingDraftData,
  type LossReportData,
  type SiteData,
} from '@protocol';

import { runCareerSeed, type CareerFixture, type CareerSeedRun } from '../balance/career.ts';

import { startRecording, type Recording, type ReplayLog, type ReplayLogCampaign } from './recording.ts';

/**
 * The golden campaign (MVP Implementation Plan phase 20; Technical
 * Specification 9.5, 11.2, 11.4, 15.1).
 *
 * One whole campaign, flown through the protocol by the scripted pilot the
 * balance careers use, and recorded as it goes. It overreaches, loses its ship
 * and is recovered, earns the fit back on the easiest site, clears the
 * multi-opponent site until the mastery fit is affordable and then clears the
 * mastery site. Along the way it is saved at the six states a save has to
 * survive: docked with a fitting draft open, in warp, in a fight, after a
 * loss, beside a wreck that still holds loot, and with every site cleared.
 *
 * The recording is two fixtures: the replay log, and one sealed save per
 * state. Both are written against the shipped content, because only the
 * shipped content reaches every one of these states; a content change that
 * moves a fight therefore makes them stale until they are recorded again
 * (`npm run golden:record`), exactly as it does the balance candidate.
 */

export const GOLDEN_STATES = [
  'station',
  'travel',
  'combat',
  'post-destruction',
  'wreck',
  'completed-progression',
] as const;

export type GoldenState = (typeof GOLDEN_STATES)[number];

export const GOLDEN_STATE_DESCRIPTIONS: Readonly<Record<GoldenState, string>> = {
  station: 'Docked after buying a fit, with a changed fitting draft still open.',
  travel: 'In warp between the station and an encounter site.',
  combat: 'In a fight: locks held both ways, a weapon cycle running, damage recorded.',
  'post-destruction': 'Recovered at the station after losing the ship, with the loss report and the wreck bookmark.',
  wreck: 'In a cleared site beside opponent wrecks that still hold their loot.',
  'completed-progression': 'Docked with all three sites cleared at least once.',
};

export const GOLDEN_CAMPAIGN: ReplayLogCampaign = {
  // The career runner starts every campaign under this name and timestamp.
  displayName: 'Test Pilot',
  seed: 'bb22cc33dd44ee55ff6677889900aa11',
  createdAtRealMs: 1_700_000_000_000,
};

/** The wall-clock stamp every golden save carries; no rule reads it. */
export const GOLDEN_SAVED_AT_REAL_MS = 1_700_000_600_000;

export const GOLDEN_CAREER: CareerFixture = {
  id: 'golden',
  description:
    'Overreach and lose the ship, recover on the easiest site, then progress through the multi-opponent site to the mastery site.',
  objectives: [],
  seeds: [GOLDEN_CAMPAIGN.seed],
  steps: [
    { equip: 'intermediate' },
    { fly: 'base.intermediate-brawl', until: { losses: 1 }, maxSorties: 1 },
    { equip: 'starter' },
    { fly: 'scout.starter', until: { affords: 'intermediate' }, maxSorties: 4 },
    { equip: 'intermediate' },
    { fly: 'patrol.intermediate', until: { affords: 'mastery' }, maxSorties: 6 },
    { equip: 'mastery' },
    { fly: 'base.mastery', until: { completions: 1 }, maxSorties: 2 },
  ],
};

export interface GoldenRun {
  readonly log: ReplayLog;
  readonly saves: Readonly<Record<GoldenState, SaveEnvelope>>;
  readonly career: CareerSeedRun;
}

/** Whether the campaign is in a golden state right now, asked through its projections. */
const REACHED: Readonly<Record<GoldenState, (recording: Recording) => Promise<boolean>>> = {
  async station(recording) {
    const fitting = await recording.query<FittingDraftData>('fitting.draft');
    return fitting.draft !== null && fitting.draft.changed;
  },
  async travel(recording) {
    return (await recording.query<SiteData>('navigation.site')).location.kind === 'warp';
  },
  async combat(recording) {
    const combat = await recording.query<CombatData>('combat.state');
    return combat.hostileLocks.length > 0 &&
      combat.events.length >= 2 &&
      combat.locks.some((lock) => lock.status === 'locked') &&
      combat.weapons.some((weapon) => weapon.repeating && weapon.cycle !== null);
  },
  async 'post-destruction'(recording) {
    return (await recording.query<LossReportData>('loss.report')).report !== null;
  },
  async wreck(recording) {
    const encounter = await recording.query<EncounterData>('encounter.state');
    return encounter.instance?.status === 'completed' &&
      encounter.wrecks.some((wreck) => wreck.owner === 'npc');
  },
  async 'completed-progression'(recording) {
    const assets = await recording.query<AssetsData>('assets.list');
    if (assets.location.kind !== 'station') return false;
    const destinations = await recording.query<DestinationsData>('navigation.destinations');
    return destinations.destinations.length > 0 &&
      destinations.destinations.every((destination) => destination.completionCount >= 1);
  },
};

/** Seals a state the way every golden save is sealed, so only the state differs between them. */
export function sealGolden(
  state: Parameters<typeof captureSnapshot>[0]['campaign'],
  content: ContentRepository,
): SaveEnvelope {
  return captureSnapshot({
    campaign: state,
    content,
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    slotId: DEFAULT_SLOT_ID,
    kind: 'auto',
    sequence: 1,
    savedAtRealMs: GOLDEN_SAVED_AT_REAL_MS,
  });
}

export async function recordGoldenCampaign(content: ContentRepository): Promise<GoldenRun> {
  const pending: GoldenState[] = [...GOLDEN_STATES];
  const saves: Partial<Record<GoldenState, SaveEnvelope>> = {};

  // The states are reached in the order they are listed, so only the next one
  // is asked about after each step.
  const afterStep = async (recording: Recording): Promise<void> => {
    const next = pending[0];
    if (next === undefined || !(await REACHED[next](recording))) return;
    pending.shift();
    await recording.mark(next);
    saves[next] = sealGolden(await recording.snapshot(), content);
  };

  let recording: Recording | null = null;
  const career = await runCareerSeed(GOLDEN_CAREER, GOLDEN_CAMPAIGN.seed, content, {
    open: async () => {
      recording = await startRecording({ campaign: GOLDEN_CAMPAIGN, content, afterStep });
      return recording;
    },
  });
  if (recording === null) throw new Error('The golden campaign never opened.');
  if (career.stalled !== null) throw new Error(`The golden campaign stalled: ${career.stalled}.`);
  if (pending.length > 0) {
    throw new Error(`The golden campaign never reached: ${pending.join(', ')}.`);
  }

  const log = await (recording as Recording).finish();
  return { log, saves: saves as Record<GoldenState, SaveEnvelope>, career };
}
