import {
  attributeValue,
  deriveShipAttributes,
  preferredRangeKm,
  PROPULSION_ACTIVE,
  resistanceAttribute,
  summariseFit,
  turretAccuracy,
  type DerivedShipAttributes,
  type FitDescription,
  type FitSummary,
  type SlotRef,
} from '@engine/domain';
import {
  DAMAGE_TYPES,
  DEFENSE_LAYERS as LAYERS,
  type ContentRepository,
  type DamageType,
  type DefenseLayer,
  type HullDefinition,
  type NpcProfileDefinition,
} from '@engine/ports';
import { planNpcFit } from '@engine/simulation';
import type { AmmunitionId, ModuleId } from '@shared';

import type { FixtureFit, PilotTactics } from './fixtures.ts';

/**
 * Content diagnostics (MVP Implementation Plan phase 16; Technical
 * Specification 6.2, 16).
 *
 * A headless scenario says whether a fit beat an encounter. This says why it
 * should or should not have, from the authored data alone, so a progression
 * failure can be traced to a number in `content/` instead of to a timeout.
 *
 * Every figure comes from the engine's own rules - the derived-attribute
 * pipeline, the fit summary, the turret formula, the behaviour selector's
 * preferred range - applied to the authored definitions. Nothing here restates
 * a formula. What it adds is a deliberately simple model of a fight:
 *
 * - each opponent is fought at one range: the tactics' chosen distance when
 *   the player is faster than it, otherwise the range it prefers;
 * - an opponent that orbits circles at its full speed, so tracking costs both
 *   sides shots; every other opponent moves straight toward or away from the
 *   player, and tracking costs nothing;
 * - opponents die one at a time in the tactics' priority order, and each one
 *   fires until it dies or runs out of rounds;
 * - every opponent is in range from the first second: the time a brawler
 *   spends closing on a ship that holds range is not counted, so a kiting fit
 *   looks more exposed here than it plays.
 *
 * The model is an explanation, not a prediction, so its findings name causes
 * - an opponent no weapon can reach, a repairer that out-heals the guns, a hold
 * that runs dry, a tank that gives out - and the headless scenarios remain
 * the proof.
 */

export type FindingSeverity = 'blocking' | 'warning' | 'note';

export interface Finding {
  readonly severity: FindingSeverity;
  readonly code:
    | 'unreachable'
    | 'outRepaired'
    | 'ammunition'
    | 'overwhelmed'
    | 'outpaced'
    | 'capacitor';
  readonly message: string;
}

export interface OpponentDiagnosis {
  readonly profileId: string;
  readonly role: string;
  readonly movement: string;
  readonly preferredRangeKm: number;
  readonly engagementRangeKm: number;
  readonly maxSpeedKmPerSecond: number;
  readonly hitPoints: number;
  /** Listed damage the player's charges must deliver to destroy it, after its resistances. */
  readonly rawHitPointsToDestroy: number;
  /** The player's hit chance with its best weapon at the engagement range. */
  readonly playerHitChance: number;
  /** Listed damage per second the player lands on it at the engagement range. */
  readonly playerDamagePerSecond: number;
  /** Hit points per second its own repairer can sustain on its capacitor. */
  readonly repairPerSecond: number;
  readonly secondsToDestroy: number | null;
  /** Damage per second it applies to the player's shield at the engagement range. */
  readonly incomingDamagePerSecond: number;
  /** How long its magazines and reserve keep it firing. */
  readonly firingSeconds: number | null;
}

export interface PlayerDiagnosis {
  readonly maxSpeedKmPerSecond: number;
  /** With the propulsion module running, when one is fitted. */
  readonly boostedSpeedKmPerSecond: number;
  readonly bufferHitPoints: number;
  readonly repairPerSecond: number;
  readonly capacitorEnduranceSeconds: number | null;
  readonly roundsCarried: number;
  readonly listedDamagePerSecond: number;
}

export interface EncounterDiagnosis {
  readonly encounterId: string;
  readonly tier: number;
  readonly fitId: string;
  readonly player: PlayerDiagnosis;
  readonly opponents: readonly OpponentDiagnosis[];
  /** Seconds to destroy every opponent in order, or `null` when one cannot be. */
  readonly secondsToDestroyAll: number | null;
  readonly estimatedDamageTaken: number;
  /** The fewest hit points the player is left with at any moment of the fight. */
  readonly lowestHitPoints: number;
  /** When the layers would give out, or `null` when they hold. */
  readonly brokenAtSeconds: number | null;
  readonly roundsNeeded: number | null;
  readonly findings: readonly Finding[];
}

