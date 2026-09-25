/**
 * Player ship destruction, the loss report and the recovery route
 * (Functional Specification 9.12, 22.1; Technical Specification 10.9).
 */
export { ensureRecoveryRoute, grantRecoveryShip } from './grant';
export { disablingEffects, finalDamage, incomingDamage } from './report';
export type { SourceName } from './report';
export {
  insuranceSettlement,
  isFlightReady,
  recoveryGrantDue,
  replacementShipAt,
  starterReferenceValue,
} from './rules';
export type { InsuranceSettlement } from './rules';
export { startingRecovery } from './start';
export {
  LOSS_DISABLING_KINDS,
  LOSS_ITEM_ORIGINS,
  LOSS_RECOVERY_OUTCOMES,
} from './types';
export type {
  LossDamageSourceRecord,
  LossDisablingEffectRecord,
  LossDisablingKind,
  LossFinalDamageRecord,
  LossInsuranceRecord,
  LossItemOrigin,
  LossItemRecord,
  LossRecord,
  LossRecoveryOutcome,
  LossRecoveryRecord,
  RecoveryState,
} from './types';
export { isRecoveryState, validateRecovery } from './validation';
