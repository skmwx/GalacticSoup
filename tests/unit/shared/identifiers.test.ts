import { describe, expect, it } from 'vitest';

import {
  asDefinitionId,
  definitionNamespaceOf,
  isDefinitionId,
  isDefinitionIdIn,
  MAX_DEFINITION_ID_LENGTH,
} from '@shared';

/**
 * Definition ids are authored, namespaced and stable. They are never derived
 * from a display name or an array position, and an unchecked string must never
 * become one (Technical Specification 5.1).
 */
describe('definition identifiers', () => {
  it.each([
    'hull.independent.starter',
    'module.turret.autocannon.small',
    'site.borrell.derelict-lane',
    'ammo.projectile.small.fusion',
  ])('accepts the authored id %s [TECH-5.1]', (id) => {
    expect(isDefinitionId(id)).toBe(true);
  });

  it.each([
    ['a single segment', 'hull'],
    ['an uppercase segment', 'Hull.starter'],
    ['a leading dot', '.hull.starter'],
    ['a trailing dot', 'hull.starter.'],
    ['an empty segment', 'hull..starter'],
    ['a space', 'hull starter'],
    ['a display name', 'Wayfarer'],
    ['a segment starting with a hyphen', 'hull.-starter'],
    ['a number', 7],
    ['nothing', undefined],
  ])('rejects %s [TECH-5.1]', (_label, id) => {
    expect(isDefinitionId(id)).toBe(false);
  });

  it('rejects an id longer than the published limit [TECH-5.1, TECH-14]', () => {
    const long = `hull.${'x'.repeat(MAX_DEFINITION_ID_LENGTH)}`;

    expect(long.length).toBeGreaterThan(MAX_DEFINITION_ID_LENGTH);
    expect(isDefinitionId(long)).toBe(false);
  });

  it('reads the namespace from the first segment [TECH-5.1]', () => {
    expect(definitionNamespaceOf('module.plating.armor.small')).toBe('module');
    expect(definitionNamespaceOf('not an id')).toBeNull();
  });

  it('distinguishes namespaces [TECH-5.1]', () => {
    expect(isDefinitionIdIn('hull.independent.starter', 'hull')).toBe(true);
    expect(isDefinitionIdIn('hull.independent.starter', 'module')).toBe(false);
  });

  it('refuses to brand a string of the wrong namespace [TECH-5.1]', () => {
    expect(asDefinitionId('hull.independent.starter', 'hull')).toBe('hull.independent.starter');
    expect(() => asDefinitionId('hull.independent.starter', 'module')).toThrow(TypeError);
    expect(() => asDefinitionId('Wayfarer', 'hull')).toThrow(TypeError);
  });
});
