/**
 * Dependency-free primitives shared by every layer
 * (Technical Specification 4.3).
 */
export {
  canonicalJson,
  CanonicalJsonError,
  canonicalNumber,
  canonicalString,
  sha256Bytes,
  sha256Hex,
  utf8Bytes,
} from './canonical/index.ts';
export type { CanonicalValue } from './canonical/index.ts';
export {
  CloneError,
  compareStable,
  deepClone,
  deepFreeze,
  indexBy,
  sortedBy,
  sortedEntries,
  sortedKeys,
} from './collections/index.ts';
export type { Mutable } from './collections/index.ts';
export {
  asDefinitionId,
  DEFINITION_ID_PATTERN,
  definitionNamespaceOf,
  isDefinitionId,
  isDefinitionIdIn,
  MAX_DEFINITION_ID_LENGTH,
} from './ids/index.ts';
export type {
  AmmunitionId,
  DefinitionId,
  EncounterId,
  GuidanceId,
  NotificationId,
  AudioCueId,
  HullId,
  ItemId,
  LootTableId,
  ModuleId,
  NpcProfileId,
  SiteId,
  StationId,
  SystemId,
} from './ids/index.ts';
export { formatMessage } from './localization/format.ts';
export type { FormatResult } from './localization/format.ts';
export { createLocalizer } from './localization/localizer.ts';
export type { Localizer, LocalizerOptions } from './localization/localizer.ts';
export type {
  LocalizationIssue,
  LocalizationIssueHandler,
  MessageCatalog,
  MessageKey,
  MessageParams,
  MessageParamValue,
} from './localization/types.ts';
export {
  ceilToInteger,
  clamp,
  clampFraction,
  clampResistance,
  credits,
  cubicDecimetres,
  cubicMetresToCubicDecimetres,
  floorToInteger,
  FRACTION_MAXIMUM,
  FRACTION_MINIMUM,
  hitPoints,
  isConvertibleVolume,
  isCount,
  isFiniteNumber,
  isInRange,
  isIntegerInRange,
  isNonNegativeNumber,
  isPositiveCount,
  isPositiveNumber,
  isSafeInteger,
  kilometres,
  kilometresPerSecond,
  milliseconds,
  quantity,
  radians,
  radiansPerSecond,
  RESISTANCE_MAXIMUM,
  RESISTANCE_MINIMUM,
  roundToInteger,
  secondsToMilliseconds,
} from './numeric/index.ts';
export type {
  Credits,
  CubicDecimetres,
  HitPoints,
  Kilometres,
  KilometresPerSecond,
  Milliseconds,
  Quantity,
  Radians,
  RadiansPerSecond,
} from './numeric/index.ts';
export { findStructuralViolation } from './structure/limits.ts';
export type {
  StructuralLimits,
  StructuralViolation,
  StructuralViolationReason,
} from './structure/limits.ts';
