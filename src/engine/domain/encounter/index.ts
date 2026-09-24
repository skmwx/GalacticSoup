/**
 * Authored encounters, opponents, wrecks and their rewards
 * (Functional Specification 9.10-9.11; Technical Specification 10.3, 10.6).
 */
export {
  ENCOUNTER_COMMANDS,
  ENCOUNTER_REFUSALS,
  wreckAccessRefusal,
} from './availability';
export type {
  EncounterCommand,
  EncounterCommandRefusal,
  EncounterRefusal,
  EncounterRuleInput,
} from './availability';
export { OBJECT_ATTITUDES, objectAttitude } from './attitude';
export type { ObjectAttitude } from './attitude';
export { preferredRangeKm, selectNpcIntent } from './behavior';
export type { NpcIntent, NpcSituation } from './behavior';
export { possibleLoot, rollLoot } from './loot';
export { startingEncounters } from './start';
export {
  activeEncounter,
  bountyGrantId,
  completionCount,
  completionGrantId,
  encounterChanged,
  isEncounterShip,
  isGranted,
  mutableEncounter,
  npcOf,
  objectiveComplete,
  runningEncounter,
  survivingNpcs,
  wreck,
  wrecksInSite,
} from './state';
export type { MutableEncounterState } from './state';
export {
  ENCOUNTER_STATUSES,
} from './types';
export type {
  EncounterInstanceState,
  EncounterNpcState,
  EncounterObjectiveState,
  EncounterOutcomeRecord,
  EncounterState,
  EncounterStatus,
  RolledLootEntry,
  WreckState,
} from './types';
export {
  isEncounterState,
  NPC_DECISION_KIND,
  validateEncounter,
  WRECK_EXPIRE_KIND,
} from './validation';