export function diagnoseEncounter(
  content: ContentRepository,
  encounterId: string,
  fit: FixtureFit,
  tactics: PilotTactics,
): EncounterDiagnosis {
  const encounter = content.requireEncounter(encounterId as never);
  const hull = content.requireHull(content.rules.economy.starterHullId as never);
  const playerFit = describeFixtureFit(content, fit);
  const player = shipModel(content, hull, playerFit);
  const boosted = deriveShipAttributes({
    hull, fit: playerFit, content, conditions: new Set([PROPULSION_ACTIVE]),
  });
  const burning = tactics.propulsion !== 'never';
  const playerSpeed = attributeValue(burning ? boosted : player.derived, 'maxSpeedKmPerSecond');

  const opponents: OpponentDiagnosis[] = [];
  for (const spawn of encounter.spawns) {
    const profile = content.requireNpcProfile(spawn.npcProfileId);
    for (let index = 0; index < spawn.count; index += 1) {
      opponents.push(diagnoseOpponent(content, profile, player, playerSpeed, tactics));
    }
  }
  opponents.sort((left, right) =>
    rank(left.profileId, tactics) - rank(right.profileId, tactics) ||
    (left.secondsToDestroy ?? Infinity) - (right.secondsToDestroy ?? Infinity));

  // Opponents die one at a time; each fires until it dies or runs dry.
  let elapsed = 0;
  let reachable = true;
  const deaths: number[] = [];
  for (const opponent of opponents) {
    if (opponent.secondsToDestroy === null) {
      reachable = false;
      deaths.push(Infinity);
      continue;
    }
    elapsed += opponent.secondsToDestroy;
    deaths.push(elapsed);
  }
  const fightSeconds = reachable ? elapsed : Math.max(elapsed, MAXIMUM_FIGHT_SECONDS);
  const playerDiagnosis = diagnosePlayer(player, boosted, fit);
  const tank = sustainFight(player, playerDiagnosis, opponents, deaths, fightSeconds);

  const roundsNeeded = reachable ? roundsFor(player.summary, opponents) : null;
  const findings = findingsFor({
    opponents, playerDiagnosis, playerSpeed, burning, tank, roundsNeeded, fightSeconds,
    holdRangeKm: tactics.movement.kind === 'keepRange' ? tactics.movement.distanceKm : null,
  });

  return {
    encounterId,
    tier: encounter.tier,
    fitId: fit.id,
    player: playerDiagnosis,
    opponents,
    secondsToDestroyAll: reachable ? elapsed : null,
    estimatedDamageTaken: tank.damageTaken,
    lowestHitPoints: tank.lowestHitPoints,
    brokenAtSeconds: tank.brokenAtSeconds,
    roundsNeeded,
    findings,
  };
}

/* -------------------------------------------------------------------------- */
/* Ships                                                                       */
/* -------------------------------------------------------------------------- */

interface ShipModel {
  readonly hull: HullDefinition;
  readonly fit: FitDescription;
  readonly derived: DerivedShipAttributes;
  readonly summary: FitSummary;
}

function shipModel(content: ContentRepository, hull: HullDefinition, fit: FitDescription): ShipModel {
  const derived = deriveShipAttributes({ hull, fit, content });
  return { hull, fit, derived, summary: summariseFit({ hull, fit, content, derived }) };
}

/** The fit a fixture names, as the attribute pipeline reads fits. */
export function describeFixtureFit(content: ContentRepository, fit: FixtureFit): FitDescription {
  return fit.modules.map((entry) => {
    const module = content.requireModule(entry.moduleId as ModuleId);
    const slot: SlotRef = { kind: entry.slot, index: entry.index };
    return {
      slot,
      moduleId: module.id,
      online: true,
      stackId: null,
      charge: entry.ammunitionId === undefined || module.category !== 'turret'
        ? null
        : { ammunitionId: entry.ammunitionId as AmmunitionId, quantity: module.turret.magazineSize, stackId: null },
    };
  });
}

