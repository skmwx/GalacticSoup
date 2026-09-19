/**
 * Stable, namespaced identifiers for authored definitions
 * (Technical Specification 5.1).
 *
 * A definition id is authored, never derived from a display name or an array
 * position, and never changes once shipped. The first segment is the namespace
 * and states what kind of definition the id refers to, so a reference can be
 * checked before the target is resolved: `hull.independent.starter` is a hull.
 *
 * The type is branded by namespace, so a `HullId` cannot be passed where a
 * `ModuleId` is expected even though both are strings at runtime.
 *
 * @implements TECH-5.1
 */

declare const definitionNamespaceBrand: unique symbol;

export type DefinitionId<TNamespace extends string = string> = string & {
  readonly [definitionNamespaceBrand]: TNamespace;
};

export type HullId = DefinitionId<'hull'>;
export type ModuleId = DefinitionId<'module'>;
export type AmmunitionId = DefinitionId<'ammo'>;
export type ItemId = DefinitionId<'item'>;
export type SystemId = DefinitionId<'system'>;
export type SiteId = DefinitionId<'site'>;
export type StationId = DefinitionId<'station'>;
export type NpcProfileId = DefinitionId<'npc'>;
export type LootTableId = DefinitionId<'loot'>;
export type EncounterId = DefinitionId<'encounter'>;

/**
 * Lowercase segments separated by dots, at least two segments. Segments may
 * contain digits and inner hyphens. The shape is deliberately narrow so ids
 * survive file names, URLs, JSON keys and a future Java port unchanged.
 */
export const DEFINITION_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

export const MAX_DEFINITION_ID_LENGTH = 96;

export function isDefinitionId(value: unknown): value is DefinitionId {
  return (
    typeof value === 'string' &&
    value.length <= MAX_DEFINITION_ID_LENGTH &&
    DEFINITION_ID_PATTERN.test(value)
  );
}

/** The namespace segment, or `null` when `value` is not a definition id. */
export function definitionNamespaceOf(value: string): string | null {
  if (!isDefinitionId(value)) {
    return null;
  }
  const separator = value.indexOf('.');
  return value.slice(0, separator);
}

export function isDefinitionIdIn<TNamespace extends string>(
  value: unknown,
  namespace: TNamespace,
): value is DefinitionId<TNamespace> {
  return typeof value === 'string' && definitionNamespaceOf(value) === namespace;
}

/**
 * Brands a validated string. Throws on anything that is not a definition id of
 * the requested namespace: an unchecked id must never reach domain state.
 */
export function asDefinitionId<TNamespace extends string>(
  value: string,
  namespace: TNamespace,
): DefinitionId<TNamespace> {
  if (!isDefinitionIdIn(value, namespace)) {
    throw new TypeError(`"${value}" is not a "${namespace}" definition id.`);
  }
  return value;
}