function npcModel(content: ContentRepository, profile: NpcProfileDefinition): ShipModel {
  const hull = content.requireHull(profile.hullId);
  const fit: FitDescription = planNpcFit(content, hull, profile).map((entry) => ({
    slot: entry.slot,
    moduleId: entry.moduleId,
    online: true,
    stackId: null,
    charge: entry.ammunitionId === null
      ? null
      : { ammunitionId: entry.ammunitionId, quantity: entry.magazineSize, stackId: null },
  }));
  return shipModel(content, hull, fit);
}

function diagnoseOpponent(
  content: ContentRepository,
  profile: NpcProfileDefinition,
  player: ShipModel,
  playerSpeed: number,
  tactics: PilotTactics,
): OpponentDiagnosis {
  const rules = content.rules.combat;
  const npc = npcModel(content, profile);
  const role = rules.npcRoles[profile.role];
  const weapons = npc.summary.weapons.filter((weapon) => weapon.online);
  const preferred = preferredRangeKm({
    role: profile.role,
    targetId: '',
    rangeKm: 0,
    maxLockRangeKm: attributeValue(npc.derived, 'maxLockRangeKm'),
    bestOptimalRangeKm: weapons.length === 0 ? null : Math.max(...weapons.map((weapon) => weapon.optimalRangeKm)),
    hasLock: false,
    repairLayerFraction: null,
    hasPropulsion: false,
  }, rules);
  const npcSpeed = attributeValue(npc.derived, 'maxSpeedKmPerSecond');
  // A faster player fights where the tactics say; a slower one where the opponent wants.
  const engagement = playerSpeed > npcSpeed ? tactics.movement.distanceKm : preferred;

  // An orbiting opponent's speed is all transverse at the range it holds.
  const angularVelocity = role.movement === 'orbit' && engagement > 0 ? npcSpeed / engagement : 0;
  const outgoing = landedDamage(content, player, npc, engagement, angularVelocity);
  const repair = repairModel(npc);
  const rawToDestroy = rawHitPoints(npc.derived, outgoing.mix) +
    repair.burstHitPoints / Math.max(0.01, layerRatio(npc.derived, repair.layer, outgoing.mix));
  const appliedPerSecond = outgoing.perSecond * averageRatio(npc.derived, outgoing.mix);
  const secondsToDestroy = outgoing.perSecond <= 0 || appliedPerSecond <= repair.perSecond
    ? null
    : rawToDestroy / outgoing.perSecond / (1 - repair.perSecond / appliedPerSecond);

  const incoming = landedDamage(content, npc, player, engagement, angularVelocity);
  const shieldApplied = incoming.perSecond * layerRatio(player.derived, 'shield', incoming.mix);
  const rounds = weapons.reduce((total, weapon) => total + weapon.magazineSize, 0) +
    (profile.loadout.reserveRounds ?? 0);
  const shotsPerSecond = weapons.reduce((total, weapon) =>
    total + (weapon.cycleSeconds > 0 ? 1 / weapon.cycleSeconds : 0), 0);

  return {
    profileId: profile.id,
    role: profile.role,
    movement: role.movement,
    preferredRangeKm: preferred,
    engagementRangeKm: engagement,
    maxSpeedKmPerSecond: npcSpeed,
    hitPoints: LAYERS.reduce((total, layer) => total + attributeValue(npc.derived, `${layer}HitPoints`), 0),
    rawHitPointsToDestroy: rawToDestroy,
    playerHitChance: outgoing.bestHitChance,
    playerDamagePerSecond: outgoing.perSecond,
    repairPerSecond: repair.perSecond,
    secondsToDestroy,
    incomingDamagePerSecond: shieldApplied,
    firingSeconds: shotsPerSecond > 0 ? rounds / shotsPerSecond : null,
  };
}

function diagnosePlayer(player: ShipModel, boosted: DerivedShipAttributes, fit: FixtureFit): PlayerDiagnosis {
  const loaded = player.summary.weapons.reduce((total, weapon) => total + weapon.magazineSize, 0);
  return {
    maxSpeedKmPerSecond: attributeValue(player.derived, 'maxSpeedKmPerSecond'),
    boostedSpeedKmPerSecond: attributeValue(boosted, 'maxSpeedKmPerSecond'),
    bufferHitPoints: LAYERS.reduce((total, layer) => total + attributeValue(player.derived, `${layer}HitPoints`), 0),
    repairPerSecond: LAYERS.reduce((total, layer) => total + player.summary.defense.sustainedHitPointsPerSecond[layer], 0),
    capacitorEnduranceSeconds: player.summary.capacitor.enduranceSeconds,
    roundsCarried: loaded + fit.cargo.reduce((total, entry) => total + entry.quantity, 0),
    listedDamagePerSecond: player.summary.weapons.reduce((total, weapon) => total + weapon.damagePerSecond, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Damage                                                                      */
/* -------------------------------------------------------------------------- */

interface Landed {
  /** Listed damage per second that hits, before the target's resistances. */
  readonly perSecond: number;
  /** Share of that damage by type. */
  readonly mix: Readonly<Record<DamageType, number>>;
  readonly bestHitChance: number;
}

/** What one ship's online turrets land on another at a range and angular velocity. */
function landedDamage(
  content: ContentRepository,
  shooter: ShipModel,
  target: ShipModel,
  rangeKm: number,
  angularVelocityRadiansPerSecond: number,
): Landed {
  const byType = Object.fromEntries(DAMAGE_TYPES.map((type) => [type, 0])) as Record<DamageType, number>;
  let perSecond = 0;
  let bestHitChance = 0;
  for (const weapon of shooter.summary.weapons) {
    if (!weapon.online || weapon.cycleSeconds <= 0) continue;
    const accuracy = turretAccuracy({
      optimalRangeKm: weapon.optimalRangeKm,
      falloffKm: weapon.falloffKm,
      trackingRadiansPerSecond: weapon.trackingRadiansPerSecond,
      signatureResolutionMetres: weapon.signatureResolutionMetres,
      targetSignatureMetres: attributeValue(target.derived, 'signatureRadiusMetres'),
      rangeKm,
      angularVelocityRadiansPerSecond,
    }, content.rules.combat);
    bestHitChance = Math.max(bestHitChance, accuracy.hitChance);
    for (const type of DAMAGE_TYPES) {
      const landed = weapon.damagePerShot[type] / weapon.cycleSeconds * accuracy.hitChance;
      byType[type] += landed;
      perSecond += landed;
    }
  }
  const mix = Object.fromEntries(DAMAGE_TYPES.map((type) =>
    [type, perSecond > 0 ? byType[type] / perSecond : 0.25])) as Record<DamageType, number>;
  return { perSecond, mix, bestHitChance };
}

/** Share of listed damage of this mix that a layer lets through. */
function layerRatio(derived: DerivedShipAttributes, layer: DefenseLayer, mix: Readonly<Record<DamageType, number>>): number {
  return DAMAGE_TYPES.reduce((total, type) =>
    total + mix[type] * (1 - attributeValue(derived, resistanceAttribute(layer, type))), 0);
}

/** Listed damage of this mix needed to take every layer to zero. */
function rawHitPoints(derived: DerivedShipAttributes, mix: Readonly<Record<DamageType, number>>): number {
  return LAYERS.reduce((total, layer) =>
    total + attributeValue(derived, `${layer}HitPoints`) / Math.max(0.01, layerRatio(derived, layer, mix)), 0);
}

function averageRatio(derived: DerivedShipAttributes, mix: Readonly<Record<DamageType, number>>): number {
  const hitPoints = LAYERS.reduce((total, layer) => total + attributeValue(derived, `${layer}HitPoints`), 0);
  const raw = rawHitPoints(derived, mix);
  return raw > 0 ? hitPoints / raw : 1;
}

interface RepairModel {
  /** What the repairers restore per second while the capacitor holds out. */
  readonly fullPerSecond: number;
  /** What the capacitor's recharge sustains once it has run down. */
  readonly perSecond: number;
  /** What running at the full rate until the capacitor is empty adds on top. */
  readonly burstHitPoints: number;
  readonly layer: DefenseLayer;
}

/**
 * A ship's own repair, limited by what its capacitor can pay for. Every
 * active module is assumed to run, as the fit summary's endurance does, so the
 * figure is the cautious one.
 */
function repairModel(ship: ShipModel): RepairModel {
  const capacitor = ship.summary.capacitor;
  let fullPerSecond = 0;
  let layer: DefenseLayer = 'armor';
  for (const candidate of LAYERS) {
    const rate = ship.summary.defense.sustainedHitPointsPerSecond[candidate];
    if (rate > fullPerSecond) {
      fullPerSecond = rate;
      layer = candidate;
    }
  }
  if (fullPerSecond <= 0) return { fullPerSecond: 0, perSecond: 0, burstHitPoints: 0, layer };
  const affordable = capacitor.drainPerSecond <= 0
    ? 1
    : Math.min(1, capacitor.rechargePerSecond / capacitor.drainPerSecond);
  return {
    fullPerSecond,
    perSecond: fullPerSecond * affordable,
    burstHitPoints: fullPerSecond * (1 - affordable) * (capacitor.enduranceSeconds ?? 0),
    layer,
  };
}

/** Longest fight the model follows when an opponent can never be destroyed. */
const MAXIMUM_FIGHT_SECONDS = 600;

interface TankResult {
  readonly damageTaken: number;
  readonly lowestHitPoints: number;
  readonly brokenAtSeconds: number | null;
}

/**
 * Follows the player's hit points through the fight a second at a time: every
 * opponent still alive and still carrying rounds fires, the repairers restore
 * at their full rate while the capacitor lasts and at the rate its recharge
 * sustains afterwards, and the shield regenerates. A burst from several
 * opponents at once therefore shows up even when the whole fight's totals
 * would balance.
 */
function sustainFight(
  player: ShipModel,
  diagnosis: PlayerDiagnosis,
  opponents: readonly OpponentDiagnosis[],
  deaths: readonly number[],
  fightSeconds: number,
): TankResult {
  const repair = repairModel(player);
  const endurance = player.summary.capacitor.enduranceSeconds ?? Infinity;
  const regeneration = attributeValue(player.derived, 'shieldHitPoints') /
    Math.max(1, attributeValue(player.derived, 'shieldRechargeSeconds'));
  let hitPoints = diagnosis.bufferHitPoints;
  let lowest = hitPoints;
  let damageTaken = 0;
  let brokenAtSeconds: number | null = null;
  for (let second = 0; second < Math.ceil(fightSeconds); second += 1) {
    const incoming = opponents.reduce((total, opponent, index) =>
      second < (deaths[index] ?? Infinity) && second < (opponent.firingSeconds ?? 0)
        ? total + opponent.incomingDamagePerSecond
        : total, 0);
    damageTaken += incoming;
    const restored = (second < endurance ? repair.fullPerSecond : repair.perSecond) + regeneration;
    hitPoints = Math.min(diagnosis.bufferHitPoints, hitPoints - incoming + restored);
    lowest = Math.min(lowest, hitPoints);
    if (hitPoints <= 0 && brokenAtSeconds === null) brokenAtSeconds = second + 1;
  }
  return { damageTaken, lowestHitPoints: Math.max(0, lowest), brokenAtSeconds };
}

/** Rounds the player fires to land the listed damage every opponent needs. */
function roundsFor(summary: FitSummary, opponents: readonly OpponentDiagnosis[]): number {
  const weapons = summary.weapons.filter((weapon) => weapon.online && weapon.cycleSeconds > 0);
  const volley = weapons.reduce((total, weapon) => total + weapon.volleyDamage, 0);
  if (volley <= 0) return 0;
  const shotsPerVolley = weapons.length;
  return Math.ceil(opponents.reduce((total, opponent) =>
    total + opponent.rawHitPointsToDestroy / Math.max(0.01, opponent.playerHitChance) / volley * shotsPerVolley, 0));
}

function rank(profileId: string, tactics: PilotTactics): number {
  const index = tactics.targetPriority.indexOf(profileId);
  return index === -1 ? tactics.targetPriority.length : index;
}

/* -------------------------------------------------------------------------- */
/* Findings                                                                    */
/* -------------------------------------------------------------------------- */

interface FindingInput {
  readonly opponents: readonly OpponentDiagnosis[];
  readonly playerDiagnosis: PlayerDiagnosis;
  readonly playerSpeed: number;
  readonly burning: boolean;
  readonly tank: TankResult;
  readonly roundsNeeded: number | null;
  readonly fightSeconds: number;
  /** The range the tactics hold against their target, or `null` when they close or orbit. */
  readonly holdRangeKm: number | null;
}

/**
 * How the brawlers fare against a ship that holds its range, when none of them
 * can reach it within the fight: either they never catch it, or the speed
 * difference is too small to close the distance before the fight is over.
 * `null` when the tactics hold no range or some brawler closes in time.
 */
function trailingBrawlers(input: FindingInput): string | null {
  const hold = input.holdRangeKm;
  const brawlers = input.opponents.filter((opponent) => opponent.movement === 'approach');
  if (hold === null || brawlers.length === 0) return null;
  let slowest = 0;
  for (const brawler of brawlers) {
    if (brawler.maxSpeedKmPerSecond < input.playerSpeed) continue;
    const closing = brawler.maxSpeedKmPerSecond - input.playerSpeed;
    const seconds = closing <= 0 ? Infinity : Math.max(0, hold - brawler.preferredRangeKm) / closing;
    if (seconds < input.fightSeconds) return null;
    slowest = Math.max(slowest, seconds);
  }
  return slowest === 0
    ? 'never catch it'
    : `need about ${slowest.toFixed(0)} s to close, longer than the ${input.fightSeconds.toFixed(0)} s fight`;
}

function findingsFor(input: FindingInput): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const opponent of input.opponents) {
    if (seen.has(opponent.profileId)) continue;
    seen.add(opponent.profileId);
    const name = opponent.profileId;
    if (opponent.playerDamagePerSecond <= 0) {
      findings.push({
        severity: 'blocking',
        code: 'unreachable',
        message: `${name} holds ${km(opponent.preferredRangeKm)} and no fitted weapon lands a shot there, ` +
          `while it moves at ${speed(opponent.maxSpeedKmPerSecond)} against ${speed(input.playerSpeed)}.`,
      });
    } else if (opponent.secondsToDestroy === null) {
      findings.push({
        severity: 'blocking',
        code: 'outRepaired',
        message: `${name} repairs ${opponent.repairPerSecond.toFixed(1)} hp/s, at least what the guns apply at ${km(opponent.engagementRangeKm)}.`,
      });
    }
    if (opponent.maxSpeedKmPerSecond >= input.playerSpeed && opponent.movement !== 'approach') {
      findings.push({
        severity: 'note',
        code: 'outpaced',
        message: `${name} is at least as fast (${speed(opponent.maxSpeedKmPerSecond)} against ${speed(input.playerSpeed)}${input.burning ? ' burning' : ''}), ` +
          `so it fights at the ${km(opponent.preferredRangeKm)} it prefers; the player hits ${pct(opponent.playerHitChance)} there.`,
      });
    }
  }
  if (input.roundsNeeded !== null && input.roundsNeeded > input.playerDiagnosis.roundsCarried) {
    findings.push({
      severity: 'warning',
      code: 'ammunition',
      message: `about ${String(input.roundsNeeded)} rounds are needed and ${String(input.playerDiagnosis.roundsCarried)} are carried.`,
    });
  }
  if (input.tank.brokenAtSeconds !== null) {
    const firing = input.opponents.filter((opponent) =>
      (opponent.firingSeconds ?? 0) > (input.tank.brokenAtSeconds ?? 0)).length;
    const trailing = trailingBrawlers(input);
    findings.push({
      // A ship that holds its range against brawlers that cannot close on it
      // within the fight is this model's blind spot: it would meet them one at
      // a time, not all at once from the first second.
      severity: trailing === null ? 'warning' : 'note',
      code: 'overwhelmed',
      message: `the layers give out after about ${String(input.tank.brokenAtSeconds)} s: ` +
        `${input.tank.damageTaken.toFixed(0)} damage arrives over the fight from up to ${String(firing)} opponents, ` +
        `faster than ${input.playerDiagnosis.bufferHitPoints.toFixed(0)} hp, repair and recharge can absorb.` +
        (trailing === null ? '' : ` But holding ${km(input.holdRangeKm ?? 0)}, the brawlers ${trailing}: ` +
          'this model puts them all in range from the first second, so it overstates the fire a kiting fit takes; the scenarios decide.'),
    });
  }
  const endurance = input.playerDiagnosis.capacitorEnduranceSeconds;
  if (endurance !== null && endurance < input.fightSeconds) {
    findings.push({
      severity: 'note',
      code: 'capacitor',
      message: `with every active module running the capacitor lasts ${endurance.toFixed(0)} s of a ${input.fightSeconds.toFixed(0)} s fight.`,
    });
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

export interface DiagnosedScenario {
  readonly scenarioId: string;
  readonly expect: string;
  readonly costCredits: number;
  readonly diagnosis: EncounterDiagnosis;
}

export function describeDiagnosis(diagnosis: EncounterDiagnosis): string {
  const opponents = diagnosis.opponents.map((opponent) =>
    `${opponent.profileId} at ${km(opponent.engagementRangeKm)}: player hits ${pct(opponent.playerHitChance)}, ` +
    `${opponent.secondsToDestroy === null ? 'cannot destroy' : `${opponent.secondsToDestroy.toFixed(0)} s to destroy`}, ` +
    `it applies ${opponent.incomingDamagePerSecond.toFixed(1)}/s`);
  const findings = diagnosis.findings.map((finding) => `[${finding.severity}] ${finding.message}`);
  return [...opponents, ...findings].join('; ');
}

export function renderDiagnosticsMarkdown(scenarios: readonly DiagnosedScenario[]): string {
  const lines = [
    '# Content diagnostics',
    '',
    'Generated by `npm run diagnose:content` from `tests/fixtures/scenarios/progression.json`. Do not edit by hand.',
    '',
    'Each representative fit is set against its encounter with the engine\'s own formulas: one range per opponent,',
    'orbiting opponents circling at full speed and the rest moving radially, opponents destroyed one at a time in the',
    'tactics\' priority order. The figures explain; the headless progression scenarios decide.',
    '',
  ];
  for (const scenario of scenarios) {
    const diagnosis = scenario.diagnosis;
    const player = diagnosis.player;
    lines.push(
      `## ${scenario.scenarioId} (expected: ${scenario.expect})`,
      '',
      `Fit \`${diagnosis.fitId}\` costs ${String(scenario.costCredits)} credits from a new campaign. ` +
        `Encounter \`${diagnosis.encounterId}\`, tier ${String(diagnosis.tier)}.`,
      '',
      `Player: ${player.listedDamagePerSecond.toFixed(1)} listed damage/s, ${player.bufferHitPoints.toFixed(0)} hp, ` +
        `repair ${player.repairPerSecond.toFixed(1)} hp/s, speed ${speed(player.maxSpeedKmPerSecond)} ` +
        `(${speed(player.boostedSpeedKmPerSecond)} burning), capacitor ` +
        `${player.capacitorEnduranceSeconds === null ? 'stable' : `lasts ${player.capacitorEnduranceSeconds.toFixed(0)} s`}, ` +
        `${String(player.roundsCarried)} rounds.`,
      '',
      '| Opponent | Role | Prefers | Fought at | Speed | HP | Player hit | Player dmg/s | Repair/s | Time to destroy | Its dmg/s on shield | Fires for |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const opponent of diagnosis.opponents) {
      lines.push(`| ${opponent.profileId} | ${opponent.role} | ${km(opponent.preferredRangeKm)} | ` +
        `${km(opponent.engagementRangeKm)} | ${speed(opponent.maxSpeedKmPerSecond)} | ${opponent.hitPoints.toFixed(0)} | ` +
        `${pct(opponent.playerHitChance)} | ${opponent.playerDamagePerSecond.toFixed(1)} | ${opponent.repairPerSecond.toFixed(1)} | ` +
        `${opponent.secondsToDestroy === null ? 'never' : `${opponent.secondsToDestroy.toFixed(0)} s`} | ` +
        `${opponent.incomingDamagePerSecond.toFixed(1)} | ` +
        `${opponent.firingSeconds === null ? '-' : `${opponent.firingSeconds.toFixed(0)} s`} |`);
    }
    lines.push(
      '',
      `Estimate: ${diagnosis.secondsToDestroyAll === null ? 'not every opponent can be destroyed' : `${diagnosis.secondsToDestroyAll.toFixed(0)} s to destroy every opponent`}, ` +
        `${diagnosis.estimatedDamageTaken.toFixed(0)} damage taken, ` +
        `${diagnosis.brokenAtSeconds === null ? `never below ${diagnosis.lowestHitPoints.toFixed(0)} hp` : `layers broken at ${String(diagnosis.brokenAtSeconds)} s`}, ` +
        `${diagnosis.roundsNeeded === null ? 'rounds needed unknown' : `about ${String(diagnosis.roundsNeeded)} rounds needed`}.`,
      '',
    );
    if (diagnosis.findings.length === 0) {
      lines.push('No findings.', '');
    } else {
      for (const finding of diagnosis.findings) lines.push(`- **${finding.severity}** (${finding.code}): ${finding.message}`);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

function km(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)} km`;
}

function speed(value: number): string {
  return `${value.toFixed(2)} km/s`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
